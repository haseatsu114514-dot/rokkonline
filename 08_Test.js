// ===============================
// 08_Test.gs（テスト関数）
// GASエディタから手動実行可能
// ===============================

// ===== 設定 =====
const TEST_USER_ID = ADMIN_USER_ID;  // テストに使用するユーザーID
const TEST_SEND_LINE = true;         // テスト時にLINE通知を送信するか

// ===================================================
// ★1. 自分の予約をキャンセル
// ===================================================
function test_cancelMyReservation() {
  console.log("=== 予約キャンセルテスト開始 ===");

  const active = getActiveReservationForUser_(TEST_USER_ID);

  if (!active) {
    console.log("❌ アクティブな予約が見つかりませんでした。");
    console.log("=== テスト終了 ===");
    return;
  }

  console.log("📋 見つかった予約:");
  console.log("  - key: " + active.key);
  console.log("  - 状態: " + active.status);
  console.log("  - 形式: " + active.format);
  console.log("  - 日時: " + formatRangeText_(active));

  // キャンセル実行
  cancelReservationByUser_(active);

  // 結果確認
  const after = loadReservation_(active.key);
  console.log("✅ キャンセル完了");
  console.log("  - 新状態: " + after.status);

  if (TEST_SEND_LINE) {
    notifyAdmin_("【テスト】予約キャンセルテストを実行しました。key: " + active.key);
  }

  console.log("=== テスト終了 ===");
}

// ===================================================
// ★2. 対面フロー完全テスト
// ===================================================
function test_fullFlowInperson() {
  console.log("=== 対面フロー完全テスト開始 ===");
  const startTime = Date.now();

  // 既存予約をクリア
  _clearTestUserReservations();
  resetState_(TEST_USER_ID);

  // Step 1: 形式選択
  console.log("\n[Step 1] 形式選択: 対面");
  setState_(TEST_USER_ID, { format: "INPERSON", step: "エリア", partPage: 0 });
  _logState("形式選択後");

  // Step 2: エリア選択
  console.log("\n[Step 2] エリア選択: 名駅");
  setState_(TEST_USER_ID, { area: "名駅", step: "日付", partPage: 0 });
  _logState("エリア選択後");

  // Step 3: 日付選択（明日）
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const dateYMD = Utilities.formatDate(tomorrow, TZ, "yyyy-MM-dd");
  console.log("\n[Step 3] 日付選択: " + dateYMD);
  setState_(TEST_USER_ID, { dateYMD: dateYMD, step: "部", partPage: 0 });
  _logState("日付選択後");

  // Step 4: 部選択
  const availParts = getAvailablePartsForDate_("INPERSON", dateYMD);
  if (!availParts.length) {
    console.log("❌ 利用可能な部がありません。テスト中止。");
    return;
  }
  const partLabel = availParts[0];
  console.log("\n[Step 4] 部選択: " + partLabel);
  setState_(TEST_USER_ID, { partLabel: partLabel, partKey: PARTS[partLabel].key, step: "分数" });
  _logState("部選択後");

  // Step 5: 分数選択
  const availMins = getAvailableMinutesForPart_NoCross_(getState_(TEST_USER_ID));
  if (!availMins.length) {
    console.log("❌ 利用可能な分数がありません。テスト中止。");
    return;
  }
  const mins = availMins[0];
  const price = PRICE_TABLE[mins] + INPERSON_EXTRA;
  console.log("\n[Step 5] 分数選択: " + mins + "分 (" + fmtYen_(price) + ")");
  setState_(TEST_USER_ID, { minutes: mins, price: price, step: "空き枠" });
  _logState("分数選択後");

  // Step 6: 空き枠選択
  const slots = computeCandidateSlots_(getState_(TEST_USER_ID));
  if (!slots.length) {
    console.log("❌ 利用可能な空き枠がありません。テスト中止。");
    return;
  }
  const selectedSlot = slots[0];
  console.log("\n[Step 6] 空き枠選択: " + fmtHM_(selectedSlot));

  // Step 7: 一時確保作成
  console.log("\n[Step 7] 一時確保作成");
  const st = getState_(TEST_USER_ID);
  const start = selectedSlot;
  const end = new Date(start.getTime() + mins * 60000);
  const key = issueKey_();
  const expiresAt = new Date(Date.now() + HOLD_TTL_MIN * 60000);

  createHold_(start, end, key, TEST_USER_ID, expiresAt);

  const res = {
    key: key,
    userId: TEST_USER_ID,
    format: "INPERSON",
    area: st.area,
    partLabel: st.partLabel,
    partKey: st.partKey,
    dateYMD: st.dateYMD,
    minutes: mins,
    price: price,
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    holdExpiresISO: expiresAt.toISOString(),
    status: ST_HOLD,
    formReceived: false,
    payMethod: "",
    createdAtISO: nowISO_(),
    updatedAtISO: nowISO_(),
    flags: {}
  };

  saveReservation_(key, res);
  indexUserKey_(TEST_USER_ID, key);
  console.log("  - key: " + key);
  console.log("  - 状態: " + res.status);

  // Step 8: フォーム受理シミュレート
  console.log("\n[Step 8] フォーム受理シミュレート（対面→即確定）");
  const dummyFormData = {
    name: "テスト太郎",
    sex: "男性",
    birthDate: "1990-01-01",
    birthTime: "12:00 東京",
    topics: "仕事,恋愛",
    details: "テスト詳細"
  };
  setFormReceivedByKey_(key, "現金", dummyFormData);

  const final = loadReservation_(key);
  console.log("✅ 最終状態: " + final.status);

  const elapsed = Date.now() - startTime;
  console.log("\n=== 対面フロー完全テスト完了 ===");
  console.log("総実行時間: " + elapsed + "ms");

  if (TEST_SEND_LINE) {
    try { pushToAdminBot_("【テスト】対面フロー完全テストを実行しました。key: " + key + "、最終状態: " + final.status); } catch (e) { }
  }
}

