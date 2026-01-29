// ===============================
// 00_Config.gs
// ===============================

// ===== LINE =====
const ACCESS_TOKEN = "sVWnhFXqTy9bT4rRXd8Tf4uFdZT9A9+RKyAI0OzPhy9Yz0tGWsqxoInWEGlxCLLjrU6Ks/WJzi0AYnaiP/GEDAJLjRztKU5hyg6giDg3ShfcCApL6kELXeuBX6/OA0VOyXPL0IVndOMlhqZE/py1tQdB04t89/1O/w1cDnyilFU=";

// ===== 管理者通知（あなたのLINE userId）=====
// ※ここだけ差し替えて使う
const ADMIN_USER_ID = "U086aa3756b3a24bf9eb2105377771aa0";

// ===== Google Calendar =====
const CALENDAR_ID = "dafc8b598911cfc9b10f56e92993836fe3c9c11b90f0d270046ccc1943692e40@group.calendar.google.com";

// ===== Form（受付キー自動入力）=====
const FORM_URL_PREFILL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfvWGXWPzTlddJN2UcRTNmX0My1XAx35Yo0tSRbT-2Ea53tCg/viewform?usp=pp_url&entry.1196660557=TESTKEY";

// ===== Meet（固定）=====
const MEET_URL = "https://meet.google.com/mxa-cjrt-gdf";

// ===== シートWebアプリ（予約マスター）=====
const SHEET_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbxaqKIsu-fm0IT3OTAI0_J6AGzeaPu-B2Jjqg4wWK7Vx4dr5pVVpEapXIcmdy7Nx9C_sQ/exec";
const SHEET_API_SECRET = "rokkon_sheet_secret_2026";

// ===== 内部コマンド（フォーム受領通知など）=====
// フォーム側GASなどからこのLINE側WebAppへPOSTする際のsecret
const INTERNAL_SECRET = "rokkon_line_internal_secret_2026";

// ===== 共通 =====
const TZ = "Asia/Tokyo";
