// ===============================
// 02_StoreState.gs
// ===============================

// ---- Reservation（Properties）----
function saveReservation_(k, obj) {
  PropertiesService.getScriptProperties().setProperty("res_" + k, JSON.stringify(obj));
}
function loadReservation_(k) {
  const s = PropertiesService.getScriptProperties().getProperty("res_" + k);
  return s ? JSON.parse(s) : null;
}
function getAllReservationKeys_() {
  return Object.keys(PropertiesService.getScriptProperties().getProperties())
    .filter((k) => k.startsWith("res_"))
    .map((k) => k.replace("res_", ""));
}

// userId -> keys（直近50）
function indexUserKey_(u, k) {
  const p = PropertiesService.getScriptProperties();
  const keyName = "uKeys_" + u;
  const cur = safeJsonParse_(p.getProperty(keyName)) || [];
  if (!cur.includes(k)) cur.push(k);
  p.setProperty(keyName, JSON.stringify(cur.slice(-50)));
}
function getUserKeys_(u) {
  const p = PropertiesService.getScriptProperties();
  return safeJsonParse_(p.getProperty("uKeys_" + u)) || [];
}
function getLatestKeyForUser_(u) {
  const keys = getUserKeys_(u);
  return keys.length ? keys[keys.length - 1] : "";
}

// 受付キー発行
function issueKey_() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const p = PropertiesService.getScriptProperties();

  while (true) {
    let k = "";
    for (let i = 0; i < 10; i++) k += chars.charAt(Math.floor(Math.random() * chars.length));
    if (!p.getProperty("k_" + k)) {
      p.setProperty("k_" + k, "1");
      return k;
    }
  }
}

// ---- State（Cache優先 + Properties保険）----
function getState_(u) {
  const c = CacheService.getScriptCache().get("st_" + u);
  if (c) {
    try { return JSON.parse(c); } catch (_) { }
  }
  const p = PropertiesService.getScriptProperties().getProperty("st_" + u);
  if (p) {
    try { return JSON.parse(p); } catch (_) { }
  }
  return {};
}
function setState_(u, o) {
  const st = { ...getState_(u), ...o };
  const s = JSON.stringify(st);
  try { CacheService.getScriptCache().put("st_" + u, s, STATE_TTL); } catch (e) { console.warn("Cache put failed", e); }
  try { PropertiesService.getScriptProperties().setProperty("st_" + u, s); } catch (e) { console.warn("Prop set failed", e); }
}
function resetState_(u) {
  try { CacheService.getScriptCache().remove("st_" + u); } catch (e) { console.warn("Cache remove failed", e); }
  try { PropertiesService.getScriptProperties().deleteProperty("st_" + u); } catch (e) { console.warn("Prop delete failed", e); }
}
