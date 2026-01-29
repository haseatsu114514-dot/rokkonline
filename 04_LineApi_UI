// ===============================
// 04_LineApi_UI.gs
// ===============================

function reply_(t, msgs) {
  const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + ACCESS_TOKEN },
    payload: JSON.stringify({ replyToken: t, messages: msgs }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    console.log("reply_ error:", res.getContentText());
  }
}

function replyText_(t, text) {
  reply_(t, [{ type: "text", text }]);
}

function push_(uid, msgs) {
  const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + ACCESS_TOKEN },
    payload: JSON.stringify({ to: uid, messages: msgs }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    console.log("push_ error:", res.getContentText());
  }
}

/**
 * ★ BOT発言（OUT）ログ付き pushText
 */
function pushText_(uid, text) {
  logToSheet_({
    ts: new Date().toISOString(),
    direction: "OUT",
    userId: uid,
    key: getLatestKeyForUser_(uid) || "",
    type: "text",
    text: text
  });
  push_(uid, [{ type: "text", text }]);
}

// -------------------------------
// Buttons template
// -------------------------------
function buildButtonsMessage_(text, actions) {
  return {
    type: "template",
    altText: text,
    template: {
      type: "buttons",
      text,
      actions: actions.slice(0, 4).map(a => ({
        type: "message",
        label: a.label,
        text: a.text
      }))
    }
  };
}

function replyButtons_(t, text, actions) {
  reply_(t, [buildButtonsMessage_(text, actions)]);
}

// -------------------------------
// QuickReply
// -------------------------------
function replyQuickReply_(t, text, labels) {
  reply_(t, [{
    type: "text",
    text,
    quickReply: {
      items: labels.slice(0, 8).map(l => ({
        type: "action",
        action: { type: "message", label: l, text: l }
      }))
    }
  }]);
}

function replyTextQuickReply_(t, text, items) {
  reply_(t, [{
    type: "text",
    text,
    quickReply: {
      items: items.slice(0, 8).map(it => ({
        type: "action",
        action: it.type === "uri"
          ? { type: "uri", label: it.label, uri: it.uri }
          : { type: "message", label: it.label, text: it.text }
      }))
    }
  }]);
}

function pushQuickReply_(uid, text, items) {
  push_(uid, [{
    type: "text",
    text,
    quickReply: {
      items: items.slice(0, 8).map(it => ({
        type: "action",
        action: it.type === "uri"
          ? { type: "uri", label: it.label, uri: it.uri }
          : { type: "message", label: it.label, text: it.text }
      }))
    }
  }]);
}

// -------------------------------
// 会話ログ送信
// -------------------------------
function logToSheet_(payload) {
  try {
    UrlFetchApp.fetch(SHEET_WEBAPP_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        secret: SHEET_API_SECRET,
        cmd: "APPEND_CHATLOG",
        data: payload
      }),
      muteHttpExceptions: true
    });
  } catch (e) {
    console.log("logToSheet error", e);
  }
}
