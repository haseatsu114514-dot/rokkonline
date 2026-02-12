// ===============================
// 06b_Flow_Conversation.gs（会話フロー）★改修版
// ===============================

// ===================================================
// UI: 戻る（中止は無し）
// ===================================================
const BACK_TO_FORMAT = "戻る（形式へ）";
const BACK_TO_MIN = "戻る（鑑定分数へ）";  // 分数が先になった
const BACK_TO_DATE = "戻る（日付へ）";
const BACK_TO_PART = "戻る（時間帯へ）";

// 時間帯ページ送り（Buttons 4個制限対策）
const PART_NEXT = "__PART_NEXT__";

// ===================================================
// 日付表示（ユーザー向け）
// ===================================================
function fmtMDJP_(ymd) {
  const s = String(ymd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [y, m, d] = s.split("-").map(Number);
  return `${m}月${d}日`;
}

// 本日から31日以内か（31日先の 00:00 未満）
function isWithin31Days_(dateObj) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const max = new Date(today.getTime() + 31 * 86400000); // 31日先の00:00
  return (dateObj >= today) && (dateObj < max);
}

// ===================================================
// 日付：QuickReply（表示は「1月30日」）
// ★改修：対面鑑定は当日受付不可
// ===================================================
function askDate_(token, userId) {
  const st = getState_(userId) || {};
  const isInperson = st.format === "INPERSON";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const labels = [];
  const map = [];

  // ★対面は当日不可なので i=1 から開始
  const startDay = isInperson ? 1 : 0;

  for (let i = startDay; i < DATE_QUICK_DAYS + startDay; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    if (!isWithin31Days_(d)) break;

    const ymd = Utilities.formatDate(d, TZ, "yyyy-MM-dd");
    const md = fmtMDJP_(ymd);
    const label = (i === 0) ? `${md}（本日）` : md;

    labels.push(label);
    map.push({ label, ymd });
  }

  labels.push("もっと先の日付");
  labels.push(BACK_TO_FORMAT);

  setState_(userId, { dateQuickMapJson: JSON.stringify(map) });

  // ★対面と非対面でメッセージを変える
  const msgText = isInperson
    ? "日付を選んでください。\n※対面は当日不可"
    : "日付を選んでください。";

  return replyQuickReplyWithHeader_(
    token,
    "【STEP 3/5】日付",
    msgText,
    labels
  );
}

// 日付入力（Buttonsで戻る）
function askDateInput_(token) {
  return replyButtons_(
    token,
    "日付を入力（例: 2/10）",
    [{ label: BACK_TO_DATE, text: BACK_TO_DATE }]
  );
}

// ===================================================
// 日付入力のパース
// ===================================================
function normalizeYMDInput_(input) {
  const s0 = String(input || "").trim();
  if (!s0) return "";

  let s = s0
    .replace(/[（）\(\)\s]/g, "")
    .replace(/（本日）/g, "")
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "")
    .replace(/\//g, "-")
    .replace(/\./g, "-");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const max = new Date(today.getTime() + 31 * 86400000);

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const dt = new Date(y, mo - 1, d, 0, 0, 0);
    if (!isValidYMD_(dt, y, mo, d)) return "";
    if (dt < today) return "";
    if (dt >= max) return "";
    return Utilities.formatDate(dt, TZ, "yyyy-MM-dd");
  }

  m = s.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const mo = Number(m[1]), d = Number(m[2]);
    const y = today.getFullYear();
    const dt = new Date(y, mo - 1, d, 0, 0, 0);
    if (!isValidYMD_(dt, y, mo, d)) return "";
    if (dt < today) return "";
    if (dt >= max) return "";
    return Utilities.formatDate(dt, TZ, "yyyy-MM-dd");
  }

  return "";
}

function isValidYMD_(dt, y, mo, d) {
  return dt &&
    dt.getFullYear() === y &&
    (dt.getMonth() + 1) === mo &&
    dt.getDate() === d;
}

// QuickReplyラベルから内部YMDを復元
function pickYMDFromDateQuick_(userId, labelText) {
  const st = getState_(userId) || {};
  const map = safeJsonParse_(st.dateQuickMapJson) || [];
  const hit = map.find(x => x && x.label === labelText);
  return hit ? hit.ymd : "";
}

