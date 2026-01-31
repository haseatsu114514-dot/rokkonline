// ===============================
// 06a_Flow_Core.gs（コア処理）★改修版 + 日付パラメータ対応 + タグ対応 + キャッシュ対応 + 0時切り替え対応
// ===============================

// ===================================================
// Webhook entry
// ===================================================
function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "";
    if (!raw) return ContentService.createTextOutput("NOPOSTDATA");
    const body = JSON.parse(raw);

    // 内部コマンド（フォーム受領通知など）
    if (body && body.secret && body.cmd) {
      const ok = handleInternalCommand_(body);
      return ContentService.createTextOutput(ok ? "OK" : "NG");
    }

    (body.events || []).forEach(ev => {
      try { handleLineEvent_(ev); } catch (err) { console.error("Event handling error:", err); }
    });
  } catch (err) {
    console.log("doPost error:", err);
    // ★追加：管理Botにエラー通知
    try { pushToAdminBot_("⚠️ Webhookエラー発生:\n" + err.message); } catch (_) { }
    return ContentService.createTextOutput("ERROR: " + err.message);
  }
  return ContentService.createTextOutput("OK");
}

// ===================================================
// doGet：フォーム短縮URL（?f=key）用リダイレクト
// + 予約状況API（日付パラメータ対応版 + キャッシュ対応 + 0時切り替え対応）
// ===================================================
function doGet(e) {
  // パラメータがない場合の処理
  if (!e || !e.parameter) {
    return ContentService.createTextOutput("OK");
  }

  // フォーム短縮URLリダイレクト（既存機能）
  const f = e.parameter.f ? String(e.parameter.f).trim() : "";
  if (f) {
    const url = FORM_URL_PREFILL.replace("TESTKEY", encodeURIComponent(f));
    return HtmlService.createHtmlOutput(
      `<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="0; url=${url}">
</head><body>Loading...</body></html>`
    );
  }

  // ★★★ 予約状況API（日付パラメータ対応 + キャッシュ対応 + 0時切り替え対応） ★★★
  const action = e.parameter.action ? String(e.parameter.action).trim() : "";
  if (action === "getTodayAvailability") {
    return handleGetTodayAvailability_(e);
  }

  return ContentService.createTextOutput("OK");
}

/**
 * 予約状況を取得（完全版：0時切り替え対応）
 * URLパラメータ: ?action=getTodayAvailability&date=2026-01-28
 * dateパラメータがない場合は本日のデータを返す
 * 21:30〜23:59は翌日のデータを返す
 * 0:00以降は本日のデータを返す
 * 60秒間キャッシュ（23:50以降は10秒）
 */
