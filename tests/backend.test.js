const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID, webcrypto } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
globalThis.crypto ||= webcrypto;
const C = require("../backend-contract.js");
const { create } = require("../backend-service.js");
const root = path.resolve(__dirname, "..");
const user = "11111111-1111-4111-8111-111111111111";
const otherUser = "22222222-2222-4222-8222-222222222222";
const org = "33333333-3333-4333-8333-333333333333";
const otherOrg = "44444444-4444-4444-8444-444444444444";
const target = "55555555-5555-4555-8555-555555555555";
const key = "sb_publishable_fixture_not_a_real_key";
const clock = Date.parse("2026-10-28T12:00:00Z");
const config = { version: 1, targetId: target, userId: user, organizationId: org, enabled: true };
const original = { id: "google:fixture-review", googleReviewId: "fixture-review", text: "Original fixture source text.", rating: 5, author: "Fixture author", placeName: "Fixture business", placeId: "fixture-place", sourceUrl: "https://www.google.com/maps?fixture=1", photos: ["https://images.example/fixture.jpg"], date: "A week ago", collectedAt: "2026-10-27T12:00:00Z", service: { id: "fixture" } };

function storage(initial = {}) {
  const data = structuredClone(initial), writes = [];
  const area = {
    async get(query, callback) {
      let result;
      if (query == null) result = structuredClone(data);
      else if (Array.isArray(query)) result = Object.fromEntries(query.filter((k) => Object.hasOwn(data, k)).map((k) => [k, structuredClone(data[k])]));
      else if (typeof query === "string") result = Object.hasOwn(data, query) ? { [query]: structuredClone(data[query]) } : {};
      else result = Object.fromEntries(Object.entries(query).map(([k, value]) => [k, structuredClone(Object.hasOwn(data, k) ? data[k] : value)]));
      if (callback) callback(result);
      return result;
    },
    async set(values, callback) { writes.push(structuredClone(values)); Object.assign(data, structuredClone(values)); if (callback) callback(); },
    async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; },
    async getKeys() { return Object.keys(data); },
    async setAccessLevel() {},
  };
  return { data, writes, area };
}
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
function setup({ released = true, initialConfig = config, signedIn = true } = {}) {
  let time = clock;
  const local = storage({ fudgeBackendConfig: structuredClone(initialConfig), reviews: [original] });
  const session = storage(signedIn ? { fudgeBackendSession: { userId: user, publishableKey: key, accessToken: "fixture-access-private", refreshToken: "fixture-refresh-private", expiresAt: clock + 3600000 } } : {});
  const calls = [];
  const rpcRecords = new Map();
  let handler = async (url, options) => {
    if (url.endsWith("/auth/v1/user")) return json({ id: user, email_confirmed_at: "2026-10-27T00:00:00Z" });
    if (url.includes("/auth/v1/token?")) return json({ access_token: "fixture-new-access-private", refresh_token: "fixture-new-refresh-private", expires_in: 3600 });
    if (url.includes("/reporting_memberships?")) return json([{ organization_id: org, role: "operator" }, { organization_id: otherOrg, role: "admin" }]);
    if (url.includes("/reporting_organizations?")) return json([{ id: org, name: "Fixture workspace" }, { id: otherOrg, name: "Other fixture workspace" }]);
    if (/\/reporting_fudge_(records|revisions)\?/.test(url)) return json([]);
    if (url.includes("/auth/v1/logout?")) return new Response(null, { status: 204 });
    if (url.endsWith("/rpc/reporting_ingest_fudge_reviews_v1")) {
      const body = JSON.parse(options.body);
      return json(body.reviews.map((review) => {
        const id = `${body.org}:${review.source_review_id}`;
        if (!rpcRecords.has(id)) rpcRecords.set(id, { record_id: randomUUID(), revisions: new Map() });
        const record = rpcRecords.get(id), content = JSON.stringify(review.payload);
        const inserted = !record.revisions.has(content);
        if (inserted) record.revisions.set(content, { id: randomUUID(), number: record.revisions.size + 1 });
        const revision = record.revisions.get(content);
        return { source: "google", source_review_id: review.source_review_id, record_id: record.record_id, revision_id: revision.id, revision: revision.number, inserted_record: inserted && revision.number === 1, inserted_revision: inserted };
      }));
    }
    throw new Error("Unexpected fixture endpoint");
  };
  const defaultHandler = (url, options) => handler(url, options);
  const fetch = async (url, options) => { calls.push({ url, options }); return defaultHandler(url, options); };
  const service = create({ local: local.area, session: session.area, fetch, now: () => time, random: () => 0.5, releaseUploads: released });
  return { local, session, calls, service, advance: (ms) => { time += ms; }, handle: (fn) => { handler = fn; }, enqueue: async (review = original, destination = initialConfig) => {
    const values = C.captureWrites(destination, [review], { now: time }); await local.area.set(values); return Object.keys(values)[0];
  } };
}