// ===================================================
// ★3. オンラインフロー完全テスト
// ===================================================
function test_fullFlowOnline() {
  console.log("=== オンラインフロー完全テスト開始 ===");
  const startTime = Date.now();

  // 既存予約をクリア
  _clearTestUserReservations();
  resetState_(TEST_USER_ID);

  // Step 1: 形式選択
  console.log("\n[Step 1] 形式選択: オンライン");
  setState_(TEST_USER_ID, { format: "ONLINE", area: "", step: "日付", partPage: 0 });
  _logState("形式選択後");

  // Step 2: 日付選択（明日）
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const dateYMD = Utilities.formatDate(tomorrow, TZ, "yyyy-MM-dd");
  console.log("\n[Step 2] 日付選択: " + dateYMD);
  setState_(TEST_USER_ID, { dateYMD: dateYMD, step: "部", partPage: 0 });
  _logState("日付選択後");

  // Step 3: 部選択
  const availParts = getAvailablePartsForDate_("ONLINE", dateYMD);
  if (!availParts.length) {
    console.log("❌ 利用可能な部がありません。テスト中止。");
    return;
  }
  const partLabel = availParts[0];
  console.log("\n[Step 3] 部選択: " + partLabel);
  setState_(TEST_USER_ID, { partLabel: partLabel, partKey: PARTS[partLabel].key, step: "分数" });
  _logState("部選択後");

  // Step 4: 分数選択
  const availMins = getAvailableMinutesForPart_NoCross_(getState_(TEST_USER_ID));
  if (!availMins.length) {
    console.log("❌ 利用可能な分数がありません。テスト中止。");
    return;
  }
  const mins = availMins[0];
  const price = PRICE_TABLE[mins];
  console.log("\n[Step 4] 分数選択: " + mins + "分 (" + fmtYen_(price) + ")");
  setState_(TEST_USER_ID, { minutes: mins, price: price, step: "空き枠" });
  _logState("分数選択後");

  // Step 5: 空き枠選択
  const slots = computeCandidateSlots_(getState_(TEST_USER_ID));
  if (!slots.length) {
    console.log("❌ 利用可能な空き枠がありません。テスト中止。");
    return;
  }
  const selectedSlot = slots[0];
  console.log("\n[Step 5] 空き枠選択: " + fmtHM_(selectedSlot));

  // Step 6: 一時確保作成
  console.log("\n[Step 6] 一時確保作成");
  const st = getState_(TEST_USER_ID);
  const start = selectedSlot;
  const end = new Date(start.getTime() + mins * 60000);
  const key = issueKey_();
  const expiresAt = new Date(Date.now() + HOLD_TTL_MIN * 60000);

  createHold_(start, end, key, TEST_USER_ID, expiresAt);

  const res = {
    key: key,
    userId: TEST_USER_ID,
    format: "ONLINE",
    area: "",
    partLabel: st.partLabel,
    partKey: st.partKey,
    dateYMD: st.dateYMD,
    minutes: mins,
    price: price,
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    holdExpiresISO: expiresAt.toISOString(),
    status: ST_HOLD,
    formReceived: false,
    payMethod: "",
    createdAtISO: nowISO_(),
    updatedAtISO: nowISO_(),
    flags: {}
  };

  saveReservation_(key, res);
  indexUserKey_(TEST_USER_ID, key);
  console.log("  - key: " + key);
  console.log("  - 状態: " + res.status);

  // Step 7: フォーム受理（→支払い待ち）
  console.log("\n[Step 7] フォーム受理シミュレート（オンライン→支払い待ち）");
  const dummyFormData = {
    name: "テスト花子",
    sex: "女性",
    birthDate: "1995-12-25",
    birthTime: "20:00 大阪",
    topics: "結婚,金運",
    details: "テスト詳細オンライン"
  };
  setFormReceivedByKey_(key, "PayPay", dummyFormData);

  let current = loadReservation_(key);
  console.log("  - 状態: " + current.status);

  // Step 8: 支払い報告シミュレート（→即確定）
  console.log("\n[Step 8] 支払い報告シミュレート");
  // 本来はhandlePaymentCommands_内でやる処理を擬似再現
  current.status = ST_PAID_CONFIRMED;
  current.paidReportedAtISO = nowISO_();
  current.paidConfirmedAtISO = nowISO_();
  current.updatedAtISO = nowISO_();
  saveReservation_(key, current);

  console.log("✅ 支払い報告後の状態（即確定）: " + current.status);

  const final = loadReservation_(key);
  console.log("✅ 最終状態: " + final.status);

  const elapsed = Date.now() - startTime;
  console.log("\n=== オンラインフロー完全テスト完了 ===");
  console.log("総実行時間: " + elapsed + "ms");

  if (TEST_SEND_LINE) {
    try { pushToAdminBot_("【テスト】オンラインフロー完全テストを実行しました。key: " + key + "、最終状態: " + final.status); } catch (e) { }
  }
}

