// ===============================
// 05_Biz_Calendar_Sheet.gs
// ===============================

// ---- Calendar ----

// 空き判定（前後INTERVAL_MINバッファ込み）
// ★改修：eventsCache引数追加で一括取得対応、try-catch追加
function isSlotFree_(start, end, eventsCache) {
  try {
    const from = new Date(start.getTime() - INTERVAL_MIN * 60000);
    const to = new Date(end.getTime() + INTERVAL_MIN * 60000);

    // キャッシュがあればAPI呼び出しをスキップ
    if (eventsCache && Array.isArray(eventsCache)) {
      for (const ev of eventsCache) {
        const evStart = ev.getStartTime();
        const evEnd = ev.getEndTime();
        // イベントが時間範囲と重なるかチェック
        if (evStart < to && evEnd > from) {
          return false;
        }
      }
      return true;
    }

    // キャッシュがなければ従来通りAPI呼び出し
    const cal = CalendarApp.getCalendarById(CALENDAR_ID);
    return cal.getEvents(from, to).length === 0;
  } catch (e) {
    console.log("isSlotFree_ error:", e);
    return false; // エラー時は空きなしとして安全側に倒す
  }
}

// ★追加：1日分のイベントを一括取得（パフォーマンス改善）
function getDayEvents_(dateYMD) {
  try {
    const ymd = String(dateYMD || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return [];

    const [y, m, d] = ymd.split("-").map(Number);
    const dayStart = new Date(y, m - 1, d, 0, 0, 0);
    const dayEnd = new Date(y, m - 1, d, 23, 59, 59);

    const cal = CalendarApp.getCalendarById(CALENDAR_ID);
    return cal.getEvents(dayStart, dayEnd);
  } catch (e) {
    console.log("getDayEvents_ error:", e);
    return [];
  }
}

// ステータス→色
function pickEventColorByStatus_(status) {
  switch (status) {
    case ST_HOLD:
      return CalendarApp.EventColor.PALE_BLUE; // 一時確保

    case ST_WAIT_PAY:
      return CalendarApp.EventColor.YELLOW;    // 支払い待ち

    case ST_PAID_REPORTED:
      return CalendarApp.EventColor.ORANGE;    // 支払い報告（確認待ち）

    case ST_PAID_CONFIRMED:
    case ST_INPERSON_FIXED:
      return CalendarApp.EventColor.GREEN;     // 予約確定

    case ST_CANCELLED:
    case ST_EXPIRED:
      return CalendarApp.EventColor.GRAY;      // 参考（基本イベント削除運用でもOK）

    default:
      return CalendarApp.EventColor.BLUE;
  }
}

// 日本語タイトル
function buildEventTitleJP_(r) {
  const fmt = (r.format === "ONLINE") ? "オンライン" : "対面";
  const area = (r.format === "INPERSON" && r.area) ? `（${r.area}）` : "";
  const mins = `${r.minutes}分`;

  if (r.status === ST_HOLD) return `【一時確保】${fmt}${area} ${mins}（${r.key}）`;
  if (r.status === ST_WAIT_PAY) return `【予約】${fmt}${area} ${mins}（支払い待ち）`;
  if (r.status === ST_PAID_REPORTED) return `【予約】${fmt}${area} ${mins}（支払い報告）`;
  if (r.status === ST_PAID_CONFIRMED) return `【予約確定】${fmt}${area} ${mins}（支払済）`;
  if (r.status === ST_INPERSON_FIXED) return `【予約確定】${fmt}${area} ${mins}`;
  if (r.status === ST_CANCELLED) return `【キャンセル】${fmt}${area} ${mins}`;
  if (r.status === ST_EXPIRED) return `【期限切れ】${fmt}${area} ${mins}`;

  return `【予約】${fmt}${area} ${mins}（${r.key}）`;
}

// 日本語説明（人間が見て分かる＋cron互換用のkey/userId/expiresAtを残す）
function buildEventDescJP_(r) {
  // オンライン支払い期限（開始3時間前まで）
  let deadlineText = "-";
  if (r.format === "ONLINE" && r.startISO) {
    const d = new Date(new Date(r.startISO).getTime() - PAY_CANCEL_HOURS_BEFORE * 3600000);
    deadlineText = `${fmtYMD_(d)} ${fmtHM_(d)}`;
  }

  const lines = [];
  lines.push(`【状態】${r.status}`);
  lines.push(`【氏名】${(r.formData && r.formData.name) || "-"}`);
  lines.push(`【形式】${r.format === "ONLINE" ? "オンライン" : "対面"}`);
  lines.push(`【エリア】${r.area || "-"}`);
  lines.push(`【鑑定】${r.minutes}分`);
  lines.push(`【料金】${fmtYen_(r.price)}`);
  lines.push(`【支払い】${r.payMethod || "-"}`);
  lines.push(`【支払い期限】${deadlineText}`);
  lines.push(`【Meet】${MEET_URL}`);
  lines.push(`【受付キー】${r.key}`);

  // cron/検索互換（古い実装で拾ってる形式も残す）
  lines.push(`key:${r.key}`);

  if (r.holdExpiresISO) lines.push(`expiresAt:${r.holdExpiresISO}`);

  return lines.join("\n");
}

// HOLD作成（イベント色つき）
function createHold_(start, end, key, userId, expiresAt) {
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);

  const dummy = {
    key,
    userId,
    format: "ONLINE", // HOLDは形式確定後に作るのでここは置物。後でupdateで上書き
    area: "",
    minutes: 0,
    price: 0,
    status: ST_HOLD,
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    holdExpiresISO: expiresAt.toISOString(),
    payMethod: "",
    createdAtISO: nowISO_(),
  };

  const ev = cal.createEvent(
    `【一時確保】予約（${key}）`,
    start,
    end,
    { description: buildEventDescJP_(dummy) }
  );
  ev.setColor(pickEventColorByStatus_(ST_HOLD));
}

