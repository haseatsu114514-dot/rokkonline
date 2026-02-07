// ===============================
// 03_Utils.gs
// ===============================

function safeJsonParse_(s) { try { return JSON.parse(s); } catch (_) { return null; } }

function nowISO_() { return new Date().toISOString(); }
function fmtHM_(d) { return Utilities.formatDate(d, TZ, "HH:mm"); }
function fmtYMD_(d) { return Utilities.formatDate(d, TZ, "yyyy/MM/dd"); }
function fmtYen_(n) { return Number(n).toLocaleString("ja-JP") + "円"; }

function normalizeYMD_(t) {
  const s = String(t || "").replace(/（本日）/g, "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}
function normalizePayMethod_(m) {
  const s = String(m || "");
  if (/pay/i.test(s)) return "PayPay";
  if (/振|bank/i.test(s)) return "振込";
  if (/現金/.test(s)) return "現金（対面鑑定のみ）";
  return "";
}
function isSameDate_(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}
function isToday_(ymd) {
  const t = String(ymd || "").replace(/（本日）/g, "").trim();
  return t === Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
}
function formatRangeText_(r) {
  const s = new Date(r.startISO);
  const e = new Date(r.endISO);
  return `${fmtYMD_(s)} ${fmtHM_(s)}〜${fmtHM_(e)}`;
}
function pickDesc_(desc, key) {
  const m = String(desc || "").match(new RegExp(key + ":(.*)"));
  return m ? m[1].trim() : "";
}
function pickMinutesFromText_(text) {
  const m = String(text || "").match(/^(\d{2,3})\s*分/);
  return m ? Number(m[1]) : 0;
}

// ユーザー表示用ステータス
function userStatusLabel_(r) {
  if (!r || !r.status) return "";
  if (r.status === ST_HOLD) return "予約未完了（フォーム入力待ち）";
  if (r.status === ST_WAIT_PAY) return "支払い待ち";
  if (r.status === ST_PAID_REPORTED) return "支払い報告済み";
  if (r.status === ST_PAID_CONFIRMED) return "予約確定";
  if (r.status === ST_INPERSON_FIXED) return "予約確定";
  if (r.status === ST_EXPIRED) return "期限切れ";
  if (r.status === ST_CANCELLED) return "キャンセル";
  if (r.status === ST_DONE) return "消化済み";
  return r.status;
}

// フォーム入力期限（残り分数）表示
function holdRemainingText_(r) {
  if (!r || !r.holdExpiresISO) return "";
  const exp = new Date(r.holdExpiresISO);
  if (isNaN(exp.getTime())) return "";
  const diff = exp.getTime() - Date.now();
  if (diff <= 0) return "（期限切れ）";
  const mins = Math.ceil(diff / 60000);
  return `（残り${mins}分）`;
}

// ★追加：ロック取得のリトライ機構（高速化版）
function tryLockWithRetry_(maxRetries, waitMs) {
  maxRetries = maxRetries || 3;
  waitMs = waitMs || 300;
  const lock = LockService.getScriptLock();
  for (let i = 0; i < maxRetries; i++) {
    if (lock.tryLock(1500)) return lock;
    if (i < maxRetries - 1) Utilities.sleep(waitMs);
  }
  return null;
}