// ===================================================
// ★4. 処理速度計測
// ===================================================
function test_performance() {
  console.log("=== パフォーマンステスト開始 ===\n");

  const results = {};
  const iterations = 5;

  // 明日の日付
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const dateYMD = Utilities.formatDate(tomorrow, TZ, "yyyy-MM-dd");

  // 1. isSlotFree_
  console.log("[1] isSlotFree_ 計測中...");
  const start1 = Date.now();
  for (let i = 0; i < iterations; i++) {
    const testStart = new Date(tomorrow);
    testStart.setHours(14, 0, 0, 0);
    const testEnd = new Date(testStart.getTime() + 30 * 60000);
    isSlotFree_(testStart, testEnd);
  }
  results["isSlotFree_"] = (Date.now() - start1) / iterations;

  // 2. computeCandidateSlots_
  console.log("[2] computeCandidateSlots_ 計測中...");
  const testState = {
    partLabel: "昼の部",
    partKey: "昼の部",
    minutes: 30,
    dateYMD: dateYMD
  };
  const start2 = Date.now();
  for (let i = 0; i < iterations; i++) {
    computeCandidateSlots_(testState);
  }
  results["computeCandidateSlots_"] = (Date.now() - start2) / iterations;

  // 3. getAvailablePartsForDate_
  console.log("[3] getAvailablePartsForDate_ 計測中...");
  const start3 = Date.now();
  for (let i = 0; i < iterations; i++) {
    getAvailablePartsForDate_("ONLINE", dateYMD);
  }
  results["getAvailablePartsForDate_"] = (Date.now() - start3) / iterations;

  // 4. getPartAvailability_（API用）
  console.log("[4] getPartAvailability_ 計測中...");
  const start4 = Date.now();
  for (let i = 0; i < iterations; i++) {
    getPartAvailability_("昼の部", dateYMD);
    getPartAvailability_("夕の部", dateYMD);
    getPartAvailability_("夜の部", dateYMD);
  }
  results["getPartAvailability_ (3部×" + iterations + "回)"] = (Date.now() - start4) / iterations;

  // 5. loadReservation_ / saveReservation_
  console.log("[5] Properties操作 計測中...");
  const testKey = "perf_test_" + Date.now();
  const testData = { test: true, ts: nowISO_() };

  const start5 = Date.now();
  for (let i = 0; i < iterations; i++) {
    saveReservation_(testKey, testData);
    loadReservation_(testKey);
  }
  results["load+save Reservation_"] = (Date.now() - start5) / iterations;

  // クリーンアップ
  PropertiesService.getScriptProperties().deleteProperty("res_" + testKey);

  // 6. getState_ / setState_
  console.log("[6] State操作 計測中...");
  const start6 = Date.now();
  for (let i = 0; i < iterations; i++) {
    setState_(TEST_USER_ID, { testKey: i });
    getState_(TEST_USER_ID);
  }
  results["get+set State_"] = (Date.now() - start6) / iterations;

  // === 結果表示 ===
  console.log("\n=============================");
  console.log("パフォーマンステスト結果");
  console.log("（" + iterations + "回平均、単位: ms）");
  console.log("=============================");

  let maxTime = 0;
  let bottleneck = "";

  for (const [name, time] of Object.entries(results)) {
    const timeStr = time.toFixed(1);
    console.log(name + ": " + timeStr + "ms");
    if (time > maxTime) {
      maxTime = time;
      bottleneck = name;
    }
  }

  console.log("=============================");
  console.log("⚠️ ボトルネック: " + bottleneck + " (" + maxTime.toFixed(1) + "ms)");
  console.log("=== パフォーマンステスト完了 ===");
}

