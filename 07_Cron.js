// ===============================
// 07_Cron.gs（文言統一版）
// ===============================

// ===================================================
// cron エントリ
// ===================================================
// ===================================================
// cron エントリ
// ★改修：Push削減のためリマインド・自動キャンセル・期限切れ通知を停止
// ===================================================
function cronAll() {
  cleanupHoldCron(); // 一時確保の掃除（通知なし）
  autoClosePastReservationsCron(); // 過去予約の消化済み化

  // paymentCancelCron(); // ★停止：自動キャンセル
  // remindCron();        // ★停止：リマインド
}

// ===================================================
// 一時確保（HOLD）期限切れ掃除
// ===================================================
function cleanupHoldCron() {
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const now = new Date();

  const events = cal.getEvents(
    new Date(now.getTime() - 6 * 3600000),
    new Date(now.getTime() + 6 * 3600000)
  );

  events.forEach(ev => {
    const title = ev.getTitle() || "";
    if (!title.startsWith("HOLD ")) return;

    const exp = pickDesc_(ev.getDescription() || "", "expiresAt");
    const key = title.replace("HOLD", "").trim() || pickDesc_(ev.getDescription() || "", "key");
    const userId = pickDesc_(ev.getDescription() || "", "userId");

    if (exp && Date.now() > new Date(exp).getTime()) {
      try { ev.deleteEvent(); } catch (_) { }

      if (!key) return;
      const r = loadReservation_(key);
      if (!r || r.status !== ST_HOLD || r.formReceived) return;

      r.status = ST_EXPIRED;
      r.updatedAtISO = nowISO_();
      saveReservation_(key, r);
      try { notifySheetUpsert_(r); } catch (_) { }

      if (userId) {
        // ★停止：Push削減のため期限切れ通知は送らない
        /*
        pushText_(
          userId,
          "一時確保の期限が切れました。\n\n" +
          "お手数ですが、もう一度「鑑定予約」からお申し込みください。"
        );
        */
      }
    }
  });
}

// ===================================================
// 過去予約を自動で「消化済み」に落とす
// ===================================================
function autoClosePastReservationsCron() {
  const now = Date.now();

  getAllReservationKeys_().forEach(k => {
    const r = loadReservation_(k);
    if (!r) return;
    if ([ST_DONE, ST_EXPIRED, ST_CANCELLED].includes(r.status)) return;

    const end = new Date(r.endISO);
    if (isNaN(end.getTime())) return;
    if (end.getTime() >= now) return;

    r.status = ST_DONE;
    r.updatedAtISO = nowISO_();
    saveReservation_(k, r);
    try { notifySheetUpsert_(r); } catch (_) { }
  });
}

// ===================================================
// オンライン：支払い未完了による自動キャンセル
// ===================================================
function paymentCancelCron() {
  const now = new Date();

  getAllReservationKeys_().forEach(k => {
    const r = loadReservation_(k);
    if (!r) return;
    if (r.format !== "ONLINE") return;
    if (r.status !== ST_WAIT_PAY) return;
    if (!r.formReceived) return;

    const start = new Date(r.startISO);
    const cancelAt = new Date(start.getTime() - PAY_CANCEL_HOURS_BEFORE * 3600000);
    if (now < cancelAt) return;

    // カレンダー削除
    try {
      const cal = CalendarApp.getCalendarById(CALENDAR_ID);
      const events = cal.getEvents(
        new Date(start.getTime() - 60000),
        new Date(new Date(r.endISO).getTime() + 60000)
      );
      for (let ev of events) {
        if ((ev.getTitle() || "").includes(r.key)) {
          ev.deleteEvent();
          break;
        }
      }
    } catch (_) { }

    r.status = ST_CANCELLED;
    r.updatedAtISO = nowISO_();
    saveReservation_(r.key, r);
    try { notifySheetUpsert_(r); } catch (_) { }

    pushText_(
      r.userId,
      "【予約キャンセルのお知らせ】\n\n" +
      `開始${PAY_CANCEL_HOURS_BEFORE}時間前までにお支払い確認ができなかったため、予約は自動キャンセルとなりました。\n\n` +
      "改めてご希望の場合は「鑑定予約」からお申し込みください。"
    );
  });
}

// ===================================================
// リマインド送信（オンライン／対面）
// ===================================================
function remindCron() {
  const now = new Date();

  getAllReservationKeys_().forEach(k => {
    const r = loadReservation_(k);
    if (!r) return;

    const start = new Date(r.startISO);
    r.flags = r.flags || {};

    // -------- オンライン --------
    if (r.format === "ONLINE") {
      if (![ST_WAIT_PAY, ST_PAID_REPORTED, ST_PAID_CONFIRMED].includes(r.status)) return;
      if (r.flags.onlineMeetRemindSentAtISO) return;

      const sendAt = new Date(start.getTime() - ONLINE_REMIND_HOURS_BEFORE * 3600000);
      if (now < sendAt) return;
      if (now > new Date(start.getTime() + 15 * 60000)) return;

      pushText_(
        r.userId,
        "【オンライン鑑定リマインド】\n\n" +
        "まもなく開始です。\n" +
        `日時：${formatRangeText_(r)}\n` +
        `参加URL：${MEET_URL}\n\n` +
        "※お支払いの確認が取れない場合、鑑定は開始できません。"
      );

      r.flags.onlineMeetRemindSentAtISO = nowISO_();
      r.updatedAtISO = nowISO_();
      saveReservation_(r.key, r);
      try { notifySheetUpsert_(r); } catch (_) { }
      return;
    }

    // -------- 対面 --------
    if (r.status !== ST_INPERSON_FIXED) return;
    if (r.flags.inpersonPlaceRemindSentAtISO) return;

    const sendAt = new Date(start.getTime() - INPERSON_REMIND_HOURS_BEFORE * 3600000);
    if (now < sendAt) return;
    if (now > new Date(start.getTime() + 15 * 60000)) return;

    const p = INPERSON_PLACES[r.area] || null;
    const placeText = p
      ? `${p.name}\n住所：${p.address}`
      : "集合場所情報が見つかりませんでした。";

    pushText_(
      r.userId,
      "【対面鑑定リマインド】\n\n" +
      `日時：${formatRangeText_(r)}\n` +
      `エリア：${r.area}\n\n` +
      "集合場所：\n" +
      placeText +
      "\n\n※当日は先に席を確保してお待ちします。"
    );

    r.flags.inpersonPlaceRemindSentAtISO = nowISO_();
    r.updatedAtISO = nowISO_();
    saveReservation_(r.key, r);
    try { notifySheetUpsert_(r); } catch (_) { }
  });
}
