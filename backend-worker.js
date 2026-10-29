/* MV3 wiring. Production release stays OFF until separately reviewed deployment/pilot. */
(() => {
  "use strict";
  const UPLOAD_RELEASED = false;
  const CATALOG_DOWNLOAD_RELEASED = false;
  const ALARM = "fudge-backend-upload";
  if (!chrome.storage.session) return;
  const service = FudgeBackendService.create({ local: chrome.storage.local, session: chrome.storage.session,
    fetch: (...args) => fetch(...args), releaseUploads: UPLOAD_RELEASED, releaseCatalog: CATALOG_DOWNLOAD_RELEASED });
  let ready = chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const run = async (work) => { await ready; return work(); };
  async function ensureAlarm() {
    await ready;
    const alarm = await chrome.alarms.get(ALARM);
    if (!alarm) await chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
  }
  ensureAlarm().catch(() => {});
  chrome.runtime.onInstalled.addListener(() => ensureAlarm().catch(() => {}));
  chrome.runtime.onStartup.addListener(() => ensureAlarm().then(() => service.drain()).catch(() => {}));
  chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) run(() => service.drain()).catch(() => {}); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.entries(changes).some(([key, change]) => key.startsWith(FudgeBackendContract.INTENT_PREFIX) && change.newValue?.status === "pending")) run(() => service.drain()).catch(() => {});
  });
  const commands = {
    BACKEND_STATUS: () => service.status(),
    BACKEND_SIGN_IN: (m) => service.signIn({ publishableKey: globalThis.FudgeBackendPublicConfig?.publishableKey, email: m.email, password: m.password }),
    BACKEND_SIGN_UP: (m) => service.signUp({ publishableKey: globalThis.FudgeBackendPublicConfig?.publishableKey, email: m.email, password: m.password }),
    BACKEND_CREATE_ACCOUNT: () => service.createAccount(),
    BACKEND_WORKSPACES: () => service.workspaces(),
    BACKEND_SELECT_WORKSPACE: (m) => service.selectWorkspace(m.organizationId),
    BACKEND_TEST_CONNECTION: () => service.testConnection(),
    BACKEND_REFRESH_CATALOG: () => service.refreshCatalog(),
    BACKEND_ENABLE: (m) => service.setEnabled(m.enabled === true, m.confirmed === true),
    BACKEND_SIGN_OUT: () => service.signOut(),
    BACKEND_QUEUE_HISTORY: (m) => service.queueHistory(m.confirmed === true),
    BACKEND_RETRY: () => service.retryBlocked(),
    BACKEND_CANCEL_PENDING: (m) => service.cancelPending(m.confirmed === true),
    BACKEND_DRAIN: () => service.drain(),
  };
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!Object.hasOwn(commands, message?.type || "")) return;
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("backend-setup.html")) {
      respond({ ok: false, error: "Backend controls are available only from Fudge's internal backend setup page." }); return;
    }
    run(() => commands[message.type](message)).then(respond).catch((error) => respond({ ok: false,
      error: error instanceof FudgeBackendService.BackendError ? error.message : "Backend setup or local storage operation failed. No private response details are displayed." }));
    return true;
  });
})();