function handleGetTodayAvailability_(e) {
  try {
    // ★★★ キャッシュキーに時刻を含める（0時で切り替わるように） ★★★
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // 21:30〜23:59のみ翌日表示（0:00以降は本日）
    const isAfter2130 = (currentHour === 21 && currentMinute >= 30) || (currentHour >= 22 && currentHour <= 23);
    // キャッシュ廃止（常に最新データを取得）

    // ★★★ 日付パラメータ処理 ★★★
    let dateYMD = e.parameter.date ? String(e.parameter.date).trim() : "";

    if (!dateYMD || !/^\d{4}-\d{2}-\d{2}$/.test(dateYMD)) {
      dateYMD = Utilities.formatDate(now, TZ, "yyyy-MM-dd");
    }

    // ★★★ 21:30〜23:59のみ翌日表示（0:00以降は本日） ★★★
    if (isAfter2130 && !e.parameter.date) {
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      dateYMD = Utilities.formatDate(tomorrow, TZ, "yyyy-MM-dd");
    }

    const tag = isAfter2130 ? "【翌日】" : "【本日】";

    // ★一括取得：1回のAPI呼び出しで1日分のイベントを取得
    const eventsCache = getDayEvents_(dateYMD);

    const result = {
      date: dateYMD,
      tag: tag,
      parts: {
        "昼の部": getPartAvailability_("昼の部", dateYMD, eventsCache),
        "夕の部": getPartAvailability_("夕の部", dateYMD, eventsCache),
        "夜の部": getPartAvailability_("夜の部", dateYMD, eventsCache)
      },
      updated: new Date().toISOString()
    };

    const resultJson = JSON.stringify(result);

    return ContentService.createTextOutput(resultJson)
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error("getTodayAvailability error:", error);

    const fallbackDate = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");

    const fallback = {
      date: fallbackDate,
      tag: "【本日】",
      parts: {
        "昼の部": { status: "full", count: 0 },
        "夕の部": { status: "full", count: 0 },
        "夜の部": { status: "full", count: 0 }
      },
      error: error.toString()
    };

    return ContentService.createTextOutput(JSON.stringify(fallback))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ===================================================
// 追加UI：見出し付きQuickReply（1通に統合）
// ===================================================
function replyQuickReplyWithHeader_(token, headerText, bodyText, labels) {
  return reply_(token, [{
    type: "text",
    text: `${headerText}\n${bodyText}`,
    quickReply: {
      items: labels.slice(0, 8).map((l) => ({
        type: "action",
        action: { type: "message", label: l, text: l },
      })),
    },
  }]);
}

// ===================================================
// フォーム短縮URL生成（このWebApp自身へ）
// ===================================================
function buildShortFormUrl_(key) {
  const THIS_WEBAPP_URL = ScriptApp.getService().getUrl();
  return `${THIS_WEBAPP_URL}?f=${encodeURIComponent(key)}`;
}

// ===================================================
// 管理者通知（あなた用）
// ===================================================
function notifyAdmin_(text) {
  if (!ADMIN_USER_ID) return;
  try { pushText_(ADMIN_USER_ID, text); } catch (e) { console.log("notifyAdmin_ error", e); }
}

function buildAdminSummary_(r) {
  const fmt = (r.format === "ONLINE") ? "オンライン" : "対面";
  const area = (r.format === "INPERSON" && r.area) ? `（${r.area}）` : "";
  return (
    `【${r.status}】${fmt}${area}\n` +
    `日時：${formatRangeText_(r)}\n` +
    `料金：${fmtYen_(r.price)}`
  );
}

// ===================================================
// 内部コマンド
// ===================================================
function handleInternalCommand_(body) {
  try {
    if (body.secret !== INTERNAL_SECRET) return false;

    const cmd = String(body.cmd || "");

    // ★廃止：FORM_RECEIVED_NOTICE_ONLY は使わない（メッセージ削減）

    if (cmd === "FORM_RECEIVED") {
      const key = String(body.key || "").trim();
      const payMethod = normalizePayMethod_(body.payMethod || "");
      if (!key) return false;
      // ★追加：フォームからの鑑定情報を渡す
      const formData = {
        name: body.name || "",
        birthDate: body.birthDate || "",
        birthTime: body.birthTime || "",
        sex: body.sex || "",
        topics: body.topics || "",
        details: body.details || ""
      };
      setFormReceivedByKey_(key, payMethod, formData);
      return true;
    }

    if (cmd === "MARK_PAID_CONFIRMED") {
      const key = String(body.key || "").trim();
      if (!key) return false;
      markPaidConfirmedByKey_(key);
      return true;
    }

    return false;
  } catch (e) {
    console.log("handleInternalCommand_ error:", e);
    return false;
  }
}

// ===================================================
// フォーム受理 → 予約へ
// ★改修：フォームデータを受け取り、管理Botに鑑定情報を転送
// ===================================================
function setFormReceivedByKey_(key, payMethod, formData) {
  const r = loadReservation_(key);
  if (!r) return;
  if (r.status === ST_EXPIRED) return;

  // フォームデータを予約に保存
  formData = formData || {};
  r.formReceived = true;
  r.payMethod = normalizePayMethod_(payMethod || r.payMethod || "");
  r.formData = {
    name: formData.name || "",
    birthDate: formData.birthDate || "",
    birthTime: formData.birthTime || "",
    sex: formData.sex || "",
    topics: formData.topics || "",
    details: formData.details || ""
  };

  if (r.format === "ONLINE") {
    if (r.status === ST_HOLD) r.status = ST_WAIT_PAY;
  } else {
    if (r.status === ST_HOLD) r.status = ST_INPERSON_FIXED;
  }

  r.updatedAtISO = nowISO_();
  saveReservation_(key, r);

  logToSheet_({
    ts: new Date().toISOString(),
    event: "FORM_RECEIVED",
    userId: r.userId,
    key: r.key,
    format: r.format,
    area: r.area,
    date: r.dateYMD,
    start: fmtHM_(new Date(r.startISO)),
    minutes: r.minutes,
    price: r.price,
    payMethod: r.payMethod
  });

  // ★管理Botに鑑定情報を転送
  const formatText = r.format === "ONLINE" ? "オンライン" : "対面";
  const birthTimeText = r.formData.birthTime ? `\n出生時間・場所：${r.formData.birthTime}` : "";
  pushToAdminBot_(
    "📋【予約確定】鑑定情報\n" +
    "━━━━━━━━━━━━━━\n" +
    `日時：${formatRangeText_(r)}\n` +
    `形式：${formatText}${r.area ? "（" + r.area + "）" : ""}\n` +
    `鑑定分数：${r.minutes}分\n` +
    `料金：${fmtYen_(r.price)}\n` +
    "━━━━━━━━━━━━━━\n" +
    `お名前：${r.formData.name || "未入力"}\n` +
    `性別：${r.formData.sex || "未入力"}\n` +
    `生年月日：${r.formData.birthDate || "未入力"}` +
    birthTimeText + "\n" +
    `テーマ：${r.formData.topics || "未選択"}\n` +
    `詳細：${r.formData.details || "なし"}`
  );

  try { notifySheetUpsert_(r); } catch (e) { }
  try { updateCalendarEventTitle_(r); } catch (e) { }

  if (r.format === "ONLINE") {
    if (r.payMethod === "現金（対面鑑定のみ）") {
      push_(r.userId, [
        {
          type: "text", text:
            "フォームのご回答を確認しました。ありがとうございます。\n\n" +
            "⚠️ 支払い方法が「現金（対面鑑定のみ）」になっていました。\n" +
            "オンライン鑑定は【PayPay / 振込】でのお支払いをお願いします。\n\n" +
            "どちらに変更しますか？"
        },
        buildButtonsMessage_("【支払い方法】", [
          { label: "PayPayに変更", text: "支払い方法をPayPayに変更" },
          { label: "振込に変更", text: "支払い方法を振込に変更" },
        ])
      ]);
      return;
    }

    pushQuickReply_(r.userId,
      "✅ 予約確定\n\n" +
      buildOnlinePayInfoText_(r.payMethod, r.startISO),
      [
        { type: "message", label: "支払い報告", text: CMD_PAID_REPORT },
        { type: "message", label: "日時を変更する", text: CMD_CHANGE_DATE },
      ]
    );
    return;
  }

  const p = INPERSON_PLACES[r.area] || null;
  const placeText = p ? `${p.name}\n住所：${p.address}` : "集合場所情報が見つかりませんでした。";

  // ★改修：1通に統合（本文＋ボタン）
  pushQuickReply_(r.userId,
    "✅ 予約確定\n\n" +
    `日時：${formatRangeText_(r)}\n` +
    `場所：${placeText}\n` +
    "支払：当日現地払い（現金/PayPay）\n\n" +
    "⚠️ リマインドは送りませんので、\n" +
    "この画面を【スクショ保存】してください。",
    [
      { type: "message", label: "日時を変更する", text: CMD_CHANGE_DATE },
    ]
  );


}

// ===================================================
// 支払い確認済み（管理者操作）
// ===================================================
function markPaidConfirmedByKey_(key) {
  const r = loadReservation_(key);
  if (!r) return;
  if (r.format !== "ONLINE") return;

  r.status = ST_PAID_CONFIRMED;
  r.paidConfirmedAtISO = nowISO_();
  r.updatedAtISO = nowISO_();
  saveReservation_(key, r);

  logToSheet_({
    ts: new Date().toISOString(),
    event: "PAID_CONFIRMED",
    userId: r.userId,
    key: r.key,
    date: r.dateYMD,
    start: fmtHM_(new Date(r.startISO)),
    price: r.price
  });

  try { notifySheetUpsert_(r); } catch (e) { }
  try { updateCalendarEventTitle_(r); } catch (e) { }

  // ★管理Bot通知
  pushToAdminBot_("【入金確認済み（手動）】\n" + buildAdminSummary_(r));
}

// ===================================================
// 一時確保解除
// ===================================================
function cancelActiveReservation_(userId) {
  const active = getActiveReservationForUser_(userId);
  if (!active) return false;
  if (active.status !== ST_HOLD) return false;

  try {
    const cal = CalendarApp.getCalendarById(CALENDAR_ID);
    const start = new Date(active.startISO);
    const end = new Date(active.endISO);
    const events = cal.getEvents(
      new Date(start.getTime() - 60000),
      new Date(end.getTime() + 60000)
    );

    for (let i = 0; i < events.length; i++) {
      const title = events[i].getTitle() || "";
      const desc = events[i].getDescription() || "";
      if (title.includes(active.key) || desc.includes(`key:${active.key}`)) {
        events[i].deleteEvent();
        break;
      }
    }
  } catch (e) {
    console.log("cancelActiveReservation_ calendar error:", e);
  }

  active.status = ST_EXPIRED;
  active.updatedAtISO = nowISO_();
  saveReservation_(active.key, active);
  try { notifySheetUpsert_(active); } catch (e) { }
  try { updateCalendarEventTitle_(active); } catch (e) { }

  return true;
}

// ===================================================
// 予約キャンセル（ユーザー操作）
// ===================================================
function cancelReservationByUser_(r) {
  try {
    const start = new Date(r.startISO);
    const end = new Date(r.endISO);
    const cal = CalendarApp.getCalendarById(CALENDAR_ID);
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

  r.status = ST_CANCELLED;
  r.updatedAtISO = nowISO_();
  saveReservation_(r.key, r);
  try { notifySheetUpsert_(r); } catch (_) { }
  try { updateCalendarEventTitle_(r); } catch (_) { }
}

// ===================================================
// 支払い報告
// ★改修：入金確認フローを廃止。支払い報告で予約確定。
// ===================================================
function buildOnlineAfterPaidReportText_(r) {
  return (
    "支払い報告を受け付けました。ありがとうございます。\n" +
    "これで【予約確定】です！\n\n" +
    `日時：${formatRangeText_(r)}\n` +
    `料金：${fmtYen_(r.price)}\n` +
    `参加URL：${MEET_URL}\n\n` +
    "✅ Google Meet は【アカウント不要／アプリ不要】で参加できます。\n" +
    "・スマホ：URLを開く → ブラウザ参加\n" +
    "・PC：URLを開くだけでOK\n\n" +
    "当日は上記URLから参加してください。\n" +
    "お会いできるのを楽しみにしています！\n\n" +
    "⚠️【重要】リマインドは送信されません\n" +
    "この画面をスクリーンショットで保存し、カレンダー等に登録してください。"
  );
}

function handlePaymentCommands_(userId, token, text) {
  if (text !== CMD_PAID_REPORT) return false;

  const r = getActiveReservationForUser_(userId);
  if (!r) {
    replyText_(token, "対象の予約が見つかりませんでした。");
    return true;
  }
  if (r.format !== "ONLINE") {
    replyText_(token, "支払い報告はオンライン鑑定のみです。");
    return true;
  }
  // ★改修：確認済みも許可（重複報告対応）
  if (![ST_WAIT_PAY, ST_PAID_REPORTED, ST_PAID_CONFIRMED].includes(r.status)) {
    replyText_(token, `現在の状態：${r.status}\nこの操作は不要です。`);
    return true;
  }
  // 既に確認済みなら再送信
  if (r.status === ST_PAID_CONFIRMED) {
    replyText_(token, buildOnlineAfterPaidReportText_(r));
    return true;
  }

  // ★改修：支払い報告で直接「確認済み」に（入金確認フロー廃止）
  r.status = ST_PAID_CONFIRMED;
  r.paidReportedAtISO = nowISO_();
  r.paidConfirmedAtISO = nowISO_();
  r.updatedAtISO = nowISO_();
  saveReservation_(r.key, r);

  logToSheet_({
    ts: new Date().toISOString(),
    event: "PAID_CONFIRMED",
    userId: r.userId,
    key: r.key,
    date: r.dateYMD,
    start: fmtHM_(new Date(r.startISO)),
    price: r.price
  });

  // ★改修：管理者通知から「入金確認→」を削除
  notifyAdmin_(
    "【支払い報告→予約確定】\n" +
    buildAdminSummary_(r)
  );

  try { notifySheetUpsert_(r); } catch (e) { }
  try { updateCalendarEventTitle_(r); } catch (e) { }

  replyText_(token, buildOnlineAfterPaidReportText_(r));
  return true;
}