// ===================================================
// レベル2：カレンダー参照込みで「指定分数の空きがある部だけ」返す
// ★改修：一括取得対応でパフォーマンス改善
// ===================================================
function getAvailablePartsForDate_(format, dateYMD, minutes) {
  const ymd = String(dateYMD || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return [];

  const [y, m, d] = ymd.split("-").map(Number);
  const base = new Date(y, m - 1, d, 0, 0, 0);

  let sameDayLimit = null;
  if (isSameDate_(new Date(), base)) {
    sameDayLimit = new Date(Date.now() + SAME_DAY_LIMIT_HOURS * 3600000);
  }

  // 分数指定がなければ30分で判定
  const checkMinutes = minutes || 30;
  const labels = [];

  // ★一括取得：1回のAPI呼び出しで1日分のイベントを取得
  const eventsCache = getDayEvents_(ymd);

  Object.keys(PARTS).forEach((lab) => {
    const part = PARTS[lab];
    if (!part) return;

    const [sh, sm] = part.start.split(":").map(Number);
    const [eh, em] = part.end.split(":").map(Number);

    const startBase = new Date(base); startBase.setHours(sh, sm, 0, 0);
    const endLimit = new Date(base); endLimit.setHours(eh, em, 0, 0);

    let ok = false;
    for (let t = new Date(startBase); t < endLimit; t = new Date(t.getTime() + SLOT_STEP_MIN * 60000)) {
      if (sameDayLimit && t < sameDayLimit) continue;

      const end = new Date(t.getTime() + checkMinutes * 60000);
      if (end > endLimit) continue;

      if (isSlotFree_(t, end, eventsCache)) { ok = true; break; }
    }

    if (ok) labels.push(lab);
  });

  return labels;
}

// ===================================================
// 部（時間帯）: Buttons
// ★改修：ステートから分数を取得し、その分数に対応できる部のみ表示
// ===================================================
function askPart_(token, userId, dateYMD, format) {
  const st = getState_(userId) || {};
  const minutes = Number(st.minutes) || 30;

  const available = getAvailablePartsForDate_(format, dateYMD, minutes);
  if (!available.length) {
    return replyButtons_(
      token,
      "この日付は受付できる時間帯がありませんでした。\n別の日付をお試しください。",
      [{ label: BACK_TO_DATE, text: BACK_TO_DATE }]
    );
  }

  const page = Number(st.partPage || 0);

  const pageSize = 3;
  const start = page * pageSize;
  const slice = available.slice(start, start + pageSize);

  const actions = slice.map((lab) => ({ label: lab, text: lab }));

  const hasNext = (start + pageSize) < available.length;
  if (hasNext) actions.push({ label: "次へ", text: PART_NEXT });
  else actions.push({ label: BACK_TO_DATE, text: BACK_TO_DATE });

  const lines = slice.map((lab) => `・${lab}（${PARTS[lab].start}〜${PARTS[lab].end}）`).join("\n");

  return replyButtons_(
    token,
    "【STEP 4/5】時間帯\n時間帯を選んでください。\n\n" +
    lines + "\n\n" +
    `※選択中：${minutes}分（${fmtYen_(st.price || PRICE_TABLE[minutes])}）`,
    actions.slice(0, 4)
  );
}

// ===================================================
// 鑑定分数：部またぎしないものだけ返す
// ===================================================
function getAvailableMinutesForPart_NoCross_(st) {
  const ymd = String(st.dateYMD || "").trim();
  const part = PARTS[st.partLabel];
  if (!part) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return [];

  const [y, m, d] = ymd.split("-").map(Number);
  const base = new Date(y, m - 1, d, 0, 0, 0);

  let sameDayLimit = null;
  if (isSameDate_(new Date(), base)) {
    sameDayLimit = new Date(Date.now() + SAME_DAY_LIMIT_HOURS * 3600000);
  }

  const [sh, sm] = part.start.split(":").map(Number);
  const [eh, em] = part.end.split(":").map(Number);

  const startBase = new Date(base); startBase.setHours(sh, sm, 0, 0);
  const endLimit = new Date(base); endLimit.setHours(eh, em, 0, 0);

  const options = [30, 60];
  const okSet = new Set();

  for (let t = new Date(startBase); t < endLimit; t = new Date(t.getTime() + SLOT_STEP_MIN * 60000)) {
    if (sameDayLimit && t < sameDayLimit) continue;

    for (const mins of options) {
      if (okSet.has(mins)) continue;
      const end = new Date(t.getTime() + mins * 60000);
      if (end > endLimit) continue;
      if (isSlotFree_(t, end)) okSet.add(mins);
    }
    if (okSet.size === options.length) break;
  }

  return options.filter(x => okSet.has(x));
}

// ===================================================
// 鑑定分数（QuickReply）
// ★改修：新フロー対応。形式選択後すぐに分数を聞く。
// ===================================================
function askMinutes_(token, userId) {
  const st = getState_(userId) || {};
  const isInperson = st.format === "INPERSON";

  // 全ての分数オプションを表示（後で日付・部で絞る）
  const options = [30, 60];

  const labels = options.map((mins) => {
    const basePrice = PRICE_TABLE[mins];
    const price = isInperson ? (basePrice + INPERSON_EXTRA) : basePrice;
    return `${mins}分（${fmtYen_(price)}）`;
  });
  labels.push(BACK_TO_FORMAT);

  const extraNote = (isInperson && INPERSON_EXTRA > 0)
    ? `\n※同席料+${INPERSON_EXTRA}円込`
    : "";

  return replyQuickReplyWithHeader_(
    token,
    "【STEP 2/5】鑑定分数",
    "分数を選んでください。" + extraNote,
    labels
  );
}

// ===================================================
// 今日の"全時間帯"で空きがあるか
// ===================================================
function hasAnySlotTodayAcrossParts_(st) {
  if (!st || !st.dateYMD || !isToday_(st.dateYMD)) return false;

  for (const lab of Object.keys(PARTS)) {
    const p = PARTS[lab];
    if (!p) continue;

    const tmp = Object.assign({}, st, { partLabel: lab, partKey: p.key });
    const list = computeCandidateSlots_(tmp);
    if (list && list.length) return true;
  }
  return false;
}

// ===================================================
// 開始時刻（候補）QuickReply
// ===================================================
function replySlotQuickReply_(token, userId, showTakenNotice) {
  const st = getState_(userId);
  const list = computeCandidateSlots_(st).slice(0, QUICK_SLOT_MAX);

  if (!list.length) {
    return replyButtons_(
      token,
      "空きがありません。別日時をお試しください。",
      [{ label: BACK_TO_PART, text: BACK_TO_PART }]
    );
  }

  const slotList = list.map((d) => ({ hm: fmtHM_(d), startISO: d.toISOString() }));
  setState_(userId, { slotListJson: JSON.stringify(slotList), step: "空き枠" });

  const head = showTakenNotice
    ? "※先に予約が入りました。別の時間を選んでください。\n\n"
    : "";

  const labels = slotList.map((x) => x.hm);
  labels.push(BACK_TO_PART);

  const priceLine = (st && st.minutes && st.price)
    ? `料金：${st.minutes}分 ${Number(st.price).toLocaleString("ja-JP")}円\n\n`
    : "";

  return replyQuickReplyWithHeader_(
    token,
    "【STEP 5/5】開始時刻",
    priceLine + head + "開始時刻を選んでください。",
    labels
  );
}

// ===================================================
// ★改修：問い合わせボタン処理
// ===================================================
function handleInquiry_(token, userId) {
  // 問い合わせモードを開始
  setState_(userId, { step: "問い合わせ" });
  return replyText_(token, "お問い合わせ内容を入力してください。\n次のメッセージをそのまま担当者にお伝えします。");
}

// 問い合わせ内容を管理Botに転送
function handleInquiryMessage_(token, userId, text) {
  try {
    pushToAdminBot_(
      "🎯【問い合わせ】\n" +
      "━━━━━━━━━━━━━━\n" +
      text
    );
  } catch (_) { }

  resetState_(userId);
  return replyText_(token, "お問い合わせを受け付けました。\n順次ご連絡します。");
}

// ===================================================
// 支払い方法変更（オンライン）
// ===================================================
function handleChangePayMethod_(userId, token, text) {
  if (text !== CMD_CHANGE_PAY_PAYPAY && text !== CMD_CHANGE_PAY_BANK) return false;

  const r = getActiveReservationForUser_(userId);
  if (!r) {
    replyText_(token, "対象の予約が見つかりませんでした。");
    return true;
  }
  if (r.format !== "ONLINE") {
    replyText_(token, "この操作はオンライン鑑定のみ可能です。");
    return true;
  }

  const newMethod = (text === CMD_CHANGE_PAY_PAYPAY) ? "PayPay" : "振込";
  r.payMethod = newMethod;
  r.updatedAtISO = nowISO_();
  saveReservation_(r.key, r);

  try { notifySheetUpsert_(r); } catch (_) { }
  try { updateCalendarEventTitle_(r); } catch (_) { }

  try {
    notifyAdmin_("【支払い方法変更】\n" + buildAdminSummary_(r) + `\n→ ${newMethod}`);
  } catch (_) { }

  replyText_(token, buildOnlinePayInfoText_(newMethod, r.startISO));
  return true;
}

// ===================================================
// LINE 会話フロー（ミニマム）
// ===================================================
function handleLineEvent_(ev) {
  if (!ev || ev.type !== "message") return;
  if (!ev.message || ev.message.type !== "text") return;

  const userId = ev.source && ev.source.userId;
  const token = ev.replyToken;
  const text = (ev.message.text || "").trim();
  if (!userId || !token) return;

  // ★問い合わせモード中の内容受付
  const st = getState_(userId) || {};
  if (st.step === "問い合わせ") {
    return handleInquiryMessage_(token, userId, text);
  }

  // ★問い合わせ開始
  if (text === CMD_INQUIRY) {
    return handleInquiry_(token, userId);
  }

  // ★キャンセル確認（確定）
  if (text === CMD_CANCEL_CONFIRM) {
    if (st.step !== "キャンセル確認") {
      return replyText_(token, "キャンセル確認中の予約が見つかりませんでした。");
    }
    const r = getActiveReservationForUser_(userId);
    if (!r) {
      resetState_(userId);
      return replyButtons_(token, "対象の予約が見つかりませんでした。", [{ label: CMD_START, text: CMD_START }]);
    }
    cancelReservationByUser_(r);
    resetState_(userId);
    return replyButtons_(token, "キャンセルしました。", [{ label: CMD_START, text: CMD_START }]);
  }

  // ★キャンセル確認（やめる）
  if (text === CMD_CANCEL_ABORT) {
    if (st.step === "キャンセル確認") resetState_(userId);
    return replyText_(token, "キャンセルをやめました。");
  }

  // ★予約確認
  if (text === CMD_CHECK) {
    const r = getActiveReservationForUser_(userId);
    if (!r) {
      return replyButtons_(token,
        "現在、有効な予約はありません。",
        [{ label: CMD_START, text: CMD_START }]
      );
    }
    const fmtType = r.format === "ONLINE" ? "オンライン" : "対面";
    const area = (r.format === "INPERSON" && r.area) ? `（${r.area}）` : "";
    let stTxt = userStatusLabel_(r);
    if (r.status === ST_HOLD) stTxt += holdRemainingText_(r);

    let info =
      "📋 ご予約内容\n" +
      "━━━━━━━━━━━━━━\n" +
      `形式：${fmtType}${area}\n` +
      `日時：${formatRangeText_(r)}\n` +
      `分数：${r.minutes}分\n` +
      `料金：${fmtYen_(r.price)}\n` +
      `状態：${stTxt}\n` +
      "━━━━━━━━━━━━━━";

    const actions = [];
    if (r.status === ST_HOLD) {
      actions.push({ type: "uri", label: "フォームを開く", uri: buildShortFormUrl_(r.key) });
      actions.push({ type: "message", label: "やり直す", text: CMD_RESET });
    } else if ([ST_WAIT_PAY, ST_PAID_REPORTED].includes(r.status)) {
      actions.push({ type: "message", label: "支払い報告", text: CMD_PAID_REPORT });
      actions.push({ type: "message", label: "日時を変更する", text: CMD_CHANGE_DATE });
    } else if (r.status === ST_INPERSON_FIXED) {
      actions.push({ type: "message", label: "日時を変更する", text: CMD_CHANGE_DATE });
    }

    if (actions.length) {
      return replyTextQuickReply_(token, info, actions);
    }
    return replyText_(token, info);
  }

  // ★日時変更ボタン
  if (text === CMD_CHANGE_DATE) {
    const r = getActiveReservationForUser_(userId);
    if (!r) {
      return replyButtons_(token, "対象の予約が見つかりませんでした。", [{ label: CMD_START, text: CMD_START }]);
    }

    // 確定済み予約（支払い待ち、支払い報告済み、対面確定）のみ変更可能
    if (![ST_WAIT_PAY, ST_PAID_REPORTED, ST_INPERSON_FIXED].includes(r.status)) {
      return replyText_(token, "現在の予約状態では日時変更ができません。\nお問い合わせください。");
    }

    return replyQuickReply_(token,
      "予約を変更しますか？",
      [CMD_CHANGE_DATE_YES, CMD_CHANGE_DATE_NO]
    );
  }

  // ★追加：日時変更確認「はい」
  if (text === CMD_CHANGE_DATE_YES) {
    const r = getActiveReservationForUser_(userId);
    if (!r) {
      return replyButtons_(token, "対象の予約が見つかりませんでした。", [{ label: CMD_START, text: CMD_START }]);
    }

    // カレンダーから削除
    try {
      const cal = CalendarApp.getCalendarById(CALENDAR_ID);
      const start = new Date(r.startISO);
      const end = new Date(r.endISO);
      const events = cal.getEvents(
        new Date(start.getTime() - 60000),
        new Date(end.getTime() + 60000)
      );
      for (let ev of events) {
        const title = ev.getTitle() || "";
        const desc = ev.getDescription() || "";
        if (title.includes(r.key) || desc.includes(`key:${r.key}`)) {
          ev.deleteEvent();
          break;
        }
      }
    } catch (_) { }

    // 予約をキャンセル状態に
    r.status = ST_CANCELLED;
    r.updatedAtISO = nowISO_();
    saveReservation_(r.key, r);
    try { notifySheetUpsert_(r); } catch (_) { }

    // ログ
    logToSheet_({
      ts: new Date().toISOString(),
      event: "DATE_CHANGE_CANCELLED",
      userId: userId,
      key: r.key,
      format: r.format,
      date: r.dateYMD
    });

    // 管理者通知（失敗してもユーザーフローを止めない）
    try {
      notifyAdmin_(
        "【日時変更】\n" +
        "ユーザーが日時変更を選択しました。\n" +
        buildAdminSummary_(r) + "\n" +
        "→ 旧予約をキャンセル済み"
      );
    } catch (e) { console.error("notifyAdmin_ date change error:", e); }

    resetState_(userId);

    return replyButtons_(
      token,
      "予約を取り消しました。",
      [{ label: CMD_START, text: CMD_START }]
    );
  }

  // ★追加：日時変更確認「やめる」
  if (text === CMD_CHANGE_DATE_NO) {
    return replyText_(token, "日時変更をキャンセルしました。\n現在の予約はそのまま有効です。");
  }

  // 一時確保解除（互換：旧「リセット」もOK）
  // 一時確保解除（互換：旧「リセット」もOK）
  if (text === CMD_RESET || text === CMD_RESET_INTERNAL || text === CMD_RESET_LEGACY) {
    // ★高速化：先に判定だけ行う（API呼び出しや重い処理は後回し）
    const active = getActiveReservationForUser_(userId);
    const hasHold = (active && active.status === ST_HOLD);

    // ★ユーザーへの返信を「先に」実行（体感速度向上）
    if (hasHold) {
      replyButtons_(
        token,
        "予約をリセットしました。\n「鑑定予約」から進められます。",
        [{ label: CMD_START, text: CMD_START }]
      );
    } else {
      replyButtons_(
        token,
        "リセットしました。\n「鑑定予約」から進められます。",
        [{ label: CMD_START, text: CMD_START }]
      );
    }

    // ★返信後に重い処理（カレンダー削除・シート更新）を実行
    if (hasHold) {
      cancelActiveReservation_(userId);
    }

    resetState_(userId);
    return; // 返信済みなので終了
  }

  // 支払い関連（オンライン）
  if (typeof handlePaymentCommands_ === "function") {
    if (handlePaymentCommands_(userId, token, text)) return;
  }

  // 支払い方法変更
  if (handleChangePayMethod_(userId, token, text)) return;

  // 予約キャンセル
  if (text === CMD_CANCEL) {
    const r = getActiveReservationForUser_(userId);
    if (!r) return replyButtons_(token, "対象の予約が見つかりませんでした。", [{ label: CMD_START, text: CMD_START }]);
    setState_(userId, { step: "キャンセル確認" });
    return replyQuickReply_(
      token,
      "予約をキャンセルしますか？",
      [CMD_CANCEL_CONFIRM, CMD_CANCEL_ABORT]
    );
  }

  // 起点：鑑定予約（アクティブがあればブロック）
  if (text === CMD_START) {
    const active = getActiveReservationForUser_(userId);
    if (active) {
      let stTxt = userStatusLabel_(active);
      if (active.status === ST_HOLD) stTxt += holdRemainingText_(active);
      let hint =
        "すでに進行中のご予約があります。\n\n" +
        `日時：${formatRangeText_(active)}\n` +
        `状態：${stTxt}\n\n`;

      if (active.status === ST_HOLD) {
        hint += `変更する場合は「やり直す」を押してください。`;
        return replyButtons_(token, hint, [{ label: "やり直す", text: CMD_RESET }]);
      }

      return replyButtons_(
        token,
        hint + "このまま案内に沿ってお進みください。",
        [{ label: CMD_CANCEL, text: CMD_CANCEL }]
      );
    }

    resetState_(userId);
    setState_(userId, { step: "形式" });

    return replyButtons_(
      token,
      "【STEP 1/5】鑑定形式\nまず鑑定形式を選んでください。",
      [
        { label: "オンライン鑑定", text: "オンライン鑑定" },
        { label: "対面鑑定", text: "対面鑑定" },
      ]
    );
  }

  // 起点ショートカット：形式が直接送られた場合（リッチメニュー/手入力）
  if (!st.step && (text === "オンライン鑑定" || text === "対面鑑定")) {
    const active = getActiveReservationForUser_(userId);
    if (active) {
      let stTxt = userStatusLabel_(active);
      if (active.status === ST_HOLD) stTxt += holdRemainingText_(active);
      let hint =
        "すでに進行中のご予約があります。\n\n" +
        `日時：${formatRangeText_(active)}\n` +
        `状態：${stTxt}\n\n`;

      if (active.status === ST_HOLD) {
        hint += `変更する場合は「やり直す」を押してください。`;
        return replyButtons_(token, hint, [{ label: "やり直す", text: CMD_RESET }]);
      }

      return replyButtons_(
        token,
        hint + "このまま案内に沿ってお進みください。",
        [{ label: CMD_CANCEL, text: CMD_CANCEL }]
      );
    }

    resetState_(userId);
    if (text === "オンライン鑑定") {
      setState_(userId, { format: "ONLINE", area: "", step: "分数", partPage: 0 });
      return askMinutes_(token, userId);
    }
    setState_(userId, { format: "INPERSON", step: "エリア", partPage: 0 });
    return replyButtons_(token, "エリアを選んでください。", [
      { label: "名駅", text: "名駅" },
      { label: "栄", text: "栄" },
      { label: "金山", text: "金山" },
      { label: BACK_TO_FORMAT, text: BACK_TO_FORMAT },
    ]);
  }

  // (stは419行目で宣言済み)

  // 時間帯ページ送り（Buttons）
  if (text === PART_NEXT) {
    const nextPage = Number(st.partPage || 0) + 1;
    setState_(userId, { partPage: nextPage, step: "部" });
    return askPart_(token, userId, st.dateYMD, st.format);
  }

  // 戻る：形式
  if (text === BACK_TO_FORMAT) {
    setState_(userId, {
      step: "形式",
      format: "", area: "",
      dateYMD: "", partLabel: "", partKey: "",
      minutes: "", price: "",
      slotListJson: "",
      partPage: 0,
      dateQuickMapJson: "",
    });
    return replyButtons_(
      token,
      "【STEP 1/5】鑑定形式\n鑑定形式を選んでください。",
      [
        { label: "オンライン鑑定", text: "オンライン鑑定" },
        { label: "対面鑑定", text: "対面鑑定" },
      ]
    );
  }

  // 戻る：日付
  if (text === BACK_TO_DATE) {
    setState_(userId, {
      step: "日付",
      dateYMD: "",
      partLabel: "", partKey: "",
      minutes: "", price: "",
      slotListJson: "",
      partPage: 0,
    });
    return askDate_(token, userId);
  }

  // 戻る：時間帯
  if (text === BACK_TO_PART) {
    setState_(userId, {
      step: "部",
      partLabel: "", partKey: "",
      minutes: "", price: "",
      slotListJson: "",
      partPage: 0,
    });
    return askPart_(token, userId, st.dateYMD, st.format);
  }

  // 戻る：鑑定分数（形式選択後に分数を聞くので、形式へ戻る）
  if (text === BACK_TO_MIN) {
    setState_(userId, { step: "分数", minutes: "", price: "", slotListJson: "", dateYMD: "", partLabel: "", partKey: "" });
    return askMinutes_(token, userId);
  }

  // ① 形式
  if (st.step === "形式") {
    if (text === "オンライン鑑定") {
      setState_(userId, { format: "ONLINE", area: "", step: "分数", partPage: 0 });
      return askMinutes_(token, userId);
    }
    if (text === "対面鑑定") {
      setState_(userId, { format: "INPERSON", step: "エリア", partPage: 0 });
      return replyButtons_(token, "エリアを選んでください。", [
        { label: "名駅", text: "名駅" },
        { label: "栄", text: "栄" },
        { label: "金山", text: "金山" },
        { label: BACK_TO_FORMAT, text: BACK_TO_FORMAT },
      ]);
    }
    return replyText_(token, "「オンライン鑑定」か「対面鑑定」を選んでください。");
  }

  // ② エリア（対面）→ 分数へ
  if (st.step === "エリア") {
    if (!INPERSON_PLACES[text]) return replyText_(token, "エリア（名駅/栄/金山）を選んでください。");
    setState_(userId, { area: text, step: "分数", partPage: 0 });
    return askMinutes_(token, userId);
  }

  // ③ 分数 → 日付へ
  if (st.step === "分数") {
    const minutes = pickMinutesFromText_(text);
    if ([30, 60].includes(minutes)) {
      const isInperson = st.format === "INPERSON";
      const price = isInperson ? (PRICE_TABLE[minutes] + INPERSON_EXTRA) : PRICE_TABLE[minutes];
      setState_(userId, { minutes, price, step: "日付" });
      return askDate_(token, userId);
    }
    return replyText_(token, "下部の候補（30分/60分）から選んでください。");
  }

  // ④ 日付
  if (st.step === "日付") {
    if (text === "もっと先の日付") {
      setState_(userId, { step: "日付入力" });
      return askDateInput_(token);
    }

    const ymdFromQuick = pickYMDFromDateQuick_(userId, text);
    if (ymdFromQuick) {
      setState_(userId, { dateYMD: ymdFromQuick, step: "部", partPage: 0 });
      return askPart_(token, userId, ymdFromQuick, st.format);
    }

    const ymd = normalizeYMDInput_(text);
    if (ymd) {
      setState_(userId, { dateYMD: ymd, step: "部", partPage: 0 });
      return askPart_(token, userId, ymd, st.format);
    }

    return replyText_(token, "下部の日付候補から選ぶか、「もっと先の日付」を押してください。");
  }

  // ④-2 日付入力
  if (st.step === "日付入力") {
    if (text === BACK_TO_DATE) {
      setState_(userId, { step: "日付" });
      return askDate_(token, userId);
    }

    const ymd = normalizeYMDInput_(text);
    if (!ymd) {
      return replyButtons_(
        token,
        "日付が正しくありません。\n例: 2/10",
        [{ label: BACK_TO_DATE, text: BACK_TO_DATE }]
      );
    }

    // ★対面鑑定で本日を入力した場合はエラー
    if (st.format === "INPERSON" && isToday_(ymd)) {
      return replyButtons_(
        token,
        "対面は当日不可です。別の日付を選んでください。",
        [{ label: BACK_TO_DATE, text: BACK_TO_DATE }]
      );
    }

    setState_(userId, { dateYMD: ymd, step: "部", partPage: 0 });
    return askPart_(token, userId, ymd, st.format);
  }

  // ⑤ 部 → 空き枠へ
  if (st.step === "部") {
    if (!PARTS[text]) return replyText_(token, "時間帯（昼の部/夕の部/夜の部）を選んでください。");
    setState_(userId, { partLabel: text, partKey: PARTS[text].key, step: "空き枠" });
    return replySlotQuickReply_(token, userId, false);
  }

  // ⑥ 開始時刻
  if (st.step === "空き枠") {
    // 戻る：時間帯へ
    if (text === BACK_TO_PART) {
      setState_(userId, { step: "部", partLabel: "", partKey: "", slotListJson: "", partPage: 0 });
      return askPart_(token, userId, st.dateYMD, st.format);
    }

    if (!/^\d{2}:\d{2}$/.test(text)) return replyText_(token, "下部の開始時刻（例: 14:00）から選んでください。");

    const slotList = safeJsonParse_(st.slotListJson) || [];
    const slot = slotList.find((x) => x && x.hm === text);
    if (!slot) return replyText_(token, "下部の開始時刻から選んでください。");

    const start = new Date(slot.startISO);
    const end = new Date(start.getTime() + Number(st.minutes) * 60000);

    // ★改修：リトライ機構（最大3回、1秒間隔）
    const lock = tryLockWithRetry_(3, 1000);
    if (!lock) return replyText_(token, "ただいま混み合っています。もう一度お試しください。");

    try {
      if (!isSlotFree_(start, end)) {
        return replySlotQuickReply_(token, userId, true);
      }

      const key = issueKey_();
      const expiresAt = new Date(Date.now() + HOLD_TTL_MIN * 60000);

      createHold_(start, end, key, userId, expiresAt);

      const res = {
        key,
        userId,
        format: st.format,
        area: st.area || "",
        partLabel: st.partLabel || "",
        partKey: st.partKey || "",
        dateYMD: st.dateYMD || "",
        minutes: Number(st.minutes),
        price: Number(st.price),
        startISO: start.toISOString(),
        endISO: end.toISOString(),
        holdExpiresISO: expiresAt.toISOString(),
        status: ST_HOLD,
        formReceived: false,

        payMethod: "",
        paidReportedAtISO: "",
        paidConfirmedAtISO: "",
        flags: {
          payNudgeSentAtISO: "",
          onlineMeetRemindSentAtISO: "",
          inpersonPlaceRemindSentAtISO: "",
        },

        createdAtISO: nowISO_(),
        updatedAtISO: nowISO_(),
      };

      saveReservation_(key, res);
      indexUserKey_(userId, key);



      // ★改修：一時確保メッセージの強調表現（詳細情報を追加）
      const detailInfo =
        `日時：${formatRangeText_(res)}\n` +
        `料金：${fmtYen_(res.price)}` +
        (res.area ? `\nエリア：${res.area}` : "");

      const shortUrl = buildShortFormUrl_(key);

      // ★高速化：PushではなくReplyを使い、かつ管理者通知の前に実行
      // ★修正：replyQuickReply_はstring配列のみ対応。URI型アクションを含むため replyTextQuickReply_ を使用
      const userReply = replyTextQuickReply_(
        token,  // userIdではなくtokenを使う
        `✅ 日時を選択しました\n\n` +
        detailInfo + "\n\n" +
        `👇 ${HOLD_TTL_MIN}分以内にフォームを送信して予約を完了してください`,
        [
          { type: "uri", label: "フォームを開く", uri: shortUrl },
          { type: "message", label: "やり直す", text: CMD_RESET },
        ]
      );

      // 一時確保の管理通知は送らない（2通飛ぶ原因になるため）

      // ★ 重要イベントログ：一時確保作成（ユーザー返信後に移動）
      logToSheet_({
        ts: new Date().toISOString(),
        event: "HOLD_CREATED",
        userId: userId,
        key: key,
        format: res.format,
        area: res.area,
        date: res.dateYMD,
        start: fmtHM_(new Date(res.startISO)),
        minutes: res.minutes,
        price: res.price
      });

      try { notifySheetUpsert_(res); } catch (e) { console.error("notifySheetUpsert_ hold error:", e); }
      try { updateCalendarEventTitle_(res); } catch (e) { console.error("updateCalendarEventTitle_ hold error:", e); }

      resetState_(userId);
      return userReply;

    } finally {
      lock.releaseLock();
    }
  }

  return replyText_(token, `メニューから「${CMD_START}」を選んでください。`);
}