// ===================================================
// ★5. Cronジョブテスト
// ===================================================
function test_cronJobs() {
  console.log("=== Cronジョブテスト開始 ===\n");

  console.log("[1] cleanupHoldCron");
  const start1 = Date.now();
  cleanupHoldCron();
  console.log("  完了: " + (Date.now() - start1) + "ms");

  console.log("\n[2] autoClosePastReservationsCron");
  const start2 = Date.now();
  autoClosePastReservationsCron();
  console.log("  完了: " + (Date.now() - start2) + "ms");

  console.log("\n[3] paymentCancelCron");
  const start3 = Date.now();
  paymentCancelCron();
  console.log("  完了: " + (Date.now() - start3) + "ms");

  console.log("\n[4] remindCron");
  const start4 = Date.now();
  remindCron();
  console.log("  完了: " + (Date.now() - start4) + "ms");

  console.log("\n=== Cronジョブテスト完了 ===");
}

// ===================================================
// ★6. カレンダー連携テスト
// ===================================================
function test_calendarIntegration() {
  console.log("=== カレンダー連携テスト開始 ===\n");

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  tomorrow.setHours(10, 0, 0, 0);
  const end = new Date(tomorrow.getTime() + 30 * 60000);
  const testKey = "cal_test_" + Date.now();

  console.log("[1] イベント作成（createHold_）");
  createHold_(tomorrow, end, testKey, TEST_USER_ID, new Date(Date.now() + 30 * 60000));
  console.log("  ✅ イベント作成完了");

  console.log("\n[2] イベント検索");
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const events = cal.getEvents(
    new Date(tomorrow.getTime() - 60000),
    new Date(end.getTime() + 60000)
  );
  const found = events.find(ev => (ev.getTitle() || "").includes(testKey));
  if (found) {
    console.log("  ✅ イベント発見: " + found.getTitle());
  } else {
    console.log("  ❌ イベントが見つかりません");
    return;
  }

  console.log("\n[3] イベント更新（updateCalendarEventTitle_）");
  const dummyRes = {
    key: testKey,
    userId: TEST_USER_ID,
    format: "ONLINE",
    area: "",
    minutes: 30,
    price: 3300,
    status: ST_PAID_CONFIRMED,
    startISO: tomorrow.toISOString(),
    endISO: end.toISOString(),
    payMethod: "PayPay"
  };
  updateCalendarEventTitle_(dummyRes);
  console.log("  ✅ イベント更新完了");

  console.log("\n[4] イベント削除");
  found.deleteEvent();
  console.log("  ✅ イベント削除完了");

  console.log("\n=== カレンダー連携テスト完了 ===");
}

// ===================================================
// ★7. 日付バリデーションテスト
// ===================================================
function test_dateValidation() {
  console.log("=== 日付バリデーションテスト開始 ===\n");

  const testCases = [
    { input: "1月30日", expected: true },
    { input: "1/30", expected: true },
    { input: "2026/1/30", expected: true },
    { input: "2026年1月30日", expected: true },
    { input: "2026-01-30", expected: true },
    { input: "13月1日", expected: false },
    { input: "0月15日", expected: false },
    { input: "hogehoge", expected: false },
    { input: "", expected: false },
  ];

  let passed = 0;
  let failed = 0;

  testCases.forEach(tc => {
    const result = normalizeYMDInput_(tc.input);
    const isValid = !!result;
    const ok = isValid === tc.expected;

    if (ok) {
      passed++;
      console.log("✅ PASS: \"" + tc.input + "\" → " + (result || "(無効)"));
    } else {
      failed++;
      console.log("❌ FAIL: \"" + tc.input + "\" → 期待:" + tc.expected + " 実際:" + isValid);
    }
  });

  console.log("\n結果: " + passed + " passed, " + failed + " failed");
  console.log("=== 日付バリデーションテスト完了 ===");
}

