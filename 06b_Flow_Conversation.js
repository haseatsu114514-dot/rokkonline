// ===============================
// 06b_Flow_Conversation.gs（会話フロー）★改修版
// ===============================

// ===================================================
// UI: 戻る（中止は無し）
// ===================================================
const BACK_TO_FORMAT = "戻る（形式へ）";
const BACK_TO_MIN    = "戻る（鑑定分数へ）";  // 分数が先になった
const BACK_TO_DATE   = "戻る（日付へ）";
const BACK_TO_PART   = "戻る（時間帯へ）";

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
// ===================================================
function askDate_(token, userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const labels = [];
  const map = [];

  for (let i = 0; i < DATE_QUICK_DAYS; i++) {
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

  return replyQuickReplyWithHeader_(
    token,
    "【日付】",
    "日付を選んでください。\n※当日は「開始5時間前」を過ぎた枠は受付できません。\n※ご予約受付は【本日から31日以内】です。",
    labels
  );
}

// 日付入力（Buttonsで戻る）
function askDateInput_(token) {
  return replyButtons_(
    token,
    "日付を入力してください。\n" +
    "※ご予約受付は【本日から31日以内】です。\n\n" +
    "入力例：1月30日 / 1/30 / 2026/1/30 / 2026年1月30日",
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
    const endLimit  = new Date(base); endLimit.setHours(eh, em, 0, 0);

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
    "【時間帯】\n時間帯を選んでください。\n\n" +
    lines + "\n\n" +
    `※選択中の鑑定分数：${minutes}分`,
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
  const endLimit  = new Date(base); endLimit.setHours(eh, em, 0, 0);

  const options = [30, 45, 60, 75, 90];
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
  const options = [30, 45, 60, 75, 90];
  
  const labels = options.map((mins) => {
    const basePrice = PRICE_TABLE[mins];
    const price = isInperson ? (basePrice + INPERSON_EXTRA) : basePrice;
    return `${mins}分（${fmtYen_(price)}）`;
  });
  labels.push(BACK_TO_FORMAT);

  const extraNote = isInperson 
    ? "\n※対面鑑定は+500円です"
    : "";

  return replyQuickReplyWithHeader_(
    token,
    "【鑑定分数】",
    "鑑定分数を選んでください。" + extraNote,
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
    if (isToday_(st.dateYMD)) {
      const any = hasAnySlotTodayAcrossParts_(st);

      if (any) {
        return replyButtons_(
          token,
          "この時間帯では空き枠が見つかりませんでした。\n別の時間帯をお試しください。",
          [{ label: BACK_TO_PART, text: BACK_TO_PART }]
        );
      }

      resetState_(userId);
      return replyButtons_(
        token,
        "【本日の受付は終了しました】\n当日は「開始5時間前」を過ぎた枠は受付できません。\n別日程をご検討ください。",
        [{ label: BACK_TO_PART, text: BACK_TO_PART }]
      );
    }

    return replyButtons_(
      token,
      "この条件では空き枠が見つかりませんでした。\n日付／時間帯を変えてお試しください。",
      [{ label: BACK_TO_PART, text: BACK_TO_PART }]
    );
  }

  const slotList = list.map((d) => ({ hm: fmtHM_(d), startISO: d.toISOString() }));
  setState_(userId, { slotListJson: JSON.stringify(slotList), step: "空き枠" });

  const head = showTakenNotice
    ? "※他のお客様が先にご予約されたため、この開始時刻はご案内できませんでした。\n別の開始時刻をお選びください。\n\n"
    : "";

  const labels = slotList.map((x) => x.hm);
  labels.push(BACK_TO_PART);

  const priceLine = (st && st.minutes && st.price)
    ? `料金：${st.minutes}分 ${Number(st.price).toLocaleString("ja-JP")}円\n\n`
    : "";

  return replyQuickReplyWithHeader_(
    token,
    "【開始時刻】",
    priceLine + head + "開始時刻を選んでください。",
    labels
  );
}

// ===================================================
// ★改修：問い合わせボタン処理
// ===================================================
function handleInquiry_(token, userId) {
  notifyAdmin_(
    "【問い合わせあり】\n" +
    "ユーザーから問い合わせがありました。\n" +
    "LINEを確認して対応してください。"
  );
  return replyText_(token, "お問い合わせを受け付けました。順次ご連絡します。");
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

  // ★改修：問い合わせボタン
  if (text === CMD_INQUIRY) {
    return handleInquiry_(token, userId);
  }

  // ★追加：日時変更ボタン
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
      "現在の予約はいったん無効にして、新しく予約を取り直す形になります。\nよろしいですか？",
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
    } catch (_) {}
    
    // 予約をキャンセル状態に
    r.status = ST_CANCELLED;
    r.updatedAtISO = nowISO_();
    saveReservation_(r.key, r);
    try { notifySheetUpsert_(r); } catch (_) {}
    
    // ログ
    logToSheet_({
      ts: new Date().toISOString(),
      event: "DATE_CHANGE_CANCELLED",
      userId: userId,
      key: r.key,
      format: r.format,
      date: r.dateYMD
    });
    
    // 管理者通知
    notifyAdmin_(
      "【日時変更】\n" +
      "ユーザーが日時変更を選択しました。\n" +
      buildAdminSummary_(r) + "\n" +
      "→ 旧予約をキャンセル済み"
    );
    
    resetState_(userId);
    
    return replyButtons_(
      token,
      "予約を取り消しました。\n\n「鑑定予約」から新しい日時を選んでください。",
      [{ label: CMD_START, text: CMD_START }]
    );
  }

  // ★追加：日時変更確認「やめる」
  if (text === CMD_CHANGE_DATE_NO) {
    return replyText_(token, "日時変更をキャンセルしました。\n現在の予約はそのまま有効です。");
  }

  // 一時確保解除（互換：旧「リセット」もOK）
  if (text === CMD_RESET || text === CMD_RESET_LEGACY) {
    const cancelled = cancelActiveReservation_(userId);
    resetState_(userId);

    if (cancelled) {
      return replyButtons_(
        token,
        "一時確保を解除しました。\n「鑑定予約」から進められます。",
        [{ label: CMD_START, text: CMD_START }]
      );
    } else {
      return replyButtons_(
        token,
        "会話をリセットしました。\n「鑑定予約」から進められます。",
        [{ label: CMD_START, text: CMD_START }]
      );
    }
  }

  // 支払い関連（オンライン）
  if (typeof handlePaymentCommands_ === "function") {
    if (handlePaymentCommands_(userId, token, text)) return;
  }

  // 予約キャンセル（支払い待ちのみ）
  if (text === CMD_CANCEL) {
    const r = getActiveReservationForUser_(userId);
    if (!r) return replyButtons_(token, "対象の予約が見つかりませんでした。", [{ label: CMD_START, text: CMD_START }]);

    if (r.format !== "ONLINE" || r.status !== ST_WAIT_PAY) {
      return replyText_(token, "この操作は「オンライン（支払い待ち）」の予約のみ可能です。");
    }

    cancelReservationByUser_(r);
    return replyButtons_(
      token,
      "予約をキャンセルしました。\n改めてご希望の場合は「鑑定予約」からお申し込みください。",
      [{ label: CMD_START, text: CMD_START }]
    );
  }

  // 起点：鑑定予約（アクティブがあればブロック）
  if (text === CMD_START) {
    const active = getActiveReservationForUser_(userId);
    if (active) {
      const stTxt = (active.status === ST_HOLD) ? "一時確保中" : active.status;
      let hint =
        "すでに進行中のご予約があります。\n\n" +
        `日時：${formatRangeText_(active)}\n` +
        `状態：${stTxt}\n\n`;

      if (active.status === ST_HOLD) {
        hint += `変更する場合は「${CMD_RESET}」で一時確保を解除してください。`;
        return replyButtons_(token, hint, [{ label: "一時確保を解除", text: CMD_RESET }]);
      }

      return replyText_(token, hint + "このまま案内に沿ってお進みください。");
    }

    resetState_(userId);
    setState_(userId, { step: "形式" });

    return replyButtons_(
      token,
      "【予約手続き】\nまず鑑定形式を選んでください。",
      [
        { label: "オンライン鑑定", text: "オンライン鑑定" },
        { label: "対面鑑定", text: "対面鑑定" },
      ]
    );
  }

  const st = getState_(userId) || {};

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
      "【鑑定形式】\n鑑定形式を選んでください。",
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
      return replyButtons_(token, "【対面エリア】\nエリアを選んでください。\n※徒歩5分程の指定のカフェで鑑定を行います。", [
        { label: "名駅", text: "名駅" },
        { label: "栄", text: "栄" },
        { label: "金山", text: "金山" },
        { label: BACK_TO_FORMAT, text: BACK_TO_FORMAT },
      ]);
    }
    return replyText_(token, "ボタンから選んでください。");
  }

  // ② エリア（対面）→ 分数へ
  if (st.step === "エリア") {
    if (!INPERSON_PLACES[text]) return replyText_(token, "ボタンから選んでください。");
    setState_(userId, { area: text, step: "分数", partPage: 0 });
    return askMinutes_(token, userId);
  }

  // ③ 分数 → 日付へ
  if (st.step === "分数") {
    const minutes = pickMinutesFromText_(text);
    if ([30,45,60,75,90].includes(minutes)) {
      const isInperson = st.format === "INPERSON";
      const price = isInperson ? (PRICE_TABLE[minutes] + INPERSON_EXTRA) : PRICE_TABLE[minutes];
      setState_(userId, { minutes, price, step: "日付" });
      return askDate_(token, userId);
    }
    return replyText_(token, "表示された候補から選んでください。");
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

    return replyText_(token, "表示された候補から選んでください。");
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
        "日付を読み取れませんでした。\n" +
        "※ご予約受付は【本日から31日以内】です。\n\n" +
        "入力例：1月30日 / 1/30 / 2026/1/30 / 2026年1月30日",
        [{ label: BACK_TO_DATE, text: BACK_TO_DATE }]
      );
    }

    setState_(userId, { dateYMD: ymd, step: "部", partPage: 0 });
    return askPart_(token, userId, ymd, st.format);
  }

  // ⑤ 部 → 空き枠へ
  if (st.step === "部") {
    if (!PARTS[text]) return replyText_(token, "ボタンから選んでください。");
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

    if (!/^\d{2}:\d{2}$/.test(text)) return replyText_(token, "表示された候補から選んでください。");

    const slotList = safeJsonParse_(st.slotListJson) || [];
    const slot = slotList.find((x) => x && x.hm === text);
    if (!slot) return replyText_(token, "表示された候補から選んでください。");

    const start = new Date(slot.startISO);
    const end = new Date(start.getTime() + Number(st.minutes) * 60000);

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return replyText_(token, "ただいま混み合っています。もう一度お試しください。");

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

      // ★ 重要イベントログ：一時確保作成
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

      // ★改修：管理者通知（一時確保）
      notifyAdmin_(
        "【一時確保】\n" +
        buildAdminSummary_(res) + "\n" +
        `有効期限：${fmtHM_(expiresAt)}`
      );

      // ★改修：一時確保メッセージの強調表現
      const shortUrl = buildShortFormUrl_(key);
      pushQuickReply_(userId,
        "⏳【一時確保中】重要なお知らせ\n" +
        "下のフォーム送信で予約が確定します。\n\n" +
        "━━━━━━━━━━━━━━\n" +
        "有効期限までにフォーム送信が必要です\n" +
        `（有効期限：${fmtHM_(expiresAt)}）\n` +
        "━━━━━━━━━━━━━━\n\n" +
        "▼ フォーム入力（所要:約3分）",
        [
          { type: "uri", label: "フォームを開く", uri: shortUrl },
          { type: "message", label: "一時確保をキャンセル", text: CMD_RESET },
        ]
      );

      try { notifySheetUpsert_(res); } catch(e) {}
      try { updateCalendarEventTitle_(res); } catch(e) {}

      resetState_(userId);
      return;

    } finally {
      lock.releaseLock();
    }
  }

  return replyText_(token, `メニューから「${CMD_START}」を選んでください。`);
}