// 既存イベント（key一致）を、日本語タイトル/説明/色に更新
function updateCalendarEventTitle_(r) {
  try {
    const cal = CalendarApp.getCalendarById(CALENDAR_ID);
    const start = new Date(r.startISO);
    const end = new Date(r.endISO);

    const events = cal.getEvents(
      new Date(start.getTime() - 60000),
      new Date(end.getTime() + 60000)
    );

    events.forEach((ev) => {
      const desc = ev.getDescription() || "";
      const title = ev.getTitle() || "";

      // key一致判定（複数パターンで拾う）
      const hit =
        desc.includes(`key:${r.key}`) ||
        desc.includes(`【受付キー】${r.key}`) ||
        title.includes(r.key);

      if (!hit) return;

      // ★改修：キャンセル・期限切れの場合はカレンダーから削除（枠を空ける）
      if (r.status === ST_CANCELLED || r.status === ST_EXPIRED) {
        ev.deleteEvent();
        return;
      }

      ev.setTitle(buildEventTitleJP_(r));
      ev.setDescription(buildEventDescJP_(r));
      ev.setColor(pickEventColorByStatus_(r.status));
    });
  } catch (e) {
    console.log("updateCalendarEventTitle_ error:", e);
  }
}

// ---- 候補計算 ----
// ★改修：一括取得対応でパフォーマンス改善
function computeCandidateSlots_(st) {
  const part = PARTS[st.partLabel || ""];
  if (!part || !st.minutes || !st.dateYMD) return [];

  const ymd = String(st.dateYMD).replace(/（本日）/g, "").trim();
  const [y, m, d] = ymd.split("-").map(Number);
  const base = new Date(y, m - 1, d, 0, 0, 0);

  const [sh, sm] = part.start.split(":").map(Number);
  const [eh, em] = part.end.split(":").map(Number);

  const startBase = new Date(base); startBase.setHours(sh, sm, 0, 0);
  const endLimit = new Date(base); endLimit.setHours(eh, em, 0, 0);

  let sameDayLimit = null;
  if (isSameDate_(new Date(), base)) {
    sameDayLimit = new Date(Date.now() + SAME_DAY_LIMIT_HOURS * 3600000);
  }

  // ★一括取得：1回のAPI呼び出しで1日分のイベントを取得
  const eventsCache = getDayEvents_(ymd);

  const out = [];
  for (let t = new Date(startBase); t < endLimit; t = new Date(t.getTime() + SLOT_STEP_MIN * 60000)) {
    if (sameDayLimit && t < sameDayLimit) continue;

    const end = new Date(t.getTime() + st.minutes * 60000);
    if (end > endLimit) continue;

    if (isSlotFree_(t, end, eventsCache)) out.push(new Date(t));
  }
  return out;
}

