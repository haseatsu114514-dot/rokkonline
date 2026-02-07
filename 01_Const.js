// ===============================
// 01_Const.gs（安全版）
// ===============================

// ===== 共通 =====
const STATE_TTL = 21600;          // 6h
const SLOT_STEP_MIN = 30;         // 30分刻み
const INTERVAL_MIN = 30;          // 前後30分インターバル
const SAME_DAY_LIMIT_HOURS = 5;   // 当日：開始5時間前を過ぎた枠は受付しない
const HOLD_TTL_MIN = 30;          // 一時確保 30分（内部はHOLD）
const QUICK_SLOT_MAX = 8;         // QuickReply最大8
const DATE_QUICK_DAYS = 7;        // 当日〜7日分

// cron
const PAY_NUDGE_HOURS_BEFORE = 6;       // （将来用／現状未使用OK）
const ONLINE_REMIND_HOURS_BEFORE = 2;   // オンライン 2時間前：Meet送付
const INPERSON_REMIND_HOURS_BEFORE = 2; // 対面 2時間前：集合場所

// ===== UI（キーワード）=====
// リッチメニュー互換のため固定
const CMD_START = "鑑定予約";

// リセット（ユーザー表示は「やり直す」）
// 旧互換: 既存導線を壊さないため、内部コマンドも受け付ける
const CMD_RESET = "やり直す";
const CMD_RESET_INTERNAL = "一時確保をキャンセル";
const CMD_RESET_LEGACY = "リセット";

// ===== ミニマム運用で使う操作 =====
const CMD_PAID_REPORT = "支払い報告（支払いました）";
const CMD_CANCEL = "キャンセルする";   // ミニマムで必須
const CMD_CANCEL_CONFIRM = "はい、キャンセルする";
const CMD_CANCEL_ABORT = "キャンセルしない";
const CMD_INQUIRY = "問い合わせる";    // ★追加：問い合わせボタン
const CMD_CHECK = "予約確認";          // ★追加：予約確認コマンド
const CMD_CHANGE_DATE = "日時を変更する";           // ★追加：日時変更
const CMD_CHANGE_DATE_YES = "はい、変更したい";     // ★追加：日時変更確認YES
const CMD_CHANGE_DATE_NO = "やっぱりやめる";        // ★追加：日時変更確認NO
const CMD_CHANGE_PAY_PAYPAY = "支払い方法をPayPayに変更";
const CMD_CHANGE_PAY_BANK = "支払い方法を振込に変更";

// ===== 部（時間帯）=====
const PARTS = {
  "昼の部": { key: "昼の部", start: "14:00", end: "16:30" },
  "夕の部": { key: "夕の部", start: "16:30", end: "19:00" },
  "夜の部": { key: "夜の部", start: "19:00", end: "22:00" },
};

// ===== 料金（MAX60運用）=====
const PRICE_TABLE = { 30: 4500, 45: 6500, 60: 8000 };
const INPERSON_EXTRA = 500;

// ===== 支払い情報（オンライン用）=====
const PAY_PAYPAY_ID = "rokkon9119";
const PAY_BANK_TEXT =
  "住信SBIネット銀行（0038）\n" +
  "キウイ支店（109）\n" +
  "普通 8580887\n" +
  "ハセガワ アツキ";

// ===== 対面の集合場所 =====
const INPERSON_PLACES = {
  名駅: {
    name: "コメダ珈琲店 名駅四丁目店",
    address: "〒450-0002 愛知県名古屋市中村区名駅4丁目11-1 コレクトマーク名駅4丁目 1F",
  },
  栄: {
    name: "コメダ珈琲店 BINO栄店",
    address: "〒460-0003 愛知県名古屋市中区錦3丁目24-17 BINO栄 2F",
  },
  金山: {
    name: "コメダ珈琲店 金山駅北口店",
    address: "〒460-0022 愛知県名古屋市中区金山1丁目14-16 トキワビル 1階・2階",
  },
};

// ===== ステータス =====
// ※過去データ互換のため値は変更しない（表示は06側で「一時確保」に変換）
const ST_HOLD = "一時確保";
const ST_EXPIRED = "期限切れ";
const ST_DONE = "消化済み";
const ST_CANCELLED = "キャンセル";

// オンライン専用
const ST_WAIT_PAY = "支払い待ち";
const ST_PAID_REPORTED = "支払い報告済み";
const ST_PAID_CONFIRMED = "支払い確認済み";

// 対面専用（現地支払い）
const ST_INPERSON_FIXED = "予約確定（現地支払い）";

// 1人1枠制限でアクティブ扱い
const ACTIVE_STATUSES = [
  ST_HOLD,
  ST_WAIT_PAY,
  ST_PAID_REPORTED,
  ST_PAID_CONFIRMED,
  ST_INPERSON_FIXED,
];

// ===== 対面同意 =====
const INPERSON_CONSENT_TEXT =
  "【対面鑑定のルール（重要）】\n" +
  "・当日は先に席を確保してお待ちします。\n" +
  "・混雑状況により、店舗/合流場所を変更する場合があります（LINEで連絡します）。\n" +
  "・対面は【当日キャンセル不可】です。\n" +
  "　体調不良などやむを得ない場合でも「日付変更」をお願いしています。\n\n" +
  "確実に来られる場合のみお申し込みください。\n" +
  "同意いただける場合のみ次へ進めます。";

// ===== 支払い関連のタイムライン =====
const PAY_CANCEL_HOURS_BEFORE = 3; // 支払い期限：開始3時間前