// ===================================================
// ★8. テストデータクリーンアップ
// ===================================================
function test_cleanupTestData() {
  console.log("=== テストデータクリーンアップ開始 ===\n");

  // テストユーザーの予約を全てクリア
  _clearTestUserReservations();

  // ステートをリセット
  resetState_(TEST_USER_ID);
  console.log("✅ ステートをリセット");

  // テスト用Propertiesをクリア
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();
  let cleaned = 0;

  for (const key of Object.keys(allProps)) {
    if (key.includes("test_") || key.includes("perf_test_") || key.includes("cal_test_")) {
      props.deleteProperty(key);
      cleaned++;
    }
  }
  console.log("✅ テスト用Properties削除: " + cleaned + "件");

  console.log("\n=== テストデータクリーンアップ完了 ===");
}

// ===================================================
// ★9. 全テスト実行（まとめ）
// ===================================================
function test_runAllTests() {
  console.log("################################################################");
  console.log("#                    全テスト実行                              #");
  console.log("################################################################\n");

  const tests = [
    { name: "日付バリデーション", fn: test_dateValidation },
    { name: "パフォーマンス", fn: test_performance },
    { name: "カレンダー連携", fn: test_calendarIntegration },
    { name: "Cronジョブ", fn: test_cronJobs },
  ];

  tests.forEach((t, i) => {
    console.log("\n>>> [" + (i + 1) + "/" + tests.length + "] " + t.name + " テスト開始 <<<");
    try {
      t.fn();
    } catch (e) {
      console.log("❌ エラー: " + e.toString());
    }
  });

  console.log("\n################################################################");
  console.log("#                    全テスト完了                              #");
  console.log("################################################################");
  console.log("\n※ フロー完全テストは個別に実行してください");
  console.log("  - test_fullFlowInperson()  : 対面フロー");
  console.log("  - test_fullFlowOnline()    : オンラインフロー");
}

// ===================================================
// ヘルパー関数
// ===================================================

function _logState(label) {
  const st = getState_(TEST_USER_ID);
  console.log("  [" + label + "] step=" + (st.step || "-") + ", format=" + (st.format || "-") + ", date=" + (st.dateYMD || "-"));
}

function _clearTestUserReservations() {
  console.log("既存予約のクリーンアップ中...");
  let cleared = 0;

  const keys = getUserKeys_(TEST_USER_ID);
  keys.forEach(k => {
    const r = loadReservation_(k);
    if (r && ACTIVE_STATUSES.includes(r.status)) {
      // カレンダーから削除
      try {
        const cal = CalendarApp.getCalendarById(CALENDAR_ID);
        const start = new Date(r.startISO);
        const end = new Date(r.endISO);
        const events = cal.getEvents(
          new Date(start.getTime() - 60000),
          new Date(end.getTime() + 60000)
        );
        for (const ev of events) {
          if ((ev.getTitle() || "").includes(r.key) || (ev.getDescription() || "").includes(r.key)) {
            ev.deleteEvent();
            break;
          }
        }
      } catch (_) { }

      // 予約をキャンセル状態に
      r.status = ST_CANCELLED;
      r.updatedAtISO = nowISO_();
      saveReservation_(k, r);
      cleared++;
    }
  });

  console.log("  クリア済み: " + cleared + "件");
}

// ===================================================
// ★10. 「鑑定予約」コマンドテスト
// ===================================================
function test_startCommand() {
  console.log("=== 鑑定予約コマンドテスト開始 ===");

  // 状態クリア
  try {
    resetState_(TEST_USER_ID);
    console.log("✅ 状態リセット成功");
  } catch (e) {
    console.log("❌ 状態リセットエラー: " + e.toString());
  }

  // イベントシミュレート
  const ev = {
    type: "message",
    replyToken: "DUMMY_TOKEN",
    source: { userId: TEST_USER_ID },
    message: { type: "text", text: CMD_START }
  };

  console.log("送信メッセージ: " + ev.message.text);

  try {
    handleLineEvent_(ev);
    console.log("✅ handleLineEvent_ 正常終了");
    console.log("※注: 実際のLINE送信はUrlFetchAppの結果次第です");
  } catch (e) {
    console.log("❌ handleLineEvent_ エラー: " + e.toString());
  }
  
  // 実行後のステート確認
  const st = getState_(TEST_USER_ID);
  console.log("実行後のステート: " + JSON.stringify(st));
  if (st && st.step === "形式") {
    console.log("✅ ステートが「形式」に更新されました");
  } else {
    console.log("⚠️ ステート更新確認できず (step=" + (st ? st.step : "null") + ")");
  }
  
  console.log("=== 鑑定予約コマンドテスト終了 ===");
}