// ---- シートUPSERT ----
function notifySheetUpsert_(res) {
  try {
    const httpRes = UrlFetchApp.fetch(SHEET_WEBAPP_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        secret: SHEET_API_SECRET,
        cmd: "UPSERT_RESERVATION",
        data: {
          key: res.key,
          date: res.dateYMD,
          start: fmtHM_(new Date(res.startISO)),
          end: fmtHM_(new Date(res.endISO)),
          type: res.format === "ONLINE" ? "オンライン" : "対面",
          area: res.area || "",
          minutes: res.minutes,
          price: res.price,
          status: res.status,
        },
      }),
      muteHttpExceptions: true,
    });

    // レスポンス確認
    const code = httpRes.getResponseCode();
    const content = httpRes.getContentText();

    if (code !== 200) {
      console.error(`Sheet API HTTP Error (${code}):`, content);
      return;
    }

    // JSONパースして論理エラー確認
    try {
      const result = JSON.parse(content);
      if (!result.ok) {
        console.error("Sheet API Logical Error:", result);
      }
    } catch (e) {
      console.error("Sheet API Response Parse Error:", content);
    }
  } catch (e) {
    console.error("notifySheetUpsert_ error:", e);
  }
}

// ---- 支払い案内文（オンライン用）----
// ---- 支払い案内文（オンライン用）----
function buildOnlinePayInfoText_(payMethod, startISO) {
  const pm = normalizePayMethod_(payMethod || "");
  let head = "【お支払い】\n";
  if (pm) head += `（選択：${pm}）\n`;

  let deadlineText = "";
  if (startISO) {
    const deadline = new Date(new Date(startISO).getTime() - PAY_CANCEL_HOURS_BEFORE * 3600000);
    deadlineText =
      `\n⚠️ 支払期限：${fmtYMD_(deadline)} ${fmtHM_(deadline)}\n` +
      "※期限を過ぎると自動キャンセルされます\n";
  }

  const commonTail =
    "\n支払完了後、下部ボタン「" + CMD_PAID_REPORT + "」を押してください。\n" +
    "※未払いでは鑑定できません🙇‍♂️";

  if (pm === "PayPay") {
    return head + "PayPay：" + PAY_PAYPAY_ID + deadlineText + commonTail;
  }
  if (pm === "振込") {
    return head + "銀行振込：\n" + PAY_BANK_TEXT + deadlineText + commonTail;
  }

  return head +
    "PayPay：" + PAY_PAYPAY_ID + "\n" +
    "銀行振込：\n" + PAY_BANK_TEXT + deadlineText + commonTail;
}

// ---- 1人1枠制限：アクティブ取得 ----
function getActiveReservationForUser_(userId) {
  const keys = getUserKeys_(userId);
  if (!keys.length) return null;

  for (let i = keys.length - 1; i >= 0; i--) {
    const r = loadReservation_(keys[i]);
    if (!r) continue;

    const start = new Date(r.startISO);
    if (!isNaN(start.getTime()) && start.getTime() < Date.now()) continue;

    if (ACTIVE_STATUSES.includes(r.status)) {
      if (r.status === ST_HOLD) {
        const exp = new Date(r.holdExpiresISO);
        if (isNaN(exp.getTime())) continue;
        if (Date.now() > exp.getTime()) continue;
      }
      return r;
    }
  }
  return null;
}

// 過去予約を消化済みに落とす（ブロック解除）
function autoClosePastReservationForUser_(userId) {
  const keys = getUserKeys_(userId);
  if (!keys.length) return;

  const now = Date.now();
  for (let i = keys.length - 1; i >= 0; i--) {
    const r = loadReservation_(keys[i]);
    if (!r) continue;
    if ([ST_DONE, ST_EXPIRED, ST_CANCELLED].includes(r.status)) continue;

    const end = new Date(r.endISO);
    if (isNaN(end.getTime())) continue;

    if (end.getTime() < now) {
      r.status = ST_DONE;
      r.updatedAtISO = nowISO_();
      saveReservation_(r.key, r);
      try { notifySheetUpsert_(r); } catch (e) { }
      try { updateCalendarEventTitle_(r); } catch (e) { }
    }
  }
}

