/* Outbound-only authenticated intake service. No scanning, Sheets or publishing. */
(() => {
  "use strict";
  const C = globalThis.FudgeBackendContract || (typeof require === "function" ? require("./backend-contract.js") : null);
  class BackendError extends Error {
    constructor(code, message, retryAfter = 0) { super(message); this.code = code; this.retryAfter = retryAfter; }
  }
  function create({ local, session, fetch: requestFetch, now = Date.now, random = Math.random, releaseUploads = false }) {
    let chain = Promise.resolve(), draining = false;
    const serial = (work) => { const next = chain.catch(() => {}).then(work); chain = next.catch(() => {}); return next; };
    const setStatus = (state, reason = "") => local.set({ fudgeBackendStatus: { state, reason, updatedAt: now() } });
    const keyValid = (key) => typeof key === "string" && /^sb_publishable_[A-Za-z0-9_-]{16,200}$/.test(key);
    async function sessionValue() { return (await session.get({ fudgeBackendSession: null })).fudgeBackendSession; }
    async function configValue() { return (await local.get({ fudgeBackendConfig: null })).fudgeBackendConfig; }
    async function entries() {
      const keys = typeof local.getKeys === "function" ? (await local.getKeys()).filter((key) => key.startsWith(C.INTENT_PREFIX)) : null;
      const all = await local.get(keys || null);
      return Object.entries(all).filter(([key, value]) => key.startsWith(C.INTENT_PREFIX) && value && typeof value === "object");
    }
    async function request(path, auth, body, method = body ? "POST" : "GET") {
      if (!keyValid(auth?.publishableKey)) throw new BackendError("configuration", "A modern publishable key from the selected shared project is required.");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await requestFetch(C.ORIGIN + path, { method, credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
          headers: { apikey: auth.publishableKey, ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}) });
        if (!response.ok) {
          const delay = Math.min(3600, Math.max(0, Number(response.headers?.get("retry-after")) || 0)) * 1000;
          if (response.status === 429 || response.status >= 500) throw new BackendError("transient", "Backend unavailable or rate limited; source stays queued locally.", delay);
          if (response.status === 401) throw new BackendError("auth", "Sign-in expired or credentials were rejected. Sign in again.");
          if (response.status === 403) throw new BackendError("permission", "This account is not authorized for the selected workspace.");
          if (response.status === 404) throw new BackendError("schema", "Intake endpoint is not deployed. Keep uploads paused until backend review and deployment.");
          throw new BackendError("invalid", "Request rejected. Check setup or repair the queued source; no item was acknowledged.");
        }
        if (response.status === 204) return null;
        const text = await response.text();
        if (text.length > 1000000) throw new BackendError("response", "Backend response exceeded the allowed size; nothing acknowledged.");
        try { return JSON.parse(text); } catch { throw new BackendError("response", "Backend returned an invalid response; nothing acknowledged."); }
      } catch (error) {
        if (error instanceof BackendError) throw error;
        throw new BackendError("transient", "Connection interrupted; queued source is retained locally.");
      } finally { clearTimeout(timeout); }
    }
    function tokenResponse(value, publishableKey) {
      if (!value || typeof value.access_token !== "string" || value.access_token.length > 16000 || typeof value.refresh_token !== "string" || value.refresh_token.length > 16000
        || !value.access_token || !value.refresh_token || !Number.isFinite(value.expires_in) || value.expires_in <= 0 || value.expires_in > 86400) throw new BackendError("response", "Invalid sign-in response. No session accepted.");
      return { publishableKey, accessToken: value.access_token, refreshToken: value.refresh_token, expiresAt: now() + value.expires_in * 1000 };
    }
    async function verifyUser(auth) {
      const user = await request("/auth/v1/user", auth);
      if (!C.uuid(user?.id) || typeof user.email_confirmed_at !== "string" || !Number.isFinite(Date.parse(user.email_confirmed_at))) throw new BackendError("permission", "Use an existing verified dashboard staff account.");
      return user.id;
    }
    async function ensureSession(force = false) {
      let auth = await sessionValue();
      if (!auth || !C.uuid(auth.userId)) throw new BackendError("auth", "Sign in again. Browser restart clears the private session, not the durable queue.");
      if (force || auth.expiresAt <= now() + 60000) {
        try {
          const value = await request("/auth/v1/token?grant_type=refresh_token", auth, { refresh_token: auth.refreshToken });
          const refreshed = tokenResponse(value, auth.publishableKey);
          const userId = await verifyUser(refreshed);
          if (userId !== auth.userId) throw new BackendError("permission", "Account identity changed. Sign in again before resuming.");
          auth = { ...refreshed, userId };
          await session.set({ fudgeBackendSession: auth });
        } catch (error) {
          if (["auth", "invalid", "permission"].includes(error.code)) await session.remove("fudgeBackendSession");
          if (["auth", "invalid"].includes(error.code)) throw new BackendError("auth", "Session refresh was rejected. Sign in again; queued originals remain unchanged.");
          throw error;
        }
      }
      return auth;
    }
    async function workspaces(auth) {
      const memberships = await request(`/rest/v1/reporting_memberships?select=organization_id,role&user_id=eq.${auth.userId}`, auth);
      const organizations = await request("/rest/v1/reporting_organizations?select=id,name&order=name", auth);
      if (!Array.isArray(memberships) || !Array.isArray(organizations) || memberships.length > 1000 || organizations.length > 1000) throw new BackendError("response", "Workspace response was invalid.");
      const allowed = new Set(memberships.filter((m) => C.uuid(m.organization_id) && ["owner", "admin", "operator"].includes(m.role)).map((m) => m.organization_id));
      return organizations.filter((o) => allowed.has(o.id) && C.uuid(o.id) && typeof o.name === "string" && o.name.length <= 100).map((o) => ({ id: o.id, name: o.name }));
    }
    async function status() {
      const config = await configValue(), auth = await sessionValue();
      const { fudgeBackendStatus = {}, fudgeBackendPublishableKey = "", fudgeBackendCancelEpochs = {} } = await local.get({ fudgeBackendStatus: {}, fudgeBackendPublishableKey: "", fudgeBackendCancelEpochs: {} });
      const counts = { pending: 0, blocked: 0, acknowledged: 0, cancelled: 0, otherTargets: 0 };
      const blockedItems = [];
      for (const [, entry] of await entries()) {
        if (!C.validTarget(config) || entry.targetId !== config.targetId || entry.userId !== config.userId || entry.organizationId !== config.organizationId) { counts.otherTargets++; continue; }
        if (["pending", "blocked"].includes(entry.status) && fudgeBackendCancelEpochs[entry.targetId] && C.cancellationEpoch(entry) !== fudgeBackendCancelEpochs[entry.targetId]) { counts.cancelled++; continue; }
        if (Object.hasOwn(counts, entry.status) && entry.status !== "otherTargets") counts[entry.status]++;
        if (entry.status === "blocked" && blockedItems.length < 20) blockedItems.push({ localId: typeof entry.localId === "string" ? entry.localId.slice(0, 512) : "", reason: typeof entry.reason === "string" ? entry.reason.slice(0, 500) : "Source needs review." });
      }
      return { ok: true, releaseUploads, signedIn: Boolean(auth), userId: auth?.userId || null, enabled: config?.enabled === true,
        organizationId: config?.organizationId || null, publishableKey: keyValid(fudgeBackendPublishableKey) ? fudgeBackendPublishableKey : "", counts, blockedItems,
        state: fudgeBackendStatus.state || "off", reason: fudgeBackendStatus.reason || "" };
    }
    async function signIn({ publishableKey, email, password }) {
      if (!keyValid(publishableKey) || typeof email !== "string" || !email.includes("@") || email.length > 320 || typeof password !== "string" || !password || password.length > 4096) throw new BackendError("invalid", "Enter a publishable key, account email and password. Passwords are never stored.");
      const previous = await configValue();
      if (previous) await local.set({ fudgeBackendConfig: { ...previous, enabled: false } });
      // Clear any prior identity before accepting another sign-in attempt.
      await session.remove("fudgeBackendSession");
      const value = await request("/auth/v1/token?grant_type=password", { publishableKey }, { email, password });
      const auth = tokenResponse(value, publishableKey);
      auth.userId = await verifyUser(auth);
      const choices = await workspaces(auth);
      if (!choices.length) throw new BackendError("permission", "No authorized staff workspace was found. Ask the dashboard owner to review membership.");
      await session.set({ fudgeBackendSession: auth });
      // The publishable key is public application identity, not an Auth credential.
      await local.set({ fudgeBackendPublishableKey: publishableKey });
      await setStatus("paused", "Signed in. Select the intended workspace; uploading remains off.");
      return { ok: true, workspaces: choices };
    }
    async function selectWorkspace(organizationId) {
      if (!C.uuid(organizationId)) throw new BackendError("invalid", "Select an authorized workspace.");
      const auth = await ensureSession();
      if (!(await workspaces(auth)).some((o) => o.id === organizationId)) throw new BackendError("permission", "Workspace is not authorized for this account.");
      const { fudgeBackendTargets = {}, fudgeBackendCancelEpochs = {} } = await local.get({ fudgeBackendTargets: {}, fudgeBackendCancelEpochs: {} });
      const current = await configValue();
      const key = `${auth.userId}:${organizationId}`;
      const existing = C.validTarget(current) && current.userId === auth.userId && current.organizationId === organizationId ? current.targetId : null;
      const targetId = C.uuid(fudgeBackendTargets[key]) ? fudgeBackendTargets[key] : existing || crypto.randomUUID();
      const cancelEpoch = C.uuid(fudgeBackendCancelEpochs[targetId]) ? fudgeBackendCancelEpochs[targetId] : existing ? C.cancellationEpoch(current) : targetId;
      await local.set({ fudgeBackendTargets: { ...fudgeBackendTargets, [key]: targetId }, fudgeBackendConfig: { version: 1, targetId, cancelEpoch, userId: auth.userId, organizationId, enabled: false } });
      await setStatus("paused", "Workspace selected. Old targets stay separate; no historical source was queued.");
      return status();
    }
    async function testConnection() {
      const config = await configValue();
      if (!C.validTarget(config)) throw new BackendError("configuration", "Select the intended workspace before testing backend reads.");
      const auth = await ensureSession();
      if (auth.userId !== config.userId || await verifyUser(auth) !== config.userId
        || !(await workspaces(auth)).some((o) => o.id === config.organizationId)) throw new BackendError("permission", "Sign in as verified staff for the selected target before testing reads.");
      // LIMIT 0 checks the authenticated table/column surface without retrieving
      // originals, counts or customer rows. Never probe readiness with an intake POST.
      const tables = [
        ["reporting_fudge_records", "id,organization_id,source,source_review_id"],
        ["reporting_fudge_revisions", "id,organization_id,record_id,revision,payload_sha256,observed_at,received_at,received_by"],
      ];
      for (const [table, columns] of tables) {
        const result = await request(`/rest/v1/${table}?select=${columns}&organization_id=eq.${config.organizationId}&limit=0`, auth);
        if (!Array.isArray(result) || result.length !== 0) throw new BackendError("response", "Read-check response was unexpected. No source was uploaded or acknowledged.");
      }
      return { ok: true, projectRef: C.PROJECT_REF, organizationId: config.organizationId, checkedAt: now(),
        checks: ["verified_staff", "records_read_surface", "revisions_read_surface"], uploadsReleased: releaseUploads };
    }
    async function setEnabled(enabled, confirmed) {
      const config = await configValue();
      if (!C.validTarget(config)) throw new BackendError("configuration", "Select a workspace first.");
      if (enabled) {
        if (!releaseUploads) throw new BackendError("release", "Uploads remain release-gated until the backend migration and pilot are separately approved.");
        if (confirmed !== true) throw new BackendError("consent", "Explicitly consent before enabling capture and upload.");
        const auth = await ensureSession();
        if (auth.userId !== config.userId || !(await workspaces(auth)).some((o) => o.id === config.organizationId)) throw new BackendError("permission", "Sign in as the authorized account for this target.");
      }
      await local.set({ fudgeBackendConfig: { ...config, enabled: enabled === true } });
      await setStatus(enabled ? "ready" : "paused", enabled ? "Only subsequent collection snapshots are captured. Historical upload is separate." : "No new captures or upload requests; retained queue is unchanged.");
      return status();
    }
    async function signOut() {
      const auth = await sessionValue(), config = await configValue();
      if (config) await local.set({ fudgeBackendConfig: { ...config, enabled: false } });
      await session.remove("fudgeBackendSession");
      let revoked = false;
      if (auth) { try { await request("/auth/v1/logout?scope=local", auth, undefined, "POST"); revoked = true; } catch { /* Local logout always succeeds; remote status is not invented. */ } }
      await setStatus("signed_out", revoked ? "Session signed out. Queue retained and uploads paused." : "Signed out locally. Remote session revocation unverified; queue retained and paused.");
      return status();
    }
    async function queueHistory(confirmed) {
      const config = await configValue();
      if (!releaseUploads || !config?.enabled) throw new BackendError("release", "Historical upload requires a released, enabled target.");
      if (confirmed !== true) throw new BackendError("consent", "Confirm historical library upload separately.");
      const auth = await ensureSession();
      if (auth.userId !== config.userId) throw new BackendError("permission", "Target account mismatch.");
      const { reviews = [] } = await local.get({ reviews: [] });
      await local.set(C.captureWrites(config, reviews, { now: now() }));
      return status();
    }
    async function retryBlocked() {
      const config = await configValue(), updates = {};
      for (const [key, entry] of await entries()) if (entry.targetId === config?.targetId && entry.userId === config?.userId && entry.status === "blocked" && C.validReview(entry.review, now())) updates[key] = { ...entry, status: "pending", attempts: 0, nextAttemptAt: 0, reason: "" };
      if (Object.keys(updates).length) await local.set(updates);
      return status();
    }
    async function cancelPending(confirmed) {
      if (confirmed !== true) throw new BackendError("consent", "Confirm cancellation of retained target intents.");
      const config = await configValue(), updates = {};
      if (!C.validTarget(config)) throw new BackendError("configuration", "Select a target before cancelling its pending snapshots.");
      const { fudgeBackendCancelEpochs = {} } = await local.get({ fudgeBackendCancelEpochs: {} });
      const cancelEpoch = crypto.randomUUID();
      updates.fudgeBackendConfig = { ...config, enabled: false, cancelEpoch };
      updates.fudgeBackendCancelEpochs = { ...fudgeBackendCancelEpochs, [config.targetId]: cancelEpoch };
      for (const [key, entry] of await entries()) if (entry.targetId === config?.targetId && entry.userId === config?.userId && ["pending", "blocked"].includes(entry.status)) updates[key] = { ...entry, status: "cancelled", review: null, reason: "Cancelled locally; backend copies, if any, are unchanged." };
      await local.set(updates);
      await setStatus("paused", "Pending target snapshots cancelled. Originals and acknowledged backend copies were not deleted.");
      return status();
    }
    async function drainOnce() {
      // A collector may finish a local write after Cancel using an older target
      // snapshot. Sweep those retired epochs even while paused/release-gated.
      const { fudgeBackendCancelEpochs = {} } = await local.get({ fudgeBackendCancelEpochs: {} });
      const retired = {};
      for (const [key, entry] of await entries()) if (["pending", "blocked"].includes(entry.status) && C.uuid(fudgeBackendCancelEpochs[entry.targetId]) && C.cancellationEpoch(entry) !== fudgeBackendCancelEpochs[entry.targetId]) {
        retired[key] = { ...entry, status: "cancelled", review: null, reason: "Capture predates target cancellation; it cannot resume or upload." };
      }
      if (Object.keys(retired).length) await local.set(retired);
      const config = await configValue();
      if (!releaseUploads || !C.validTarget(config) || !config.enabled) return status();
      const chosen = [], seen = new Set(), invalid = {};
      const candidates = (await entries()).sort((a, b) => a[1].createdAt - b[1].createdAt || a[0].localeCompare(b[0]));
      for (const [key, entry] of candidates) {
        if (entry.targetId !== config.targetId || entry.userId !== config.userId || entry.organizationId !== config.organizationId || entry.status !== "pending" || entry.nextAttemptAt > now()) continue;
        if (!C.validReview(entry.review, now())) { invalid[key] = { ...entry, status: "blocked", reason: "Queued source needs identity, timestamp or payload repair." }; continue; }
        if (seen.has(entry.review.source_review_id)) continue;
        if (chosen.length >= 25 || C.bytes({ version: 1, organization_id: config.organizationId, reviews: [...chosen.map((e) => e[1].review), entry.review] }) > 262144) break;
        chosen.push([key, entry]); seen.add(entry.review.source_review_id);
      }
      if (Object.keys(invalid).length) await local.set(invalid);
      if (!chosen.length) return status();
      try {
        let auth = await ensureSession();
        if (auth.userId !== config.userId) throw new BackendError("permission", "Sign in as the account that owns this queued target.");
        const body = { org: config.organizationId, reviews: chosen.map((e) => e[1].review) };
        let result;
        try { result = await request("/rest/v1/rpc/reporting_ingest_fudge_reviews_v1", auth, body); }
        catch (error) { if (error.code !== "auth") throw error; auth = await ensureSession(true); result = await request("/rest/v1/rpc/reporting_ingest_fudge_reviews_v1", auth, body); }
        if (!C.receiptsMatch(body.reviews, result)) throw new BackendError("response", "Incomplete or mismatched receipts; nothing acknowledged. Review backend contract.");
        const current = await configValue(), currentAuth = await sessionValue();
        if (current?.targetId !== config.targetId || currentAuth?.userId !== config.userId) throw new BackendError("permission", "Target or identity changed; snapshots retained for safe reconciliation.");
        const acknowledgments = {};
        chosen.forEach(([key, entry], index) => { acknowledgments[key] = { ...entry, status: "acknowledged", review: null, receipt: result[index], reason: "", acknowledgedAt: now() }; });
        // Keys are immutable per capture: an old receipt cannot clear a newer snapshot.
        await local.set(acknowledgments);
        await setStatus("ready", "Batch acknowledged. Originals remain local; later captures have independent intents.");
      } catch (error) {
        const updates = {}, code = error.code || "storage";
        for (const [key, entry] of chosen) {
          const attempts = entry.attempts + 1;
          const retry = code === "transient" && attempts < 8;
          const wait = Math.max(error.retryAfter || 0, Math.min(3600000, 5000 * 2 ** Math.min(attempts, 10) * (0.75 + random() * 0.5)));
          updates[key] = { ...entry, attempts, status: code === "auth" ? "pending" : retry ? "pending" : "blocked", nextAttemptAt: now() + (code === "auth" ? 60000 : wait), reason: error instanceof BackendError ? error.message : "Local acknowledgment failed; original snapshots retained for safe retry." };
        }
        await local.set(updates);
        await setStatus(code === "auth" ? "sign_in_required" : code === "transient" ? "retrying" : "blocked", error instanceof BackendError ? error.message : "Local queue write failed; inspect storage before retrying.");
      }
      return status();
    }
    return {
      status, signIn: (input) => serial(() => signIn(input)), workspaces: () => serial(async () => ({ ok: true, workspaces: await workspaces(await ensureSession()) })),
      selectWorkspace: (org) => serial(() => selectWorkspace(org)), setEnabled: (enabled, confirmed) => serial(() => setEnabled(enabled, confirmed)),
      testConnection: () => serial(testConnection),
      signOut: () => serial(signOut), queueHistory: (confirmed) => serial(() => queueHistory(confirmed)), retryBlocked: () => serial(retryBlocked), cancelPending: (confirmed) => serial(() => cancelPending(confirmed)),
      drain: () => {
        if (draining) return Promise.resolve({ ok: true, busy: true });
        draining = true;
        return serial(drainOnce).finally(() => { draining = false; });
      },
    };
  }
  const api = { create, BackendError };
  globalThis.FudgeBackendService = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