test("projection uploads only originals, excludes secrets/classification and does not mutate input", () => {
  const input = { ...original, password: "DO_NOT_UPLOAD", rewrittenText: "Not original" };
  const mapped = C.project(input, clock);
  assert.equal(mapped.payload.text, original.text);
  assert.ok(!JSON.stringify(mapped).includes("DO_NOT_UPLOAD"));
  assert.ok(!JSON.stringify(mapped).includes("Not original"));
  assert.equal(input.text, original.text);
  assert.equal(C.project({ ...original, googleReviewId: "", id: "fingerprint" }, clock), null);
});
test("malformed dates, future times, invalid source fields and unsupported URLs remain blocked", () => {
  for (const changed of [{ collectedAt: "2026-02-30T00:00:00Z" }, { collectedAt: "2099-01-01T00:00:00Z" }, { collectedAt: "2026-10-27T10:00Z" }, { collectedAt: "2026-10-27T10:00:00+20:00" }, { text: " " }, { rating: 1.5 }, { sourceUrl: "https://user:password@example.test" }, { photos: ["http://example.test/a"] }]) assert.equal(C.project({ ...original, ...changed }, clock), null);
});
test("capture is opt-in and snapshots are pinned to immutable per-target intent keys", () => {
  assert.deepEqual(C.captureWrites({ ...config, enabled: false }, [original]), {});
  assert.deepEqual(C.captureWrites(null, [original]), {});
  const first = C.captureWrites(config, [original], { now: clock });
  const second = C.captureWrites(config, [{ ...original, text: "Fuller original" }], { now: clock });
  assert.notEqual(Object.keys(first)[0], Object.keys(second)[0]);
  assert.equal(Object.values(first)[0].targetId, target);
  assert.equal(Object.values(first)[0].review.payload.text, original.text);
  assert.equal(Object.values(C.captureWrites(config, [{ ...original, googleReviewId: "" }], { now: clock }))[0].status, "blocked");
});
test("release gate blocks enable/history/drain even if local configuration is tampered to enabled", async () => {
  const f = setup({ released: false }); await f.enqueue();
  await assert.rejects(f.service.setEnabled(true, true), /release-gated/);
  await assert.rejects(f.service.queueHistory(true), /requires a released/);
  await f.service.drain(); assert.equal(f.calls.length, 0);
  assert.equal((await f.service.status()).counts.pending, 1);
});
test("sign-in verifies user/workspace and never persists password or tokens to local storage", async () => {
  const f = setup({ signedIn: false });
  const result = await f.service.signIn({ publishableKey: key, email: "fixture@example.test", password: "fixture-password-private" });
  assert.equal(result.workspaces.length, 2);
  assert.equal(f.local.data.fudgeBackendConfig.enabled, false);
  const persisted = JSON.stringify(f.local.data);
  for (const secret of ["fixture-password-private", "fixture-new-access-private", "fixture-new-refresh-private"]) assert.ok(!persisted.includes(secret));
  assert.ok(f.session.data.fudgeBackendSession.refreshToken);
  assert.ok(!JSON.stringify(result).includes("access"));
  for (const call of f.calls) { assert.ok(call.url.startsWith(C.ORIGIN + "/")); assert.equal(call.options.redirect, "error"); assert.equal(call.options.credentials, "omit"); }
});
test("privileged/management keys fail before any network request", async () => {
  const f = setup();
  for (const publishableKey of ["sb_secret_fixture", "sbp_fixture", "eyJ.fixture.jwt", ""]) await assert.rejects(f.service.signIn({ publishableKey, email: "fixture@example.test", password: "fixture" }));
  assert.equal(f.calls.length, 0);
});
function accountHandler({ organizations = [org], verified = true, signupStatus = 200, onCreate = () => {} } = {}) {
  return async (url) => {
    if (url.endsWith("/auth/v1/signup")) return json({ access_token: "must-not-store-signup-token", refresh_token: "must-not-store-refresh" }, signupStatus);
    if (url.includes("/auth/v1/token?")) return json({ access_token: "fixture-access-private", refresh_token: "fixture-refresh-private", expires_in: 3600 });
    if (url.endsWith("/auth/v1/user")) return json({ id: user, email_confirmed_at: verified ? "2026-10-27T00:00:00Z" : null });
    if (url.includes("/reporting_memberships?")) return json(organizations.map((id) => ({ organization_id: id, role: "owner" })));
    if (url.includes("/reporting_organizations?")) return json(organizations.map((id) => ({ id, name: "Fixture business" })));
    if (url.endsWith("/rpc/reporting_create_workspace")) { onCreate(); organizations.push(org); return json(org); }
    throw new Error("Unexpected account endpoint");
  };
}
test("single-business sign-in auto-selects the authorized target without enabling or migrating", async () => {
  const f = setup({ released: false, signedIn: false, initialConfig: null });
  f.handle(accountHandler());
  await f.service.signIn({ publishableKey: key, email: "fixture@example.test", password: "fixture-password" });
  assert.equal(f.local.data.fudgeBackendConfig.organizationId, org);
  assert.equal(f.local.data.fudgeBackendConfig.enabled, false);
  assert.equal((await f.service.status()).counts.pending, 0);
  assert.ok(!f.calls.some((c) => c.url.includes("/rpc/")));
});
test("multiple-business sign-in never silently chooses or creates another target", async () => {
  const f = setup({ signedIn: false, initialConfig: null });
  const result = await f.service.signIn({ publishableKey: key, email: "fixture@example.test", password: "fixture-password" });
  assert.equal(result.workspaces.length, 2);
  assert.equal(f.local.data.fudgeBackendConfig, null);
  assert.ok(!f.calls.some((c) => c.url.includes("/rpc/")));
});
test("unverified email cannot establish a Fudge session or create a business", async () => {
  const f = setup({ signedIn: false }); f.handle(accountHandler({ verified: false }));
  await assert.rejects(f.service.signIn({ publishableKey: key, email: "fixture@example.test", password: "fixture-password" }), /verified/);
  assert.equal(f.session.data.fudgeBackendSession, undefined);
  assert.equal(f.local.data.fudgeBackendConfig.enabled, false);
  assert.ok(!f.calls.some((c) => c.url.includes("/rpc/")));
});
test("signup requests verification without accepting returned tokens, provisioning or modifying the queue", async () => {
  const f = setup({ signedIn: false, released: false }); f.handle(accountHandler());
  const before = structuredClone(f.local.data);
  const result = await f.service.signUp({ publishableKey: key, email: "fixture@example.test", password: "fixture-password" });
  assert.match(result.message, /check your email and verify/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, C.ORIGIN + "/auth/v1/signup");
  assert.equal(f.session.data.fudgeBackendSession, undefined);
  assert.deepEqual(f.local.data, before);
  assert.ok(!JSON.stringify(result).includes("must-not-store"));
});
test("signup rejects weak passwords and privileged app keys before sending any request", async () => {
  const f = setup();
  for (const password of ["short", "x".repeat(129)]) await assert.rejects(f.service.signUp({ publishableKey: key, email: "fixture@example.test", password }));
  await assert.rejects(f.service.signUp({ publishableKey: "sb_secret_fixture", email: "fixture@example.test", password: "fixture-password" }));
  assert.equal(f.calls.length, 0);
});
test("signup rate-limit errors do not leak responses or accept sessions", async () => {
  const f = setup({ signedIn: false }); f.handle(accountHandler({ signupStatus: 429 }));
  await assert.rejects(f.service.signUp({ publishableKey: key, email: "fixture@example.test", password: "fixture-password" }), (e) => e.code === "transient" && !e.message.includes("must-not-store"));
  assert.equal(f.session.data.fudgeBackendSession, undefined);
});
test("first login waits for explicit private-account setup and reuses it on repeated clicks", async () => {
  const f = setup({ signedIn: false, initialConfig: null, released: false }); let created = 0;
  f.handle(accountHandler({ organizations: [], onCreate: () => created++ }));
  const result = await f.service.signIn({ publishableKey: key, email: "fixture@example.test", password: "fixture-password" });
  assert.equal(result.workspaces.length, 0); assert.equal(created, 0);
  await Promise.all([f.service.createAccount(), f.service.createAccount()]);
  assert.equal(created, 1);
  assert.equal(f.local.data.fudgeBackendConfig.organizationId, org);
  assert.equal(f.local.data.fudgeBackendConfig.enabled, false);
  assert.equal((await f.service.status()).counts.pending, 0);
  const provision = f.calls.find((c) => c.url.endsWith("/rpc/reporting_create_workspace"));
  assert.deepEqual(JSON.parse(provision.options.body), { workspace_name: "My business" });
});
test("private-account setup requires verified sign-in and never creates for a multi-business user", async () => {
  const signedOut = setup({ signedIn: false });
  await assert.rejects(signedOut.service.createAccount(), /Sign in again/);
  assert.equal(signedOut.calls.length, 0);
  const f = setup(); f.handle(accountHandler({ organizations: [org, otherOrg] }));
  await assert.rejects(f.service.createAccount(), /needs review/);
  assert.ok(!f.calls.some((c) => c.url.includes("/rpc/")));
});
test("bundled backend config contains only pinned public application identity", () => {
  const context = {}; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "backend-public-config.js"), "utf8"), context);
  const config = context.FudgeBackendPublicConfig;
  assert.deepEqual(Object.keys(config).sort(), ["publishableKey", "url"]);
  assert.equal(config.url, C.ORIGIN);
  assert.match(config.publishableKey, /^sb_publishable_[A-Za-z0-9_-]{16,200}$/);
  assert.ok(Object.isFrozen(config));
  const worker = fs.readFileSync(path.join(root, "backend-worker.js"), "utf8");
  assert.ok(!worker.includes("publishableKey: m.publishableKey"));
  const html = fs.readFileSync(path.join(root, "backend-setup.html"), "utf8");
  assert.ok(!html.includes('id="publishableKey"'));
});
test("local acknowledgment list exposes only receipt IDs, revision and local time for the saved target", async () => {
  const f = setup(); await f.enqueue(); await f.service.drain();
  const state = await f.service.status();
  assert.equal(state.recentReceipts.length, 1);
  const receipt = state.recentReceipts[0];
  assert.deepEqual(Object.keys(receipt).sort(), ["acknowledgedAt", "recordId", "revision", "revisionId"]);
  assert.ok(C.uuid(receipt.recordId)); assert.ok(C.uuid(receipt.revisionId));
  assert.equal(receipt.revision, 1); assert.equal(receipt.acknowledgedAt, clock);
  assert.ok(!JSON.stringify(receipt).includes(original.text));
  await f.service.selectWorkspace(otherOrg);
  assert.equal((await f.service.status()).recentReceipts.length, 0);
});
test("local receipt history is newest-first, bounded to twenty and excludes malformed or foreign receipts", async () => {
  const f = setup({ released: false });
  for (let i = 0; i < 25; i++) {
    f.local.data[C.INTENT_PREFIX + i] = { ...config, status: "acknowledged", acknowledgedAt: clock + i,
      receipt: { record_id: randomUUID(), revision_id: randomUUID(), revision: 1 } };
  }
  f.local.data[C.INTENT_PREFIX + "foreign"] = { ...config, organizationId: otherOrg, status: "acknowledged", acknowledgedAt: clock + 100, receipt: { record_id: randomUUID(), revision_id: randomUUID(), revision: 1 } };
  f.local.data[C.INTENT_PREFIX + "bad"] = { ...config, status: "acknowledged", acknowledgedAt: clock + 1000, receipt: { record_id: "bad", revision_id: randomUUID(), revision: 1 } };
  f.local.data[C.INTENT_PREFIX + "badtime"] = { ...config, status: "acknowledged", acknowledgedAt: 1e20, receipt: { record_id: randomUUID(), revision_id: randomUUID(), revision: 1 } };
  const state = await f.service.status();
  assert.equal(state.recentReceipts.length, 20);
  assert.equal(state.recentReceipts[0].acknowledgedAt, clock + 24);
  assert.equal(state.recentReceipts[19].acknowledgedAt, clock + 5);
  assert.equal(f.calls.length, 0);
});
test("workspace selection is membership-checked, paused and never queues historical records", async () => {
  const f = setup(); await f.service.selectWorkspace(org);
  assert.equal(f.local.data.fudgeBackendConfig.enabled, false);
  assert.equal((await f.service.status()).counts.pending, 0);
  await assert.rejects(f.service.selectWorkspace(randomUUID()), /not authorized/);
});
test("switching back reuses a target identity; old workspace data never retargets", async () => {
  const f = setup(); await f.service.selectWorkspace(org);
  const first = structuredClone(f.local.data.fudgeBackendConfig);
  await f.enqueue(original, { ...first, enabled: true });
  await f.service.selectWorkspace(otherOrg);
  assert.equal((await f.service.status()).counts.otherTargets, 1);
  await f.service.selectWorkspace(org);
  assert.equal(f.local.data.fudgeBackendConfig.targetId, first.targetId);
  assert.equal((await f.service.status()).counts.pending, 1);
});
test("requires consent to enable and never couples upload controls to Sheets/scanning", async () => {
  const f = setup();
  await assert.rejects(f.service.setEnabled(true, false), /consent/);
  await f.service.setEnabled(true, true);
  assert.ok(!Object.hasOwn(f.local.data, "runState"));
  assert.ok(!Object.hasOwn(f.local.data, "sheetKnownReviewIds"));
});
test("complete durable receipts acknowledge exactly their own capture keys", async () => {
  const f = setup(); const capture = await f.enqueue();
  await f.service.drain();
  assert.equal(f.local.data[capture].status, "acknowledged");
  assert.equal(f.local.data[capture].review, null);
  assert.ok(C.uuid(f.local.data[capture].receipt.revision_id));
  assert.deepEqual(f.local.data.reviews, [original]);
});
test("partial/mismatched receipts never acknowledge any item", async () => {
  const f = setup(); const capture = await f.enqueue();
  f.handle(async () => json([]));
  await f.service.drain();
  assert.equal(f.local.data[capture].status, "blocked");
  assert.ok(f.local.data[capture].review);
  assert.equal((await f.service.status()).counts.acknowledged, 0);
});
test("offline failure retains original snapshot, backs off and does not send an early retry", async () => {
  const f = setup(); const capture = await f.enqueue();
  f.handle(async () => { throw new Error("DO_NOT_ECHO_PRIVATE_DIAGNOSTIC"); });
  await f.service.drain();
  assert.equal(f.local.data[capture].status, "pending");
  assert.ok(f.local.data[capture].nextAttemptAt > clock);
  assert.ok(!JSON.stringify(await f.service.status()).includes("DO_NOT_ECHO"));
  const calls = f.calls.length; await f.service.drain(); assert.equal(f.calls.length, calls);
});
test("rate limits honor bounded Retry-After and exhausted retries require manual repair", async () => {
  const f = setup(); const capture = await f.enqueue();
  f.handle(async () => json({}, 429, { "retry-after": "120" }));
  await f.service.drain(); assert.ok(f.local.data[capture].nextAttemptAt >= clock + 120000);
  for (let i = 1; i < 8; i++) { f.advance(4000000); await f.service.drain(); }
  assert.equal(f.local.data[capture].attempts, 8);
  assert.equal(f.local.data[capture].status, "blocked");
});
test("missing RPC and permission failures block without deletion or automatic looping", async () => {
  for (const http of [403, 404]) {
    const f = setup(); const capture = await f.enqueue(); f.handle(async () => json({}, http));
    await f.service.drain(); assert.equal(f.local.data[capture].status, "blocked");
    await f.service.drain(); assert.equal(f.calls.length, 1); assert.ok(f.local.data[capture].review);
  }
});
test("expired sessions refresh once, rotate privately and preserve account identity", async () => {
  const f = setup(); f.session.data.fudgeBackendSession.expiresAt = clock - 1;
  await f.enqueue(); await f.service.drain();
  assert.equal(f.calls.filter((call) => call.url.includes("grant_type=refresh_token")).length, 1);
  assert.equal(f.session.data.fudgeBackendSession.accessToken, "fixture-new-access-private");
  assert.ok(!JSON.stringify(f.local.data).includes("fixture-new-access-private"));
});
test("browser restart loses only session, retaining durable intents until sign-in", async () => {
  const f = setup({ signedIn: false }); const capture = await f.enqueue();
  await f.service.drain();
  assert.equal(f.calls.length, 0); assert.equal(f.local.data[capture].status, "pending");
  assert.equal((await f.service.status()).state, "sign_in_required");
});
test("rejected refresh tokens require sign-in rather than marking original payload invalid", async () => {
  const f = setup(); f.session.data.fudgeBackendSession.expiresAt = clock - 1;
  const capture = await f.enqueue(); f.handle(async () => json({}, 400));
  await f.service.drain();
  assert.equal(f.session.data.fudgeBackendSession, undefined);
  assert.equal(f.local.data[capture].status, "pending");
  assert.equal((await f.service.status()).state, "sign_in_required");
  assert.ok(f.local.data[capture].review);
});
test("session from another user cannot submit a previously queued target", async () => {
  const f = setup(); f.session.data.fudgeBackendSession.userId = otherUser; const capture = await f.enqueue();
  await f.service.drain(); assert.equal(f.calls.length, 0); assert.equal(f.local.data[capture].status, "blocked");
});
test("requests are bounded by count and do not repeat one source identity within a batch", async () => {
  const f = setup();
  for (let i = 0; i < 30; i++) await f.enqueue({ ...original, googleReviewId: `fixture-${i}`, id: `google:fixture-${i}` });
  await f.enqueue({ ...original, googleReviewId: "fixture-0", text: "Fuller recapture" });
  await f.service.drain();
  const submitted = JSON.parse(f.calls[0].options.body).reviews;
  assert.equal(submitted.length, 25);
  assert.equal(new Set(submitted.map((review) => review.source_review_id)).size, submitted.length);
  assert.equal((await f.service.status()).counts.pending, 6);
});
test("new captures arriving during an upload survive an older acknowledgment", async () => {
  const f = setup(); const older = await f.enqueue();
  let complete, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  f.handle(async (url, options) => {
    entered();
    return new Promise((resolve) => { complete = () => resolve(json(JSON.parse(options.body).reviews.map((r) => ({ source: "google", source_review_id: r.source_review_id, record_id: randomUUID(), revision_id: randomUUID(), revision: 1, inserted_record: true, inserted_revision: true })))); });
  });
  const upload = f.service.drain(); await started;
  const newer = await f.enqueue({ ...original, text: "A newer complete original snapshot." });
  assert.equal((await f.service.drain()).busy, true);
  complete(); await upload;
  assert.equal(f.local.data[older].status, "acknowledged");
  assert.equal(f.local.data[newer].status, "pending");
  assert.equal(f.local.data[newer].review.payload.text, "A newer complete original snapshot.");
});
test("lost local acknowledgment can replay the immutable intent safely", async () => {
  const f = setup(); const capture = await f.enqueue(); const originalSet = f.local.area.set;
  let fail = true;
  f.local.area.set = async (values, callback) => {
    if (fail && values[capture]?.status === "acknowledged") { fail = false; throw new Error("fixture storage failure"); }
    return originalSet(values, callback);
  };
  await f.service.drain(); assert.equal(f.local.data[capture].status, "blocked");
  await f.service.retryBlocked(); await f.service.drain();
  assert.equal(f.local.data[capture].status, "acknowledged");
  assert.equal(f.local.data[capture].receipt.inserted_revision, false);
});
test("pause/cancel/sign-out preserve originals and cannot delete backend copies", async () => {
  const f = setup(); const capture = await f.enqueue();
  await assert.rejects(f.service.cancelPending(false), /Confirm/);
  await f.service.cancelPending(true);
  assert.equal(f.local.data[capture].status, "cancelled"); assert.equal(f.local.data[capture].review, null);
  assert.equal(f.local.data.fudgeBackendConfig.enabled, false);
  await f.service.signOut(); assert.equal(f.session.data.fudgeBackendSession, undefined);
  assert.deepEqual(f.local.data.reviews, [original]);
  assert.ok(f.calls.every((call) => call.options.method !== "DELETE"));
});
test("a capture finishing after cancellation cannot resume under its retired consent epoch", async () => {
  const f = setup();
  const staleTarget = structuredClone(f.local.data.fudgeBackendConfig);
  await f.service.cancelPending(true);
  const late = await f.enqueue(original, staleTarget);
  await f.service.drain();
  assert.equal(f.local.data[late].status, "cancelled");
  assert.equal(f.local.data[late].review, null);
  assert.equal(f.calls.length, 0);
  await f.service.setEnabled(true, true);
  const fresh = await f.enqueue(original, f.local.data.fudgeBackendConfig);
  await f.service.drain();
  assert.equal(f.local.data[fresh].status, "acknowledged");
  assert.equal(f.local.data[late].status, "cancelled");
});
test("cancelled target epochs survive workspace switches and worker restart", async () => {
  const f = setup();
  await f.service.selectWorkspace(org);
  const stale = { ...f.local.data.fudgeBackendConfig, enabled: true };
  await f.service.cancelPending(true);
  const epoch = f.local.data.fudgeBackendConfig.cancelEpoch;
  await f.service.selectWorkspace(otherOrg);
  await f.service.selectWorkspace(org);
  assert.equal(f.local.data.fudgeBackendConfig.cancelEpoch, epoch);
  const late = await f.enqueue(original, stale);
  const restarted = create({ local: f.local.area, session: f.session.area, fetch: async () => { throw new Error("No network expected"); }, now: () => clock, releaseUploads: false });
  await restarted.drain();
  assert.equal(f.local.data[late].status, "cancelled");
});
test("bounded upload bytes remain below the DTO transport ceiling", async () => {
  const f = setup();
  for (let i = 0; i < 10; i++) await f.enqueue({ ...original, googleReviewId: `large-${i}`, text: "x".repeat(30000) });
  await f.service.drain();
  const body = JSON.parse(f.calls[0].options.body);
  assert.ok(C.bytes({ version: 1, organization_id: org, reviews: body.reviews }) <= 262144);
  assert.equal(body.reviews.length, 8);
});
test("a local atomic-write failure is reported instead of claiming collection succeeded", async () => {
  const store = storage({ reviews: [], fudgeBackendConfig: config });
  const runtime = { lastError: null };
  store.area.set = async (values, callback) => { runtime.lastError = { message: "fixture local write failed" }; callback(); runtime.lastError = null; };
  const context = { chrome: { storage: { local: store.area }, runtime }, crypto: webcrypto, TextEncoder, URL, FudgeBackendContract: C };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "shared.js"), "utf8") + "\n;globalThis.__Fudge = Fudge;", context);
  await assert.rejects(context.__Fudge.addReviews([original]), /fixture local write failed/);
  assert.equal(store.data.reviews.length, 0);
});
test("bad, reordered or internally inconsistent receipts fail complete-batch matching", () => {
  const reviews = [C.project(original, clock), C.project({ ...original, googleReviewId: "fixture-second" }, clock)];
  const receipts = reviews.map((r) => ({ source: "google", source_review_id: r.source_review_id, record_id: randomUUID(), revision_id: randomUUID(), revision: 1, inserted_record: true, inserted_revision: true }));
  assert.equal(C.receiptsMatch(reviews, receipts), true);
  for (const value of [null, [], receipts.slice(0, 1), [...receipts].reverse(), [{ ...receipts[0], inserted_revision: false }, receipts[1]], [{ ...receipts[0], record_id: receipts[1].record_id }, receipts[1]], [{ ...receipts[0], password: "unexpected" }, receipts[1]]]) assert.equal(C.receiptsMatch(reviews, value), false);
});
test("refreshing to a different account never submits an old queued target", async () => {
  const f = setup(); f.session.data.fudgeBackendSession.expiresAt = clock - 1;
  const capture = await f.enqueue();
  f.handle(async (url) => {
    if (url.includes("grant_type=refresh_token")) return json({ access_token: "fixture-access", refresh_token: "fixture-refresh", expires_in: 3600 });
    if (url.endsWith("/auth/v1/user")) return json({ id: otherUser, email_confirmed_at: "2026-10-27T00:00:00Z" });
    throw new Error("Intake should not be requested");
  });
  await f.service.drain();
  assert.equal(f.local.data[capture].status, "blocked");
  assert.ok(!f.calls.some((call) => call.url.includes("/rpc/")));
  assert.equal(f.session.data.fudgeBackendSession, undefined);
});
test("collector commits library and capture snapshots in the same local write", async () => {
  const store = storage({ reviews: [], fudgeBackendConfig: config });
  const context = { chrome: { storage: { local: store.area }, runtime: { lastError: null } }, crypto: webcrypto, TextEncoder, URL, FudgeBackendContract: C };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "shared.js"), "utf8") + "\n;globalThis.__Fudge = Fudge;", context);
  await context.__Fudge.addReviews([original]);
  const committed = store.writes.find((write) => Object.hasOwn(write, "reviews") && Object.keys(write).some((key) => key.startsWith(C.INTENT_PREFIX)));
  assert.ok(committed); assert.equal(committed.reviews.length, 1);
  assert.equal(Object.values(committed).find((value) => value?.review)?.review.payload.text, original.text);
});
test("unconfigured collection writes no upload snapshot and remains local-first", async () => {
  const store = storage({ reviews: [] });
  const context = { chrome: { storage: { local: store.area }, runtime: { lastError: null } }, crypto: webcrypto, TextEncoder, URL, FudgeBackendContract: C };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "shared.js"), "utf8") + "\n;globalThis.__Fudge = Fudge;", context);
  await context.__Fudge.addReviews([original]);
  assert.equal(store.data.reviews.length, 1);
  assert.equal(Object.keys(store.data).filter((key) => key.startsWith(C.INTENT_PREFIX)).length, 0);
});
test("worker accepts backend controls only from the exact internal setup page", async () => {
  const listeners = [], services = [];
  const event = () => ({ addListener() {} });
  const chrome = { storage: { local: {}, session: { async setAccessLevel(value) { assert.equal(value.accessLevel, "TRUSTED_CONTEXTS"); } }, onChanged: event() },
    runtime: { id: "fixture-extension", getURL: (p) => `chrome-extension://fixture-extension/${p}`, onInstalled: event(), onStartup: event(), onMessage: { addListener: (fn) => listeners.push(fn) } },
    alarms: { async get() { return {}; }, async create() {}, onAlarm: event() } };
  const context = { chrome, FudgeBackendContract: C, fetch() { throw new Error("No real network"); }, FudgeBackendService: { BackendError: Error, create(options) { services.push(options); return { async status() { return { ok: true }; } }; } } };
  vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(root, "backend-worker.js"), "utf8"), context);
  assert.equal(services[0].releaseUploads, false);
  let result;
  listeners[0]({ type: "BACKEND_STATUS" }, { id: "fixture-extension", url: "https://www.google.com/maps" }, (value) => { result = value; });
  assert.equal(result.ok, false);
  await new Promise((resolve) => listeners[0]({ type: "BACKEND_STATUS" }, { id: "fixture-extension", url: chrome.runtime.getURL("backend-setup.html") }, (value) => { result = value; resolve(); }));
  assert.equal(result.ok, true);
});
test("manifest limits optional backend access to the selected project", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.optional_host_permissions, [C.ORIGIN + "/*"]);
  assert.ok(!manifest.host_permissions.some((value) => value.includes("supabase")));
  assert.ok(!manifest.content_scripts[0].js.includes("backend-service.js"));
  assert.ok(!manifest.content_scripts[0].js.includes("backend-worker.js"));
});
test("all setup controls bind to actual HTML elements without inline script handlers", () => {
  const html = fs.readFileSync(path.join(root, "backend-setup.html"), "utf8");
  const source = fs.readFileSync(path.join(root, "backend-setup.js"), "utf8");
  for (const match of source.matchAll(/field\("([A-Za-z0-9_-]+)"\)/g)) assert.ok(html.includes(`id="${match[1]}"`), `Missing setup element ${match[1]}`);
  assert.ok(!/\bon(?:click|submit|change)=/i.test(html));
  assert.ok(!/<script[^>]+src="https?:/i.test(html));
});
test("read diagnostic works with release off and never changes queue, consent or target", async () => {
  const f = setup({ released: false, initialConfig: { ...config, enabled: false } });
  const before = structuredClone(f.local.data);
  const result = await f.service.testConnection();
  assert.deepEqual(result, { ok: true, projectRef: C.PROJECT_REF, organizationId: org, checkedAt: clock,
    checks: ["verified_staff", "records_read_surface", "revisions_read_surface"], uploadsReleased: false });
  assert.deepEqual(f.local.data, before);
  assert.equal(f.calls.length, 5);
  assert.ok(f.calls.every((c) => c.options.method === "GET" && !c.options.body && !c.url.includes("/rpc/")));
  const reads = f.calls.filter((c) => c.url.includes("/reporting_fudge_"));
  assert.equal(reads.length, 2);
  for (const call of reads) {
    const url = new URL(call.url);
    assert.equal(url.origin, C.ORIGIN);
    assert.equal(url.searchParams.get("organization_id"), `eq.${org}`);
    assert.equal(url.searchParams.get("limit"), "0");
    assert.equal(call.options.redirect, "error");
  }
  assert.ok(!JSON.stringify(result).includes("fixture-access-private"));
});
test("read diagnostic requires selected target and a private session before network access", async () => {
  const missing = setup({ initialConfig: null });
  await assert.rejects(missing.service.testConnection(), /Select the intended workspace/);
  assert.equal(missing.calls.length, 0);
  const signedOut = setup({ signedIn: false });
  await assert.rejects(signedOut.service.testConnection(), /Sign in again/);
  assert.equal(signedOut.calls.length, 0);
});
test("read diagnostic refuses mismatched session owner without querying source tables", async () => {
  const f = setup(); f.session.data.fudgeBackendSession.userId = otherUser;
  await assert.rejects(f.service.testConnection(), /verified staff/);
  assert.equal(f.calls.length, 0);
});
test("read diagnostic verifies current identity instead of accepting only local session metadata", async () => {
  const f = setup();
  f.handle(async () => json({ id: otherUser, email_confirmed_at: "2026-10-27T00:00:00Z" }));
  await assert.rejects(f.service.testConnection(), /verified staff/);
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].url.endsWith("/auth/v1/user"));
});
test("read diagnostic checks current membership before probing intake tables", async () => {
  const f = setup();
  f.handle(async (url) => {
    if (url.endsWith("/auth/v1/user")) return json({ id: user, email_confirmed_at: "2026-10-27T00:00:00Z" });
    return json([]);
  });
  await assert.rejects(f.service.testConnection(), /verified staff/);
  assert.ok(!f.calls.some((c) => c.url.includes("/reporting_fudge_")));
});
test("read diagnostic handles missing, denied and malformed table responses without leaking bodies", async () => {
  for (const [status, data, code] of [[404, {}, "schema"], [403, {}, "permission"], [503, {}, "transient"], [200, {}, "response"], [200, [{ text: "DO_NOT_DISPLAY_SOURCE" }], "response"]]) {
    const f = setup();
    f.handle(async (url) => {
      if (url.endsWith("/auth/v1/user")) return json({ id: user, email_confirmed_at: "2026-10-27T00:00:00Z" });
      if (url.includes("/reporting_memberships?")) return json([{ organization_id: org, role: "operator" }]);
      if (url.includes("/reporting_organizations?")) return json([{ id: org, name: "Fixture" }]);
      return json(data, status);
    });
    const before = structuredClone(f.local.data);
    await assert.rejects(f.service.testConnection(), (error) => error.code === code && !error.message.includes("DO_NOT_DISPLAY_SOURCE"));
    assert.deepEqual(f.local.data, before);
    assert.ok(!f.calls.some((c) => c.url.includes("/rpc/")));
  }
});
test("read diagnostic command is restricted to the internal setup sender", () => {
  const listeners = [];
  const event = () => ({ addListener() {} });
  const chrome = { storage: { local: {}, session: { async setAccessLevel() {} }, onChanged: event() },
    runtime: { id: "fixture-extension", getURL: (p) => `chrome-extension://fixture-extension/${p}`, onInstalled: event(), onStartup: event(), onMessage: { addListener: (fn) => listeners.push(fn) } },
    alarms: { async get() { return {}; }, async create() {}, onAlarm: event() } };
  const context = { chrome, FudgeBackendContract: C, fetch() { throw new Error("No network"); },
    FudgeBackendService: { BackendError: Error, create() { return { testConnection() { throw new Error("Must not be called"); } }; } } };
  vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(root, "backend-worker.js"), "utf8"), context);
  let result;
  listeners[0]({ type: "BACKEND_TEST_CONNECTION" }, { id: "fixture-extension", url: "https://www.google.com/maps" }, (value) => { result = value; });
  assert.equal(result.ok, false);
});