// ★★★ 予約状況API用：特定の部の空き状況を判定（修正版） ★★★
// ★改修：eventsCache対応で高速化
// ★★★ 予約状況API用：特定の部の空き状況を判定（修正版：詳細スロット情報対応） ★★★
// ★改修：eventsCache対応で高速化 + slots配列返却 + status判定ロジック変更
function getPartAvailability_(partLabel, dateYMD, eventsCache) {
  const part = PARTS[partLabel];
  if (!part) {
    return { status: "full", count: 0, slots: [] };
  }

  const ymd = String(dateYMD || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return { status: "full", count: 0, slots: [] };
  }

  const [y, m, d] = ymd.split("-").map(Number);
  // タイムゾーンを考慮してbaseを作成（日本時間）
  const baseStr = ymd + " 00:00:00";
  const base = Utilities.parseDate(baseStr, TZ, "yyyy-MM-dd HH:mm:ss");

  // ★★★ 当日の時刻判定（日本時間） ★★★
  const now = new Date();
  const nowStr = Utilities.formatDate(now, TZ, "yyyy-MM-dd HH:mm:ss");
  const nowJST = Utilities.parseDate(nowStr, TZ, "yyyy-MM-dd HH:mm:ss");
  const baseDateStr = Utilities.formatDate(base, TZ, "yyyy-MM-dd");
  const nowDateStr = Utilities.formatDate(nowJST, TZ, "yyyy-MM-dd");
  const isToday = (baseDateStr === nowDateStr);

  if (isToday) {
    // 部の終了時刻を過ぎていたら終了
    const [eh, em] = part.end.split(":").map(Number);
    const ehStr = (eh < 10 ? "0" : "") + eh;
    const emStr = (em < 10 ? "0" : "") + em;
    const partEndTimeStr = ymd + " " + ehStr + ":" + emStr + ":00";
    const partEndTime = Utilities.parseDate(partEndTimeStr, TZ, "yyyy-MM-dd HH:mm:ss");

    if (nowJST >= partEndTime) {
      return { status: "full", count: 0, slots: [] };
    }
  }

  const [sh, sm] = part.start.split(":").map(Number);
  const [eh, em] = part.end.split(":").map(Number);

  const shStr = (sh < 10 ? "0" : "") + sh;
  const smStr = (sm < 10 ? "0" : "") + sm;
  const ehStr = (eh < 10 ? "0" : "") + eh;
  const emStr = (em < 10 ? "0" : "") + em;

  const startBaseStr = ymd + " " + shStr + ":" + smStr + ":00";
  const endLimitStr = ymd + " " + ehStr + ":" + emStr + ":00";
  const startBase = Utilities.parseDate(startBaseStr, TZ, "yyyy-MM-dd HH:mm:ss");
  const endLimit = Utilities.parseDate(endLimitStr, TZ, "yyyy-MM-dd HH:mm:ss");

  // 30分刻みで空き枠をカウント
  let totalSlots = 0;
  let count = 0;
  const minMinutes = 30;
  const slotStatuses = []; // true:空き, false:不可

  // もしキャッシュが渡されていなければ内部で取得（後方互換）
  const cache = eventsCache || getDayEvents_(ymd);

  for (let t = new Date(startBase); t < endLimit; t = new Date(t.getTime() + SLOT_STEP_MIN * 60000)) {
    totalSlots++;

    // ★★★ 修正：各スロットの開始時刻の5時間前をチェック（日本時間） ★★★
    let isTimeOk = true;
    if (isToday) {
      // スロットの開始時刻の5時間前を計算（日本時間）
      // tは日本時間で作成されているので、そのまま5時間前を計算
      const slotDeadline = new Date(t.getTime() - SAME_DAY_LIMIT_HOURS * 3600000);
      // 現在時刻（日本時間）が「このスロットの開始時刻の5時間前」以上だったらスキップ
      if (nowJST.getTime() >= slotDeadline.getTime()) {
        isTimeOk = false;
      }
    }

    if (!isTimeOk) {
      slotStatuses.push(false); // 時間切れ
      continue;
    }

    const end = new Date(t.getTime() + minMinutes * 60000);
    if (end > endLimit) {
      slotStatuses.push(false); // 時間外
      continue;
    }

    if (isSlotFree_(t, end, cache)) {
      count++;
      slotStatuses.push(true); // 空き
    } else {
      slotStatuses.push(false); // 予約済み
    }
  }

  // ステータス判定
  let status = "full";
  if (count === totalSlots && count > 0) {
    status = "available"; // 全て空いている
  } else if (count > 0) {
    status = "limited";   // まだ空きがある（一部埋まっている）
  }

  return { status, count, slots: slotStatuses };
}
