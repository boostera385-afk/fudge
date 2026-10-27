const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
// Read from the source rather than written down here, so bumping the connector
// version never breaks a test that only meant "a current connector".
const CURRENT_CONNECTOR_VERSION = Number(
  fs.readFileSync(path.join(root, "sheets.js"), "utf8").match(/REQUIRED_CONNECTOR_VERSION = (\d+)/)[1]
);

function storage(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    local: {
      get(defaults, callback) {
        const result = { ...defaults };
        Object.keys(defaults || {}).forEach((key) => {
          if (Object.hasOwn(data, key)) result[key] = structuredClone(data[key]);
        });
        if (callback) callback(result);
        return Promise.resolve(result);
      },
      set(values, callback) {
        Object.assign(data, structuredClone(values));
        if (callback) callback();
        return Promise.resolve();
      },
      remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
        return Promise.resolve();
      }
    }
  };
}

async function testUsedDataIsolation() {
  const store = storage({
    reviews: [
      { id: "ready", author: "A", text: "Painted our kitchen", rating: 5, photos: ["https://lh3.googleusercontent.com/ready=w200"], usedAt: null },
      { id: "used", author: "B", text: "Fixed garage door track", rating: 5, photos: ["https://lh3.googleusercontent.com/used=w200"], usedAt: "2026-01-01T00:00:00.000Z" }
    ],
    drivePhotoIndex: {
      "https://lh3.googleusercontent.com/ready=s0": { id: "ready-drive" },
      "https://lh3.googleusercontent.com/used=s0": { id: "used-drive" }
    }
  });
  const context = {
    chrome: { storage: { local: store.local }, runtime: { lastError: null } },
    crypto: webcrypto,
    TextEncoder,
    URL
  };
  vm.createContext(context);
  const source = `${fs.readFileSync(path.join(root, "shared.js"), "utf8")}\n;globalThis.__Fudge = Fudge;`;
  vm.runInContext(source, context);

  const result = await context.__Fudge.clearUsedReviews();
  assert.equal(result.removed, 1);
  assert.deepEqual(Array.from(result.reviews, (review) => review.id), ["ready"]);
  assert.equal(store.data.reviews.length, 1);
  assert.ok(store.data.drivePhotoIndex["https://lh3.googleusercontent.com/ready=s0"]);
  assert.equal(store.data.drivePhotoIndex["https://lh3.googleusercontent.com/used=s0"], undefined);
}

async function testUnusedDataIsolation() {
  const store = storage({
    reviews: [
      { id: "unused", author: "A", text: "Painted our kitchen", rating: 5, photos: ["https://lh3.googleusercontent.com/unused=w200"], usedAt: null },
      { id: "used", author: "B", text: "Fixed garage door track", rating: 5, photos: ["https://lh3.googleusercontent.com/used=w200"], usedAt: "2026-01-01T00:00:00.000Z" }
    ],
    drivePhotoIndex: {
      "https://lh3.googleusercontent.com/unused=s0": { id: "unused-drive" },
      "https://lh3.googleusercontent.com/used=s0": { id: "used-drive" }
    }
  });
  const context = {
    chrome: { storage: { local: store.local }, runtime: { lastError: null } },
    crypto: webcrypto,
    TextEncoder,
    URL
  };
  vm.createContext(context);
  const source = `${fs.readFileSync(path.join(root, "shared.js"), "utf8")}\n;globalThis.__Fudge = Fudge;`;
  vm.runInContext(source, context);

  const result = await context.__Fudge.clearUnusedReviews();
  assert.equal(result.removed, 1);
  assert.deepEqual(Array.from(result.reviews, (review) => review.id), ["used"]);
  assert.equal(store.data.reviews.length, 1);
  assert.ok(store.data.drivePhotoIndex["https://lh3.googleusercontent.com/used=s0"]);
  assert.equal(store.data.drivePhotoIndex["https://lh3.googleusercontent.com/unused=s0"], undefined);
}

async function testContentDuplicateIdentity() {
  const store = storage({
    reviews: [{
      id: "google:first-id",
      googleReviewId: "first-id",
      author: "Original Author",
      text: "They repaired our garage door and it works smoothly.",
      placeId: "garage-place",
      placeName: "Ashton Garage Door Services",
      rating: 5,
      photos: ["https://lh3.googleusercontent.com/duplicate=s0"],
      reviewMode: "photo"
    }]
  });
  const context = {
    chrome: { storage: { local: store.local }, runtime: { lastError: null } },
    crypto: webcrypto,
    TextEncoder,
    URL
  };
  vm.createContext(context);
  vm.runInContext(`${fs.readFileSync(path.join(root, "shared.js"), "utf8")}\n;globalThis.__Fudge = Fudge;`, context);
  const result = await context.__Fudge.addReviews([{
    googleReviewId: "different-google-id",
    author: "Different Parsed Author",
    text: "They repaired our garage door and it works smoothly.",
    placeId: "garage-place",
    placeName: "Ashton Garage Door Services",
    rating: 5,
    photos: ["https://lh3.googleusercontent.com/duplicate=s0"],
    reviewMode: "photo"
  }]);
  assert.equal(result.accepted, 0);
  assert.equal(result.duplicates, 1, "same text at the same business must remain one review even when Google IDs differ");
  assert.equal(store.data.reviews.length, 1);
}

async function testDuplicateMergeKeepsDrivePhotoAlignment() {
  const first = "https://lh3.googleusercontent.com/merge-first=s0";
  const second = "https://lh3.googleusercontent.com/merge-second=s0";
  const store = storage({
    reviews: [{
      id: "google:merge-review",
      googleReviewId: "merge-review",
      author: "Reviewer",
      text: "They assembled our furniture perfectly.",
      placeId: "place-merge",
      rating: 5,
      photos: [first],
      drivePhotos: [null],
      reviewMode: "photo"
    }]
  });
  const context = {
    chrome: { storage: { local: store.local }, runtime: { lastError: null } },
    crypto: webcrypto,
    TextEncoder,
    URL
  };
  vm.createContext(context);
  vm.runInContext(`${fs.readFileSync(path.join(root, "shared.js"), "utf8")}\n;globalThis.__Fudge = Fudge;`, context);
  const secondDrive = { id: "drive-second", directLink: "https://drive.google.com/uc?export=view&id=drive-second" };
  await context.__Fudge.addReviews([{
    id: "google:merge-review",
    googleReviewId: "merge-review",
    author: "Reviewer",
    text: "They assembled our furniture perfectly.",
    placeId: "place-merge",
    rating: 5,
    photos: [first, second],
    drivePhotos: [null, secondDrive],
    reviewMode: "photo"
  }]);
  assert.deepEqual(Array.from(store.data.reviews[0].photos), [first, second]);
  assert.equal(store.data.reviews[0].drivePhotos[0], null);
  assert.equal(store.data.reviews[0].drivePhotos[1].id, "drive-second");
}

const EXEC_URL = "https://script.google.com/macros/s/AKfycbxTestDeploymentId/exec";
const SECRET = "fudge-secret-0123456789-abcdefghij";

// Stands in for the deployed Apps Script web app: one POST endpoint that
// switches on `action`, exactly as apps-script.gs does.
function connectorStub({ structureRows = [], reviewRows = [], progressRows = [], cityRows = [], serviceRows = [], uploadResult = { files: [], errors: [] }, onRequest = null, appendStartRow = 0, calls }) {
  return async (url, options = {}) => {
    assert.equal(url, EXEC_URL);
    const request = JSON.parse(options.body);
    assert.equal(request.secret, SECRET, "every connector call must carry the shared secret");
    calls.push(request);
    if (onRequest) await onRequest(request);
    const reply = (value) => ({ ok: true, status: 200, text: async () => JSON.stringify(value) });
    switch (request.action) {
      case "setup":
        return reply({ ok: true, spreadsheetId: "sheet-1", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1" });
      case "read":
        return reply({ ok: true, values: request.ranges.map((range) => {
          if (range.startsWith("Structure")) return structureRows;
          if (range.startsWith("Reviews")) return reviewRows;
          if (range.startsWith("Cities")) return cityRows;
          if (range.startsWith("Services")) return serviceRows;
          if (range.includes("Search Progress")) return progressRows;
          throw new Error(`Unexpected range: ${range}`);
        }) });
      case "batchWrite":
        return reply({ ok: true, totalUpdatedRanges: request.updates.length });
      case "appendRows":
        // A current connector reports where the rows actually landed.
        return reply(appendStartRow
          ? { ok: true, appended: request.rows.length, startRow: appendStartRow }
          : { ok: true, appended: request.rows.length });
      case "uploadPhotos":
        return reply({ ok: true, ...uploadResult });
      default:
        throw new Error(`Unexpected connector action: ${request.action}`);
    }
  };
}

function sheetsContext(store, fetchImpl) {
  const context = {
    chrome: { storage: { local: store.local }, runtime: { lastError: null } },
    crypto: webcrypto,
    TextEncoder,
    URL,
    console,
    // A service worker has these; the sandbox must too, because connector requests
    // now carry a deadline instead of hanging forever.
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl
  };
  vm.createContext(context);
  vm.runInContext(`${fs.readFileSync(path.join(root, "shared.js"), "utf8")}
;globalThis.__Fudge = Fudge;`, context);
  vm.runInContext(`${fs.readFileSync(path.join(root, "sheets.js"), "utf8")}
;globalThis.__SheetsService = SheetsService;`, context);
  return context;
}

async function testConnectorSetup() {
  const store = storage({ driveClientId: "stale", driveOAuth: { accessToken: "stale" }, driveProfile: { email: "stale@example.com" } });
  const calls = [];
  const context = sheetsContext(store, connectorStub({ calls }));
  const service = context.__SheetsService;

  await assert.rejects(service.configure("https://example.com/not-apps-script", SECRET), /ending in \/exec/);
  await assert.rejects(service.configure(EXEC_URL.replace("/exec", "/dev"), SECRET), /ending in \/exec/);
  await assert.rejects(service.configure(EXEC_URL, "too-short"), /secret is missing/);

  const database = await service.configure(EXEC_URL, SECRET);
  assert.equal(database.spreadsheetId, "sheet-1");
  assert.equal(database.connector, "apps-script");
  assert.equal(store.data.appsScriptUrl, EXEC_URL);
  // Connecting prepares the sheet and collects nothing: only Start may switch
  // collecting on, so linking a sheet can never surprise anyone with open tabs.
  assert.equal(store.data.runState, "stopped");
  assert.equal(store.data.sheetsAutomation, false);
  // The Apps Script migration must leave no OAuth leftovers behind.
  assert.equal(store.data.driveClientId, undefined);
  assert.equal(store.data.driveOAuth, undefined);
  assert.equal(store.data.driveProfile, undefined);

  const connectionCode = service.createConnectionCode(EXEC_URL, SECRET);
  assert.match(connectionCode, /^FUDGE1\|/);
  const sharedStore = storage();
  const sharedCalls = [];
  const sharedService = sheetsContext(sharedStore, connectorStub({ calls: sharedCalls })).__SheetsService;
  await sharedService.configure(connectionCode, "different-installation-secret-0123456789");
  assert.equal(sharedStore.data.appsScriptUrl, EXEC_URL, "a shared connection code must restore the deployment URL");
  assert.equal(sharedStore.data.appsScriptSecret, SECRET, "a shared connection code must restore the matching secret");
  assert.equal(sharedCalls[0].secret, SECRET, "the first request from another computer must use the owner's secret");

  await service.disconnect();
  assert.equal(store.data.appsScriptUrl, undefined);
  assert.equal(store.data.runState, "stopped");
}

// A deployment baked earlier by this same installation answers to a secret it still
// holds, just not the newest one. That is Fudge's problem to solve, not something to
// hand back as a wall of text telling someone to re-copy and redeploy the connector.
async function testConnectingRecoversAnOlderSecret() {
  const deployed = "deployed-secret-0123456789abcdefghij";
  const current = "current-secret-0123456789abcdefghijk";
  const store = storage({
    appsScriptSecret: current,
    appsScriptSecretBackup: current,
    // The secret the live deployment was baked with, still on record here.
    appsScriptSecretOwn: deployed
  });
  const attempted = [];
  const service = sheetsContext(store, async (_url, options) => {
    const request = JSON.parse(options.body);
    attempted.push(request.secret);
    if (request.secret !== deployed) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: false, error: "Fudge connector secret does not match." }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, spreadsheetId: "sheet-1", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1", connectorVersion: CURRENT_CONNECTOR_VERSION }) };
  }).__SheetsService;

  const database = await service.configure(EXEC_URL, current);
  assert.equal(database.spreadsheetId, "sheet-1", "it connects, quietly");
  assert.ok(attempted.includes(current) && attempted.includes(deployed), "after trying the secrets this installation holds");
  assert.equal((await store.local.get({ appsScriptSecret: "" })).appsScriptSecret, deployed, "and keeps the one that worked");

  // A deployment that answers to none of them is still reported — but briefly.
  const strangerStore = storage({ appsScriptSecret: current, appsScriptSecretBackup: current, appsScriptSecretOwn: current });
  const stranger = sheetsContext(strangerStore, async () => ({
    ok: true, status: 200, text: async () => JSON.stringify({ ok: false, error: "Fudge connector secret does not match." })
  })).__SheetsService;
  await assert.rejects(stranger.configure(EXEC_URL, current), (error) => {
    assert.match(error.message, /different secret/);
    assert.ok(error.message.length < 240, `the mismatch message must stay short, got ${error.message.length} characters`);
    return true;
  });
}

// Sharing an installation folder gives the new copy a fresh secret, and the old
// code also threw the secret away on Disconnect. Either way the connector that
// was already deployed stopped answering with "secret does not match", which is
// the one failure no instruction on the setup page can talk a user out of.
async function testConnectorSecretSurvivesDisconnect() {
  const freshStore = storage();
  const fresh = await sheetsContext(freshStore, connectorStub({ calls: [] })).__SheetsService.getSetup();
  assert.ok(fresh.appsScriptSecret.length >= 24, "a fresh installation must generate a usable secret");
  assert.equal(freshStore.data.appsScriptSecretOwn, fresh.appsScriptSecret, "the generated secret must be kept as this installation's own");
  assert.equal(fresh.connectionReady, false, "a new installation must not claim to be connected");

  const store = storage({ appsScriptSecretOwn: SECRET });
  const calls = [];
  const service = sheetsContext(store, connectorStub({ calls })).__SheetsService;
  assert.equal((await service.getSetup()).appsScriptSecret, SECRET, "the connector must be copied with this installation's own secret");

  await service.configure(EXEC_URL, SECRET);
  await service.disconnect();
  assert.equal(store.data.appsScriptSecretOwn, SECRET, "Disconnect must not discard the secret baked into deployed connectors");

  const afterDisconnect = await service.getSetup();
  assert.equal(afterDisconnect.appsScriptSecret, SECRET, "reconnecting must offer the same secret the deployment already answers to");
  assert.equal(afterDisconnect.connectionReady, false, "a disconnected installation must still report that it is not connected");
  await service.configure(EXEC_URL, afterDisconnect.appsScriptSecret);
  assert.equal(calls.at(-1).secret, SECRET, "the reconnect must reach the old deployment with its own secret");

  // A computer that joined through a connection code must keep re-copying the
  // connector with the owner's secret, or deploying that copy locks the owner out.
  const ownSecret = "own-installation-secret-0123456789";
  const sharedStore = storage({ appsScriptSecretOwn: ownSecret });
  const sharedService = sheetsContext(sharedStore, connectorStub({ calls: [] })).__SheetsService;
  await sharedService.configure(sharedService.createConnectionCode(EXEC_URL, SECRET), ownSecret);
  assert.equal((await sharedService.getSetup()).appsScriptSecret, SECRET, "while connected, the copied connector must carry the live deployment's secret");
  assert.equal(sharedStore.data.appsScriptSecretOwn, ownSecret, "joining a shared Sheet must not overwrite this installation's own secret");
}

async function testConnectorAuthorizationErrorIsActionable() {
  const store = storage();
  const htmlResponse = async () => ({
    ok: true,
    status: 200,
    text: async () => "<!doctype html><title>Authorization required</title><p>Sign in and approve permission.</p>"
  });
  const context = sheetsContext(store, htmlResponse);
  await assert.rejects(
    context.__SheetsService.configure(EXEC_URL, SECRET),
    /select fudgeInstallAutomation, click Run, approve access/i,
    "an Apps Script authorization page must explain the one-time repair"
  );

  const notFoundContext = sheetsContext(storage(), async () => ({ ok: false, status: 404, text: async () => "Not found" }));
  await assert.rejects(
    notFoundContext.__SheetsService.configure(EXEC_URL, SECRET),
    /Google returned 404.*not shared.*access to Anyone/i,
    "a private or deleted deployment must explain how to make the web app reachable"
  );
}

async function runSheetsSync({ structureRows, reviewRows, progressRows = [], cityRows = [], serviceRows = [], localReviews = [], onRequest = null, appendStartRow = 0, parallelTabs = 3 }) {
  const store = storage({
    appsScriptUrl: EXEC_URL,
    appsScriptSecret: SECRET,
    sheetsDatabase: { spreadsheetId: "sheet-1", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1", connector: "apps-script" },
    sheetsAutomation: true,
    parallelTabs,
    reviews: localReviews
  });
  const calls = [];
  const context = sheetsContext(store, connectorStub({ structureRows, reviewRows, progressRows, cityRows, serviceRows, calls, appendStartRow, onRequest: (request) => onRequest?.(request, store) }));
  const result = await context.__SheetsService.sync({ force: true });
  const valueUpdates = calls.filter((call) => call.action === "batchWrite").flatMap((call) => call.updates);
  const appended = calls.filter((call) => call.action === "appendRows");
  return { result, valueUpdates, appended, calls, store };
}

// Modelled on a real operator's sheet: every row is Self Write, the City column is
// left empty and the Cities tab has nothing in it. That shape has to queue work
// anyway — with no city the search is simply run without one — because a sheet like
// this producing no job at all is indistinguishable from Fudge being broken.
async function testSelfWriteRowsWithoutCitiesStillQueueWork() {
  const keywords = ["Junk Removal", "Dryer Repair", "Moving Service", "Sofa Cleaning", "Christmas Lights Installation",
    "Garage Door Opener Repair", "Drywall Repair", "Gas Range Repair", "Gutter Cleaning", "Furniture Assembly"];
  const structureRows = keywords.map((keyword, index) => [`REQ-${index + 2}`, "Self Write", keyword, ""]);
  const { result } = await runSheetsSync({ structureRows, reviewRows: [], cityRows: [] });

  assert.ok(result.nextJob, "a sheet with no cities must still produce a job");
  assert.equal(result.nextJob.serviceKeyword, "Junk Removal", "the first outstanding row decides what is searched first");
  assert.equal(result.nextJob.reviewMode, "without-picture", "Self Write means text-only reviews are wanted");
  assert.equal(result.nextJob.city, "", "with no city anywhere, the search simply runs without one");
  assert.ok(result.nextJob.query && !/undefined|null/.test(result.nextJob.query), `the query must be usable, got "${result.nextJob.query}"`);
  assert.equal(result.nextJobs.length, 3, "the default hands out three distinct keywords");
  assert.equal(new Set(result.nextJobs.map((job) => job.serviceKeyword)).size, 3, "the tabs never chase the same keyword");
  assert.deepEqual([...result.exhaustedEverywhere], [], "nothing is exhausted on a fresh sheet");
}

async function testSheetJobCountFollowsTabLimit() {
  const keywords = ["Junk Removal", "Dryer Repair", "Moving Service", "Sofa Cleaning", "Christmas Lights Installation", "Garage Door Opener Repair", "Drywall Repair"];
  const structureRows = keywords.map((keyword, index) => [`REQ-${index + 2}`, "Self Write", keyword, ""]);
  for (const [parallelTabs, expected] of [[1, 1], [3, 3], [5, 5], [20, 6]]) {
    const { result } = await runSheetsSync({ structureRows, reviewRows: [], parallelTabs });
    assert.equal(result.nextJobs.length, expected, `a limit of ${parallelTabs} should return ${expected} jobs`);
    assert.equal(new Set(result.nextJobs.map((job) => job.serviceKeyword)).size, expected);
  }
}

async function testActiveSyncSignalsAllocationOwnership() {
  const { calls } = await runSheetsSync({ structureRows: [["REQ-2", "Self Write", "Dryer Repair", ""]], reviewRows: [] });
  const primaryRead = calls.find((call) => call.action === "read" && call.ranges.some((range) => range.startsWith("Structure!")));
  assert.equal(primaryRead.driving, true, "an active sync must tell the connector that Chrome owns allocation");
  const write = calls.find((call) => call.action === "batchWrite");
  assert.equal(write.deferRephrase, true, "ordinary sync must not wait for AI rephrasing");
}

// A sync that changes nothing must write nothing. Every Structure row used to be
// rewritten every minute whether or not anything had happened to it: Updated At
// churned on rows nobody had touched, and the connector reformatted and re-read the
// whole tab each time. That was most of the slowness.
async function testAnUnchangedSyncWritesNothing() {
  const structureRows = [
    ["REQ-2", "Self Write", "Junk Removal", "", "", "", "", "Waiting for reviews", "", "", "2026-10-21T09:00:00.000Z"],
    ["REQ-3", "Self Write", "Dryer Repair", "", "", "", "", "Waiting for reviews", "", "", "2026-10-21T09:00:00.000Z"]
  ];
  const { valueUpdates } = await runSheetsSync({ structureRows, reviewRows: [] });
  const structureWrites = valueUpdates.filter((item) => /^Structure!/.test(item.range));
  assert.deepEqual(structureWrites, [], "rows that are still waiting, and still unchanged, are left alone");

  // And a row that does change is written, with a fresh timestamp.
  const filling = [["REQ-2", "With Picture", "Furniture Assembly", "Houston TX", "", "", "", "Waiting for reviews", "", "", "2026-10-21T09:00:00.000Z"]];
  const run = await runSheetsSync({ structureRows: filling, reviewRows: [reviewSheetRow("ready")] });
  const written = run.valueUpdates.find((item) => item.range === "Structure!A2:K2");
  assert.ok(written, "a row that gets filled is written back");
  assert.equal(written.values[0][7], "Filled");
  assert.notEqual(written.values[0][10], "2026-10-21T09:00:00.000Z", "and only then does Updated At move");
}

async function testPictureLinksStayInOneCell() {
  // Every Drive link Fudge writes takes the sharing form. Google hands back several
  // others, and the scraped googleusercontent URL is not a Drive link at all: it
  // expires, and it is not something anyone can be given.
  const NEWLINE = String.fromCharCode(10);
  const share = (id) => `https://drive.google.com/file/d/${id}/view?usp=sharing`;
  const structureRows = [["REQ-2", "With Picture", "Furniture Assembly", "Houston TX"]];
  const reviewRows = [reviewSheetRow("multiphoto")];
  // Originals as scraped, pipe-separated the way an older sheet held them.
  reviewRows[0][9] = "https://lh3.googleusercontent.com/one=s0 | https://lh3.googleusercontent.com/two=s0";
  // Drive links in two of the shapes Google actually returns.
  reviewRows[0][10] = "https://drive.google.com/uc?export=view&id=photo-one-0123456789 | https://drive.google.com/file/d/photo-two-0123456789/view?usp=drivesdk";
  const { valueUpdates } = await runSheetsSync({ structureRows, reviewRows });
  const expectedDrive = [share("photo-one-0123456789"), share("photo-two-0123456789")].join(NEWLINE);

  const structure = valueUpdates.find((item) => item.range === "Structure!A2:K2").values[0];
  assert.equal(structure[5], expectedDrive, "Picture Links must be Drive sharing links, one per line in the one cell");
  assert.doesNotMatch(structure[5], /googleusercontent|uc\?export|usp=drivesdk/, "and nothing else");

  const migrated = valueUpdates.find((item) => item.range === "Reviews!J2:K2").values[0];
  assert.equal(migrated[0], ["https://lh3.googleusercontent.com/one=s0", "https://lh3.googleusercontent.com/two=s0"].join(NEWLINE),
    "older pipe-separated Reviews cells must migrate to one link per line");
  assert.equal(migrated[1], expectedDrive, "and Drive links already in the sheet are rewritten into the sharing form");

  const dashboard = fs.readFileSync(path.join(root, "dashboard.js"), "utf8");
  assert.match(dashboard, /CHAR\(10\)/, "clipboard output must use in-cell line breaks instead of creating extra rows");
}

async function testDriveUploadKeepsPhotoPositions() {
  const first = "https://lh3.googleusercontent.com/first=s0";
  const second = "https://lh3.googleusercontent.com/second=s0";
  const store = storage({
    appsScriptUrl: EXEC_URL,
    appsScriptSecret: SECRET,
    reviews: [{ id: "review-two-photos", photos: [first, second], drivePhotos: [] }],
    drivePhotoIndex: {}
  });
  const calls = [];
  const secondFile = { id: "drive-second", originalUrl: second, directLink: "https://drive.google.com/uc?export=view&id=drive-second" };
  const context = sheetsContext(store, connectorStub({
    calls,
    uploadResult: { files: [secondFile], errors: [{ key: "review-two-photos:0", error: "temporary fetch failure" }] }
  }));

  await assert.rejects(context.__SheetsService.saveReviews(store.data.reviews), /1 images uploaded; 1 failed/);
  assert.equal(store.data.reviews[0].drivePhotos.length, 2, "Drive slots must stay aligned with original photos");
  assert.equal(store.data.reviews[0].drivePhotos[0], null, "a failed first photo must keep an empty first slot");
  assert.equal(store.data.reviews[0].drivePhotos[1].id, "drive-second", "the second Drive file must remain attached to photo two");
}

async function testDriveUploadKeepsReviewsCollectedMeanwhile() {
  const photo = "https://lh3.googleusercontent.com/upload-race=s0";
  const first = { id: "first", photos: [photo], drivePhotos: [] };
  const later = { id: "collected-during-upload", photos: [], drivePhotos: [] };
  const store = storage({ appsScriptUrl: EXEC_URL, appsScriptSecret: SECRET, reviews: [first], drivePhotoIndex: {} });
  const calls = [];
  const context = sheetsContext(store, connectorStub({
    calls,
    uploadResult: { files: [{ id: "drive-first", originalUrl: photo }], errors: [] },
    onRequest: async (request) => {
      if (request.action === "uploadPhotos") await store.local.set({ reviews: [first, later] });
    }
  }));
  await context.__SheetsService.saveReviews([first]);
  assert.deepEqual(store.data.reviews.map((review) => review.id), ["first", "collected-during-upload"],
    "an image upload must not restore an older library snapshot over new reviews");
  assert.equal(store.data.reviews[0].drivePhotos[0].id, "drive-first");
  const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
  assert.match(content, /if \(job\.saveToDrive && eligible\.length && !job\.auto\)/,
    "automatic scans must continue without waiting for Drive photos");
}

async function testEmptyDriveSelectionUploadsNothing() {
  const store = storage({
    appsScriptUrl: EXEC_URL,
    appsScriptSecret: SECRET,
    reviews: [{ id: "not-selected", photos: ["https://lh3.googleusercontent.com/not-selected=s0"] }]
  });
  const calls = [];
  const context = sheetsContext(store, connectorStub({ calls }));
  const result = await context.__SheetsService.saveReviews([]);
  assert.equal(result.uploaded, 0);
  assert.equal(calls.some((call) => call.action === "uploadPhotos"), false, "an empty selection must not upload the whole library");
}

const reviewSheetRow = (id, status = "Unused", text = "They assembled our furniture perfectly") => [
  id, `fingerprint-${id}`, "Installation", "Furniture assembly", "Houston TX", `Business ${id}`, `place-${id}`,
  text, "With Picture", `https://lh3.googleusercontent.com/${id}=s0`, "", status, status === "Used" ? "2026-10-01T00:00:00.000Z" : "", "", "https://google.com", "2026-10-01T00:00:00.000Z", ""
];

const christmasReviewSheetRow = (id, status = "Unused", text = "They installed beautiful Christmas lights along our roofline") => [
  id, `fingerprint-${id}`, "Holiday lighting", "Christmas lights installation", "Houston TX", `Holiday Business ${id}`, `place-${id}`,
  text, "With Picture", `https://lh3.googleusercontent.com/${id}=s0`, "", status, status === "Used" ? "2026-10-01T00:00:00.000Z" : "", "", "https://google.com", "2026-10-01T00:00:00.000Z", ""
];

async function testSheetsPoolAllocation() {
  const structureRows = [
    ["REQ-2", "", "Furniture Assembly", "Houston TX"],
    ["REQ-3", "", "Furniture Assembly", "Houston TX"]
  ];
  const reviewRows = Array.from({ length: 6 }, (_, index) => reviewSheetRow(`review-${index + 1}`));
  const { result, valueUpdates } = await runSheetsSync({ structureRows, reviewRows });
  assert.equal(result.ok, true);
  assert.equal(result.nextJob, null, "two assigned reviews plus four unused backups should satisfy the 3x pool");
  const first = valueUpdates.find((item) => item.range === "Structure!A2:K2").values[0];
  const second = valueUpdates.find((item) => item.range === "Structure!A3:K3").values[0];
  assert.equal(first[6], "QC needed");
  assert.equal(second[6], "QC needed");
  assert.equal(first[8], "review-1");
  assert.equal(second[8], "review-2");
  assert.equal(valueUpdates.find((item) => item.range === "Reviews!L2:N2").values[0][0], "Used");
  assert.equal(valueUpdates.find((item) => item.range === "Reviews!L3:N3").values[0][0], "Used");
}

// The Apps Script connector does its own QC replacements on an edit trigger and
// cannot see chrome.storage. The sync used to rebuild the Reviews status column
// from the local library, so it overwrote the connector's work: the review the user
// rejected came back as "Unused" — which put it straight back in the pool, because
// itemMatches only offers rows whose Sheet status is "unused" — and the replacement
// the connector had just marked "Used" was reset to "Unused" as well.
async function testConnectorQcStatusIsNotUndone() {
  const Fudge = loadShared();
  const libraryReview = (id, extra = {}) => ({
    id,
    author: `Reviewer ${id}`,
    text: "They assembled our furniture perfectly",
    placeId: `place-${id}`,
    placeName: `Business ${id}`,
    rating: 5,
    photos: [`https://lh3.googleusercontent.com/${id}=s0`],
    reviewMode: "photo",
    service: Fudge.classify("furniture assembly"),
    ...extra
  });

  const { valueUpdates, store } = await runSheetsSync({
    // A spare requirement that the rejected review would match, so a review wrongly
    // returned to the pool would be handed straight back out.
    structureRows: [["REQ-9", "With Picture", "Furniture Assembly", "Houston TX"]],
    reviewRows: [
      reviewSheetRow("old-review", "Rejected"),
      reviewSheetRow("new-review", "Used"),
      // The connector both filled and rejected this one, so the library knows
      // nothing about it at all. This is the row that came back as "Unused".
      reviewSheetRow("connector-only", "Rejected")
    ],
    localReviews: [
      // Chrome filled this row earlier, then the connector rejected it on QC.
      libraryReview("old-review", { usedAt: "2026-10-01T00:00:00.000Z" }),
      // The connector picked this replacement; Chrome never saw it happen.
      libraryReview("new-review"),
      libraryReview("connector-only")
    ]
  });

  const statusWrites = valueUpdates.filter((update) => /^Reviews!L\d+:M\d+$/.test(update.range));
  assert.deepEqual(statusWrites, [], "a stale library must not rewrite the Reviews status column at all");

  const byId = new Map(store.data.reviews.map((review) => [review.id, review]));
  assert.ok(byId.get("old-review").rejectedAt, "the library must learn that the connector rejected this review");
  assert.equal(byId.get("old-review").usedAt, null, "a rejected review is no longer a used one");
  assert.ok(byId.get("new-review").usedAt, "the library must learn that the connector used the replacement");
  assert.ok(byId.get("connector-only").rejectedAt, "a rejection the library never saw must not come back as \"Unused\"");

  const structureWrites = valueUpdates.filter((update) => /^Structure!/.test(update.range));
  assert.ok(
    structureWrites.every((update) => !update.values.flat().includes("old-review")),
    "a rejected review must never be offered to another row"
  );
}

// Freeing a review on the dashboard is a deliberate instruction, so it is the one
// case that may send a Sheet status back down.
async function testDashboardReleaseStillFreesAReview() {
  const Fudge = loadShared();
  const { valueUpdates } = await runSheetsSync({
    structureRows: [["REQ-9", "With Picture", "Furniture Assembly", "Houston TX"]],
    reviewRows: [reviewSheetRow("released-review", "Used")],
    localReviews: [{
      id: "released-review",
      author: "Reviewer",
      text: "They assembled our furniture perfectly",
      placeId: "place-released-review",
      placeName: "Business released-review",
      rating: 5,
      photos: ["https://lh3.googleusercontent.com/released-review=s0"],
      reviewMode: "photo",
      service: Fudge.classify("furniture assembly"),
      usedAt: null,
      releasedAt: "2026-10-02T00:00:00.000Z"
    }]
  });
  const statusWrites = valueUpdates.filter((update) => /^Reviews!L\d+:M\d+$/.test(update.range));
  assert.deepEqual(statusWrites.map((update) => update.values[0][0]), ["Unused"],
    "a review released on the dashboard must be freed in the Sheet too");
}

// A review appended during a sync can fill a Structure row in that same sync, and
// its "Used" mark is written by row number. That number cannot be worked out from
// the read Fudge holds — the tab's last row counts anything in it, while the read
// stops at the last row with a value in the columns Fudge asks for — so being one
// row out stamped "Used" on a different review.
async function testAppendedReviewIsMarkedOnItsOwnRow() {
  const Fudge = loadShared();
  const { valueUpdates } = await runSheetsSync({
    structureRows: [["REQ-1", "With Picture", "Furniture Assembly", "Houston TX"]],
    // One existing review, already spent, so the appended one is the only candidate.
    reviewRows: [reviewSheetRow("already-used", "Used")],
    // The tab really ends at row 6, so the connector appends at row 7 — not at the
    // row 3 that the read alone would imply.
    appendStartRow: 7,
    localReviews: [
      {
        id: "already-used",
        author: "Reviewer One",
        text: "They assembled our furniture perfectly",
        placeId: "place-already-used",
        placeName: "Business already-used",
        rating: 5,
        photos: ["https://lh3.googleusercontent.com/already-used=s0"],
        reviewMode: "photo",
        searchCity: "Houston TX",
        service: Fudge.classify("furniture assembly"),
        usedAt: "2026-10-01T00:00:00.000Z"
      },
      {
        id: "fresh-review",
        author: "Reviewer Two",
        text: "They assembled our wardrobe and dresser perfectly",
        placeId: "place-fresh-review",
        placeName: "Business fresh-review",
        rating: 5,
        photos: ["https://lh3.googleusercontent.com/fresh-review=s0"],
        reviewMode: "photo",
        searchCity: "Houston TX",
        service: Fudge.classify("furniture assembly")
      }
    ]
  });

  const reviewWrites = valueUpdates.filter((update) => /^Reviews!L\d+:N\d+$/.test(update.range));
  assert.deepEqual(reviewWrites.map((update) => update.range), ["Reviews!L7:N7"],
    "the appended review must be marked on the row the connector actually used");
  assert.equal(reviewWrites[0].values[0][0], "Used");
  const structureWrite = valueUpdates.find((update) => /^Structure!/.test(update.range));
  assert.equal(structureWrite.values[0][8], "fresh-review",
    "the Structure row must name the same review that was marked used");
}

// A keyword whose rows are all filled already has what it needs; the deficit left
// on it is only the spare buffer held behind a row waiting on QC. Searching for
// spares must wait until nothing is still empty.
async function testEmptyRowsAreSearchedBeforeSpares() {
  const Fudge = loadShared();
  const { result } = await runSheetsSync({
    structureRows: [
      // Filled and awaiting QC: it wants spares, nothing more.
      ["REQ-1", "With Picture", "Furniture Assembly", "Houston TX", "They assembled our furniture perfectly", "link", "QC needed", "Filled", "filled-review", "Business", ""],
      // Still empty, and listed second.
      ["REQ-2", "With Picture", "Painting", "Houston TX"]
    ],
    reviewRows: [reviewSheetRow("filled-review", "Used")],
    localReviews: [{
      id: "filled-review",
      author: "Reviewer",
      text: "They assembled our furniture perfectly",
      placeId: "place-filled-review",
      placeName: "Business filled-review",
      rating: 5,
      photos: ["https://lh3.googleusercontent.com/filled-review=s0"],
      reviewMode: "photo",
      searchCity: "Houston TX",
      service: Fudge.classify("furniture assembly"),
      usedAt: "2026-10-01T00:00:00.000Z"
    }]
  });

  assert.ok(result.nextJobs.length, "there is still work to queue");
  assert.equal(result.nextJobs[0].serviceKeyword, "Painting",
    "the keyword with an empty row must be searched before a filled keyword's spare buffer");
  // Array.from keeps the comparison in this realm; result crosses out of the vm.
  assert.deepEqual(Array.from(result.nextJobs, (job) => job.serviceKeyword), ["Painting", "Furniture Assembly"],
    "spare-buffer work goes to the back of the queue, not off it");
}

// The same append asked for twice — a replayed request, a racing sync, a response
// that never arrived — must not leave a second copy in the Reviews tab.
function testConnectorAppendIsIdempotent() {
  const connector = loadConnector();
  const rows = [];
  const sheet = {
    getLastRow() { return rows.length + 1; },
    getMaxColumns() { return 17; },
    setRowHeights() {},
    getRange(row, column, rowCount, columnCount) {
      return {
        setWrapStrategy() { return this; },
        getDisplayValues() {
          return rows.slice(row - 2, row - 2 + rowCount).map((source) => Array.from({ length: columnCount }, (_, i) => String(source[column - 1 + i] ?? "")));
        },
        setValues(values) { values.forEach((value, i) => { rows[row - 2 + i] = value; }); }
      };
    }
  };
  connector.SpreadsheetApp = { openById: () => ({ getSheetByName: () => sheet }), WrapStrategy: { CLIP: "CLIP" } };
  connector.PropertiesService = { getScriptProperties: () => ({ getProperty: () => "sheet-1" }) };

  const row = (id) => [id, `fingerprint-${id}`, "Installation", "Furniture assembly", "Houston TX", "Biz", "place", "text", "With Picture", "link", "", "Unused", "", "", "", "", ""];
  const first = connector.appendRows_("Reviews", [row("rev-1"), row("rev-2")]);
  assert.equal(first.appended, 2);
  assert.equal(rows.length, 2);

  // The identical call again, as a retry or a second sync would make it.
  const again = connector.appendRows_("Reviews", [row("rev-1"), row("rev-2")]);
  assert.equal(again.appended, 0, "a repeated append must write nothing");
  assert.equal(again.skipped, 2);
  assert.equal(rows.length, 2, "the Reviews tab must not collect a second copy");

  // A genuinely new review still gets through, and a batch mixing both is filtered.
  const mixed = connector.appendRows_("Reviews", [row("rev-2"), row("rev-3")]);
  assert.equal(mixed.appended, 1);
  assert.equal(mixed.skipped, 1);
  assert.deepEqual(rows.map((entry) => entry[0]), ["rev-1", "rev-2", "rev-3"]);
}

// A review already written to the Reviews tab must never be appended again.
async function testReviewIsNotAppendedTwice() {
  const Fudge = loadShared();
  const review = {
    id: "google:abc123",
    googleReviewId: "abc123",
    author: "Jane Doe",
    text: "They assembled our wardrobe perfectly and tidied up after.",
    placeId: "0x1:0xa",
    placeName: "Assembly Pros",
    rating: 5,
    photos: ["https://lh3.googleusercontent.com/abc123=s0"],
    reviewMode: "photo",
    searchCity: "Houston TX",
    searchKeyword: "furniture assembly",
    matchedKeyword: "furniture assembly",
    service: Fudge.classify("furniture assembly")
  };
  const first = await runSheetsSync({
    structureRows: [["REQ-1", "With Picture", "Furniture Assembly", "Dallas TX"]],
    reviewRows: [],
    localReviews: [review]
  });
  const appendedRows = first.appended.flatMap((call) => call.rows);
  assert.equal(appendedRows.length, 1, "the review is written once");

  // Exactly what the Reviews tab now holds, and the library as the first sync left it.
  const second = await runSheetsSync({
    structureRows: [["REQ-1", "With Picture", "Furniture Assembly", "Dallas TX"]],
    reviewRows: appendedRows.map((row) => [...row]),
    localReviews: structuredClone(first.store.data.reviews)
  });
  assert.deepEqual(second.appended.flatMap((call) => call.rows), [],
    "a review already in the Reviews tab must never be appended again");
}

async function testSheetSyncCannotEraseConcurrentReview() {
  const local = {
    id: "existing-local",
    author: "Reviewer One",
    text: "They assembled our wardrobe perfectly.",
    placeId: "place-existing",
    placeName: "Furniture Assembly Pros",
    rating: 5,
    photos: ["https://lh3.googleusercontent.com/existing-local=s0"],
    reviewMode: "photo",
    service: loadShared().classify("furniture assembly")
  };
  const late = {
    id: "late-local",
    author: "Reviewer Two",
    text: "They assembled our dresser perfectly.",
    placeId: "place-late",
    placeName: "Furniture Assembly Pros",
    rating: 5,
    photos: ["https://lh3.googleusercontent.com/late-local=s0"],
    reviewMode: "photo",
    service: loadShared().classify("furniture assembly")
  };
  let injected = false;
  const { store } = await runSheetsSync({
    structureRows: [["REQ-2", "With Picture", "Furniture Assembly", "Houston TX"]],
    reviewRows: [reviewSheetRow("existing-local")],
    localReviews: [local],
    onRequest(request, liveStore) {
      if (!injected && request.action === "batchWrite") {
        injected = true;
        liveStore.data.reviews.push(structuredClone(late));
      }
    }
  });
  assert.deepEqual(store.data.reviews.map((review) => review.id).sort(), ["existing-local", "late-local"], "a sync must preserve a review collected during its write");
}

// A row Fudge did not change is no longer written back, so "what does this row say
// now" is the update when there is one, and what went in when there is not.
function structureRowAfter(valueUpdates, rowNumber, originalRows) {
  const update = valueUpdates.find((item) => item.range === `Structure!A${rowNumber}:K${rowNumber}`);
  return update ? update.values[0] : pad(originalRows[rowNumber - 2] || [], 11);
}

function pad(row, length) {
  return Array.from({ length }, (_, index) => (row[index] == null ? "" : String(row[index])));
}

async function testDuplicateReviewCannotFillTwoRows() {
  const structureRows = [
    ["REQ-2", "With Picture", "Furniture Assembly", "Houston TX", "They assembled our furniture perfectly", "photo", "QC needed", "Filled", "same-review", "Same Business"],
    ["REQ-3", "With Picture", "Furniture Assembly", "Houston TX", "They assembled our furniture perfectly", "photo", "QC needed", "Filled", "same-review", "Same Business"]
  ];
  const used = reviewSheetRow("same-review", "Used");
  used[5] = "Same Business";
  const replacement = reviewSheetRow("unique-replacement");
  replacement[5] = "Different Business";
  const { valueUpdates } = await runSheetsSync({ structureRows, reviewRows: [used, replacement] });
  const first = structureRowAfter(valueUpdates, 2, structureRows);
  const second = structureRowAfter(valueUpdates, 3, structureRows);
  assert.equal(first[8], "same-review", "the first assignment remains canonical");
  assert.equal(valueUpdates.some((item) => item.range === "Structure!A2:K2"), false,
    "and because it did not change, it is not written back at all");
  assert.equal(second[8], "unique-replacement", "a repeated assignment must be replaced by a different review");

  const emptyStructure = [
    ["REQ-2", "With Picture", "Furniture Assembly", "Houston TX"],
    ["REQ-3", "With Picture", "Furniture Assembly", "Houston TX"]
  ];
  const duplicateA = reviewSheetRow("duplicate-a");
  const duplicateB = reviewSheetRow("duplicate-b");
  duplicateA[1] = "fingerprint-a";
  duplicateB[1] = "fingerprint-b";
  duplicateA[5] = duplicateB[5] = "Same Business";
  duplicateA[6] = duplicateB[6] = "same-place";
  const distinct = reviewSheetRow("distinct-review", "Unused", "They assembled our wardrobe efficiently");
  const secondRun = await runSheetsSync({ structureRows: emptyStructure, reviewRows: [duplicateA, duplicateB, distinct] });
  const assigned = secondRun.valueUpdates
    .filter((item) => /^Structure!A[23]:K[23]$/.test(item.range))
    .map((item) => item.values[0][8]);
  assert.deepEqual(assigned, ["duplicate-a", "distinct-review"], "different IDs for identical review content must still be treated as one review");
}

// Repeated keywords form one batch even when unrelated requirements sit between
// them in Structure. Each row needs one review plus two backups.
async function testScatteredRowsAreCombined() {
  const structureRows = [
    ["REQ-2", "With Picture", "Christmas Lights Installation", "Houston TX"],
    ["REQ-3", "With Picture", "Furniture Assembly", "Houston TX"],
    ["REQ-4", "With Picture", "Christmas Light Installation", "Houston TX"],
    ["REQ-5", "With Picture", "Christmas Lights Installation", "Houston TX"]
  ];
  const { result } = await runSheetsSync({ structureRows, reviewRows: [] });
  assert.equal(result.nextJob.serviceKeyword, "Christmas Lights Installation");
  assert.equal(result.nextJob.targetCount, 9, "three scattered Christmas rows should request nine reviews together");
}

// Once the first occurrence is filled, it must still anchor the priority of the
// whole repeated-keyword batch. This is the regression that previously allowed
// Furniture Assembly to jump ahead of later Christmas rows.
async function testFilledFirstRowKeepsBatchPriority() {
  const structureRows = [
    ["REQ-2", "With Picture", "Christmas Lights Installation", "Houston TX", "Already selected Christmas review", "photo", "QC needed", "Filled", "christmas-used", "Holiday Business"],
    ["REQ-3", "With Picture", "Furniture Assembly", "Houston TX"],
    ["REQ-4", "With Picture", "Christmas Lights Installation", "Houston TX"],
    ["REQ-5", "With Picture", "Christmas Lights Installation", "Houston TX"]
  ];
  const reviewRows = [christmasReviewSheetRow("christmas-used", "Used", "Already selected Christmas review")];
  const { result } = await runSheetsSync({ structureRows, reviewRows });
  assert.equal(result.nextJob.serviceKeyword, "Christmas Lights Installation", "later matching rows must stay ahead of an intervening keyword");
  assert.equal(result.nextJob.targetCount, 8, "two empty rows need six reviews and the filled row still needs two backups");
}

// A keyword with no city left cannot be worked on at all, so it is not unfinished
// work in progress — it is blocked. Stopping the whole queue at it meant one
// exhausted keyword silently froze every keyword added after it in Structure,
// which looked exactly like Fudge ignoring new rows. It keeps its place and is
// still reported, and the next keyword is searched meanwhile.
async function testExhaustedKeywordDoesNotBlockTheRest() {
  const structureRows = [
    ["REQ-2", "With Picture", "Christmas Lights Installation", ""],
    ["REQ-3", "With Picture", "Flooring Installation", ""]
  ];
  const cityRows = [["Dallas, TX"], ["Houston, TX"]];
  const progressRows = cityRows.map(([city]) => progressRow("Christmas Lights Installation", city, "photo", { exhausted: true }));
  const { result } = await runSheetsSync({ structureRows, reviewRows: [], progressRows, cityRows });
  assert.equal(result.nextJob.serviceKeyword, "Flooring Installation", "a keyword that cannot be searched must not hold up the next one");
  assert.deepEqual([...result.exhaustedEverywhere], ["Christmas Lights Installation"], "the blocked keyword is still reported so cities can be added");
}

async function testSheetsQcReplacement() {
  const structureRows = [["REQ-2", "", "Furniture Assembly", "Houston TX", "Old review", "old-link", "Change it", "Filled", "old", "Old Business"]];
  const reviewRows = [reviewSheetRow("old", "Used", "Old review"), reviewSheetRow("replacement"), reviewSheetRow("backup-1"), reviewSheetRow("backup-2")];
  const { result, valueUpdates } = await runSheetsSync({ structureRows, reviewRows });
  assert.equal(result.nextJob, null);
  const oldUpdate = valueUpdates.find((item) => item.range === "Reviews!L2:Q2").values[0];
  const structure = valueUpdates.find((item) => item.range === "Structure!A2:K2").values[0];
  assert.equal(oldUpdate[0], "Rejected");
  assert.equal(structure[6], "QC needed");
  assert.equal(structure[8], "replacement");
  assert.equal(structure[4], "They assembled our furniture perfectly");
}

// The connector is a standalone Apps Script with its own matcher; it never sees
// shared.js, so its rules have to be tested against the real file.
function loadConnector() {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  return context;
}

function loadShared() {
  const context = { chrome: { storage: { local: { get: (d, cb) => cb && cb(d), set: () => {} } } }, crypto: webcrypto, TextEncoder, console };
  vm.createContext(context);
  vm.runInContext(`${fs.readFileSync(path.join(root, "shared.js"), "utf8")}
;globalThis.__Fudge = Fudge;`, context);
  return context.__Fudge;
}

// Google Places is searched for the trade, not the speciality.
function testSearchTermGeneralisation() {
  const Fudge = loadShared();
  // Appliances are the one family that collapses: nobody lists themselves as a
  // "washer repair" business, they list as appliance repair.
  ["washer repair", "dryer repair", "refrigerator not cooling", "dishwasher repair"].forEach((keyword) => {
    assert.equal(Fudge.searchTermFor(keyword), "appliance repair", `${keyword} should search for appliance repair`);
  });
  // Every other family searches the speciality exactly as written, because that is
  // what finds businesses whose reviews are about it.
  ["toilet replacement", "water heater replacement", "leak repair", "garage door track",
   "spring replacement", "drywall texture matching", "cabinet painting", "flooring installation",
   "thermostat", "ac repair", "roof leak"].forEach((keyword) => {
    assert.equal(Fudge.searchTermFor(keyword), keyword, `${keyword} should be searched as written`);
  });
  // An unrecognised keyword is used verbatim rather than collapsing to handyman.
  assert.equal(Fudge.searchTermFor("pet grooming"), "pet grooming");
  assert.equal(Fudge.buildSearchQuery("garage door track", "Houston, TX"), "garage door track in Houston, TX");
  assert.equal(Fudge.buildSearchQuery("washer repair", "Houston, TX"), "appliance repair in Houston, TX");
  assert.equal(Fudge.buildSearchQuery("drywall", ""), "drywall");
}

// Adding the appliance family must not steal from the trades around it.
function testApplianceClassification() {
  const Fudge = loadShared();
  const cases = [
    ["fixed my washing machine, it would not spin", "appliance", "Washer & dryer"],
    ["refrigerator stopped cooling", "appliance", "Refrigerator & freezer"],
    ["garbage disposal replaced under the sink", "plumbing", null],
    ["cleaned the dryer vent and duct work", "hvac", null],
    ["installed a new water heater", "plumbing", null]
  ];
  cases.forEach(([text, service, subcategory]) => {
    const result = Fudge.classify(text);
    assert.equal(result.id, service, `"${text}" should classify as ${service}`);
    if (subcategory) assert.equal(result.subcategory.label, subcategory);
  });
}

async function testQueryIsBuiltFromUmbrella() {
  const structureRows = [["REQ-2", "With Picture", "garage door track", "Houston, TX"]];
  const { result } = await runSheetsSync({ structureRows, reviewRows: [] });
  assert.ok(result.nextJob, "an unfilled requirement with no inventory should schedule a search");
  assert.equal(result.nextJob.query, "garage door track in Houston, TX");
  assert.equal(result.nextJob.serviceKeyword, "garage door track", "the specific keyword is still used for matching");
  assert.equal(result.nextJob.city, "Houston, TX");
}

// A blank city means "any city", not "no match possible".
async function testBlankCityUsesWholeInventory() {
  const structureRows = [["REQ-2", "", "Furniture Assembly", ""]];
  const reviewRows = [reviewSheetRow("review-1")];
  const { result, valueUpdates } = await runSheetsSync({ structureRows, reviewRows });
  const structure = valueUpdates.find((item) => item.range === "Structure!A2:K2").values[0];
  assert.equal(structure[8], "review-1", "a Houston review should fill a requirement that names no city");
  assert.equal(structure[6], "QC needed");
  if (result.nextJob) assert.equal(result.nextJob.query, "Furniture Assembly", "a city-less search drops the trailing location");
}

// A row the user filled in must never vanish without explanation.
async function testMissingKeywordIsReported() {
  const structureRows = [["REQ-2", "With Picture", "", "Houston, TX"]];
  const { valueUpdates } = await runSheetsSync({ structureRows, reviewRows: [] });
  const structure = valueUpdates.find((item) => item.range === "Structure!A2:K2");
  assert.ok(structure, "a row with a review type but no keyword should still be written back");
  assert.equal(structure.values[0][7], "Needs a service keyword");
}

// The Businesses tab used to gain a row on every revisit of the same place.
async function testBusinessesAreNotRelogged() {
  const store = storage({
    appsScriptUrl: EXEC_URL,
    appsScriptSecret: SECRET,
    sheetsDatabase: { spreadsheetId: "sheet-1", connector: "apps-script" }
  });
  const calls = [];
  const context = sheetsContext(store, connectorStub({ calls }));
  const job = { serviceKeyword: "garage door track", city: "Houston, TX" };
  await context.__SheetsService.recordBusiness(job, "place-1", "Ironclad Garage", 3);
  await context.__SheetsService.recordBusiness(job, "place-1", "Ironclad Garage", 3);
  await context.__SheetsService.recordBusiness(job, "place-2", "Other Garage", 1);
  const appended = calls.filter((call) => call.action === "appendRows" && call.tab === "Businesses");
  assert.equal(appended.length, 2, "the same place must only be logged once per keyword and city");
  assert.deepEqual(appended.map((call) => call.rows[0][0]), ["place-1", "place-2"]);
}

const progressRow = (service, city, mode, { exhausted = false, page = 1, business = 0, visited = "", updatedAt = "2026-10-16T00:00:00.000Z" } = {}) => {
  const Fudge = loadShared();
  const key = [Fudge.normalize(service), Fudge.normalize(city), mode].join("|");
  return [key, service, city, Fudge.buildSearchQuery(service, city), page, business, exhausted ? "Yes" : "No", visited, updatedAt];
};

// The user supplies keywords; Fudge supplies the city.
async function testCityIsChosenFromTheCitiesTab() {
  const structureRows = [["REQ-2", "With Picture", "flooring installation", ""]];
  const cityRows = [["Dallas, TX"], ["Houston, TX"], ["Austin, TX"]];
  const { result } = await runSheetsSync({ structureRows, reviewRows: [], cityRows });
  assert.ok(result.nextJob, "a keyword with no city should still schedule a search");
  assert.equal(result.nextJob.city, "Austin, TX", "the keyword's stable shuffled choice should not always be the first city");
  assert.equal(result.nextJob.query, "flooring installation in Austin, TX");
  assert.equal(result.cityCount, 3);
}

async function testKeywordsReceiveDistributedCities() {
  const structureRows = [
    ["REQ-2", "With Picture", "flooring installation", ""],
    ["REQ-3", "With Picture", "furniture assembly", ""]
  ];
  const cityRows = [["Dallas, TX"], ["Houston, TX"], ["Austin, TX"]];
  const first = await runSheetsSync({ structureRows, reviewRows: [], cityRows });
  const second = await runSheetsSync({ structureRows, reviewRows: [], cityRows });
  assert.deepEqual(Array.from(first.result.nextJobs, (job) => job.city), ["Austin, TX", "Houston, TX"], "different keywords should be distributed across the city list");
  assert.deepEqual(Array.from(second.result.nextJobs, (job) => job.city), ["Austin, TX", "Houston, TX"], "the shuffled choice must survive a restart");
}

// An exhausted keyword/city combination is never searched again.
async function testExhaustedCityIsSkipped() {
  const structureRows = [["REQ-2", "With Picture", "flooring installation", ""]];
  const cityRows = [["Dallas, TX"], ["Houston, TX"], ["Austin, TX"]];
  const progressRows = [progressRow("flooring installation", "Austin, TX", "photo", { exhausted: true })];
  const { result } = await runSheetsSync({ structureRows, reviewRows: [], progressRows, cityRows });
  assert.equal(result.nextJob.city, "Houston, TX", "the selected city is finished, so Fudge moves to the next shuffled city");
  assert.equal(result.nextJob.query, "flooring installation in Houston, TX");
}

// A city that was only partly searched is resumed, not abandoned.
// Progress is written from several places, some with a job record that has been
// sitting in storage a while. A stale one overwriting a newer position is what made
// a scan walk the same pages and businesses over again.
async function testACheckpointNeverMovesBackwards() {
  const existing = progressRow("flooring installation", "Dallas, TX", "photo", { page: 4, business: 7, visited: "place-a|place-b" });
  const written = [];
  const store = storage({
    appsScriptUrl: EXEC_URL,
    appsScriptSecret: SECRET,
    sheetsDatabase: { spreadsheetId: "sheet-1", connector: "apps-script" }
  });
  const service = sheetsContext(store, async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.action === "read") return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, values: [[existing]] }) };
    if (request.action === "batchWrite") { written.push(...request.updates); return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) }; }
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
  }).__SheetsService;

  const key = existing[0];
  // A stale record, two pages behind, must not drag the checkpoint back.
  await service.recordProgress({ searchKey: key, serviceKeyword: "flooring installation", city: "Dallas, TX", currentPage: 2, businessIndex: 1, visitedPlaceIds: ["place-c"] }, false);
  assert.equal(written.length, 0, "a position behind the one on record is not written at all");

  // Real progress is written, and never forgets where it has been.
  await service.recordProgress({ searchKey: key, serviceKeyword: "flooring installation", city: "Dallas, TX", currentPage: 4, businessIndex: 9, visitedPlaceIds: ["place-c"] }, false);
  assert.equal(written.length, 1);
  const row = written[0].values[0];
  assert.equal(row[4], 4);
  assert.equal(row[5], 9, "the newer position is kept");
  assert.deepEqual(row[7].split("|").sort(), ["place-a", "place-b", "place-c"], "and visited businesses are only ever added to");
}

// Cities take turns, and a city picked up again resumes exactly where it stopped.
// A city used to stay pinned to its keyword until it was marked exhausted — which
// only happens when a scan runs out of results or hits the page cap — so any other
// ending left it pinned and the same city was searched over and over.
async function testCitiesTakeTurnsAndResumeWhereTheyStopped() {
  const structureRows = [["REQ-2", "With Picture", "flooring installation", ""]];
  const cityRows = [["Dallas, TX"], ["Houston, TX"]];

  // Dallas is part-searched, Houston has never been touched: cover the list first.
  const partial = [progressRow("flooring installation", "Dallas, TX", "photo", { page: 4, business: 2, visited: "place-a|place-b" })];
  const firstPass = await runSheetsSync({ structureRows, reviewRows: [], progressRows: partial, cityRows });
  assert.equal(firstPass.result.nextJob.city, "Houston, TX", "a city nobody has searched comes before one that has been");

  // Both have been searched now, Dallas longest ago: its turn, from its checkpoint.
  const both = [
    progressRow("flooring installation", "Dallas, TX", "photo", { page: 4, business: 2, visited: "place-a|place-b", updatedAt: "2026-10-16T00:00:00.000Z" }),
    progressRow("flooring installation", "Houston, TX", "photo", { page: 2, business: 1, updatedAt: "2026-10-20T00:00:00.000Z" })
  ];
  const { result } = await runSheetsSync({ structureRows, reviewRows: [], progressRows: both, cityRows });
  assert.equal(result.nextJob.city, "Dallas, TX", "the city left alone longest goes next");
  assert.equal(result.nextJob.currentPage, 4, "and resumes on its own page");
  assert.equal(result.nextJob.businessIndex, 2);
  assert.deepEqual([...result.nextJob.visitedPlaceIds], ["place-a", "place-b"], "with everything it had already visited");
}

// Running out of cities is reported rather than looping silently.
async function testAllCitiesExhausted() {
  const structureRows = [["REQ-2", "With Picture", "flooring installation", ""]];
  const cityRows = [["Dallas, TX"], ["Houston, TX"]];
  const progressRows = [
    progressRow("flooring installation", "Dallas, TX", "photo", { exhausted: true }),
    progressRow("flooring installation", "Houston, TX", "photo", { exhausted: true })
  ];
  const { result } = await runSheetsSync({ structureRows, reviewRows: [], progressRows, cityRows });
  assert.equal(result.nextJob, null, "nothing left to search");
  assert.deepEqual([...result.exhaustedEverywhere], ["flooring installation"]);
}

// Exhaustion is mirrored onto the Cities tab, and only changed rows are written.
async function testCitiesTabMirrorsExhaustion() {
  const structureRows = [["REQ-2", "With Picture", "flooring installation", ""]];
  const cityRows = [["Dallas, TX"], ["Houston, TX"]];
  const progressRows = [progressRow("flooring installation", "Dallas, TX", "photo", { exhausted: true })];
  const { valueUpdates } = await runSheetsSync({ structureRows, reviewRows: [], progressRows, cityRows });
  const dallas = valueUpdates.find((item) => item.range === "Cities!A2:E2");
  assert.ok(dallas, "the searched city should be written back");
  assert.equal(dallas.values[0][1], "In use");
  assert.equal(dallas.values[0][3], "flooring installation");
  assert.equal(valueUpdates.find((item) => item.range === "Cities!A3:E3"), undefined, "an untouched city must not be rewritten");
}

// A city written on the Structure row still overrides the list.
async function testStructureCityOverridesList() {
  const structureRows = [["REQ-2", "With Picture", "flooring installation", "Miami, FL"]];
  const cityRows = [["Dallas, TX"], ["Houston, TX"]];
  const { result } = await runSheetsSync({ structureRows, reviewRows: [], cityRows });
  assert.equal(result.nextJob.city, "Miami, FL");
  assert.equal(result.nextJob.query, "flooring installation in Miami, FL");
}

// A requirement must not be filled by a review that never mentions the thing.
function testKeywordNeedsEvidenceInTheReview() {
  const Fudge = loadShared();
  const review = (text) => ({ text, service: Fudge.classify(text) });
  const toilet = "toilet replacement";
  assert.equal(Fudge.matchesServiceKeyword(review("They replaced our toilet quickly and cleanly."), toilet), true);
  // All plumbing, none of them about a toilet.
  ["Fixed a leaking pipe under the kitchen sink.",
   "Unclogged the main drain line, very professional.",
   "Installed a new water heater in the garage."].forEach((text) => {
    assert.equal(Fudge.matchesServiceKeyword(review(text), toilet), false, `"${text}" must not satisfy ${toilet}`);
  });
  // A keyword that names the trade itself still takes anything in that trade.
  assert.equal(Fudge.matchesServiceKeyword(review("Fixed a leaking pipe under the kitchen sink."), "plumbing"), true);
  assert.equal(Fudge.matchesServiceKeyword(review("Unclogged the main drain line."), "plumbing"), true);
  assert.equal(Fudge.matchesServiceKeyword(review("Patched the drywall and matched the texture."), "drywall"), true);
  // Stemming: "matching" should find "matched".
  assert.equal(Fudge.reviewMentionsKeyword(review("They matched the texture perfectly"), "texture matching"), true);
  assert.equal(Fudge.reviewMentionsKeyword(review("Realigned the garage door tracks"), "garage door track"), true);
  assert.equal(Fudge.reviewMentionsKeyword(review("Replaced the garage door springs"), "garage door track"), false);
  // Plurals must not hide a match: "springs" has to satisfy "spring replacement".
  assert.equal(Fudge.matchesServiceKeyword(review("Replaced both torsion springs on the garage door."), "spring replacement"), true);
  assert.equal(Fudge.classify("Realigned the garage door tracks").subcategory.id, "track-repair");
}

function testNaturalReviewWordingIsAccepted() {
  const Fudge = loadShared();
  const matches = (keyword, text, extra = {}) => Fudge.matchesServiceKeyword({ text, service: Fudge.classify(text), ...extra }, keyword);

  assert.equal(matches("Furniture Assembly", "He put together our IKEA wardrobe and dining table perfectly."), true);
  assert.equal(matches("Christmas Lights Installation", "The holiday lights looked amazing and the crew was professional."), true);
  assert.equal(matches("Drywall Patch Repair", "They fixed the hole in our wall and matched it perfectly."), true);
  assert.equal(matches("Garage Door Track Repair", "Our garage door was off its rails and they fixed it quickly."), true);
  assert.equal(matches("Painting Repair", "The painters touched up the damaged wall and matched the color perfectly."), true);
  assert.equal(matches("Garage Door Installation", "They installed a brand new garage door and it looks great."), true);
  assert.equal(matches("Garage Door Installation", "They repaired the broken spring on our garage door."), false,
    "garage door installation must not accept a repair-only review");
  assert.equal(Fudge.matchesServiceKeyword({
    text: "They installed a new garage door and adjusted the tracks.",
    service: { id: "garage-doors", matched: true, subcategory: { id: "garage-installation" } }
  }, "Garage Door Track Repair"), false, "an installation review mentioning tracks must stay out of track repair");
  assert.equal(matches("Exterior Painting", "They painted the outside of our house and the siding looks great."), true);
  assert.equal(matches("Exterior Painting", "They painted our kitchen walls and cabinets."), false,
    "exterior painting must not accept an interior-only review");
  assert.equal(matches("Upholstery Cleaning", "They cleaned our sofa and it looks new."), true);
  assert.equal(matches("Upholstery Cleaning", "Our couch was cleaned thoroughly."), true);
  assert.equal(matches("Upholstery Cleaning", "They cleaned the upholstery on six dining chairs."), false,
    "upholstery cleaning must be limited to sofa and couch reviews");
  assert.equal(matches("Carpet Cleaning", "They cleaned every carpet and area rug."), true);
  assert.equal(matches("Carpet Cleaning", "They cleaned our couch and dining chairs."), false,
    "carpet cleaning must be limited to carpet and rug reviews");

  // A specialised business skips Google's filter, but the review still needs one
  // of the configured service signals. A selected topic becomes review context.
  assert.equal(matches("Furniture Assembly", "Great service and very professional.", { placeName: "Houston Furniture Assembly" }), false);
  assert.equal(matches("Toilet Replacement", "Great service and very professional.", { reviewTopic: "toilet replacement" }), true);

  // Looser wording must not mix precise garage-door subsections.
  assert.equal(matches("Garage Door Track Repair", "They replaced the broken torsion spring."), false);
  assert.equal(matches("Garage Door Track Repair", "They fixed the garage door opener motor."), false);
}

function testSheetManagedServiceRules() {
  const Fudge = loadShared();
  Fudge.setServiceRules([{
    keyword: "Solar Panel Cleaning",
    searchTerm: "solar panel cleaners",
    businessSignals: ["solar", "photovoltaic"],
    reviewSignals: ["solar panel", "panels"],
    requiredSignals: ["clean"],
    topicSignals: ["solar panel"],
    excludeSignals: ["installation"],
    family: "Solar services",
    subcategory: "Solar panel cleaning",
    topicRequired: true,
    collectFamilyInventory: false
  }]);
  assert.equal(Fudge.buildSearchQuery("Solar Panel Cleaning", "Austin TX"), "solar panel cleaners in Austin TX");
  assert.equal(Fudge.businessMatchesKeyword("Bright Photovoltaic Care", "Solar Panel Cleaning"), true);
  assert.equal(Fudge.requiresTopicMatch("Solar Panel Cleaning"), true);
  assert.ok(Fudge.topicKeywordMatchScore("solar panel washing", "Solar Panel Cleaning") > 0);
  assert.equal(Fudge.matchesServiceKeyword({ text: "They cleaned all of our solar panels." }, "Solar Panel Cleaning"), true);
  assert.equal(Fudge.matchesServiceKeyword({ text: "They inspected all of our solar panels." }, "Solar Panel Cleaning"), false, "all required signals must be present");
  assert.equal(Fudge.matchesServiceKeyword({ text: "They cleaned the panels during the installation." }, "Solar Panel Cleaning"), false, "an excluded signal must reject the review");
  assert.equal(Fudge.serviceIdentity("Solar Panel Cleaning").label, "Solar services");
}

async function testServicesRulesDriveSearchAndPersist() {
  const structureRows = [["REQ-2", "With Picture", "Solar Panel Cleaning", "Austin TX"]];
  const serviceRows = [[
    "Solar Panel Cleaning", "", "", "", "solar panel cleaners", "solar | photovoltaic", "solar panel | panels", "clean",
    "solar panel", "installation", "Solar services", "Solar panel cleaning", "Yes", "No", "solar panel cleaning", "photovoltaic panel cleaning | solar washing"
  ]];
  const { result, store, valueUpdates } = await runSheetsSync({ structureRows, reviewRows: [], serviceRows });
  assert.equal(result.nextJob.query, "solar panel cleaners in Austin TX");
  assert.equal(store.data.serviceRules.length, 1);
  assert.deepEqual(Array.from(store.data.serviceRules[0].businessSignals), ["solar", "photovoltaic"]);
  assert.equal(store.data.serviceRules[0].topicRequired, true);
  assert.equal(store.data.serviceRules[0].rewriteServicePhrase, "solar panel cleaning");
  assert.deepEqual(Array.from(store.data.serviceRules[0].equivalentServicePhrases), ["photovoltaic panel cleaning", "solar washing"]);
  assert.equal(valueUpdates.some((item) => item.range === "Services!A2:P2"), false, "configured rules must never be overwritten by defaults");
}

// The Services tab is handed to the scanner so off-trade reviews are never kept.
async function testServicesTabDrivesCollection() {
  const structureRows = [["REQ-2", "With Picture", "Furniture Assembly", "Houston TX"]];
  const serviceRows = [["Furniture Assembly"], ["Drywall"], ["Gutter cleaning", "Paused"]];
  const { store, valueUpdates } = await runSheetsSync({ structureRows, reviewRows: [reviewSheetRow("review-1")], serviceRows });
  assert.deepEqual([...store.data.activeServiceKeywords], ["Furniture Assembly", "Drywall"], "paused services are excluded");
  const furniture = valueUpdates.find((item) => item.range === "Services!A2:D2");
  assert.ok(furniture, "an offered service should be written back");
  assert.equal(furniture.values[0][1], "Active");
  assert.equal(furniture.values[0][2], "1", "one collected review matches this service");
  const paused = valueUpdates.find((item) => item.range === "Services!A4:D4");
  assert.equal(paused.values[0][1], "Paused");
}

// A connector deployed before the Cities/Services tabs existed rejects the whole
// read. Fudge must still sync the tabs it does understand.
async function testOutdatedConnectorStillSyncs() {
  const store = storage({
    appsScriptUrl: EXEC_URL,
    appsScriptSecret: SECRET,
    sheetsDatabase: { spreadsheetId: "sheet-1", connector: "apps-script" },
    sheetsAutomation: true,
    reviews: []
  });
  const calls = [];
  const oldConnector = async (url, options = {}) => {
    const request = JSON.parse(options.body);
    calls.push(request);
    const reply = (value) => ({ ok: true, status: 200, text: async () => JSON.stringify(value) });
    if (request.action === "read") {
      const known = ["Structure", "Reviews", "Search Progress"];
      const unknown = request.ranges.find((range) => !known.some((tab) => range.includes(tab)));
      // No connectorVersion field at all, exactly like the older deployment.
      if (unknown) return reply({ ok: false, error: "Invalid Fudge range." });
      return reply({ ok: true, values: request.ranges.map(() => []) });
    }
    return reply({ ok: true });
  };
  const context = sheetsContext(store, oldConnector);
  const result = await context.__SheetsService.sync({ force: true });
  // Header maintenance runs asynchronously so it never delays collection.
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(result.ok, true, "an outdated connector must not break the whole sync");
  assert.equal(result.connectorOutdated, true, "and the UI must be able to say so");
  const reads = calls.filter((call) => call.action === "read");
  assert.equal(reads.length, 3, "one attempt with every tab, a retry with the core tabs, then the header top-up");
  assert.equal(reads[1].ranges.length, 3, "the retry asks only for tabs the old connector knows");
  assert.equal(reads[2].ranges.length, 2, "the header top-up checks Reviews and the expanded Services rule table");
  assert.deepEqual(Array.from(reads[2].ranges), ["Reviews!A1:S1", "Services!A1:P1"]);
}

// Google groups a business's reviews into topic chips. These are the real chips
// from a Houston plumber's listing; picking the right one is what stops a toilet
// requirement being filled from the water-heater pile.
function testReviewTopicSelection() {
  const Fudge = loadShared();
  const topics = [
    "water heater replacement", "leak repair", "knowledgeable plumber", "problem diagnosis",
    "courteous staff", "sewer line replacement", "toilet replacement", "prompt arrival",
    "fair pricing", "clear explanations"
  ];
  const best = (keyword) => topics
    .map((label) => ({ label, score: Fudge.keywordMatchScore(label, keyword) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.label || null;

  assert.equal(best("toilet replacement"), "toilet replacement");
  assert.equal(best("water heater"), "water heater replacement");
  assert.equal(best("sewer line"), "sewer line replacement");
  assert.equal(best("leak repair"), "leak repair");
  // Nothing on this plumber's list is drywall, so the business is skipped.
  assert.equal(best("drywall patch"), null);
  assert.equal(best("garage door track"), null);
  // Sentiment topics must never be mistaken for a service.
  ["courteous staff", "fair pricing", "prompt arrival", "clear explanations"].forEach((label) => {
    assert.equal(Fudge.keywordMatchScore(label, "toilet replacement"), 0, `${label} is not a service`);
  });
}

function testToiletTopicIsRequiredAtGeneralPlumbers() {
  const Fudge = loadShared();
  assert.equal(Fudge.requiresTopicMatch("Toilet Replacement"), true);
  assert.equal(Fudge.requiresTopicMatch("Toilet Repair"), true);
  assert.equal(Fudge.requiresTopicMatch("Plumbing"), false);
  assert.equal(Fudge.requiresTopicMatch("Water Heater Replacement"), false);
  assert.equal(Fudge.businessMatchesKeyword("Ashton Plumbing", "Toilet Replacement"), false);
  assert.equal(Fudge.businessMatchesKeyword("Ashton Toilet Repairs", "Toilet Replacement"), true);
  assert.ok(Fudge.topicKeywordMatchScore("toilet installation", "Toilet Replacement") > 0);
  assert.equal(Fudge.topicKeywordMatchScore("water heater replacement", "Toilet Replacement"), 0);
}

// Whether the topic filter is needed depends on the business, not the keyword.
function testSpecialisedBusinessNeedsNoFilter() {
  const Fudge = loadShared();
  const specialised = (name, category, keyword) => Fudge.businessMatchesKeyword(`${name} ${category}`, keyword);
  // Already a garage door company: every review is garage door work.
  assert.equal(specialised("Halo Overhead Doors", "Garage door supplier", "garage door repair"), true);
  assert.equal(specialised("Houston Christmas Light Installation", "Holiday lighting service", "christmas light installation"), true);
  // A general plumber covers many trades, so "toilet" has to be narrowed.
  assert.equal(specialised("bluefrog Plumbing and Drain of West Houston", "Plumber", "toilet replacement"), false);
  // A garage specialist is scanned without a topic filter; individual reviews
  // are still classified into track, spring, opener and other subsections.
  assert.equal(specialised("Halo Overhead Doors", "Garage door supplier", "garage door track"), true);
}

function testFlexibleBusinessNameSignals() {
  const Fudge = loadShared();
  const matches = (name, keyword) => Fudge.businessMatchesKeyword(name, keyword);
  const accepted = [
    ["Handy Hans Furniture Assembly", "Furniture Assembly"],
    ["Ashton Assembled", "Furniture Assembly"],
    ["Assembly Help", "Furniture Assembly"],
    ["Ashton Toilet Repairs", "Toilet Replacement"],
    ["Ashton Christmas Lights Install", "Christmas Lights Installation"],
    ["Govee Permanent Lighting", "Govee Permanent Lights Installation"],
    ["Ashton Garage Specialists", "Garage Door Track Repair"],
    ["Ashton Painter Services", "Painting Repair"],
    ["Ashton Sheetrock", "Drywall Patch Repair"],
    ["Ashton TV Install", "TV Mounting"],
    ["TV Mount Helpers", "TV Mounting"],
    ["Gallery Frame Hanging", "Picture Frame Hanging"],
    ["Rapid Junk Haulers", "Junk Removal"],
    ["Careful Movers", "Moving"],
    ["Bright Window Pros", "Window Cleaning"],
    ["Rainspout Crew", "Gutter Cleaning"],
    ["Rug Doctor", "Carpet Cleaning"],
    ["Sofa Care", "Upholstery Cleaning"],
    ["Pressure Pros", "Pressure Washing"]
  ];
  accepted.forEach(([name, keyword]) => assert.equal(matches(name, keyword), true, `${name} should be specialised for ${keyword}`));
  assert.equal(matches("Ashton Plumbing", "Toilet Replacement"), false);
  assert.equal(matches("Ashton Electrical", "Christmas Lights Installation"), false);
  assert.equal(matches("Ashton Handy Services", "TV Mounting"), false);
}

function testSingleSignalReviewMatching() {
  const Fudge = loadShared();
  const matches = (keyword, text, extra = {}) => Fudge.matchesServiceKeyword({ text, service: Fudge.classify(text), ...extra }, keyword);
  const accepted = [
    ["Window Cleaning", "Our windows are spotless."],
    ["Gutter Cleaning", "They cleared every rainspout."],
    ["Carpet Cleaning", "The rug looks brand new."],
    ["Govee Permanent Lights Installation", "The lights look incredible."],
    ["Moving", "They moved us carefully."],
    ["Refrigerator Repair", "Our fridge is cold again."],
    ["Dishwasher Repair", "The dishwasher works perfectly."],
    ["Oven Repair", "The stovetop finally heats evenly."],
    ["Washing Machine Repair", "Our washer stopped leaking."],
    ["Dryer Repair", "The dryer works again."],
    ["Microwave Repair", "The microwave was repaired quickly."],
    ["Furniture Assembly", "The wardrobe was assembled perfectly."],
    ["Pressure Washing", "The pressure cleaning transformed the patio."],
    ["Upholstery Cleaning", "Our sofa looks new."],
    ["Junk Removal", "They hauled everything away."],
    ["Picture Frame Hanging", "Every frame is perfectly level."],
    ["TV Mounting", "They mounted our television."],
    ["Toilet Replacement", "The toilet was replaced cleanly."],
    ["Garage Door Repair", "The garage works smoothly now."],
    ["Painting Repair", "Excellent painters and clean work."],
    ["Drywall Patch Repair", "They repaired the ceiling after a water leak."],
    ["Outlet Replacement", "The new GFCI works perfectly."]
  ];
  accepted.forEach(([keyword, text]) => assert.equal(matches(keyword, text), true, `"${text}" should satisfy ${keyword}`));
  assert.equal(matches("Window Cleaning", "Great service and friendly staff."), false);
  assert.equal(matches("Toilet Replacement", "They repaired our water heater."), false);
  assert.equal(matches("Garage Door Track Repair", "They replaced the torsion spring."), false, "precise garage subcategories stay separate");
}

function testExpandedFurnitureAndJunkVocabulary() {
  const Fudge = loadShared();
  const matches = (keyword, text, extra = {}) => Fudge.matchesServiceKeyword({ text, service: Fudge.classify(text), ...extra }, keyword);
  [
    "They assembled our flatpack wardrobe.",
    "The IKEA dresser and bed frame look perfect.",
    "They put together a dining table, desk and chairs.",
    "Our shelves, bookshelf and drawers were assembled carefully.",
    "The crib, nightstand and armoire were completed quickly."
  ].forEach((text) => assert.equal(matches("Furniture Assembly", text), true, `Furniture wording should match: ${text}`));
  [
    "They removed our old mattress.",
    "Excellent rubbish removal and disposal.",
    "They hauled away all the clutter and debris.",
    "The junk pickup team filled the dumpster quickly."
  ].forEach((text) => assert.equal(matches("Junk Removal", text), true, `Junk wording should match: ${text}`));
  assert.equal(matches("Junk Removal", "They removed the old spring.", { sourceServiceId: "garage-doors" }), false, "generic removed wording must not steal a garage-door review");
}

function testGarageSpecialistCollectsOtherSubcategories() {
  const Fudge = loadShared();
  const springReview = {
    text: "They replaced the torsion spring.",
    placeName: "Ashton Garage Services",
    placeCategory: "Garage door supplier",
    service: Fudge.classify("They replaced the torsion spring on the garage door.")
  };
  assert.equal(Fudge.matchesServiceKeyword(springReview, "Garage Door Track Repair"), false, "spring must not fill a track row");
  assert.equal(Fudge.shouldCollectSpecialistInventory(springReview, "Garage Door Track Repair"), true, "but it should still be saved and classified in inventory");
}

function testSpecialistFamilyLockBlocksAmbiguousWords() {
  const Fudge = loadShared();
  const review = {
    text: "The technician moved it carefully and everything works smoothly.",
    placeName: "Ashton Garage Door Services",
    sourceServiceId: "garage-doors"
  };
  const classified = Fudge.classifyForKeyword(review, "Garage Door Repair");
  assert.equal(classified.id, "garage-doors", "an ambiguous verb must not move a specialist review into another service family");
  assert.equal(Fudge.matchesServiceKeyword({ ...review, service: classified }, "Moving"), false, "a garage-locked review must never fill a Moving requirement");
  assert.equal(Fudge.matchesServiceKeyword({ ...review, service: classified }, "Garage Door Repair"), true, "the review remains available to its broad garage-door family");
}

function testRequirementContextCorrectsClassification() {
  const Fudge = loadShared();
  const classify = (keyword, text) => Fudge.classifyForKeyword({ text }, keyword);
  assert.equal(classify("Window Cleaning", "Our windows are spotless.").subcategory.id, "window-cleaning");
  assert.equal(classify("Carpet Cleaning", "The carpet looks new.").subcategory.id, "carpet-cleaning");
  assert.equal(classify("Govee Permanent Lights Installation", "The lights look incredible.").id, "holiday-lighting");
  assert.equal(classify("Picture Frame Hanging", "Every frame is level.").subcategory.id, "picture-hanging");
  assert.equal(classify("Garage Door Track Repair", "They replaced the torsion spring on our garage door.").subcategory.id, "spring-repair", "review evidence must retain the real garage subsection");
}

// The reported bug: the panel said "Connected" because a Sheet record and a URL
// existed, while every request failed because the secret was gone.
async function testConnectionReadyNeedsAllThreePieces() {
  const make = (extra) => sheetsContext(storage({
    sheetsDatabase: { spreadsheetId: "sheet-1", connector: "apps-script" },
    ...extra
  }), async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));

  const full = await make({ appsScriptUrl: EXEC_URL, appsScriptSecret: SECRET }).__SheetsService.status();
  assert.equal(full.connectionReady, true, "sheet record, valid url and secret");

  const noSecret = await make({ appsScriptUrl: EXEC_URL }).__SheetsService.status();
  assert.equal(noSecret.connectionReady, false, "a missing secret is not connected");

  const badUrl = await make({ appsScriptUrl: EXEC_URL.replace("/exec", "/dev"), appsScriptSecret: SECRET }).__SheetsService.status();
  assert.equal(badUrl.connectionReady, false, "a /dev url is not connected");

  const shortSecret = await make({ appsScriptUrl: EXEC_URL, appsScriptSecret: "too-short" }).__SheetsService.status();
  assert.equal(shortSecret.connectionReady, false, "a truncated secret is not connected");

  // An incomplete storage write repairs itself from the backup copy.
  const repaired = await make({ appsScriptUrl: EXEC_URL, appsScriptSecretBackup: SECRET }).__SheetsService.status();
  assert.equal(repaired.connectionReady, true, "the backup secret restores the connection");
}

// Guards two rules that only show up against live Google markup, verified in a
// browser harness: sponsored results are never opened, and a business is never
// recognised by the per-page tsuid_ container id.
function testSponsoredAndStableBusinessIds() {
  const source = fs.readFileSync(path.join(root, "content.js"), "utf8");
  assert.match(source, /data-is-ad/, "sponsored results must be detected");
  assert.match(source, /local-ad-unit/, "sponsored results must be detected");
  assert.match(source, /if \(isSponsored\(node\)\) return false;/, "sponsored results must be filtered out of the target list");
  // The tsuid_ id embeds the page event id, so it differs on every results page.
  // Ads have no feature id or /g/ id, so this fallback made them look new each page.
  const idFn = source.slice(source.indexOf("const businessTargetId"), source.indexOf("const openBusinessAt"));
  assert.ok(!/\|\|\s*container\?\.id/.test(idFn), "business identity must not fall back to the per-page container id");
  assert.match(idFn, /data-feature-id/, "ads should be identified by their feature id");
  // A business whose topics did not match gets a capped look, not a skip.
  assert.match(source, /UNMATCHED_TOPIC_BUDGET_MS = 4000/);
  assert.ok(!/stage: "No reviews about this service here"/.test(source), "unmatched topics must no longer skip the business");
}

// Configurable Places tabs, a block that pauses instead of corrupting progress, and the
// five-minute fallback to photo-less reviews.
function testParallelTabsBlockingAndPhotoGrace() {
  const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
  const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const sheets = fs.readFileSync(path.join(root, "sheets.js"), "utf8");

  // Three by default, up to six, each on its own keyword.
  assert.match(background, /const DEFAULT_PARALLEL_TABS = 3/);
  assert.match(background, /const MAX_PARALLEL_TABS = 6/);
  assert.match(background, /JOB_STAGGER_MS/, "the second tab must not open at the same instant as the first");
  assert.match(sheets, /const DEFAULT_PARALLEL_JOBS = 3/);
  assert.match(sheets, /const MAX_PARALLEL_JOBS = 6/);
  assert.match(sheets, /claimedKeywords/, "jobs must never share a service keyword");
  // Concurrent jobs need their own records, or each one stops the other.
  assert.match(background, /scanJobs/, "jobs must be stored per id");
  assert.match(content, /scanJobs\[jobId\]/, "a tab must check its own job, not the newest one");

  // A block halts without writing the business off.
  assert.match(content, /googleBlockPage/);
  assert.match(content, /\/sorry\//);
  assert.match(content, /unusual traffic\|not a robot/);
  assert.match(content, /stage: "Blocked by Google", blocked: true/);
  assert.match(background, /const exhausted = !blocked &&/, "a blocked run must never mark a city exhausted");
  assert.match(background, /blockedUntil/, "a block must start a cooldown");
  assert.match(background, /BLOCK_BACKOFF_MINUTES = \[15, 30, 60, 120\]/);
  assert.ok(!/captcha.?solv|bypass|evade/i.test(background + content), "no block-evasion logic");

  // A second keyword must open a second tab. `scanJob` only mirrors the most
  // recently updated runner, so guarding on it made the second keyword adopt the
  // first one's job and Places was scanned one tab at a time.
  const startJob = background.slice(background.indexOf("async function startAutomaticJob"), background.indexOf("async function runSheetsAutomation"));
  assert.match(startJob, /getLocal\(\{ scanJobs: \{\}, scanJob: null \}\)/, "the live-runner check must look at every job, not the mirror");
  assert.ok(!/if \(scanJob\?\.status === "running"\)/.test(startJob), "one running job must not stand in for all of them");
  assert.match(startJob, /job\.searchKey === spec\.searchKey/, "only the same search key makes a new tab redundant");
  assert.match(startJob, /if \(live\.length >= await configuredParallelTabs\(\)\) return null/, "the chosen tab ceiling belongs where the tab is opened");
  assert.match(background, /const mine = Object\.values\(scanJobs\)\.find\(\(job\) => job\.tabId === tabId\)/, "a paginating tab must get its own job back, not the mirror");

  // Five minutes of hunting one keyword, then photo-less reviews are allowed.
  assert.match(content, /PHOTO_GRACE_MS = 5 \* 60 \* 1000/);
  assert.match(content, /photoGraceExpired/);
  assert.match(content, /keywordStartedAt/, "the grace period needs a start time on the job");
  assert.match(sheets, /NO_PICTURE_TEXT = "No picture found"/);
  assert.match(sheets, /\.length \? review\.photos\.join\(.*\) : NO_PICTURE_TEXT/, "an empty picture cell must say so");
}

// Three outstanding keywords have to put three Places tabs on screen. Guarding on the
// `scanJob` mirror made later keywords adopt the first one's job, so only one
// tab ever opened however many keywords were waiting.
async function testTwoPlacesTabsRunInParallel() {
  const store = storage({ runState: "running", sheetsAutomation: true });
  const tabs = [];
  const sent = [];
  let nextTabId = 100;
  let messageListener = null;
  const queued = [
    { auto: true, searchKey: "toilet replacement|leeds|photo", serviceKeyword: "toilet replacement", city: "Leeds", query: "toilet replacement Leeds", reviewMode: "photo", currentPage: 1, businessIndex: 0, visitedPlaceIds: [] },
    { auto: true, searchKey: "garage door repair|leeds|photo", serviceKeyword: "garage door repair", city: "Leeds", query: "garage door repair Leeds", reviewMode: "photo", currentPage: 1, businessIndex: 0, visitedPlaceIds: [] },
    { auto: true, searchKey: "junk removal|leeds|photo", serviceKeyword: "junk removal", city: "Leeds", query: "junk removal Leeds", reviewMode: "photo", currentPage: 1, businessIndex: 0, visitedPlaceIds: [] }
  ];
  const context = {
    importScripts() {},
    console,
    URL,
    crypto: webcrypto,
    TextEncoder,
    // The stagger between tabs is real but not worth waiting for in a test.
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 1)),
    Fudge: { normalize: (value = "") => String(value).toLowerCase() },
    SheetsService: {
      sync: async () => ({ ok: true, nextJobs: queued, nextJob: queued[0] }),
      recordProgress: async () => {},
      recordBusiness: async () => {}
    },
    chrome: {
      storage: { local: store.local },
      runtime: {
        lastError: null,
        getURL: (file) => file,
        onMessage: { addListener: (fn) => { messageListener = fn; } },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} }
      },
      alarms: { get: async () => ({ name: "fudge-sheets-sync" }), create: async () => {}, onAlarm: { addListener() {} } },
      notifications: { create: async () => {} },
      sidePanel: { setPanelBehavior: async () => {} },
      tabs: {
        create: async ({ url, active }) => {
          const tab = { id: nextTabId += 1, url, active, status: "complete" };
          tabs.push(tab);
          return tab;
        },
        get: async (tabId) => tabs.find((tab) => tab.id === tabId) || null,
        remove: async () => {},
        onRemoved: { addListener() {} },
        // Stands in for the content script: it answers the readiness ping, then
        // registers its own job under its own id.
        sendMessage: async (tabId, message) => {
          if (message.type === "FUDGE_PING") return { ok: true, running: false };
          sent.push({ tabId, keyword: message.options?.serviceKeyword });
          const job = { id: `job-${tabId}`, status: "running", auto: true, searchKey: message.options.searchKey, serviceKeyword: message.options.serviceKeyword, tabId };
          const { scanJobs } = await store.local.get({ scanJobs: {} });
          await store.local.set({ scanJobs: { ...scanJobs, [job.id]: job }, scanJob: job });
          return { ok: true, job };
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), context);

  const result = await context.runSheetsAutomation({ force: true });
  assert.equal(tabs.length, 3, "three outstanding keywords must open three Places tabs");
  assert.deepEqual(sent.map((entry) => entry.keyword), ["toilet replacement", "garage door repair", "junk removal"], "each tab gets its own keyword");
  assert.equal(result.startedJobs.length, 3);
  assert.equal(new Set(result.startedJobs.map((job) => job.id)).size, 3, "each tab must report its own job");
  assert.ok(tabs.every((tab) => /\/search\?q=.*udm=local/.test(tab.url)), "all tabs open on Places results");
  assert.deepEqual(tabs.map((tab) => tab.active), [false, false, false], "an alarm-driven run opens tabs in the background");

  // Three is the default ceiling: with all still running, another pass opens nothing.
  const again = await context.runSheetsAutomation({ force: true });
  assert.equal(tabs.length, 3, "a fourth tab must not open at the default limit");
  assert.equal(again.startedJob, false);

  // Each tab must get its own job back when it resumes after paginating, not
  // whichever one the `scanJob` mirror happens to point at.
  const askFor = (tabId) => new Promise((resolve) => messageListener({ type: "GET_SCAN_JOB" }, { tab: { id: tabId } }, resolve));
  assert.equal((await askFor(tabs[0].id)).job?.tabId, tabs[0].id, "the first tab must resume its own job after paginating");
  assert.equal((await askFor(tabs[1].id)).job?.tabId, tabs[1].id, "the second tab must resume its own job after paginating");
  assert.equal((await askFor(tabs[2].id)).job?.tabId, tabs[2].id, "the third tab must resume its own job after paginating");
  assert.equal((await askFor(999)).job, null, "a tab with no job of its own gets none");
}

// The Apps Script connector fills rows from its own matcher, which never sees
// shared.js. It gated on the review's family, but worked that family out by running
// patterns over the Service and Sub-category text — and that returned nothing for a
// third of Fudge's own sub-category labels, "Installation / TV mounting" among them.
// With no family the gate was skipped and word signals alone decided, so a review
// plainly labelled TV mounting filled a Christmas-lights row because its text said
// "lights". The family is now read off the recorded Service column.
function testConnectorHonoursTheRecordedService() {
  const Fudge = loadShared();
  const connector = loadConnector();

  // Every label pair Fudge can write must resolve to a family, or the gate below is
  // silently skipped for it.
  const blind = [];
  for (const service of Fudge.SERVICES) {
    for (const subcategory of service.subcategories) {
      if (!connector.queueRecordedFamily_(service.label, subcategory.label)) blind.push(`${service.label} / ${subcategory.label}`);
    }
  }
  assert.deepEqual(blind, [], "every recorded service/sub-category must resolve to a family");

  const review = (service, subcategory, text) => ({
    row: ["r1", "fp", service, subcategory, "Houston TX", "Biz", "place", text, "With Picture", "link", "", "Unused", "", "", "", "", ""]
  });
  const requirement = (service) => ({ service, city: "Houston TX", mode: "photo" });
  const matches = (serviceLabel, subcategoryLabel, text, keyword) =>
    connector.queueReviewMatches_(review(serviceLabel, subcategoryLabel, text), requirement(keyword));

  // The reported case, plus the same shape across other services.
  assert.equal(matches("Installation", "TV mounting", "They mounted the TV above the fireplace, the LED lights look great.", "Christmas Lights Installation"), false,
    "a review recorded as TV mounting must never fill a Christmas-lights row");
  assert.equal(matches("Installation", "Mounting & shelving", "Shelves up and the lights wired in neatly.", "Christmas Lights Installation"), false);
  assert.equal(matches("Plumbing", "Leak & pipe repair", "Fixed the leak, and the bathroom light works again.", "Christmas Lights Installation"), false);
  assert.equal(matches("Roofing", "Gutters", "Cleared the gutters and checked the roofline lights.", "Christmas Lights Installation"), false);
  assert.equal(matches("Carpentry", "Cabinetry", "Built the cabinet and added a light strip.", "Furniture Assembly"), false);
  assert.equal(matches("Remodeling", "Bathroom remodeling", "Remodelled the bathroom including the toilet.", "Toilet Replacement"), false);

  // Recall: each recorded service still satisfies its own keyword.
  assert.equal(matches("Holiday lighting", "Christmas lights installation", "The christmas lights look amazing on the roofline.", "Christmas Lights Installation"), true);
  assert.equal(matches("Installation", "TV mounting", "They mounted the television neatly.", "TV Mounting"), true);
  assert.equal(matches("Installation", "Furniture assembly", "The wardrobe was assembled perfectly.", "Furniture Assembly"), true);
  assert.equal(matches("Plumbing", "Toilet repair", "Replaced our toilet quickly.", "Toilet Replacement"), true);
  assert.equal(matches("Plumbing", "Toilet repair", "Great service, fast and efficient. Came the same day and helped us out.", "Toilet Replacement"), false,
    "a stored Toilet repair label must not let a generic review fill a toilet replacement row");
  assert.equal(matches("Garage doors", "Garage door installation", "They installed a new garage door.", "Garage Door Installation"), true);
  assert.equal(matches("Garage doors", "Spring replacement", "They repaired the broken garage door spring.", "Garage Door Installation"), false,
    "the Sheet queue must keep garage installation separate from repair work");
  assert.equal(matches("Garage doors", "Garage door installation", "They installed a new garage door and adjusted the tracks.", "Garage Door Track Repair"), false,
    "the Sheet queue must not use an installation review for track repair just because tracks are mentioned");
  assert.equal(matches("Painting", "Exterior painting", "They painted the exterior walls and siding.", "Exterior Painting"), true);
  assert.equal(matches("Painting", "Interior painting", "They painted our bedroom and kitchen.", "Exterior Painting"), false,
    "the Sheet queue must keep exterior painting separate from interior painting");
  assert.equal(matches("Specialty cleaning", "Upholstery cleaning", "They cleaned our sofa and couch.", "Upholstery Cleaning"), true);
  assert.equal(matches("Specialty cleaning", "Upholstery cleaning", "They cleaned six upholstered dining chairs.", "Upholstery Cleaning"), false,
    "the Sheet queue must limit upholstery cleaning to sofa and couch reviews");
  assert.equal(matches("Specialty cleaning", "Carpet & rug cleaning", "They cleaned our carpet and area rug.", "Carpet Cleaning"), true);
  assert.equal(matches("Specialty cleaning", "Upholstery cleaning", "They cleaned our sofa and couch.", "Carpet Cleaning"), false,
    "the Sheet queue must limit carpet cleaning to carpet and rug reviews");

  // "General repairs" is Fudge saying it could not tell, not a different trade, so
  // it stays eligible — the pool order is what keeps it last.
  assert.equal(matches("General repairs", "Handyman service", "Put up the christmas lights for us.", "Christmas Lights Installation"), true,
    "a review Fudge could not pin to a trade must stay usable as a last resort");
}

// The same rule in the extension's own matcher: a review whose recorded service is
// another trade is never offered, while one recorded under "General repairs" is.
function testRecordedServiceBlocksOtherTrades() {
  const Fudge = loadShared();
  // Shaped exactly as sheets.js itemMatches builds a candidate.
  const candidate = (serviceLabel, subcategoryLabel, text) => {
    const classified = Fudge.classify(`${serviceLabel} ${subcategoryLabel}`);
    return { service: classified, sourceServiceId: classified.matched ? classified.id : "", text, business: "Biz", placeName: "Biz" };
  };
  const matches = (serviceLabel, subcategoryLabel, text, keyword) =>
    Fudge.matchesServiceKeyword(candidate(serviceLabel, subcategoryLabel, text), keyword);

  assert.equal(matches("Installation", "TV mounting", "They mounted the TV, the LED lights look great.", "Christmas Lights Installation"), false,
    "a review recorded as TV mounting must never fill a Christmas-lights row");
  assert.equal(matches("Moving", "Moving service", "They moved us and the lights were on.", "Christmas Lights Installation"), false);
  assert.equal(matches("Cleaning", "Window cleaning", "Windows spotless, so much light now.", "Christmas Lights Installation"), false);
  assert.equal(matches("Installation", "TV mounting", "They mounted the television neatly.", "TV Mounting"), true,
    "its own keyword still matches");
  assert.equal(matches("General repairs", "Handyman service", "Put up the christmas lights for us.", "Christmas Lights Installation"), true,
    "an unpinned review stays usable as a last resort");
}

// Fudge already decides what each review is about and writes that subsection in
// the Reviews tab. That subsection, not a count of shared words, settles which
// keyword may claim the review: a moving review stays a moving review however the
// word "paint" got into the sentence.
function testSubcategoryDecidesTheKeyword() {
  const Fudge = loadShared();
  const matches = (keyword, text) => Fudge.matchesServiceKeyword({ text, service: Fudge.classify(text) }, keyword);

  // A definite subsection from another trade wins over one shared word.
  for (const text of [
    "The plumber moved the toilet to fit the new vanity.",
    "They assembled our IKEA wardrobe and moved it into the bedroom.",
    "They moved the washing machine out and installed the new one perfectly.",
    "Moved our sofa aside and cleaned the carpet beautifully.",
    "Hauled away all the junk and moved the old mattress out for us.",
    "They mounted the TV and moved the cabinet underneath it.",
    "Fixed the outlet after moving the dresser out of the way.",
    "Cleaned the gutters and moved the ladder carefully around the plants."
  ]) assert.equal(matches("Moving", text), false, `another trade's subsection must keep this out of moving: ${text}`);

  assert.equal(matches("Junk Removal", "The plumber removed the old toilet and fitted a new one."), false,
    "a plumbing subsection must keep a review out of junk removal");
  assert.equal(matches("Holiday Lighting", "The electrician installed a new light fixture in the hallway."), false,
    "an electrical subsection must keep a review out of holiday lighting");
  assert.equal(matches("Painting Repair", "They painted over the patch after the drywall repair."), false,
    "a drywall subsection must keep a review out of painting");

  // Genuine reviews are untouched by the rule.
  for (const text of [
    "Great movers, careful with everything from start to finish.",
    "They moved us from our old apartment to the new house in one day.",
    "The crew moved all our boxes into the truck quickly.",
    "Moving day went smoothly, they packed everything with care.",
    "Used this moving company for a long distance move and it was flawless.",
    "Relocation was painless, they handled the whole office move.",
    "Moved our two bedroom flat without a single scratch.",
    "Best moving service we have used, the packers were brilliant."
  ]) assert.equal(matches("Moving", text), true, `a real moving review must still be collected: ${text}`);

  // The subsection never overrules the keyword inside one trade, because it is not
  // dependable at that level: "They mounted our television" classifies as
  // mounting-shelving, and comparing subsections there would discard the very
  // review being asked for.
  assert.equal(matches("TV Mounting", "They mounted our television."), true,
    "a canonical TV review must survive its own misfiled subsection");

  // Two pieces of this trade's vocabulary are evidence, not a coincidence, so they
  // outrank another trade's subsection.
  assert.equal(matches("Drywall Patch Repair", "They repaired the ceiling after a water leak."), true,
    "ceiling plus water leak is a drywall job even though the subsection says plumbing");
}

// A click swallowed while the previous panel closes used to look exactly like
// "this business has no reviews", and the business was skipped for good.
function testSwallowedClickRetries() {
  const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
  const openAt = content.slice(content.indexOf("const openBusinessAt"), content.indexOf("const closeReviewLayer"));
  assert.match(openAt, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/, "a swallowed click must be retried");
  assert.match(openAt, /attempt === 0 \? 1200 : 2400/, "the first retry wait must be short so a normal open costs nothing");
  assert.match(openAt, /staleSignature/, "the previous business's feed must not count as this one's");
  // openReviews must not accept the feed that is already on screen.
  const openRev = content.slice(content.indexOf("const openReviews"), content.indexOf("const isSponsored"));
  assert.match(openRev, /freshFeed/);
  assert.ok(!/if \(findCards\(\)\.length\) return true;/.test(openRev), "stale cards must never be treated as the new business's reviews");
  assert.match(content, /waitFor\(\(\) => !findCards\(\)\.length, 700, 50\)/, "wait for the old panel to clear instead of a flat delay");
}

// Google swaps the panel heading a frame or two before it renders the reviews tab
// or the feed, and openBusinessAt hands over the moment the heading changes.
// Reading the DOM once in that instant reported "Reviews unavailable" for every
// business after the first — only the first has no previous heading to change —
// so a three-business page saved six reviews instead of eighteen.
function testReviewPanelIsGivenTimeToRender() {
  const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
  const openRev = content.slice(content.indexOf("const reviewsControl"), content.indexOf("// Paid results sit above"));
  assert.match(content, /const REVIEWS_APPEAR_MS = 7000/, "a freshly opened business needs a render budget");
  assert.match(openRev, /await waitFor\(\(\) => \{[\s\S]*freshFeed\(\)[\s\S]*reviewsControl\(\)[\s\S]*\}, REVIEWS_APPEAR_MS/, "openReviews must wait for whichever of the feed or the reviews tab lands first");
  assert.ok(!/if \(!preferred\) return false;/.test(openRev), "no reviews control on screen yet must not mean the business has no reviews");
  assert.ok(!/if \(freshFeed\(\)\) return true;\s*\n\s*const exact/.test(openRev), "the one-shot read of the DOM must be gone");
}

// Three businesses scanned in one run. The same six reviewers write about the
// same jobs at each of them, so review identity has to stay anchored to the
// business; when it does not, only the first business's reviews survive the batch.
async function testEveryBusinessInABatchIsSaved() {
  const store = storage({ reviews: [] });
  const context = {
    chrome: { storage: { local: store.local }, runtime: { lastError: null } },
    crypto: webcrypto,
    TextEncoder,
    URL
  };
  vm.createContext(context);
  vm.runInContext(`${fs.readFileSync(path.join(root, "shared.js"), "utf8")}\n;globalThis.__Fudge = Fudge;`, context);

  const authors = ["Jane Doe", "Mark Fields", "Priya Raman", "Tom Becker", "Lena Ortiz", "Sam Whitfield"];
  const texts = [
    "They replaced our toilet in the upstairs bathroom and cleaned up afterwards.",
    "Old toilet was leaking badly; the new toilet they installed works perfectly.",
    "Great toilet replacement job, fitted a new pan and cistern the same morning.",
    "Our downstairs toilet cracked and they swapped it for a new one quickly.",
    "Quoted fairly for a toilet replacement and left the bathroom spotless.",
    "Replaced two toilets for us, tidy work and the new toilet flushes great."
  ];
  const businesses = [
    { slug: "alpha", name: "Alpha Plumbing Co", placeId: "0x487e1a1111aaaa11:0x1111aaaa11111111" },
    { slug: "bravo", name: "Bravo Plumbing Services", placeId: "0x487e1a2222bbbb22:0x2222bbbb22222222" },
    { slug: "charlie", name: "Charlie Plumbing and Heating", placeId: "0x487e1a3333cccc33:0x3333cccc33333333" }
  ];
  const batch = businesses.flatMap((business) => authors.map((author, index) => ({
    googleReviewId: `${business.slug}-review-${index}`,
    author,
    text: texts[index],
    rating: 5,
    photos: [`https://lh3.googleusercontent.com/${business.slug}-photo-${index}=w200-h150`],
    reviewMode: "photo",
    placeName: business.name,
    placeId: business.placeId,
    matchedKeyword: "toilet replacement"
  })));

  const saved = await context.__Fudge.addReviews(batch);
  assert.equal(saved.accepted, 18, "every business's reviews must be saved, not just the first one's");
  assert.equal(saved.duplicates, 0, "reviews from different businesses are not duplicates of each other");
  const perBusiness = businesses.map((business) => store.data.reviews.filter((review) => review.placeName === business.name).length);
  assert.deepEqual(perBusiness, [6, 6, 6], "each business keeps its own six reviews");

  // Again without Google's review ids: identity then falls back to the author and
  // the place, which still has to tell the three businesses apart.
  store.data.reviews = [];
  const anonymous = batch.map(({ googleReviewId, ...review }) => review);
  const savedAnonymous = await context.__Fudge.addReviews(anonymous);
  assert.equal(savedAnonymous.accepted, 18, "the author/place fallback must not merge reviews across businesses");
  assert.equal(savedAnonymous.duplicates, 0);
  assert.equal(new Set(store.data.reviews.map((review) => review.id)).size, 18, "every saved review needs its own id");
}

function testDomBindings() {
  const pairs = [
    ["dashboard.js", "dashboard.html", new Set(["emptyAll", "emptyClear"])],
    ["drive-setup.js", "drive-setup.html", new Set()],
    ["sidepanel.js", "sidepanel.html", new Set()]
  ];
  for (const [scriptName, htmlName, dynamic] of pairs) {
    const script = fs.readFileSync(path.join(root, scriptName), "utf8");
    const html = fs.readFileSync(path.join(root, htmlName), "utf8");
    const ids = [...script.matchAll(/(?:\$\(|document\.querySelector\()\s*"#([^" ]+)"\)/g)].map((match) => match[1]);
    const missing = [...new Set(ids)].filter((id) => !dynamic.has(id) && !html.includes(`id="${id}"`));
    assert.deepEqual(missing, [], `${scriptName} references missing elements: ${missing.join(", ")}`);
  }
}

function loadWebsiteWriter(store) {
  const context = {
    chrome: { storage: { local: store.local } },
    fetch: async () => { throw new Error("network is not available in tests"); },
    console
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(root, "config.js"), "utf8")
    + "\n" + fs.readFileSync(path.join(root, "rewriter.js"), "utf8")
    + "\n;globalThis.__WebsiteWriter = WebsiteWriter;";
  vm.runInContext(source, context);
  return context.__WebsiteWriter;
}

function testWebsiteWriterPromptCarriesAllFiveRules() {
  const writer = loadWebsiteWriter(storage());
  const messages = writer.buildMessages({
    text: "Acme Garage Doors fixed our spring in Dallas last week. Call them at (555) 123-4567.",
    reviewerName: "Sarah",
    businessName: "Acme Garage Doors",
    phone: "(555) 987-6543",
    names: "Darwin, Felix, Bernard"
  });
  const system = messages[0].content;
  const user = messages[1].content;
  assert.match(system, /NO BUSINESS NAME/);
  assert.match(system, /NO LOCATION/);
  assert.match(system, /NO DATE/);
  assert.match(system, /NO WEATHER/);
  assert.match(system, /PHONE NUMBERS/);
  assert.match(system, /KEEP THE REVIEWER'S VOICE/, "rule 5 must preserve the reviewer's first-person voice");
  assert.match(system, /PERSON NAME/, "rule 6 must require a person name in every review");
  assert.match(system, /exactly once in every finished review/, "rule 6 must always identify the service provider with one name");
  assert.match(system, /organization, brand, school/, "rule 1 must remove other organizations mentioned inside a review");
  assert.match(system, /reviewer_name/, "the system prompt must reference the reviewer_name input field");
  assert.match(system, /must not appear inside the text/, "the reviewer's name must not be spoken as 'NAME said'");
  assert.match(system, /MINIMAL EDIT/, "the system prompt must prohibit unnecessary enhancement");
  assert.match(system, /Do not polish, enhance, advertise, summarize, expand/, "the writer must preserve the original instead of embellishing it");
  assert.match(system, /add no contact invitation or reference/, "an empty phone must not add a contact CTA");
  assert.match(user, /reviewer_name: Sarah/, "the reviewer's name must be passed under its field name");
  assert.match(user, /phone: \(555\) 987-6543/, "the phone must be passed under its field name");
  assert.match(user, /required_cta: .+\(555\) 987-6543/, "a short rotating CTA must be supplied when a phone exists");
  assert.match(user, /replacement_name: Darwin/, "one stable replacement name must be passed under its field name");
  assert.match(user, /business name to remove: Acme Garage Doors/, "the business name must be passed so the model knows what to strip");
  assert.match(user, /Acme Garage Doors fixed our spring/, "the original review text must be sent");

  // An empty names list must receive a stable US male fallback name.
  const emptyList = writer.buildMessages({ text: "Great work", reviewerName: "Sarah", phone: "555", names: "" });
  assert.match(emptyList[1].content, /replacement_name: (?:James|Michael|Daniel|David|Matthew|Ryan|Jason|Andrew|Brian|Kevin)/, "an empty crew list must receive a default male name");
}

function testWebsiteWriterSafetyCheck() {
  const writer = loadWebsiteWriter(storage());

  // A foreign phone in the rewrite is flagged; the configured CTA phone is not.
  const withForeignPhone = writer.checkText(
    "Sarah said the team fixed the springs fast. Call the service today at (555) 123-4567.",
    { phone: "(555) 987-6543", businessName: "Acme Garage Doors" }
  );
  assert.ok(withForeignPhone.some((warning) => warning.includes("(555) 123-4567")), "a phone that is not the configured one must be flagged");

  const withOwnPhone = writer.checkText(
    "Sarah said the team fixed the springs fast. Call the service at (555) 987-6543.",
    { phone: "(555) 987-6543", businessName: "Acme Garage Doors" }
  );
  assert.ok(!withOwnPhone.some((warning) => /phone/i.test(warning)), "the configured CTA phone must pass the phone check");

  // Several configured numbers are allowed; any of them may appear.
  const withSecondAllowed = writer.checkText(
    "Sarah said the team fixed the springs fast. His contact (469) 718-8444.",
    { phone: "(555) 987-6543, (469) 718-8444", businessName: "Acme Garage Doors" }
  );
  assert.ok(!withSecondAllowed.some((warning) => /contact|phone/i.test(warning)), "any configured phone number must pass the contact check");

  // Dates fail rule 3: month names, relative phrases, and years.
  for (const text of [
    "Sarah said the team came last week.",
    "They finished in October and cleaned everything.",
    "Great work back in 2024."
  ]) {
    const warnings = writer.checkText(text, { phone: "(555) 987-6543", businessName: "Acme Garage Doors" });
    assert.ok(warnings.some((warning) => /date/i.test(warning)), `"${text}" must be flagged for a date or time phrase`);
  }

  // Business names fail rule 1.
  const withBusiness = writer.checkText(
    "Sarah said Acme Garage was quick and fairly priced.",
    { phone: "(555) 987-6543", businessName: "Acme Garage Doors" }
  );
  assert.ok(withBusiness.some((warning) => /business/i.test(warning)), "a leftover business name must be flagged");

  // A clean rewrite raises nothing.
  const cleanReview = "They fixed the springs the same day and the price was fair.";
  const cleanCta = writer.ctaFor(cleanReview, "(555) 987-6543");
  const clean = writer.checkText(
    `James fixed the springs the same day and the price was fair. ${cleanCta}`,
    { phone: "(555) 987-6543", businessName: "Acme Garage Doors", names: "James", reviewText: cleanReview }
  );
  assert.equal(clean.length, 0, "a rule-abiding rewrite must produce no warnings");
  assert.notEqual(
    writer.ctaFor("Acme fixed our spring.", "(555) 987-6543"),
    writer.ctaFor("Another review.", "(555) 987-6543"),
    "different reviews should rotate through different CTA wording"
  );
  assert.ok(!writer.checkText("I may recommend the team.", {}).some((warning) => /date/i.test(warning)), "ordinary lowercase may is not a date");
  assert.ok(writer.checkText("They came on May 5.", {}).some((warning) => /date/i.test(warning)), "the month May must still be detected");
  assert.ok(writer.checkText("They worked through the rain.", {}).some((warning) => /weather/i.test(warning)), "weather must be flagged locally");
  assert.ok(!writer.checkText("They replaced the garage door spring.", {}).some((warning) => /weather/i.test(warning)), "garage door spring must not be mistaken for a season or weather");
}

function testWebsiteWriterCrewNameCheck() {
  const writer = loadWebsiteWriter(storage());
  const original = "Mario, Gris, and Esuin completed my move in a timely manner. Mario was careful with everything.";

  // A leaked original crew name is flagged even when the review text differs.
  const leak = writer.checkText(
    "Mario completed my move in a timely manner.",
    { phone: "(561) 464-6940", reviewerName: "Bernard", names: "Darwin, Felix", reviewText: original }
  );
  assert.ok(leak.some((warning) => /crew/i.test(warning) && warning.includes("Mario")), "a surviving original crew name must be flagged");

  // The reviewer's own name, the provided replacements, and the business name are allowed.
  const crewCta = writer.ctaFor(original, "(561) 464-6940");
  const clean = writer.checkText(
    `Darwin and Felix completed my move in a timely manner. Bernard was careful with everything. ${crewCta}`,
    { phone: "(561) 464-6940", reviewerName: "Bernard", names: "Darwin, Felix", reviewText: original }
  );
  assert.equal(clean.length, 0, "replacement names from the list must not be flagged");
}

async function testWebsiteWriterCacheRoundTrip() {
  const store = storage();
  const writer = loadWebsiteWriter(store);
  const saved = await writer.getRewrite("review-1");
  assert.equal(saved, null, "an unrewritten review starts with no cached rewrite");
  await writer.saveRewrite("review-1", { text: "Sarah said the team was great.", warnings: [] });
  const cached = await writer.getRewrite("review-1");
  assert.equal(cached.text, "Sarah said the team was great.");
  assert.ok(cached.savedAt, "the cached rewrite records when it was written");
  const stored = await writer.getRewrite("review-2");
  assert.equal(stored, null, "another review must not inherit the first one's rewrite");
}

function loadWebsiteWriterWithFetch(store, fetchStub) {
  const context = {
    chrome: { storage: { local: store.local }, runtime: { sendMessage: async () => {
      const response = await fetchStub();
      const body = await response.json();
      return { ok: true, text: body.choices[0].message.content };
    } } },
    fetch: fetchStub,
    console
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(root, "config.js"), "utf8")
    + "\n" + fs.readFileSync(path.join(root, "rewriter.js"), "utf8")
    + "\n;globalThis.__WebsiteWriter = WebsiteWriter;";
  vm.runInContext(source, context);
  return context.__WebsiteWriter;
}

async function testWebsiteWriterEnsureRewriteCachesPerReview() {
  let apiCalls = 0;
  const stub = async () => {
    apiCalls += 1;
    return { ok: true, json: async () => ({ choices: [{ message: { content: "Sarah and Felix handled everything. Call (555) 987-6543." } }] }) };
  };
  const writer = loadWebsiteWriterWithFetch(storage(), stub);
  const review = { id: "r1", author: "Sarah", placeName: "Acme Garage Doors", text: "Acme fixed our spring." };
  const first = await writer.ensureRewrite(review, { phone: "(555) 987-6543", names: "Felix, Darwin" });
  assert.match(first, /Sarah/, "the generated rewrite is returned on first call");
  const second = await writer.ensureRewrite(review, { phone: "(555) 987-6543", names: "Felix, Darwin" });
  assert.equal(second, first, "the second call must return the cached rewrite");
  assert.equal(apiCalls, 1, "the cache must prevent a second API call for the same review");

  const other = await writer.ensureRewrite({ id: "r2", author: "Sam", placeName: "Acme Garage Doors", text: "Another review." }, { phone: "(555) 987-6543", names: "Felix, Darwin" });
  assert.match(other, /Sarah|Felix/, "a different review gets its own rewrite");
  assert.equal(apiCalls, 2, "a different review must trigger exactly one more API call");
}

async function testWebsiteWriterDetectsPhoneForTheColumn() {
  const writer = loadWebsiteWriterWithFetch(storage(), async () => { throw new Error("no API call expected"); });
  const phones = "(561) 464-6940, (469) 718-8444";
  assert.equal(
    writer.phoneForText("Their prices are the best. You can call at (561) 464-6940.", phones),
    "(561) 464-6940",
    "the configured number appearing in the copy is reported"
  );
  assert.equal(
    writer.phoneForText("Reach them at (469) 718-8444 for a quote.", phones),
    "(469) 718-8444",
    "the second configured number is also recognized"
  );
  assert.equal(
    writer.phoneForText("Sarah and Felix handled everything, no number here.", phones),
    "",
    "a rewrite without any number skips the Phone column"
  );
  assert.equal(
    writer.phoneForText("Call (999) 555-0100 now.", phones),
    "",
    "a foreign number must never be reported as the used phone"
  );
  assert.equal(writer.phoneForText("anything", ""), "", "no configured phones means an empty Phone column");
}

function testWebsiteWriterReachesTheSheetColumn() {
  const sheets = fs.readFileSync(path.join(root, "sheets.js"), "utf8");
  const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
  const connector = fs.readFileSync(path.join(root, "apps-script.gs"), "utf8");

  assert.match(sheets, /"Website Copy"/, "the Reviews tab must gain a Website Copy column");
  assert.match(sheets, /"Phone"/, "the Reviews tab must gain a Phone column");
  assert.match(sheets, /Reviews!A2:S/, "the sync must read both new columns");
  assert.match(sheets, /Reviews!A1:S1/, "the sync must top up the header row so the new columns appear in old Sheets by themselves");
  assert.match(sheets, /localReviewRow\(review, "", ""\)/, "inventory rows must be appended without spending credits on website copy");
  assert.doesNotMatch(sheets, /WebsiteWriter\.ensureRewrite/, "Sheet sync must never auto-rewrite the Reviews inventory");
  assert.doesNotMatch(connector, /function processRewrites_/, "the one-minute connector must never backfill Website Copy at API cost");
  assert.match(background, /importScripts\("shared\.js", "config\.js", "rewriter\.js", "sheets\.js"\)/, "the service worker must retain the explicit dashboard writer");
  assert.ok(!html.includes("id=\"writerAuto\""), "the removed inventory auto-write control must not promise costly background work");
}

function testLiveGoogleRegressions() {
  const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
  const background = fs.readFileSync(path.join(root, "background.js"), "utf8");

  assert.match(content, /const selectors = \["\.d83Iyc"/, "direct Search Places review text must be accepted");
  assert.match(content, /h2\.RjvGlb\.pb3iw/, "the current Search Places business-name heading must be preferred");
  assert.match(content, /\.OSrXXb/, "the mirrored Search Places business name must be supported");
  assert.match(content, /if \(!ranked\.length\) return \{ applied: false, skip: topicRequired/, "strict toilet searches must skip a general plumber without a toilet topic");
  assert.match(content, /if \(!chips\.length\) \{[\s\S]{0,200}?skip: topicRequired/, "strict toilet searches must not scroll when topic filters are unavailable");
  assert.match(content, /if \(!chips\.length && topicRequired\) \{[\s\S]{0,260}?chips = reviewTopicChips\(\);/, "an empty topic carousel must be re-read once before a business is written off");
  assert.match(content, /await waitForReviewTopicsSettled\(\)/, "strict topic decisions must wait for Google's topic carousel to settle");
  assert.match(content, /await waitForPlaceIdentitySettled\(\)/, "business-name decisions must wait for the selected title to settle");
  assert.match(content, /document\.querySelector\("a#pnnext\[href\]/, "pagination must use Google's real pnnext anchor");
  assert.match(content, /nextPageButton\(\) \|\| await waitFor\(nextPageButton/, "pagination must wait briefly before declaring a city exhausted");
  assert.match(content, /location\.href = nextHref/, "the next page href must be followed directly even when the anchor has a zero-size box");
  assert.match(content, /loadedPage > Number\(job\.currentPage \|\| 1\)[\s\S]{0,180}pageAdvanced: true/, "a page transition is checkpointed after the new page loads");
  assert.match(content, /Results did not load — will retry/, "an unloaded results page must not be declared exhausted");
  assert.match(background, /businessCompleted \|\| message\.patch\.pageAdvanced/, "page checkpoints must be written to Search Progress");
  assert.doesNotMatch(content, /searchParams\.set\("start",\s*"0"\)/, "result reordering must not restart the city from page one");
  assert.match(content, /Results changed — safely resuming page/, "reordered results should restart only the current page");
  assert.match(content, /const MAX_RESULT_PAGES = 4/, "no scan may paginate beyond four result pages");
  assert.match(background, /const MAX_RESULT_PAGES = 4/, "the background runner must clamp legacy page settings to four");
  assert.match(background, /end of results\|page limit reached/i, "the page cap must complete the city instead of reopening page five");
  assert.match(background, /const onLivePlacesTab = async \(job\) => \{[\s\S]*chrome\.tabs\.get\(job\.tabId\)/, "a stale running job must be checked before blocking resume");
  assert.match(background, /if \(!leaseExpired\(job\) && await onLivePlacesTab\(job\)\) \{ live\.push\(job\); continue; \}/, "a live runner is left alone");
  assert.match(background, /await updateScanJob\(\{ id: job\.id, tabId: job\.tabId, status: "interrupted"/, "only the dead runner is interrupted, never a sibling still scanning");
  assert.match(background, /await SheetsService\.recordProgress\(job, false\)[\s\S]{0,160}status: "interrupted"/, "save a dead runner's checkpoint before releasing it");
  // Stop is unconditional now. Making it depend on the mirrored job left automation
  // switched on, and the alarm reopened tabs a minute after the user stopped.
  assert.match(background, /if \(message\?\.type === "STOP_SCAN_JOB"\)[\s\S]*?await setLocal\(\{ runState: RUN_STATE_STOPPED, sheetsAutomation: false \}\);/, "Stop must switch collecting off whatever state the jobs are in");
  assert.match(background, /if \(await isRunning\(\) && !blocked\) setTimeout/, "completion must honor the one run switch and never restart while blocked");
  assert.match(background, /chrome\.tabs\.onRemoved\.addListener/, "closing a runner tab must release its scanning slot");
  assert.match(background, /const done = entry\.status !== "running" \|\| leaseExpired\(entry\)/, "a running record with a lapsed lease must not survive forever");
  assert.doesNotMatch(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8"), /All pages|10 pages|Custom/, "the sidebar must not offer limits above four");
}

function testConnectorSanitisesFormulaText() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  assert.equal(context.safeCell_("=IMPORTXML(\"https://example.com\")"), "'=IMPORTXML(\"https://example.com\")");
  assert.equal(context.safeCell_("+cmd"), "'+cmd");
  assert.equal(context.safeCell_("Normal review"), "Normal review");
  assert.equal(vm.runInContext("FUDGE_CONNECTOR_VERSION", context), CURRENT_CONNECTOR_VERSION, "the connector and the extension must agree on the version");
  assert.equal(vm.runInContext("typeof FUDGE_REQUIRED_SERVICE_KEYWORDS", context), "undefined", "the connector must not force service rows from code");
  assert.deepEqual(Array.from(vm.runInContext("FUDGE_TABS.Services", context)), [
    "Service Keyword", "Status", "Reviews Collected", "Notes", "Search Term", "Business Name Keywords", "Review Keywords", "Required Review Keywords", "Google Filter Keywords", "Exclude Keywords", "Service Family", "Subcategory", "Topic Filter Required", "Collect Family Reviews", "Rewrite Service Phrase", "Equivalent Service Phrases"
  ]);
}

function testConnectorMakesEveryPhotoLinkClickable() {
  const built = [];
  const context = {
    SpreadsheetApp: {
      newRichTextValue: () => {
        const value = { text: "", links: [] };
        return {
          setText(text) { value.text = text; return this; },
          setLinkUrl(start, end, url) { value.links.push({ start, end, url }); return this; },
          build() { built.push(value); return value; }
        };
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  const first = "https://drive.google.com/file/d/first/view";
  const second = "https://drive.google.com/file/d/second/view";
  const rich = context.richLinkedText_(`${first}\n${second}`);
  assert.equal(rich.text, `${first}\n${second}`);
  assert.deepEqual(Array.from(rich.links, (link) => link.url), [first, second], "every URL in one cell must receive its own clickable link range");
}

function testConnectorRetriesDateLeak() {
  let calls = 0;
  const context = {
    UrlFetchApp: { fetch: (_url, options) => {
      calls += 1;
      const content = calls === 1 ? "James made me happy with the work yesterday." : "James made me happy with the work.";
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ message: { content } }] }) };
    } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  assert.equal(context.writerDateMatch_("I may recommend them."), null, "ordinary may must not be treated as the month");
  assert.ok(context.writerDateMatch_("They arrived May 5."), "the month May must still be detected");
  assert.equal(context.writerStripDates_("They came yesterday and fixed it."), "They came and fixed it.");
  assert.equal(context.writerStripDates_("They came on yesterday and fixed it."), "They came and fixed it.");
  assert.equal(context.writerStripDates_("They arrived on March 5, 2025 and helped."), "They arrived and helped.");
  assert.equal(context.writerStripDates_("They arrived on 10/15/2025 and helped."), "They arrived and helped.");
  assert.equal(context.writerStripDates_("I may recommend them."), "I may recommend them.");
  const result = context.rewriteText_({ text: "I was happy with the work yesterday." }, { key: "test-key", phone: "", names: "James", requirePhone: false });
  assert.equal(result.text, "James made me happy with the work.");
  assert.equal(calls, 1, "a leaked date must be removed locally without a slow second API call");
}

function testConnectorRemovesWeatherLocally() {
  let calls = 0;
  const context = {
    UrlFetchApp: { fetch: () => {
      calls += 1;
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ message: { content: "Despite the rain, James fixed our garage door spring." } }] }) };
    } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  assert.ok(context.writerWeatherMatch_("It was raining during the job."));
  assert.equal(context.writerWeatherMatch_("James replaced the garage door spring."), null, "spring hardware is not weather");
  assert.equal(context.writerStripWeather_("Despite the rain, James fixed our garage door spring."), "James fixed our garage door spring.");
  assert.equal(context.writerStripWeather_("It was raining, but James fixed our garage door spring."), "James fixed our garage door spring.");
  assert.equal(context.writerStripWeather_("During the winter, they installed the lights."), "They installed the lights.");
  const result = context.rewriteText_({ text: "They fixed our garage door spring." }, { key: "test-key", phone: "", names: "James", requirePhone: false });
  assert.equal(result.text, "James fixed our garage door spring.");
  assert.equal(calls, 1, "weather should be removed locally without buying another rewrite");
}

function testConnectorCleansOriginalNameAndFindsOtherOrganizations() {
  let calls = 0;
  const context = {
    UrlFetchApp: { fetch: () => {
      calls += 1;
      const content = calls === 1 ? "Joe was amazing!" : "James was amazing!";
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ message: { content } }] }) };
    } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  const organizations = Array.from(context.writerOrganizationNames_(
    "I recommend Sumo Garage Doors. As an owner with Cyber Trading University, I value honest work.",
    "Sumo Garage Doors"
  ));
  assert.deepEqual(organizations, ["Sumo Garage Doors", "Cyber Trading University"]);
  assert.deepEqual(Array.from(context.writerOriginalPersonNames_("Joe was amazing. Frank and his team helped us.")), ["Joe", "Frank"]);
  assert.deepEqual(Array.from(context.writerOriginalPersonNames_("Their service was great. Overall, everything was smooth.")), [], "ordinary capitalized words must not be treated as people");
  assert.deepEqual(Array.from(context.writerOriginalPersonNames_("Garage Door service was excellent. Garage Door repair went smoothly.")), [], "repeated capitalized service words must not be treated as people");
  const signatureReview = "Great Service, fast and efficient.Came same day we called and helped us out.-Martin Lawrence Galleries";
  const signatureOrganizations = Array.from(context.writerOrganizationNames_(signatureReview, "Toilet Business"));
  assert.deepEqual(signatureOrganizations, ["Toilet Business", "Martin Lawrence Galleries"], "generic praise must not be mistaken for a company, while a dashed gallery signature must be detected");
  const cleanedSignature = context.writerCleanKnownIdentities_(
    "Ryan provided the organization, fast and efficient. Came same day we called and helped us out.-Martin Lawrence Galleries",
    signatureOrganizations, [], [], "Ryan"
  );
  assert.equal(cleanedSignature, "Ryan and his team provided great service, fast and efficient. Came same day we called and helped us out.");
  const result = context.rewriteText_({ text: "Joe was amazing!" }, { key: "test-key", phone: "", names: "James", requirePhone: false });
  assert.equal(result.text, "James was amazing!");
  assert.equal(calls, 1, "a known original worker name should be cleaned without wasting another API call");
}

function testConnectorRotatesNamesAlignsServicesAndVariesCtas() {
  const namesRows = [["Aiden", ""], ["Blake", ""], ["Cole", ""]];
  const properties = { FUDGE_SPREADSHEET_ID: "sheet-1" };
  const namesSheet = {
    getName: () => "Names",
    getLastRow: () => namesRows.length + 1,
    getMaxColumns: () => 2,
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () => namesRows.slice(row - 2, row - 2 + rowCount).map((source) =>
          Array.from({ length: columnCount }, (_, index) => source[column - 1 + index] || "")),
        setValues(values) {
          values.forEach((source, rowOffset) => source.forEach((value, columnOffset) => {
            namesRows[row - 2 + rowOffset][column - 1 + columnOffset] = value;
          }));
        }
      };
    }
  };
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0;
  const context = {
    Math: deterministicMath,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties[key] || "",
      setProperty: (key, value) => { properties[key] = value; }
    }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: (name) => name === "Names" ? namesSheet : null }) },
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  assert.deepEqual(Array.from(context.writerAllocateNames_(2, "")), ["Blake", "Cole"], "name selection must be shuffled instead of following sheet rows");
  assert.deepEqual(Array.from(context.writerAllocateNames_(2, "")), ["Aiden", "Blake"], "a name must not repeat until every name in the tab has been used");
  assert.equal(context.writerAlignServiceTerms_(
    "They installed holiday lights along our roofline.", "Christmas lights", ["holiday lights", "holiday lighting"]
  ), "They installed Christmas lights along our roofline.");
  const conflictRules = {
    christmas: { keyword: "Christmas Lights Installation", subcategory: "Christmas lights", rewriteServicePhrase: "Christmas lights installation", equivalentServicePhrases: ["holiday lights"], familyId: "lighting" },
    govee: { keyword: "Govee Lights Installation", subcategory: "Govee lights", rewriteServicePhrase: "Govee lights installation", equivalentServicePhrases: ["permanent lights"], familyId: "lighting" },
    toilet: { keyword: "Toilet Replacement", subcategory: "Toilet replacement", rewriteServicePhrase: "toilet replacement", equivalentServicePhrases: [], familyId: "plumbing" }
  };
  const conflicts = Array.from(context.queueServiceConflicts_(conflictRules.christmas, conflictRules, "They completed a toilet replacement."));
  assert.ok(conflicts.includes("holiday lights"), "target equivalents must be removed after conversion");
  assert.ok(conflicts.some((phrase) => phrase.toLowerCase() === "govee lights installation"), "sibling services must be treated as conflicts");
  assert.ok(conflicts.some((phrase) => phrase.toLowerCase() === "toilet replacement"), "an unrelated configured service found in the original must be removed");
  const failedService = context.writerEvaluateResponse_(
    { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ message: { content: "James handled the toilet replacement and Christmas lights installation." } }] }) },
    { settings: { phone: "", requirePhone: false }, original: "They completed a toilet replacement.", servicePhrase: "Christmas lights installation", equivalentServicePhrases: [], conflictingServicePhrases: conflicts, replacementName: "James", organizationNames: [], originalPersonNames: [], locationNames: [], requiredCta: "", organizations: [], locations: [] }
  );
  assert.equal(failedService.ok, true, "a configured conflicting service should be corrected locally without another API call");
  assert.doesNotMatch(failedService.result.text, /toilet replacement/i);
  assert.match(failedService.result.text, /Christmas lights installation/i);
  const repairedChristmasReview = context.writerRepairGrammar_(context.writerRepairMeaning_(
    "Aaron was great. Answered my request for estimate very quickly. He was very fair and work is beautiful. Highly recommend he and his team.",
    "Frank was great. Answered my request for estimate very quickly. Price was very fare and work is beautiful. Highly recommend Blinky’s Christmas Lights.",
    "Christmas lights",
    ["holiday lights", "holiday lighting"]
  ), "Aaron");
  assert.match(repairedChristmasReview, /He answered my request for an estimate/);
  assert.match(repairedChristmasReview, /The price was very fair/);
  assert.match(repairedChristmasReview, /Christmas lights look beautiful/);
  assert.match(repairedChristmasReview, /I highly recommend him and his team/);
  assert.doesNotMatch(repairedChristmasReview, /Blinky|recommend he and his team/);
  assert.equal(context.writerGrammarIssue_(repairedChristmasReview), null);
  assert.ok(context.writerGrammarIssue_("Aaron was helpful. Answered quickly. They was professional."));
  const firstCta = context.writerCta_("He repaired the door.", "(555) 987-6543", 0);
  const secondCta = context.writerCta_("He repaired the door.", "(555) 987-6543", 1);
  assert.notEqual(firstCta, secondCta);
  assert.doesNotMatch(firstCta + secondCta, /schedule|book|get started/i, "training-style contact lines must not sound like sales copy");
  assert.equal(context.writerCta_("They handled the move.", "(555) 987-6543", 0), "Their number is (555) 987-6543.");
  assert.deepEqual(Array.from(vm.runInContext("FUDGE_TABS.Names", context)), ["Name", "Last Used"]);
}

function testEmptyWriterSettingsDoNotBlockPropertySaving() {
  const values = { FUDGE_OPENAI_API_KEY: "test-key", FUDGE_WRITER_PHONE: "", FUDGE_WRITER_NAMES: "" };
  const context = { PropertiesService: { getScriptProperties: () => ({
    getProperty: (key) => values[key] || "",
    setProperty: (key, value) => { values[key] = value; },
    deleteProperty: (key) => { delete values[key]; }
  }) } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  const result = context.saveWriterSettings_({ phone: "", names: "", enabled: true });
  assert.equal(result.configured, true);
  assert.equal(values.FUDGE_WRITER_PHONE, undefined);
  assert.equal(values.FUDGE_WRITER_NAMES, undefined);
  assert.equal(values.FUDGE_WRITER_ENABLED, "true");
}

function testConnectorKeyCanBeSetFromSheetMenu() {
  const menuHandlers = [];
  const saved = {};
  const ui = {
    ButtonSet: { OK_CANCEL: "OK_CANCEL" }, Button: { OK: "OK" },
    createMenu: () => ({ addItem(_label, handler) { menuHandlers.push(handler); return this; }, addToUi() {} }),
    prompt: () => ({ getSelectedButton: () => "OK", getResponseText: () => "new-test-key" }),
    alert() {}
  };
  const context = {
    SpreadsheetApp: { getUi: () => ui },
    PropertiesService: { getScriptProperties: () => ({ setProperty: (key, value) => { saved[key] = value; } }) }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  context.onOpen();
  assert.ok(menuHandlers.includes("fudgeSetOpenAiKey"));
  // Rephrasing used to depend on someone opening the script editor and running a
  // function by hand, and a broken key or model said nothing at all. Both are now
  // reachable from the Sheet itself.
  assert.ok(menuHandlers.includes("fudgeInstallAutomation"), "the Sheet must be able to install its own automation");
  assert.ok(menuHandlers.includes("fudgeTestRephrasing"), "the Sheet must be able to test rephrasing and show the real API error");
  assert.ok(menuHandlers.includes("fudgeShowStatus"), "the Sheet must be able to report its rephrasing state");
  context.fudgeSetOpenAiKey();
  assert.equal(saved.FUDGE_OPENAI_API_KEY, "new-test-key");
}

function testSheetOnlyQueueMatching() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  const row = (service, subcategory, text, type = "With Picture", status = "Unused") => [
    "review-id", "fingerprint", service, subcategory, "Houston TX", "Business", "place-id", text,
    type, type === "With Picture" ? "https://lh3.googleusercontent.com/photo=s0" : "", "", status, "", "", "", "", ""
  ];
  const requirement = (service, mode = "photo") => ({ service, city: "Houston TX", mode });
  assert.equal(context.queueReviewMatches_({ row: row("Installation", "Furniture assembly", "They assembled an IKEA wardrobe.") }, requirement("Furniture Assembly")), true);
  assert.equal(context.queueReviewMatches_({ row: row("Junk removal", "Junk hauling", "They removed our old matress.") }, requirement("Junk Removal")), true);
  assert.equal(context.queueReviewMatches_({ row: row("Garage doors", "Spring repair", "They removed the broken spring.") }, requirement("Junk Removal")), false, "removed must remain locked to the garage family");
  assert.equal(context.queueReviewMatches_({ row: row("Garage doors", "Spring repair", "They replaced the spring.") }, requirement("Garage Door Track Repair")), false);
  assert.equal(context.queueReviewMatches_({ row: row("Garage doors", "Track & roller repair", "They realigned the tracks.") }, requirement("Garage Door Track Repair")), true);
  assert.equal(context.queueReviewMatches_({ row: row("Garage doors", "Garage door installation", "They installed a new garage door and adjusted the tracks.") }, requirement("Garage Door Track Repair")), false,
    "an installation row mentioning tracks must not fill track repair");
  assert.equal(context.queueReviewMatches_({ row: row("Garage doors", "Track & roller repair", "They installed new rollers and realigned the track.") }, requirement("Garage Door Installation")), false,
    "a track repair row using the word installed must not fill garage door installation");
  assert.equal(context.queueReviewMatches_({ row: row("Installation", "Furniture assembly", "They assembled a desk.", "Without Picture") }, requirement("Furniture Assembly", "without-picture")), true);
}

function testSheetOnlyQueueUsesManagedRules() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  const row = (text, service = "Specialty cleaning", subcategory = "Solar panel cleaning") => [
    "solar-review", "solar-fingerprint", service, subcategory, "Austin TX", "Solar Care", "solar-place", text,
    "With Picture", "https://lh3.googleusercontent.com/solar=s0", "", "Unused", "", "", "", "", ""
  ];
  const rule = {
    keyword: "Solar Panel Cleaning",
    reviewSignals: ["solar panel", "panels"],
    requiredSignals: ["clean"],
    excludeSignals: ["installation"],
    familyId: "cleaning",
    subcategory: "Solar panel cleaning"
  };
  const requirement = { service: "Solar Panel Cleaning", city: "Austin TX", mode: "photo", rule };
  assert.equal(context.queueReviewMatches_({ row: row("They cleaned all of our solar panels.") }, requirement), true);
  assert.equal(context.queueReviewMatches_({ row: row("They inspected all of our solar panels.") }, requirement), false);
  assert.equal(context.queueReviewMatches_({ row: row("They cleaned the panels during installation.") }, requirement), false);
  assert.equal(context.queueReviewMatches_({ row: row("They cleaned all of our solar panels.", "Electrical", "Solar panel cleaning") }, requirement), false, "the configured family must still isolate trades");
}

function testSheetConnectorInstallsIndependentTriggers() {
  const script = fs.readFileSync(path.join(root, "apps-script.gs"), "utf8");
  assert.match(script, /Treat service_keyword as authoritative/, "the rephrasing prompt must make the Structure service authoritative");
  assert.match(script, /convert holiday lights or Halloween lights work into Christmas lights installation/, "the prompt must explicitly convert seasonal lighting examples");
  assert.match(script, /change spring, track, cable, panel, or installation work into opener-repair wording/, "the prompt must convert a mismatched garage-door subservice");
  assert.match(script, /finished review must naturally contain service_phrase/, "the writer must explicitly include the configured target service phrase");
  assert.match(script, /Writer kept a conflicting service phrase/, "the connector must reject leftover service details after rephrasing");
  assert.doesNotMatch(script.match(/const instructions = \[[\s\S]*?\]\.join\("\\n"\)/)?.[0] || "", /Never invent or convert the service to force a match/, "the writer prompt must not contradict the requested service conversion");
  assert.match(script, /newTrigger\("fudgeProcessQueue"\)\.timeBased\(\)\.everyMinutes\(1\)/, "the connector needs a one-minute independent fallback");
  assert.match(script, /newTrigger\("fudgeRewriteOnEdit"\)\.forSpreadsheet\(ss\)\.onEdit\(\)\.create\(\)/, "Structure review edits need an authorized API trigger");
  assert.match(script, /queueTriggers\.slice\(1\).*deleteTrigger/, "reinstalling automation must remove duplicate queue triggers");
  assert.match(script, /function withAutomationLock_[\s\S]*?Number\(waitMs\) \|\| 500/, "scheduled automation must skip quickly instead of timing out behind another run");
  assert.match(script, /function fudgeRewriteOnEdit[\s\S]*?\}, 5000\)/, "a direct user edit may briefly wait for the queue instead of falling through to the one-minute retry");
  assert.match(script, /UrlFetchApp\.fetchAll/, "automatic rewrites must send each batch in parallel instead of waiting on rows one by one");
  assert.match(script, /function fudgeProcessQueue\(\)[\s\S]*?processStructureRewrites_\(\)/, "the scheduled pass must rephrase without the extension");
  assert.match(script, /function onEdit\(e\)\s*\{\s*return fudgeOnEdit\(e\)/, "Structure edits should use the permission-free simple trigger");
  assert.doesNotMatch(script.match(/function setup_\(\)[\s\S]*?\n\}/)?.[0] || "", /ensureAutomationTriggers_/, "ordinary setup must not require ScriptApp trigger permissions");
  const readAction = script.match(/case "read": \{[\s\S]*?\n      \}/)?.[0] || "";
  assert.match(readAction, /readRanges_\(request\.ranges/, "extension reads must return the current Sheet values");
  assert.doesNotMatch(readAction, /processQueue_|rephraseTouched_|withSoftLock_/, "a read must not allocate, rephrase, or wait on the queue lock");
  assert.match(script, /function fudgeProcessQueue[\s\S]{0,900}?rephraseTouched_\(result\)/, "the Sheet's own queue run must still rephrase what it filled, for sheets with no Chrome");
  // The root of the lock timeouts: both halves filling the same rows every minute.
  assert.match(script, /function fudgeProcessQueue[\s\S]{0,200}?if \(extensionIsDriving_\(\)\)/, "the Sheet must stand down from allocating while the extension is driving");
  assert.match(readAction, /readRanges_[\s\S]*?if \(request\.driving\) noteExtensionSync_\(\)/, "only a successful active read should mark the extension as driving");
  assert.match(script, /case "batchWrite": \{[\s\S]*?request\.deferRephrase[\s\S]*?rephraseTouched_\(written\)/, "writes support deferred rephrasing and preserve the synchronous fallback");
  assert.match(script, /case "processQueue": return json_\(runQueueNow_\(\)\)/, "the Sheet must expose a manual fill");
  assert.match(script, /case "rephraseNow": return json_\(rephraseEverythingNow_\(\)\)/, "the Sheet must expose a manual rephrase");
  assert.match(script, /function fudgeInstallAutomation\(\)/, "automation must also be installable directly from Apps Script");
  assert.doesNotMatch(script, /autoResizeColumn/, "Fudge must preserve user-defined Sheet column widths");
}

function testDeferredConnectorRephrasing() {
  let rephrased = 0;
  const context = { ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8").replace('"__FUDGE_SECRET__"', JSON.stringify(SECRET)), context);
  context.withLock_ = (work) => work();
  context.batchWrite_ = () => ({ ok: true, touchedRows: [2, 3], structureSheet: {} });
  context.rephraseTouched_ = (result) => { rephrased += 1; return result.touchedRows.length; };
  const request = (action, extra = {}) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ secret: SECRET, action, ...extra }) } }).text);
  const fast = request("batchWrite", { updates: [], deferRephrase: true });
  assert.deepEqual(fast.touchedRows, [2, 3]);
  assert.equal(rephrased, 0, "sync must not wait for OpenAI");
  assert.equal(request("rephraseRows", { rows: [2, 3, -1, "invalid"] }).rephrased, 2);
  assert.equal(rephrased, 1, "the independent request still rephrases the touched rows");
  assert.equal(request("batchWrite", { updates: [] }).rephrased, 2, "older clients retain synchronous rephrasing");
}

function testConnectorReadDoesNotRunQueue() {
  let queueRuns = 0;
  let activeMarks = 0;
  let failRead = false;
  const context = {
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } })
    }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(root, "apps-script.gs"), "utf8")
    .replace('"__FUDGE_SECRET__"', JSON.stringify(SECRET));
  vm.runInContext(source, context);
  context.processQueue_ = () => { queueRuns += 1; throw new Error("read must not allocate"); };
  context.readRanges_ = () => {
    if (failRead) throw new Error("read failed");
    return [[["REQ-2", "", "Roof Repair"]]];
  };
  context.noteExtensionSync_ = () => { activeMarks += 1; };
  context.automationState_ = () => ({});
  const request = { postData: { contents: JSON.stringify({ secret: SECRET, action: "read", ranges: ["Structure!A2:K"], driving: true }) } };
  const good = JSON.parse(context.doPost(request).text);
  assert.equal(good.ok, true);
  assert.equal(good.values[0][0][2], "Roof Repair");
  assert.equal(queueRuns, 0, "a read must never run the Sheet allocator");
  assert.equal(activeMarks, 1, "a completed read lets the Sheet hand allocation to the extension");
  const stoppedRequest = { postData: { contents: JSON.stringify({ secret: SECRET, action: "read", ranges: ["Structure!A2:K"], driving: false }) } };
  assert.equal(JSON.parse(context.doPost(stoppedRequest).text).ok, true);
  assert.equal(activeMarks, 1, "a manual sync while collection is stopped must leave the Sheet's own queue running");
  failRead = true;
  const failed = JSON.parse(context.doPost(request).text);
  assert.equal(failed.ok, false);
  assert.equal(activeMarks, 1, "a failed read must leave the Sheet's own queue available");
}

function testBusyAutomationSkipsWithoutLockTimeout() {
  let released = false;
  const context = {
    LockService: { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => { released = true; } }) },
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  const result = context.fudgeProcessQueue();
  assert.equal(result.skipped, true);
  assert.equal(released, false, "a lock that was not acquired must not be released");
}

function testConnectorRewritesNewReviewInSheet() {
  const rows = [];
  let apiCalls = 0;
  const properties = {
    FUDGE_SPREADSHEET_ID: "sheet-1",
    FUDGE_OPENAI_API_KEY: "test-key",
    FUDGE_WRITER_PHONE: "(555) 987-6543",
    FUDGE_WRITER_NAMES: "Felix",
    FUDGE_WRITER_ENABLED: "true"
  };
  const sheet = {
    getLastRow: () => rows.length + 1,
    getMaxColumns: () => 19,
    setRowHeights() {},
    getRange(row, column, rowCount, columnCount) {
      return {
        setWrapStrategy() { return this; },
        getDisplayValues() {
          return rows.slice(row - 2, row - 2 + rowCount).map((values) =>
            Array.from({ length: columnCount }, (_, index) => String(values[column - 1 + index] ?? "")));
        },
        setValues(values) {
          values.forEach((source, offset) => {
            const target = rows[row - 2 + offset] || (rows[row - 2 + offset] = []);
            source.forEach((value, index) => { target[column - 1 + index] = value; });
          });
        }
      };
    }
  };
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] || "", setProperties: (values) => Object.assign(properties, values) }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }), flush() {}, WrapStrategy: { CLIP: "CLIP" } },
    UrlFetchApp: { fetch: (_url, options) => {
      apiCalls += 1;
      const payload = JSON.parse(options.payload);
      const cta = payload.messages[1].content.match(/required_cta: ([^\n]+)/)[1];
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ message: { content: `Felix fixed our door. ${cta}` } }] }) };
    } },
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  const incoming = ["review-1", "fingerprint-1", "Garage doors", "Spring repair", "Dallas", "Acme Doors", "place-1", "Acme fixed our door.", "Without Picture", "", "", "Unused", "", "", "", "", ""];
  const result = context.appendRows_("Reviews", [incoming]);
  assert.equal(result.appended, 1);
  assert.equal(rows[0][7], "Acme fixed our door.", "the original review must stay intact");
  assert.equal(rows[0][17], "", "inventory Website Copy must remain empty until the user explicitly requests it");
  assert.equal(rows[0][18], "", "inventory Phone must remain empty without an explicit rewrite");
  assert.equal(apiCalls, 0, "appending inventory must spend no OpenAI credits");
}

function testStructureReviewRephrasesAfterEdits() {
  const row = ["REQ-2", "", "Door repair", "", "They fixed my door.", "", "", "", "", "", "", "(555) 987-6543", ""];
  let note = "";
  let calls = 0;
  let lastPayload = null;
  const flushedValues = [];
  const sheet = {
    getName: () => "Structure",
    getLastRow: () => 2,
    getRange(number, column, rowCount, columnCount) {
      return {
        getDisplayValues: () => [Array.from({ length: columnCount }, (_, index) => String(row[column - 1 + index] ?? ""))],
        getNotes: () => [[note]],
        getNote: () => note,
        setNote(value) { note = value; return this; },
        clearNote() { note = ""; return this; },
        clearContent() { row[column - 1] = ""; return this; },
        setValue(value) { row[column - 1] = value; return this; }
      };
    }
  };
  const properties = { FUDGE_OPENAI_API_KEY: "test-key" };
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] || "" }) },
    SpreadsheetApp: { flush() { flushedValues.push(row[12]); } },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    UrlFetchApp: { fetch: (_url, options) => {
      calls += 1;
      const payload = JSON.parse(options.payload);
      lastPayload = payload;
      const hasPhone = payload.messages[1].content.includes("phone: (555) 987-6543");
      const replacementName = payload.messages[1].content.match(/replacement_name: ([^\n]+)/)[1];
      const requiredCta = payload.messages[1].content.match(/required_cta: ([^\n]+)/)[1];
      const servicePhrase = payload.messages[1].content.match(/service_phrase: ([^\n]+)/)[1];
      const copy = hasPhone ? `${replacementName} handled the ${servicePhrase.toLowerCase()}. Version ${calls}. ${requiredCta}` : `${replacementName} handled the ${servicePhrase.toLowerCase()}. Version ${calls}.`;
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ message: { content: copy } }] }) };
    } },
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  assert.equal(context.writerPhone_("Call me at +92 300 1234567.", "+92 300 1234567"), "+92 300 1234567");
  const edit = (column) => ({ range: { getSheet: () => sheet, getRow: () => 2, getLastRow: () => 2, getColumn: () => column, getLastColumn: () => column, getNumRows: () => 1 } });
  context.fudgeRewriteOnEdit(edit(5));
  assert.equal(flushedValues[0], "Rephrasing...", "the Sheet must show progress before waiting for the writer");
  assert.match(row[12], /555\) 987-6543/);
  assert.equal(lastPayload.temperature, 0, "minimal rewrites should be deterministic");
  assert.equal(lastPayload.model, "gpt-5.6-luna", "automatic rephrasing should use the current efficient rewrite model");
  assert.equal(lastPayload.reasoning_effort, "none", "simple rewrites should not spend tokens on hidden reasoning");
  assert.match(lastPayload.messages[0].content, /smallest possible edit/i);
  assert.match(lastPayload.messages[0].content, /Do not polish, enhance, advertise, summarize, expand/);
  assert.match(lastPayload.messages[0].content, /proofread it strictly/i);
  assert.match(lastPayload.messages[0].content, /Every sentence must be complete and natural/i);
  assert.match(lastPayload.messages[0].content, /subject-verb disagreement/i);
  assert.equal(row[4], "They fixed my door.");
  assert.ok(note, "the source values must be recorded so changes are detected");
  context.fudgeRewriteOnEdit(edit(5));
  assert.equal(calls, 1, "an unchanged review must not incur another API call");
  row[2] = "Door installation";
  context.fudgeRewriteOnEdit(edit(3));
  assert.match(row[12], /Version 2/, "changing only Service Keyword must refresh Rephrased Content");
  row[4] = "They painted my room.";
  context.fudgeRewriteOnEdit(edit(5));
  assert.match(row[12], /Version 3/);
  row[11] = "";
  context.fudgeRewriteOnEdit(edit(12));
  assert.match(row[12], /Version 4/);
  assert.doesNotMatch(row[12], /555/);
  row[4] = "";
  context.fudgeRewriteOnEdit(edit(5));
  assert.equal(row[12], "", "clearing the review must clear its old rephrasing");
}

function testStructureFailureKeepsCopyAndBacksOff() {
  const row = ["REQ-FAIL", "", "Door repair", "", "They fixed my door.", "", "", "", "", "", "", "", "Existing safe rewrite."];
  let note = "old-inputs";
  let calls = 0;
  const properties = { FUDGE_OPENAI_API_KEY: "bad-test-key" };
  const propertyStore = {
    getProperty: (key) => properties[key] || "",
    setProperty: (key, value) => { properties[key] = value; },
    setProperties: (values) => Object.assign(properties, values)
  };
  const sheet = {
    getName: () => "Structure",
    getLastRow: () => 2,
    getRange(_number, column, _rowCount, columnCount) {
      return {
        getDisplayValues: () => [Array.from({ length: columnCount }, (_, index) => String(row[column - 1 + index] ?? ""))],
        getNotes: () => [[note]],
        setNote(value) { note = value; return this; },
        clearNote() { note = ""; return this; },
        clearContent() { row[column - 1] = ""; return this; },
        setValue(value) { row[column - 1] = value; return this; }
      };
    }
  };
  const context = {
    PropertiesService: { getScriptProperties: () => propertyStore },
    SpreadsheetApp: { flush() {} },
    UrlFetchApp: { fetch: () => {
      calls += 1;
      return { getResponseCode: () => 401, getContentText: () => "{}" };
    } },
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  context.processStructureRewrites_(sheet, 2, 1, 6);
  assert.equal(row[12], "Existing safe rewrite.", "an API error must restore the prior visible rewrite");
  // A locally repaired draft is not a rephrase. Recording these as successes — and
  // stamping the done note on them — is what made a wrong key, model or quota look
  // identical to "Fudge chose not to rephrase this row": no retry, no message, and
  // no way to tell the two apart.
  assert.match(note, /^FUDGE_REWRITE_FAILURE:/, "a failed rephrase must be recorded as a failure, not as finished work");
  assert.equal(properties.FUDGE_LAST_WRITER_ERROR.includes("401"), true, "the real API status must be kept for the extension to show");
  assert.equal(calls, 1, "a permanent authorization error must not be sent twice");
  context.processStructureRewrites_(sheet, 2, 1, 6);
  assert.equal(calls, 1, "a permanent failure must not spend credits repeatedly");
  row[4] = "They repaired my door.";
  context.processStructureRewrites_(sheet, 2, 1, 6);
  assert.equal(calls, 2, "editing the review must unlock a failed row immediately");
}

function testStructureBatchLimitNeverClearsWaitingRows() {
  const rows = [
    ["REQ-1", "", "Door repair", "", "They did the work.", "", "", "", "", "", "", "", ""],
    ["REQ-2", "", "Door repair", "", "They repaired the door.", "", "", "", "", "", "", "", "Existing second rewrite."]
  ];
  const notes = ["", "old-inputs"];
  const properties = { FUDGE_OPENAI_API_KEY: "test-key" };
  const propertyStore = {
    getProperty: (key) => properties[key] || "",
    setProperty: (key, value) => { properties[key] = value; },
    setProperties: (values) => Object.assign(properties, values)
  };
  const sheet = {
    getName: () => "Structure",
    getLastRow: () => 3,
    getRange(number, column, rowCount, columnCount) {
      return {
        getDisplayValues: () => rows.slice(number - 2, number - 2 + rowCount).map((row) =>
          Array.from({ length: columnCount }, (_, index) => String(row[column - 1 + index] ?? ""))),
        getNotes: () => notes.slice(number - 2, number - 2 + rowCount).map((value) => [value]),
        setNote(value) { notes[number - 2] = value; return this; },
        clearNote() { notes[number - 2] = ""; return this; },
        clearContent() { rows[number - 2][column - 1] = ""; return this; },
        setValue(value) { rows[number - 2][column - 1] = value; return this; }
      };
    }
  };
  const context = {
    PropertiesService: { getScriptProperties: () => propertyStore },
    SpreadsheetApp: { flush() {} },
    UrlFetchApp: { fetchAll: (requests) => requests.map((request) => {
      const payload = JSON.parse(request.payload);
      const name = payload.messages[1].content.match(/replacement_name: ([^\n]+)/)[1];
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ message: { content: `${name} did the work.` } }] }) };
    }) },
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  context.processStructureRewrites_(sheet, 2, 2, 1);
  assert.equal(rows[1][12], "Existing second rewrite.", "rows waiting behind the batch limit must keep their visible content");
}

function testSheetOnlyQueueFillsAndReplaces() {
  const structureRows = [
    ["REQ-2", "With Picture", "Furniture Assembly", "Houston TX", "", "", "", "", "", "", ""],
    ["REQ-3", "With Picture", "Furniture Assembly", "Houston TX", "Old review", "old-link", "Change it", "Filled", "old-review", "Old Business", ""],
    ["REQ-4", "With Picture", "Roof Repair", "Houston TX", "", "", "", "Waiting for reviews", "", "", ""]
  ];
  const reviewsRows = [
    ["new-one", "fp-one", "Installation", "Furniture assembly", "Houston TX", "New Business One", "place-one", "They assembled our IKEA wardrobe.", "With Picture", "original-one", "drive-one", "Unused", "", "", "", "", ""],
    ["old-review", "fp-old", "Installation", "Furniture assembly", "Houston TX", "Old Business", "place-old", "Old review", "With Picture", "old-link", "", "Used", "old-date", "REQ-3", "", "", ""],
    ["new-two", "fp-two", "Installation", "Furniture assembly", "Houston TX", "New Business Two", "place-two", "They assembled our dresser and shelves.", "With Picture", "original-two-a\noriginal-two-b", "", "Unused", "", "", "", "", ""]
  ];
  const makeSheet = (name, rows) => ({
    name,
    rows,
    heightCalls: [],
    wrapCalls: [],
    writes: [],
    getName() { return name; },
    getLastRow() { return rows.length + 1; },
    getMaxColumns() { return 17; },
    setRowHeights(startRow, rowCount, height) { this.heightCalls.push({ startRow, rowCount, height }); },
    getRange(row, column, rowCount, columnCount) {
      const sheet = this;
      return {
        setWrapStrategy(strategy) { sheet.wrapCalls.push({ row, column, rowCount, strategy }); return this; },
        getDisplayValues() {
          return rows.slice(row - 2, row - 2 + rowCount).map((source) => Array.from({ length: columnCount }, (_, index) => String(source[column - 1 + index] ?? "")));
        },
        setValues(values) {
          sheet.writes.push({ row, column });
          values.forEach((source, rowOffset) => {
            const target = rows[row - 2 + rowOffset];
            source.forEach((value, columnOffset) => { target[column - 1 + columnOffset] = value; });
          });
        }
      };
    }
  });
  const sheets = { Structure: makeSheet("Structure", structureRows), Reviews: makeSheet("Reviews", reviewsRows) };
  const spreadsheet = { getSheetByName: (name) => sheets[name] || null };
  const lock = { waitLock() {}, releaseLock() {} };
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => key === "FUDGE_SPREADSHEET_ID" ? "sheet-1" : "" }) },
    SpreadsheetApp: { openById: () => spreadsheet, flush() {}, WrapStrategy: { CLIP: "CLIP", WRAP: "WRAP", OVERFLOW: "OVERFLOW" } },
    LockService: { getScriptLock: () => lock }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  const result = context.fudgeProcessQueue();
  assert.equal(result.filled, 2);
  assert.equal(result.replaced, 1);
  assert.equal(structureRows[0][8], "new-one");
  assert.equal(structureRows[0][5], "drive-one", "Drive links should be preferred when available");
  assert.equal(structureRows[1][8], "new-two");
  assert.equal(structureRows[1][5], "original-two-a\noriginal-two-b", "multiple pictures stay in one cell on separate lines");
  assert.equal(structureRows[1][6], "QC needed");
  assert.equal(reviewsRows[0][11], "Used");
  assert.equal(reviewsRows[1][11], "Rejected");
  assert.equal(reviewsRows[2][11], "Used");
  const waitingWrites = sheets.Structure.writes.filter((write) => write.row === 4).length;
  context.fudgeProcessQueue();
  assert.equal(sheets.Structure.writes.filter((write) => write.row === 4).length, waitingWrites,
    "a row already waiting for reviews must not be rewritten on every queue pass");
  assert.ok(sheets.Structure.heightCalls.length > 0 && sheets.Structure.heightCalls.every((call) => call.height === 21), "Structure data rows must remain 21 px");
  assert.ok(sheets.Reviews.heightCalls.length > 0 && sheets.Reviews.heightCalls.every((call) => call.height === 21), "Reviews data rows must remain 21 px");
  // Pinning the height alone let a wrapped multi-line picture list grow the row
  // straight back as soon as the data landed in it.
  assert.ok(sheets.Structure.wrapCalls.some((call) => call.strategy === "CLIP"), "written Structure rows must be clipped so the data cannot resize them");
  assert.ok(sheets.Structure.wrapCalls.some((call) => call.column === 13 && call.strategy === "OVERFLOW"), "Rephrased Content must remain visible without expanding the row");
  assert.ok(sheets.Reviews.wrapCalls.length > 0 && sheets.Reviews.wrapCalls.every((call) => call.strategy === "CLIP"), "written Reviews rows must be clipped so the data cannot resize them");
  const gs = fs.readFileSync(path.join(root, "apps-script.gs"), "utf8");
  assert.ok(!/setWrap\(true\)/.test(gs), "no Fudge column may be left wrapping, or its rows grow with the data");
  assert.ok(!/setColumnWidth|autoResizeColumn/.test(gs), "Fudge must never change a column's size");
}

// Each of these verified leaks used to match because an ambiguous single word
// (paint, ceiling, light, pressure, mount, hung, cabinet, vanity, window, range)
// was accepted as a strong review signal when it only belongs as a weak one that
// also needs a context word from the same trade.
function testKeywordDoesNotClaimOtherTradeReviews() {
  const Fudge = loadShared();
  const matches = (keyword, text, extra = {}) =>
    Fudge.matchesServiceKeyword({ text, service: Fudge.classify(text), ...extra }, keyword);

  // What the assigned subsection can settle: it names a different trade, so one
  // shared word does not hand the review over.
  assert.equal(matches("Junk Removal", "The plumber removed the old toilet and fitted a new one."), false,
    "junk removal must not claim a plumbing review that merely says 'removed'");
  assert.equal(matches("Holiday Lighting", "The electrician installed a new light fixture in the hallway."), false,
    "holiday lighting must not claim an electrical review mentioning only 'light fixture'");
  assert.equal(matches("Painting Repair", "They painted over the patch after the drywall repair."), false,
    "painting must not claim a drywall review that mentions painting only as a finishing touch");

  // What it cannot settle, and why. The subsection is worked out from the same
  // words the keyword matched on, so when that word misled the classifier the
  // subsection repeats the mistake and has nothing independent to say. These are
  // left to the fill order instead: each lands in a catch-all or in the keyword's
  // own family, and catch-alls are used only when nothing better is left.
  const unresolved = [
    ["Pressure Washing", "The water pressure is perfect now after they fixed the pipe."],
    ["Furniture Assembly", "The plumber replaced the vanity and the cabinet under the sink."],
    ["Window Cleaning", "They replaced the window seal on our patio door."],
    ["Appliance Repair", "They offer a great range of services and fixed our door."],
    ["TV Mounting", "They mounted the shelf and the coat rack on the wall."],
    ["Picture Frame Hanging", "They hung the TV bracket and tidied the cables."]
  ];
  for (const [keyword, text] of unresolved) {
    const actual = Fudge.classify(text);
    const target = Fudge.classify(keyword);
    assert.ok(
      Fudge.isCatchAllClassification(actual) || actual.id === target.id,
      `${keyword}: this leak is only tolerable while the review is a catch-all or in the same family, but it classified as ${actual.id}/${actual.subcategory.id}`
    );
  }

  // ---- Recall checks: the genuine reviews must still match -------------------
  assert.equal(matches("Junk Removal", "They hauled everything away."), true,
    "a genuine junk removal review must still match");
  assert.equal(matches("Holiday Lighting", "The holiday lights looked amazing and the crew was professional."), true,
    "a genuine holiday-lighting review must still match");
  assert.equal(matches("Pressure Washing", "The pressure cleaning transformed the patio."), true,
    "a genuine pressure washing review must still match");
  assert.equal(matches("Appliance Repair", "They fixed our oven and the burners heat evenly now."), true,
    "a genuine appliance review mentioning the oven must still match");
  assert.equal(matches("TV Mounting", "They mounted our television."), true,
    "a genuine tv-mounting review must still match");
  assert.equal(matches("Picture Frame Hanging", "Every frame is perfectly level."), true,
    "a genuine picture-hanging review must still match");
  assert.equal(matches("Furniture Assembly", "The wardrobe was assembled perfectly."), true,
    "a genuine furniture assembly review must still match");
  assert.equal(matches("Drywall Patch Repair", "They repaired the ceiling after a water leak."), true,
    "a genuine drywall review must still match");
  assert.equal(matches("Window Cleaning", "Our windows are spotless."), true,
    "a genuine window-cleaning review must still match");
  assert.equal(matches("Painting Repair", "Excellent painters and clean work."), true,
    "a genuine painting review must still match");
}

// A review Fudge could only file under "General repairs", "Home maintenance" or a
// family's own "General ..." subsection says the least about what the job was. It
// is kept, but it must be the last thing used to fill a row.
function testCatchAllReviewsFillLast() {
  const Fudge = loadShared();
  const flag = (text) => Fudge.isCatchAllClassification(Fudge.classify(text));
  assert.equal(flag("They did a great job, very professional."), true, "an unclassifiable review is a catch-all");
  assert.equal(flag("Handyman sorted our odd jobs list."), true, "handyman work is a catch-all");
  assert.equal(flag("Routine home maintenance, all done well."), true, "home maintenance is a catch-all");
  assert.equal(flag("Painted the hallway and moved the furniture back when they finished."), true,
    "a review that only reached a family's general subsection is a catch-all");
  assert.equal(flag("Great movers, careful with everything from start to finish."), false,
    "a definite subsection is never a catch-all");
  assert.equal(flag("They repaired the ceiling after a water leak."), false,
    "a definite subsection is never a catch-all");

  // Both fill paths order their pool by it, and rows are filled from the first
  // match, so a catch-all is reached only once nothing better is left.
  const sheets = fs.readFileSync(path.join(root, "sheets.js"), "utf8");
  assert.match(sheets, /\.sort\(\(a, b\) => Number\(Fudge\.isCatchAllClassification\(a\.classifiedService\)\) - Number\(Fudge\.isCatchAllClassification\(b\.classifiedService\)\)\)/,
    "the extension must fill from the pool with catch-alls last");
  const gs = fs.readFileSync(path.join(root, "apps-script.gs"), "utf8");
  assert.match(gs, /function queueIsCatchAll_/, "the Sheet-only queue needs the same rule");
  assert.match(gs, /\.sort\(function \(a, b\) \{ return Number\(queueIsCatchAll_\(a\)\) - Number\(queueIsCatchAll_\(b\)\); \}\)/,
    "the Sheet-only queue must fill with catch-alls last");
}

// A background service worker with just enough Chrome around it to drive the run
// switch and the scanning slots.
function backgroundContext(store, { queued = [], tabs = [], sync = null, onSendMessage = null } = {}) {
  let nextTabId = 500;
  const context = {
    importScripts() {},
    console,
    URL,
    crypto: webcrypto,
    TextEncoder,
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 1)),
    clearTimeout,
    Fudge: { normalize: (value = "") => String(value).toLowerCase() },
    SheetsService: {
      sync: sync || (async () => ({ ok: true, nextJobs: queued, nextJob: queued[0] || null })),
      recordProgress: async () => {},
      recordBusiness: async () => {},
      ensureAutomation: async () => ({ ok: true, automation: {} })
    },
    chrome: {
      storage: { local: store.local },
      runtime: {
        lastError: null,
        getURL: (file) => file,
        onMessage: { addListener(fn) { context.__message = fn; } },
        onInstalled: { addListener() {} },
        onStartup: { addListener(fn) { context.__startup = fn; } }
      },
      alarms: { get: async () => ({ name: "fudge-sheets-sync" }), create: async () => {}, onAlarm: { addListener(fn) { context.__alarm = fn; } } },
      notifications: { create: async () => {} },
      sidePanel: { setPanelBehavior: async () => {} },
      tabs: {
        create: async ({ url, active }) => {
          const tab = { id: nextTabId += 1, url, active, status: "complete" };
          tabs.push(tab);
          return tab;
        },
        get: async (tabId) => tabs.find((tab) => tab.id === tabId) || null,
        remove: async (tabId) => { const index = tabs.findIndex((tab) => tab.id === tabId); if (index >= 0) tabs.splice(index, 1); },
        onRemoved: { addListener(fn) { context.__tabRemoved = fn; } },
        sendMessage: async (tabId, message) => {
          if (onSendMessage) {
            const custom = await onSendMessage(tabId, message);
            if (custom !== undefined) return custom;
          }
          if (message.type === "FUDGE_PING") return { ok: true, running: false };
          const job = { id: `job-${tabId}`, status: "running", auto: true, searchKey: message.options.searchKey, serviceKeyword: message.options.serviceKeyword, tabId, updatedAt: new Date().toISOString() };
          const { scanJobs } = await store.local.get({ scanJobs: {} });
          await store.local.set({ scanJobs: { ...scanJobs, [job.id]: job }, scanJob: job });
          return { ok: true, job };
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), context);
  return context;
}

const askBackground = (context, message, sender = {}) =>
  new Promise((resolve) => { context.__message(message, sender, resolve); });

// The side panel once said "No source" while its switch was On. A page probe
// that started before Start could also finish afterward and overwrite the card.
async function testCollectingCardIgnoresPageDetection() {
  const source = fs.readFileSync(path.join(root, "sidepanel.js"), "utf8");
  const jobStart = source.indexOf("function renderJob(job) {");
  const pageStart = source.indexOf("async function detectPage() {");
  const jobCode = source.slice(jobStart, source.indexOf("\n/* The status line", jobStart));
  const pageCode = source.slice(pageStart, source.indexOf("\n// Rephrasing happens", pageStart));
  assert.ok(jobStart > 0 && pageStart > 0);
  let pageQueries = 0;
  const states = [];
  const context = { runState: "running", setState: (...args) => states.push(args), sheetsReady: async () => true,
    chrome: { tabs: { query: async () => { pageQueries += 1; return []; } } } };
  vm.createContext(context);
  vm.runInContext(`${jobCode}\n${pageCode}`, context);
  vm.runInContext("renderJob(null)", context);
  await vm.runInContext("detectPage()", context);
  assert.equal(pageQueries, 0, "an active Sheet collector has no reason to inspect the selected tab");
  assert.equal(states.length, 0, "page detection must not replace the collector card");

  let releasePage;
  context.runState = "stopped";
  context.chrome.tabs.query = () => new Promise((resolve) => { releasePage = resolve; });
  const pending = vm.runInContext("detectPage()", context);
  context.runState = "running";
  releasePage([{ url: "https://example.com/" }]);
  await pending;
  assert.equal(states.length, 0, "a probe started before collecting cannot overwrite the card after Start");
}

// Two records left behind by a closed Chrome used to occupy both scanning slots
// for good: the pruner skipped anything marked "running", and the only code that
// could release them sat behind the very slot check they were blocking. Fudge then
// never scanned again, on any keyword, and said "no Structure rows are waiting".
async function testStaleRunningJobsReleaseTheirSlot() {
  const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const store = storage({
    runState: "running",
    scanJobs: {
      "dead-1": { id: "dead-1", status: "running", auto: true, tabId: 11, searchKey: "a|x|photo", updatedAt: old, leaseUntil: old },
      "dead-2": { id: "dead-2", status: "running", auto: true, tabId: 12, searchKey: "b|x|photo", updatedAt: old, leaseUntil: old }
    }
  });
  const tabs = [];
  const queued = [{ auto: true, searchKey: "toilet replacement|leeds|photo", serviceKeyword: "toilet replacement", city: "Leeds", query: "toilet replacement Leeds", reviewMode: "photo", currentPage: 1, businessIndex: 0, visitedPlaceIds: [] }];
  const context = backgroundContext(store, { queued, tabs });

  const result = await context.runSheetsAutomation({ force: true });
  assert.equal(result.startedJob, true, "a dead runner must never keep a slot");
  assert.equal(tabs.length, 1, "the waiting keyword must get its tab");
  const { scanJobs } = await store.local.get({ scanJobs: {} });
  assert.equal(scanJobs["dead-1"].status, "interrupted");
  assert.equal(scanJobs["dead-2"].status, "interrupted");
}

// Closing the runner tab by hand is the other way a job used to get stuck.
async function testClosingTheRunnerTabEndsItsJob() {
  const store = storage({ runState: "running", scanJobs: { live: { id: "live", status: "running", auto: true, tabId: 77, updatedAt: new Date().toISOString() } } });
  const context = backgroundContext(store, { tabs: [{ id: 77, url: "https://www.google.com/search?q=x&udm=local", status: "complete" }] });
  await context.__tabRemoved(77);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const { scanJobs } = await store.local.get({ scanJobs: {} });
  assert.equal(scanJobs.live.status, "interrupted", "a closed tab must end its job");
}

async function testConcurrentJobUpdatesAndLateHeartbeat() {
  const store = storage({ runState: "running", scanJobs: {
    a: { id: "a", tabId: 1, status: "running" },
    b: { id: "b", tabId: 2, status: "running" }
  } });
  const context = backgroundContext(store);
  await Promise.all([
    context.updateScanJob({ id: "a", businessIndex: 3 }),
    context.updateScanJob({ id: "b", businessIndex: 7 })
  ]);
  assert.equal(store.data.scanJobs.a.businessIndex, 3);
  assert.equal(store.data.scanJobs.b.businessIndex, 7);
  await context.updateScanJob({ id: "a", status: "stopped" });
  await context.updateScanJob({ id: "a", businessIndex: 4 });
  assert.equal(store.data.scanJobs.a.status, "stopped", "late runner messages must not revive stopped work");
  assert.equal(store.data.scanJobs.a.businessIndex, 3);
}

async function testNewReviewsTriggerCoalescedSync() {
  const store = storage({ runState: "running", scanJobs: { a: { id: "a", tabId: 1, status: "running", auto: true } } });
  let syncs = 0;
  const context = backgroundContext(store, { sync: async () => { syncs += 1; return { ok: true, nextJobs: [] }; } });
  await Promise.all([1, 2, 3].map(() => askBackground(context, { type: "SCAN_JOB_UPDATE", patch: { id: "a", businessCompleted: true, businessEligible: 1 } })));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(syncs, 1, "new reviews should trigger one coalesced sync rather than wait for the alarm");
}

// A tab is opened before the runner inside it can report for duty. A worker evicted
// in that gap left the tab on screen with nothing driving it, and the next pass
// opened another one beside it.
async function testOrphanRunnerTabsAreClosed() {
  const tabs = [{ id: 31, url: "https://www.google.com/search?q=old&udm=local", status: "complete" }];
  const store = storage({ runState: "running", pendingRunnerTabs: [31], scanJobs: {} });
  const context = backgroundContext(store, { queued: [], tabs });
  await context.runSheetsAutomation({ force: true });
  assert.deepEqual(tabs.map((tab) => tab.id), [], "a tab no job ever claimed must be closed");
  assert.deepEqual((await store.local.get({ pendingRunnerTabs: [] })).pendingRunnerTabs, []);

  // A tab a runner did claim is left alone.
  const livePage = { id: 32, url: "https://www.google.com/search?q=live&udm=local", status: "complete" };
  const busy = storage({ runState: "running", pendingRunnerTabs: [32], scanJobs: { live: { id: "live", status: "running", auto: true, tabId: 32, updatedAt: new Date().toISOString() } } });
  const second = backgroundContext(busy, { queued: [], tabs: [livePage] });
  await second.runSheetsAutomation({ force: true });
  assert.deepEqual((await busy.local.get({ pendingRunnerTabs: [] })).pendingRunnerTabs, [32], "a claimed tab stays open");

  // A tab created by Start can still be loading while the clock begins a pass.
  // It must not be mistaken for an orphan and closed under the user's cursor.
  const openingTab = { id: 33, url: "https://www.google.com/search?q=opening&udm=local", status: "loading" };
  const opening = storage({ runState: "running", pendingRunnerTabs: [33], pendingRunnerStartedAt: { 33: Date.now() } });
  const third = backgroundContext(opening, { queued: [], tabs: [openingTab] });
  await third.runSheetsAutomation({ force: true });
  assert.equal(openingTab.id, 33);
  assert.deepEqual((await opening.local.get({ pendingRunnerTabs: [] })).pendingRunnerTabs, [33], "a fresh handoff keeps its pending tab");
  await opening.local.set({ pendingRunnerStartedAt: { 33: Date.now() - 90_000 } });
  await third.runSheetsAutomation({ force: true });
  assert.deepEqual((await opening.local.get({ pendingRunnerTabs: [] })).pendingRunnerTabs, [], "an abandoned handoff is eventually closed");
}

// Stop has to mean stopped. Tying it to the mirrored job left automation switched
// on, and the one-minute alarm reopened tabs a minute later.
async function testStopIsUnconditional() {
  const store = storage({ runState: "running", scanJob: { id: "manual", status: "complete", auto: false } });
  const context = backgroundContext(store, { tabs: [] });
  const result = await askBackground(context, { type: "STOP_SCAN_JOB" });
  assert.equal(result.ok, true);
  assert.equal((await store.local.get({ runState: "" })).runState, "stopped", "Stop must switch collecting off even with nothing running");
  // And a later alarm must not undo that.
  let synced = 0;
  const quiet = backgroundContext(store, { sync: async () => { synced += 1; return { ok: true, nextJobs: [] }; } });
  await quiet.__alarm({ name: "fudge-sheets-sync" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(synced, 0, "a stopped Fudge must not sync or open anything on its alarm");
}

async function testCompletedKeywordStillUploadsPictures() {
  const store = storage({ runState: "running", saveToDrive: true });
  const context = backgroundContext(store, { queued: [] });
  let uploads = 0;
  context.Fudge.getReviews = async () => [{ id: "saved", photos: ["https://lh3.googleusercontent.com/saved=s0"], drivePhotos: [] }];
  context.SheetsService.saveReviews = async () => { uploads += 1; return { uploaded: 1 }; };
  await context.runSheetsAutomation({ force: true });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(uploads, 1, "Drive catch-up must run even when the completed keyword has no next Google job");
}

async function testTabControlAppliesWhileRunning() {
  const store = storage({ runState: "running", parallelTabs: 1, scanPageLimit: "2" });
  const queued = ["Roof Repair", "Junk Removal", "Dryer Repair", "Moving Service"].map((keyword, index) => ({
    auto: true, searchKey: `job-${index}`, serviceKeyword: keyword, city: "Leeds", query: `${keyword} Leeds`, reviewMode: "photo", currentPage: 1, businessIndex: 0, visitedPlaceIds: []
  }));
  const tabs = [];
  const pageLimits = [];
  const context = backgroundContext(store, {
    queued, tabs,
    onSendMessage: async (_tabId, message) => {
      if (message.type === "FUDGE_START_SCAN") pageLimits.push(message.options.pageLimit);
    }
  });
  await context.runSheetsAutomation({ force: true });
  assert.equal(tabs.length, 1, "the saved limit of one must be honored");
  assert.deepEqual(pageLimits, [2], "alarm-driven jobs must use the saved page limit");
  const increased = await askBackground(context, { type: "SET_PARALLEL_TABS", count: 3 });
  assert.equal(increased.parallelTabs, 3);
  for (let attempt = 0; attempt < 30 && tabs.length < 3; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(tabs.length, 3, "raising the limit should fill free slots immediately");
  const decreased = await askBackground(context, { type: "SET_PARALLEL_TABS", count: 1 });
  assert.equal(decreased.parallelTabs, 1);
  await context.runSheetsAutomation({ force: true });
  assert.equal(tabs.length, 3, "lowering the limit preserves in-progress scans and blocks new ones");
  assert.equal((await askBackground(context, { type: "SET_PARALLEL_TABS", count: 0 })).ok, false);
  assert.equal(store.data.parallelTabs, 1, "invalid limits must not alter the saved setting");
}

async function testSheetAlarmUsesThirtySecondCadence() {
  const context = backgroundContext(storage());
  await new Promise((resolve) => setTimeout(resolve, 5)); // Let the worker's startup check finish.
  const created = [];
  context.chrome.alarms.get = async () => ({ name: "fudge-sheets-sync", periodInMinutes: 1 });
  context.chrome.alarms.create = async (name, settings) => { created.push({ name, settings }); };
  await context.ensureSheetsAlarm();
  assert.equal(created.length, 1, "an older one-minute alarm must be replaced after updating");
  assert.equal(created[0].settings.periodInMinutes, 0.5);
  context.chrome.alarms.get = async () => ({ name: "fudge-sheets-sync", periodInMinutes: 0.5 });
  await context.ensureSheetsAlarm();
  assert.equal(created.length, 1, "an already-current alarm must not be reset");
}

async function testGoogleCooldownCountsEpisodesAndResets() {
  const store = storage();
  const context = backgroundContext(store);
  const [first, sameEpisode] = await Promise.all([context.noteGoogleBlock(), context.noteGoogleBlock()]);
  assert.equal(first, sameEpisode, "two blocked tabs in one episode share one cooldown");
  assert.equal(store.data.googleBlockStrikes, 1);
  assert.ok(Math.abs(Date.parse(first) - Date.now() - 15 * 60_000) < 5000);
  await context.noteCleanGoogleRun({ startedAt: new Date(Date.now() - 60_000).toISOString() });
  assert.equal(store.data.googleBlockStrikes, 1, "a sibling already scanning cannot cancel the pause");
  await store.local.set({ blockedUntil: new Date(Date.now() - 1000).toISOString() });
  const second = await context.noteGoogleBlock();
  assert.equal(store.data.googleBlockStrikes, 2);
  assert.ok(Math.abs(Date.parse(second) - Date.now() - 30 * 60_000) < 5000);
  await store.local.set({ blockedUntil: new Date(Date.now() - 1000).toISOString() });
  await context.noteCleanGoogleRun({ startedAt: new Date().toISOString() });
  assert.equal(store.data.googleBlockStrikes, 0, "a successful retry resets the ladder");
  assert.equal(store.data.blockedUntil, "");
  const restarted = await context.noteGoogleBlock();
  assert.ok(Math.abs(Date.parse(restarted) - Date.now() - 15 * 60_000) < 5000,
    "a later independent block begins at fifteen minutes again");
}

async function testSyncNowStartsNewWorkOnlyWhenOn() {
  const spec = { auto: true, searchKey: "roof|leeds|photo", serviceKeyword: "Roof Repair", city: "Leeds", query: "roof repair Leeds", reviewMode: "photo", currentPage: 1, businessIndex: 0, visitedPlaceIds: [] };
  for (const [runState, expected] of [["running", 1], ["stopped", 0]]) {
    const store = storage({ runState });
    const tabs = [];
    const context = backgroundContext(store, { queued: [spec], tabs });
    const result = await askBackground(context, { type: "RUN_SHEETS_SYNC" });
    assert.equal(result.ok, true);
    assert.equal(result.queued, true, "Sync now acknowledges before the work finishes");
    for (let attempt = 0; attempt < 30 && tabs.length < expected; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(tabs.length, expected, "Sync now should start Google only while collection is on");
  }
}

async function testStopDuringTabLoadDoesNotStartScan() {
  const store = storage({ runState: "running" });
  const tabs = [];
  const spec = { auto: true, searchKey: "roof|leeds|photo", serviceKeyword: "Roof Repair", city: "Leeds", query: "roof repair Leeds", reviewMode: "photo", currentPage: 1, businessIndex: 0, visitedPlaceIds: [] };
  let starts = 0;
  const context = backgroundContext(store, {
    queued: [spec], tabs,
    onSendMessage: async (_tabId, message) => {
      if (message.type === "FUDGE_PING") {
        await store.local.set({ runState: "stopped" });
        return { ok: true };
      }
      if (message.type === "FUDGE_START_SCAN") starts += 1;
    }
  });
  await context.runSheetsAutomation({ force: true });
  assert.equal(starts, 0, "a stopped collector must not hand a newly loaded tab a scan");
  assert.equal(tabs.length, 0, "the unused runner tab should close");
}

async function testAutomaticUploadFollowsSwitch() {
  const spec = { auto: true, searchKey: "roof|leeds|photo", serviceKeyword: "Roof Repair", city: "Leeds", query: "roof repair Leeds", reviewMode: "photo", currentPage: 1, businessIndex: 0, visitedPlaceIds: [] };
  for (const enabled of [false, true]) {
    const store = storage({ runState: "running", saveToDrive: enabled });
    let sentSetting;
    const context = backgroundContext(store, {
      queued: [spec],
      onSendMessage: async (_tabId, message) => {
        if (message.type === "FUDGE_START_SCAN") sentSetting = message.options.saveToDrive;
      }
    });
    context.Fudge.getReviews = async () => [];
    await context.runSheetsAutomation({ force: true });
    assert.equal(sentSetting, enabled, "automatic scans must honor Upload originals");
  }
}

// The old guards answered "already running" to a button press, which the Start
// handler then reported as "no Structure rows are waiting for reviews right now".
async function testManualStartIsNeverDropped() {
  const store = storage({ runState: "running" });
  let syncs = 0;
  const context = backgroundContext(store, {
    sync: async () => { syncs += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { ok: true, nextJobs: [] }; }
  });
  const scheduled = context.runSheetsAutomation({ scheduled: true, force: true });
  const manual = context.runSheetsAutomation({ force: true });
  const [, manualResult] = await Promise.all([scheduled, manual]);
  assert.equal(syncs, 2, "a run the user asked for must wait its turn and then really run");
  assert.equal(manualResult.skipped, undefined, "a manual run must never answer with a skip");
}

// Pressing Start used to wait for a complete read of the Sheet before a tab was
// even created — seconds at best, far longer when the Sheet had rows to fill and
// rephrase first. The last sync already worked out which keyword comes next.
async function testStartDoesNotWaitForASync() {
  let syncs = 0;
  let syncFinished = false;
  const store = storage({
    runState: "stopped",
    sheetsDatabase: { connector: "apps-script", spreadsheetId: "s" },
    appsScriptUrl: "https://script.google.com/macros/s/abc/exec",
    sheetsStatus: {
      ok: true,
      syncedAt: new Date().toISOString(),
      nextJobs: [{ auto: true, searchKey: "junk removal|leeds|without-picture", serviceKeyword: "Junk Removal", city: "Leeds", query: "junk removal Leeds", reviewMode: "without-picture", currentPage: 1, businessIndex: 0, visitedPlaceIds: [] }]
    }
  });
  const tabs = [];
  const context = backgroundContext(store, {
    tabs,
    sync: async () => {
      syncs += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      syncFinished = true;
      return { ok: true, nextJobs: [] };
    }
  });

  const started = await askBackground(context, { type: "START_NEXT_JOB", pageLimit: "4" });
  assert.equal(started.ok, true, "Start must acknowledge immediately");
  assert.equal(started.queued, true);
  assert.equal(syncFinished, false, "Start must answer before the Sheet sync finishes");
  for (let attempt = 0; attempt < 30 && tabs.length < 1; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(tabs.length, 1, "the recent job opens without waiting for the Sheet");
  assert.equal(tabs[0].active, true, "a tab the user asked for opens in front");

  // A stale cache is not trusted: Fudge reads the Sheet again rather than scanning
  // for something that may already be done.
  const stale = storage({
    runState: "stopped",
    sheetsDatabase: { connector: "apps-script", spreadsheetId: "s" },
    appsScriptUrl: "https://script.google.com/macros/s/abc/exec",
    sheetsStatus: {
      ok: true,
      syncedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      nextJobs: [{ auto: true, searchKey: "old|leeds|photo", serviceKeyword: "Old", city: "Leeds", query: "old Leeds", reviewMode: "photo", currentPage: 1, businessIndex: 0, visitedPlaceIds: [] }]
    }
  });
  let staleSyncs = 0;
  const staleContext = backgroundContext(stale, {
    tabs: [],
    sync: async () => { staleSyncs += 1; return { ok: true, nextJobs: [] }; }
  });
  await askBackground(staleContext, { type: "START_NEXT_JOB", pageLimit: "4" });
  for (let attempt = 0; attempt < 30 && staleSyncs < 1; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(staleSyncs, 1, "an hour-old job list must be re-read before anything is opened");
}

// A run finished, the next sync could not read the Sheet, and collecting stopped
// dead: no job list, so no tab, so the panel sat on "looking for the next
// requirement" while the switch still said Running. One unreadable minute must not
// end the loop — the last known job list carries it until a sync succeeds.
async function testCollectingSurvivesAnUnreadableSync() {
  const store = storage({
    runState: "running",
    sheetsStatus: {
      ok: true,
      syncedAt: new Date().toISOString(),
      nextJobs: [{ auto: true, searchKey: "junk removal|leeds|without-picture", serviceKeyword: "Junk Removal", city: "Leeds", query: "junk removal Leeds", reviewMode: "without-picture", currentPage: 1, businessIndex: 0, visitedPlaceIds: [] }]
    }
  });
  const tabs = [];
  const context = backgroundContext(store, {
    tabs,
    sync: async () => ({ ok: true, retrying: true, notice: "The Sheet was busy rephrasing, so this sync was skipped." })
  });
  const result = await context.runSheetsAutomation({ force: true });
  assert.equal(result.startedJob, true, "a sync that could not be read must not stop collecting");
  assert.equal(tabs.length, 1, "the last known requirement keeps a tab opening");
}

// And the retry status must not destroy the job list it falls back on.
async function testARetryKeepsTheLastGoodSync() {
  const good = { ok: true, syncedAt: new Date().toISOString(), nextJobs: [{ serviceKeyword: "Junk Removal", searchKey: "k" }], nextJob: { serviceKeyword: "Junk Removal" } };
  const store = storage({
    runState: "running",
    sheetsDatabase: { spreadsheetId: "sheet-1", connector: "apps-script" },
    appsScriptUrl: EXEC_URL,
    appsScriptSecret: SECRET,
    sheetsStatus: good
  });
  const service = sheetsContext(store, async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ ok: false, connectorVersion: CURRENT_CONNECTOR_VERSION, error: "Lock timeout: another process was holding the lock for too long." })
  })).__SheetsService;
  const result = await service.sync({ force: true });
  assert.equal(result.retrying, true);
  const stored = (await store.local.get({ sheetsStatus: null })).sheetsStatus;
  assert.equal(stored.retrying, true, "the notice is recorded");
  assert.deepEqual(stored.nextJobs, good.nextJobs, "but the job list that keeps collecting going survives");
  assert.equal(stored.syncedAt, good.syncedAt, "and so does the time it was read");
}

// After every business the runner sent an update and waited, and the handler
// replied only once two round trips to Apps Script had finished. A slow connector
// or an evicted worker closed that channel, the rejection reached the runner, and
// the whole scan ended with "a listener indicated an asynchronous response, but the
// message channel closed before a response was received".
async function testTheScanDoesNotWaitOnSheetWrites() {
  const store = storage({ runState: "running" });
  let progressWrites = 0;
  let releaseWrite;
  const blocked = new Promise((resolve) => { releaseWrite = resolve; });
  const context = backgroundContext(store, { tabs: [] });
  context.SheetsService.recordProgress = async () => { progressWrites += 1; await blocked; };
  context.SheetsService.recordBusiness = async () => { await blocked; };

  const answered = await askBackground(
    context,
    { type: "SCAN_JOB_UPDATE", patch: { id: "job-1", status: "running", auto: true, businessCompleted: true, lastPlaceId: "p1" } },
    { tab: { id: 9 } }
  );
  assert.equal(answered.ok, true, "the runner is answered");
  assert.equal(answered.job.id, "job-1");
  assert.equal(progressWrites, 1, "and the Sheet write is under way");
  releaseWrite();
  // The point: the answer arrived while the write was still blocked.

  // Every handler must answer, even when its work throws, or the channel closes
  // and the runner sees that same error.
  const failing = backgroundContext(storage({ runState: "running" }), { tabs: [] });
  failing.SheetsService.sync = async () => { throw new Error("connector exploded"); };
  const reply = await askBackground(failing, { type: "RUN_SHEETS_SYNC" });
  assert.ok(reply && typeof reply === "object", "a handler whose work throws must still answer");

  const source = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const names = [...source.matchAll(/if \(message\?\.type === "([A-Z_]+)"\)/g)].map((m) => m[1]);
  names.forEach((name) => {
    const start = source.indexOf(`if (message?.type === "${name}"`);
    const end = source.indexOf("return true;", start);
    if (end === -1) return;
    assert.ok(source.slice(start, end).includes(".catch("),
      `${name} returns true but has no catch, so it can close the channel without answering`);
  });

  // And the runner itself must survive a message that is never answered — every
  // single one of them, not just the progress update.
  const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
  assert.match(content, /const updateJob = async \(patch\) => \{[\s\S]{0,400}?sendMessage\([\s\S]{0,120}?\.catch\(\(\) => null\)/,
    "a dropped progress update must not end the run");
  [...content.matchAll(/chrome\.runtime\.sendMessage\(/g)].forEach((match) => {
    const tail = content.slice(match.index, match.index + 260);
    const line = content.slice(0, match.index).split(String.fromCharCode(10)).length;
    assert.match(tail, /\.catch\(/, `content.js:${line} sends a message with no catch, so a dropped reply can end a scan`);
  });
  // An orphaned content script — the extension was reloaded under an open tab —
  // must stop rather than loop against a runtime that no longer exists.
  assert.match(content, /const extensionGone = \(\) => \{[\s\S]{0,160}?chrome\.runtime\?\.id/, "an orphaned runner must be able to tell");
  assert.match(content, /const jobWasStopped = async[\s\S]{0,260}?if \(extensionGone\(\)\) return true;/, "and must stop when it is");
}

// Start acknowledges immediately, then stores the actual outcome for the panel.
async function testStartReportsTheRealReason() {
  const store = storage({ runState: "stopped", sheetsDatabase: { connector: "apps-script", spreadsheetId: "s" }, appsScriptUrl: "https://script.google.com/macros/s/abc/exec" });
  const queued = [{ auto: true, searchKey: "a|b|photo", serviceKeyword: "Toilet Replacement", city: "Leeds", query: "toilet replacement Leeds", reviewMode: "photo", currentPage: 1, businessIndex: 0, visitedPlaceIds: [] }];
  const context = backgroundContext(store, { queued, tabs: [] });
  context.chrome.tabs.create = async () => { throw new Error("Google tab could not open"); };
  const result = await askBackground(context, { type: "START_NEXT_JOB", pageLimit: "4" });
  assert.equal(result.ok, true, "a slow or failed tab must not hold the Start message open");
  for (let attempt = 0; attempt < 30 && !(await store.local.get({ sheetsStatus: null })).sheetsStatus?.retrying; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  const failureStatus = (await store.local.get({ sheetsStatus: null })).sheetsStatus;
  assert.match(failureStatus.notice, /Google tab could not open/, "the actual tab failure must appear in the panel status");
  assert.equal(failureStatus.retrying, true, "a failed tab is retried automatically");
  assert.equal((await store.local.get({ runState: "" })).runState, "running", "Start still switches collecting on");

  const emptyTabs = [];
  const empty = backgroundContext(storage({ runState: "stopped", sheetsDatabase: { connector: "apps-script", spreadsheetId: "s" }, appsScriptUrl: "https://script.google.com/macros/s/abc/exec" }), { queued: [], tabs: emptyTabs });
  const nothing = await askBackground(empty, { type: "START_NEXT_JOB", pageLimit: "4" });
  assert.equal(nothing.queued, true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(emptyTabs.length, 0, "an empty queue does not open a Google tab");

  const unreadStore = storage({ runState: "stopped", sheetsDatabase: { connector: "apps-script", spreadsheetId: "s" }, appsScriptUrl: "https://script.google.com/macros/s/abc/exec" });
  const unread = backgroundContext(unreadStore, { sync: async () => {
    const status = { ok: true, retrying: true, notice: "The Sheet was busy rephrasing, so this sync was skipped." };
    await unreadStore.local.set({ sheetsStatus: status });
    return status;
  } });
  const blocked = await askBackground(unread, { type: "START_NEXT_JOB", pageLimit: "4" });
  assert.equal(blocked.ok, true);
  for (let attempt = 0; attempt < 30 && !(await unreadStore.local.get({ sheetsStatus: null })).sheetsStatus?.retrying; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  const blockedStatus = (await unreadStore.local.get({ sheetsStatus: null })).sheetsStatus;
  assert.equal(blockedStatus.retrying, true, "an unreadable Sheet must be reported as a retry");
  assert.match(blockedStatus.notice, /busy rephrasing/, "and must say what actually happened");
}

// Chrome throttles timers in a hidden tab to roughly one wake a minute. The old
// poll loop therefore looked once or twice inside a seven-second budget and reported
// nothing there, so a business whose panel was still rendering was closed again as
// "no reviews" — the open-and-close-without-checking behaviour, and the reason the
// same keyword worked on a later run with the tab in front. waitFor is now driven by
// DOM mutations, which are not throttled.
//
// The function is lifted out of content.js and run against a deliberately hostile
// clock: no timer callback ever fires.
function loadWaitFor({ runTimers = false } = {}) {
  const source = fs.readFileSync(path.join(root, "content.js"), "utf8");
  const start = source.indexOf("  const waitFor = (test");
  const end = source.indexOf("\n  };", source.indexOf("return new Promise", start)) + "\n  };".length;
  assert.ok(start > 0 && end > start, "waitFor must be extractable for this test");
  const observers = [];
  const timers = [];
  const context = {
    Date,
    console,
    document: { documentElement: {} },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() { this.live = false; }
    },
    // A fully throttled tab: nothing on a timer ever runs.
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    clearInterval() {},
    setTimeout: (fn, ms) => { if (runTimers) { timers.push(fn); } return timers.length; },
    clearTimeout() {}
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\n;globalThis.__waitFor = waitFor;`, context);
  return {
    waitFor: context.__waitFor,
    mutate: () => observers.forEach((observer) => observer.callback()),
    runTimers: () => { const pending = timers.splice(0); pending.forEach((fn) => fn()); }
  };
}

async function testPageWaitsSurviveTabThrottling() {
  const { waitFor, mutate } = loadWaitFor();

  // Already there: answered without waiting for anything at all.
  assert.equal(await waitFor(() => "ready", 7000, 110), "ready");

  // Not there yet, and no timer will ever fire. Google inserts the panel; the wait
  // must notice through the mutation alone.
  let rendered = false;
  const pending = waitFor(() => (rendered ? "panel" : null), 7000, 110);
  let settled = null;
  pending.then((value) => { settled = value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, null, "nothing is there yet, so the wait is still open");
  rendered = true;
  mutate();
  assert.equal(await pending, "panel", "a throttled tab must still see the panel the moment it renders");

  // Two mutations in quick succession must both be looked at. Deferring one onto a
  // timer is the one thing this function may never do, however briefly.
  let seen = 0;
  const quick = waitFor(() => (seen >= 2 ? "late" : null), 7000, 110);
  mutate();
  seen = 1;
  mutate();
  seen = 2;
  mutate();
  assert.equal(await quick, "late", "a check must never be deferred onto a timer, even for a moment");

  // The budget is still honoured: once it has passed, the next look gives up rather
  // than waiting on a throttled timer to notice.
  const expiring = waitFor(() => null, 40, 110);
  await new Promise((resolve) => setTimeout(resolve, 60));
  mutate();
  assert.equal(await expiring, null, "an expired budget must end the wait");
}

// Conditions that clear themselves must never be presented as errors. A Sheet busy
// rephrasing, Google throttling and a dropped connection are all things Fudge is
// about to retry, and calling them failures made a working setup look broken.
async function testTransientFailuresAreQuietRetries() {
  const base = { sheetsDatabase: { spreadsheetId: "sheet-1", connector: "apps-script" }, appsScriptUrl: EXEC_URL, appsScriptSecret: SECRET, runState: "running" };

  const busy = storage(base);
  const busyService = sheetsContext(busy, async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: false, error: "Lock timeout: another process was holding the lock for too long." })
  })).__SheetsService;
  const busyResult = await busyService.sync({ force: true });
  assert.equal(busyResult.ok, true, "a Sheet mid-rephrase is not a failure");
  assert.equal(busyResult.retrying, true);
  assert.match(busyResult.notice, /busy rephrasing/);
  assert.equal((await busy.local.get({ sheetsStatus: null })).sheetsStatus.error, undefined, "and nothing is stored as an error");

  // The same message from an out-of-date connector is not a hiccup at all: that
  // version holds one lock for everything, so every sync waits thirty seconds and
  // gives up, nothing is read, and no scan can ever start. It must say so.
  const outdated = storage(base);
  const outdatedService = sheetsContext(outdated, async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: false, connectorVersion: 30, error: "Lock timeout: another process was holding the lock for too long." })
  })).__SheetsService;
  await assert.rejects(outdatedService.sync({ force: true }), /version 30 and Fudge needs/, "a connector too old to get out of its own way must be named");

  const throttled = storage(base);
  const throttledService = sheetsContext(throttled, async () => ({ ok: false, status: 503, text: async () => "" })).__SheetsService;
  const throttledResult = await throttledService.sync({ force: true });
  assert.equal(throttledResult.retrying, true, "Google being busy is not the user's problem");

  const offline = storage(base);
  const offlineService = sheetsContext(offline, async () => { throw new TypeError("Failed to fetch"); }).__SheetsService;
  const offlineResult = await offlineService.sync({ force: true });
  assert.equal(offlineResult.retrying, true, "a dropped connection is not the user's problem either");

  // A real problem still reads as one.
  const broken = storage(base);
  const brokenService = sheetsContext(broken, async () => ({ ok: false, status: 404, text: async () => "" })).__SheetsService;
  await assert.rejects(brokenService.sync({ force: true }), /not shared with this computer/);
}

// The root of the lock timeouts: the Sheet and the extension were both filling
// Structure rows from the same pool, both every minute, through the same lock. Only
// one of them allocates at a time now — the extension while it is there, the Sheet
// when it is not — and the handover happens by itself.
function testOnlyOneAllocatorRunsAtATime() {
  const properties = {};
  let queueRuns = 0;
  let rephraseRuns = 0;
  const context = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties[key] || "",
      setProperty: (key, value) => { properties[key] = value; },
      setProperties: (values) => Object.assign(properties, values)
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }), getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { flush() {} },
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  // Stand in for the two halves so the handover itself is what is measured.
  context.processQueue_ = () => { queueRuns += 1; return { ok: true, filled: 0, replaced: 0, touchedRows: [] }; };
  context.processStructureRewrites_ = () => { rephraseRuns += 1; return 0; };

  // Nobody has synced: the Sheet does the work, as it must with Chrome closed.
  context.fudgeProcessQueue();
  assert.equal(queueRuns, 1, "with no extension around, the Sheet allocates");

  // The extension just read the Sheet, so it is driving.
  context.noteExtensionSync_();
  assert.equal(context.extensionIsDriving_(), true);
  const rephrasesBefore = rephraseRuns;
  const deferred = context.fudgeProcessQueue();
  assert.equal(deferred.deferredToExtension, true, "the Sheet stands down while the extension is driving");
  assert.equal(queueRuns, 1, "and does not allocate the same rows a second time");
  assert.equal(rephraseRuns, rephrasesBefore + 1, "but still rephrases, which the extension never does");

  // Chrome goes away. The Sheet takes the work back on its own.
  properties.FUDGE_LAST_EXTENSION_SYNC = String(Date.now() - 10 * 60 * 1000);
  assert.equal(context.extensionIsDriving_(), false);
  context.fudgeProcessQueue();
  assert.equal(queueRuns, 2, "once the extension stops syncing, the Sheet resumes by itself");
}

// Rephrasing must not depend on anyone opening the Apps Script editor, and its
// state has to be readable from outside the Sheet.
function testConnectorInstallsAndReportsItsOwnAutomation() {
  const created = [];
  const properties = { FUDGE_SPREADSHEET_ID: "sheet-1", FUDGE_OPENAI_API_KEY: "test-key" };
  const trigger = (handler) => ({ getHandlerFunction: () => handler });
  const installed = [];
  const context = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties[key] || "",
      setProperty: (key, value) => { properties[key] = value; },
      setProperties: (values) => Object.assign(properties, values)
    }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => null }) },
    ScriptApp: {
      getProjectTriggers: () => installed.map(trigger),
      deleteTrigger() {},
      newTrigger: (handler) => {
        created.push(handler);
        const builder = {
          timeBased: () => ({ everyMinutes: () => ({ create() { installed.push(handler); } }) }),
          forSpreadsheet: () => ({ onEdit: () => ({ create() { installed.push(handler); } }) })
        };
        return builder;
      }
    },
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);

  const result = context.installAutomation_();
  assert.equal(result.ok, true);
  assert.deepEqual(created.slice().sort(), ["fudgeProcessQueue", "fudgeRephrasePass", "fudgeRewriteOnEdit"], "all three triggers are installed without touching the editor");
  const state = context.automationState_();
  assert.equal(state.queueTrigger, true);
  assert.equal(state.rephraseTrigger, true);
  assert.equal(state.editTrigger, true);
  assert.equal(state.writerConfigured, true);
  assert.equal(state.model, "gpt-5.6-luna");

  // Missing trigger permission is reported, not hidden behind a working setup.
  const blind = { PropertiesService: context.PropertiesService, SpreadsheetApp: context.SpreadsheetApp, ScriptApp: { getProjectTriggers: () => { throw new Error("You do not have permission to call ScriptApp.getProjectTriggers"); } }, console };
  vm.createContext(blind);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), blind);
  assert.match(blind.automationState_().triggerError, /permission/, "a connector that cannot read its triggers must say so");
}

// The rephrase pass owns a different lock from the connector's reads and writes,
// so neither can time the other out, and it is rate-limited so the one-minute
// clock cannot spend the account's whole daily script runtime on OpenAI.
function testRephrasingCannotStarveTheConnector() {
  const script = fs.readFileSync(path.join(root, "apps-script.gs"), "utf8");
  assert.match(script, /function withWriterLock_[\s\S]*?getDocumentLock/, "rephrasing must not hold the lock the extension needs");
  assert.match(script, /function fudgeRewriteOnEdit[\s\S]*?withWriterLock_\([\s\S]*?processStructureRewrites_/, "a user's own edit must rephrase under the writer lock");
  assert.match(script, /newTrigger\("fudgeRephrasePass"\)\.timeBased\(\)\.everyMinutes\(5\)/, "rephrasing needs its own slower clock");
  assert.match(script, /FUDGE_REPHRASE_MIN_INTERVAL_MS = 5 \* 60 \* 1000/, "the one-minute clock must not rephrase more often than the five-minute one");
  assert.match(script, /function fudgeProcessQueue\(\)[\s\S]*?rephraseCooldownActive_\(\)[\s\S]*?processStructureRewrites_\(\)/, "the one-minute clock must check the cooldown first");

  const properties = {};
  const context = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties[key] || "",
      setProperties: (values) => Object.assign(properties, values)
    }) },
    console
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  assert.equal(context.rephraseCooldownActive_(), false, "nothing has run yet");
  context.noteRephraseCooldown_();
  assert.equal(context.rephraseCooldownActive_(), true, "a pass that spent OpenAI time pushes the next one out");
}

// A model that will not take `temperature` or `reasoning_effort` used to fail every
// row, and by looking like a success it did so invisibly.
function testWriterRetriesWithoutRefusedParameters() {
  const payloads = [];
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "", setProperty() {}, setProperties() {} }) },
    UrlFetchApp: { fetch: (_url, options) => {
      const payload = JSON.parse(options.payload);
      payloads.push(payload);
      if (payload.temperature !== undefined) {
        return { getResponseCode: () => 400, getContentText: () => JSON.stringify({ error: { message: "Unsupported parameter: 'temperature' is not supported with this model." } }) };
      }
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ message: { content: "Felix handled the door repair." } }] }) };
    } },
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  const result = context.rewriteText_(
    { text: "They repaired my door.", serviceKeyword: "Door repair", rewriteServicePhrase: "door repair" },
    { key: "test-key", phone: "", names: "Felix", requirePhone: false }
  );
  assert.equal(payloads.length, 2, "the refused parameters are dropped and the request is sent again");
  assert.equal(payloads[1].temperature, undefined);
  assert.equal(payloads[1].reasoning_effort, undefined);
  assert.equal(result.fallback, undefined, "the second attempt is a real rephrase, not a local fallback");
  assert.match(result.text, /door repair/i);
}

// A row the extension fills must be rephrased in that same request. A script write
// fires no edit trigger, so these rows used to wait for a clock — which is what made
// rephrasing look like it happened whenever it felt like it.
function testWrittenRowsAreRephrasedInTheSameRequest() {
  const rows = [["REQ-1", "With Picture", "Door repair", "Dallas", "", "", "", "", "", "", "", "(555) 987-6543", ""]];
  const notes = [""];
  let apiCalls = 0;
  const properties = { FUDGE_SPREADSHEET_ID: "sheet-1", FUDGE_OPENAI_API_KEY: "test-key", FUDGE_WRITER_NAMES: "Felix" };
  const sheet = {
    getName: () => "Structure",
    getLastRow: () => rows.length + 1,
    getMaxColumns: () => 13,
    setRowHeights() {},
    getRange(...args) {
      // Both call shapes: getRange("A2:M2") from batchWrite_, and the numeric form
      // the writer uses.
      let row = 2; let column = 1; let rowCount = 1; let columnCount = 13;
      if (args.length === 1) {
        const match = String(args[0]).match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
        const toIndex = (letters) => letters.split("").reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
        column = toIndex(match[1]); row = Number(match[2]);
        columnCount = toIndex(match[3]) - column + 1; rowCount = Number(match[4]) - row + 1;
      } else { [row, column, rowCount, columnCount] = args; }
      return {
        getRow: () => row,
        getColumn: () => column,
        getNumRows: () => rowCount,
        getNumColumns: () => columnCount,
        setWrapStrategy() { return this; },
        getDisplayValues: () => rows.slice(row - 2, row - 2 + rowCount).map((source) =>
          Array.from({ length: columnCount }, (_, index) => String(source[column - 1 + index] ?? ""))),
        getNotes: () => notes.slice(row - 2, row - 2 + rowCount).map((value) => [value]),
        setNote(value) { notes[row - 2] = value; return this; },
        clearNote() { notes[row - 2] = ""; return this; },
        clearContent() { rows[row - 2][column - 1] = ""; return this; },
        setValue(value) { rows[row - 2][column - 1] = value; return this; },
        setValues(values) {
          values.forEach((source, offset) => {
            const target = rows[row - 2 + offset] || (rows[row - 2 + offset] = []);
            source.forEach((value, index) => { target[column - 1 + index] = value; });
          });
          return this;
        }
      };
    }
  };
  const context = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties[key] || "",
      setProperty: (key, value) => { properties[key] = value; },
      setProperties: (values) => Object.assign(properties, values)
    }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }), flush() {}, WrapStrategy: { CLIP: "CLIP" } },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }), getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    UrlFetchApp: { fetchAll: (requests) => requests.map((request) => {
      apiCalls += 1;
      const payload = JSON.parse(request.payload);
      const name = payload.messages[1].content.match(/replacement_name: ([^\n]+)/)[1];
      const cta = payload.messages[1].content.match(/required_cta: ([^\n]+)/)[1];
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ message: { content: `${name} handled the door repair. ${cta}` } }] }) };
    }) },
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);

  const written = context.batchWrite_([{ range: "Structure!A2:K2", values: [["REQ-1", "With Picture", "Door repair", "Dallas", "They fixed my door.", "", "QC needed", "Filled", "review-1", "Acme Doors", "now"]] }]);
  assert.deepEqual(Array.from(written.touchedRows), [2], "a Structure write reports the rows it touched");
  const rephrased = context.rephraseTouched_(written);
  assert.equal(rephrased, 1, "and they are rephrased in the same request, not on the next tick of a clock");
  assert.equal(apiCalls, 1);
  assert.match(rows[0][12], /handled the door repair/);
  assert.equal(context.publicResult_(written).structureSheet, undefined, "internals never travel back to the extension");

  // Nothing changed, so nothing is sent again.
  const again = context.rephraseTouched_({ touchedRows: [2], structureSheet: sheet });
  assert.equal(again, 0);
  assert.equal(apiCalls, 1, "an unchanged row costs nothing");

  // A manual run ignores the cooldown the scheduled sweep respects.
  context.noteRephraseCooldown_();
  rows[0][4] = "They repaired the door again.";
  const manual = context.rephraseEverythingNow_();
  assert.equal(manual.ok, true);
  assert.equal(manual.rephrased, 1, "Rephrase now must never answer with a wait");
  assert.equal(apiCalls, 2);
}

// Rows to rephrase arrive scattered: the row someone edited, plus whatever the
// queue filled elsewhere in the sheet. Reading one block from the first to the last
// would pull in every row between them.
function testScatteredRowsAreReadInGroups() {
  const reads = [];
  const sheet = {
    getName: () => "Structure",
    getLastRow: () => 600,
    getRange(row, column, rowCount, columnCount) {
      if (rowCount > 1 || column === 1) reads.push({ row, rowCount });
      return {
        getDisplayValues: () => Array.from({ length: rowCount || 1 }, () => Array.from({ length: columnCount || 1 }, () => "")),
        getNotes: () => Array.from({ length: rowCount || 1 }, () => [""]),
        setNote() { return this; }, clearNote() { return this; },
        clearContent() { return this; }, setValue() { return this; }
      };
    }
  };
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => (key === "FUDGE_OPENAI_API_KEY" ? "test-key" : ""), setProperty() {}, setProperties() {} }) },
    SpreadsheetApp: { flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }), getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    UrlFetchApp: { fetchAll: () => [] },
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);

  context.rephraseRowsNow_(sheet, [500, 2, 3]);
  assert.ok(reads.length >= 2, "scattered rows must be read as separate groups");
  assert.ok(reads.every((read) => read.rowCount <= 25), `no group may span the whole sheet, got ${JSON.stringify(reads)}`);
  const starts = reads.map((read) => read.row).sort((a, b) => a - b);
  assert.equal(starts[0], 2, "the group near the top starts at the first of its rows");
  assert.ok(starts.includes(500), "and the distant row is read on its own");
}

// A transient API error keeps the row, records the reason, and schedules a retry.
function testTransientRephraseFailureIsRetriedLater() {
  const row = ["REQ-R", "", "Door repair", "", "They fixed my door.", "", "", "", "", "", "", "", ""];
  let note = "";
  let calls = 0;
  const properties = { FUDGE_OPENAI_API_KEY: "test-key" };
  const sheet = {
    getName: () => "Structure",
    getLastRow: () => 2,
    getRange(_number, column, _rowCount, columnCount) {
      return {
        getDisplayValues: () => [Array.from({ length: columnCount }, (_, index) => String(row[column - 1 + index] ?? ""))],
        getNotes: () => [[note]],
        setNote(value) { note = value; return this; },
        clearNote() { note = ""; return this; },
        clearContent() { row[column - 1] = ""; return this; },
        setValue(value) { row[column - 1] = value; return this; }
      };
    }
  };
  const context = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties[key] || "",
      setProperty: (key, value) => { properties[key] = value; },
      setProperties: (values) => Object.assign(properties, values)
    }) },
    SpreadsheetApp: { flush() {} },
    UrlFetchApp: { fetchAll: (requests) => requests.map(() => { calls += 1; return { getResponseCode: () => 503, getContentText: () => "{}" }; }) },
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  assert.equal(context.processStructureRewrites_(sheet, 2, 1, 6), 0, "a failed row is not counted as rephrased");
  const state = JSON.parse(note.replace("FUDGE_REWRITE_FAILURE:", ""));
  assert.equal(state.attempts, 1, "the first transient failure is attempt one, not a dead end");
  assert.ok(state.retryAt > Date.now(), "and a retry is scheduled");
  assert.ok(calls >= 2, "a retryable status is given a second attempt inside the pass");
  assert.match(properties.FUDGE_LAST_WRITER_ERROR, /503/, "the reason is kept where the extension can read it");
  assert.ok(row[12], "the row keeps readable text rather than being left blank");
}

(async () => {
  const tests = [
    ["used data isolation", testUsedDataIsolation],
    ["collecting card ignores page detection", testCollectingCardIgnoresPageDetection],
    ["stale running jobs release their slot", testStaleRunningJobsReleaseTheirSlot],
    ["closing the runner tab ends its job", testClosingTheRunnerTabEndsItsJob],
    ["concurrent jobs and late heartbeat", testConcurrentJobUpdatesAndLateHeartbeat],
    ["new reviews trigger coalesced sync", testNewReviewsTriggerCoalescedSync],
    ["orphan runner tabs are closed", testOrphanRunnerTabsAreClosed],
    ["stop is unconditional", testStopIsUnconditional],
    ["completed keyword still uploads pictures", testCompletedKeywordStillUploadsPictures],
    ["tab control applies while running", testTabControlAppliesWhileRunning],
    ["Sheet alarm uses thirty second cadence", testSheetAlarmUsesThirtySecondCadence],
    ["Google cooldown counts episodes and resets", testGoogleCooldownCountsEpisodesAndResets],
    ["Sync now starts new work only when on", testSyncNowStartsNewWorkOnlyWhenOn],
    ["stop during tab load does not start scan", testStopDuringTabLoadDoesNotStartScan],
    ["automatic upload follows switch", testAutomaticUploadFollowsSwitch],
    ["manual start is never dropped", testManualStartIsNeverDropped],
    ["start does not wait for a sync", testStartDoesNotWaitForASync],
    ["collecting survives an unreadable sync", testCollectingSurvivesAnUnreadableSync],
    ["a retry keeps the last good sync", testARetryKeepsTheLastGoodSync],
    ["the scan does not wait on Sheet writes", testTheScanDoesNotWaitOnSheetWrites],
    ["start reports the real reason", testStartReportsTheRealReason],
    ["page waits survive tab throttling", testPageWaitsSurviveTabThrottling],
    ["transient failures are quiet retries", testTransientFailuresAreQuietRetries],
    ["only one allocator runs at a time", testOnlyOneAllocatorRunsAtATime],
    ["connector installs and reports its automation", testConnectorInstallsAndReportsItsOwnAutomation],
    ["rephrasing cannot starve the connector", testRephrasingCannotStarveTheConnector],
    ["writer retries without refused parameters", testWriterRetriesWithoutRefusedParameters],
    ["written rows are rephrased in the same request", testWrittenRowsAreRephrasedInTheSameRequest],
    ["scattered rows are read in groups", testScatteredRowsAreReadInGroups],
    ["transient rephrase failure is retried later", testTransientRephraseFailureIsRetriedLater],
    ["unused data isolation", testUnusedDataIsolation],
    ["content duplicate identity", testContentDuplicateIdentity],
    ["duplicate merge keeps Drive alignment", testDuplicateMergeKeepsDrivePhotoAlignment],
    ["connector setup", testConnectorSetup],
    ["connecting recovers an older secret", testConnectingRecoversAnOlderSecret],
    ["connector secret survives disconnect", testConnectorSecretSurvivesDisconnect],
    ["connector authorization error is actionable", testConnectorAuthorizationErrorIsActionable],
    ["sheets pool allocation", testSheetsPoolAllocation],
    ["review is not appended twice", testReviewIsNotAppendedTwice],
    ["connector append is idempotent", testConnectorAppendIsIdempotent],
    ["Sheet sync preserves concurrent review", testSheetSyncCannotEraseConcurrentReview],
    ["connector QC status is not undone", testConnectorQcStatusIsNotUndone],
    ["appended review is marked on its own row", testAppendedReviewIsMarkedOnItsOwnRow],
    ["empty rows are searched before spares", testEmptyRowsAreSearchedBeforeSpares],
    ["dashboard release still frees a review", testDashboardReleaseStillFreesAReview],
    ["duplicate review cannot fill two rows", testDuplicateReviewCannotFillTwoRows],
    ["self write rows without cities still queue work", testSelfWriteRowsWithoutCitiesStillQueueWork],
    ["Sheet job count follows tab limit", testSheetJobCountFollowsTabLimit],
    ["active sync signals allocation ownership", testActiveSyncSignalsAllocationOwnership],
    ["an unchanged sync writes nothing", testAnUnchangedSyncWritesNothing],
    ["picture links stay in one cell", testPictureLinksStayInOneCell],
    ["Drive upload keeps photo positions", testDriveUploadKeepsPhotoPositions],
    ["Drive upload keeps reviews collected meanwhile", testDriveUploadKeepsReviewsCollectedMeanwhile],
    ["empty Drive selection uploads nothing", testEmptyDriveSelectionUploadsNothing],
    ["scattered rows are combined", testScatteredRowsAreCombined],
    ["filled first row keeps batch priority", testFilledFirstRowKeepsBatchPriority],
    ["exhausted keyword does not block the rest", testExhaustedKeywordDoesNotBlockTheRest],
    ["sheets QC replacement", testSheetsQcReplacement],
    ["search term generalisation", testSearchTermGeneralisation],
    ["appliance classification", testApplianceClassification],
    ["query built from umbrella", testQueryIsBuiltFromUmbrella],
    ["blank city uses whole inventory", testBlankCityUsesWholeInventory],
    ["missing keyword is reported", testMissingKeywordIsReported],
    ["businesses are not re-logged", testBusinessesAreNotRelogged],
    ["city chosen from Cities tab", testCityIsChosenFromTheCitiesTab],
    ["keywords receive distributed cities", testKeywordsReceiveDistributedCities],
    ["exhausted city is skipped", testExhaustedCityIsSkipped],
    ["a checkpoint never moves backwards", testACheckpointNeverMovesBackwards],
    ["cities take turns and resume where they stopped", testCitiesTakeTurnsAndResumeWhereTheyStopped],
    ["all cities exhausted", testAllCitiesExhausted],
    ["Cities tab mirrors exhaustion", testCitiesTabMirrorsExhaustion],
    ["Structure city overrides list", testStructureCityOverridesList],
    ["keyword needs evidence in review", testKeywordNeedsEvidenceInTheReview],
    ["natural review wording is accepted", testNaturalReviewWordingIsAccepted],
    ["Sheet-managed service rules", testSheetManagedServiceRules],
    ["Services rules drive search and persist", testServicesRulesDriveSearchAndPersist],
    ["Services tab drives collection", testServicesTabDrivesCollection],
    ["review topic selection", testReviewTopicSelection],
    ["toilet topic required at general plumbers", testToiletTopicIsRequiredAtGeneralPlumbers],
    ["specialised business needs no filter", testSpecialisedBusinessNeedsNoFilter],
    ["flexible business-name signals", testFlexibleBusinessNameSignals],
    ["single-signal review matching", testSingleSignalReviewMatching],
    ["expanded furniture and junk vocabulary", testExpandedFurnitureAndJunkVocabulary],
    ["garage specialist inventory", testGarageSpecialistCollectsOtherSubcategories],
    ["specialist family lock", testSpecialistFamilyLockBlocksAmbiguousWords],
    ["requirement context corrects classification", testRequirementContextCorrectsClassification],
    ["outdated connector still syncs", testOutdatedConnectorStillSyncs],
    ["connection needs all three pieces", testConnectionReadyNeedsAllThreePieces],
    ["sponsored skipped and ids stable", testSponsoredAndStableBusinessIds],
    ["parallel tabs, blocking, photo grace", testParallelTabsBlockingAndPhotoGrace],
    ["two Places tabs run in parallel", testTwoPlacesTabsRunInParallel],
    ["connector honours the recorded service", testConnectorHonoursTheRecordedService],
    ["recorded service blocks other trades", testRecordedServiceBlocksOtherTrades],
    ["sub-category decides the keyword", testSubcategoryDecidesTheKeyword],
    ["catch-all reviews fill last", testCatchAllReviewsFillLast],
    ["swallowed click retries", testSwallowedClickRetries],
    ["review panel is given time to render", testReviewPanelIsGivenTimeToRender],
    ["every business in a batch is saved", testEveryBusinessInABatchIsSaved],
    ["dom bindings", testDomBindings],
    ["website writer prompt carries all six rules", testWebsiteWriterPromptCarriesAllFiveRules],
    ["website writer safety check", testWebsiteWriterSafetyCheck],
    ["website writer crew-name check", testWebsiteWriterCrewNameCheck],
    ["website writer cache round trip", testWebsiteWriterCacheRoundTrip],
    ["website writer ensure rewrite caches per review", testWebsiteWriterEnsureRewriteCachesPerReview],
    ["website writer detects the phone for the column", testWebsiteWriterDetectsPhoneForTheColumn],
    ["website writer reaches the Sheet column", testWebsiteWriterReachesTheSheetColumn],
    ["live Google regressions", testLiveGoogleRegressions],
    ["connector sanitises formula text", testConnectorSanitisesFormulaText],
    ["every photo URL in one cell is clickable", testConnectorMakesEveryPhotoLinkClickable],
    ["connector retries a leaked date", testConnectorRetriesDateLeak],
    ["connector removes weather locally", testConnectorRemovesWeatherLocally],
    ["connector cleans an original name and finds other organizations", testConnectorCleansOriginalNameAndFindsOtherOrganizations],
    ["connector rotates names, aligns services, and varies CTAs", testConnectorRotatesNamesAlignsServicesAndVariesCtas],
    ["empty writer settings do not block property saving", testEmptyWriterSettingsDoNotBlockPropertySaving],
    ["connector key setup from Sheet menu", testConnectorKeyCanBeSetFromSheetMenu],
    ["Sheet-only queue matching", testSheetOnlyQueueMatching],
    ["Sheet-only queue uses managed rules", testSheetOnlyQueueUsesManagedRules],
    ["Sheet connector installs independent triggers", testSheetConnectorInstallsIndependentTriggers],
    ["connector defers rephrasing safely", testDeferredConnectorRephrasing],
    ["connector read leaves queue work to extension", testConnectorReadDoesNotRunQueue],
    ["busy automation skips without lock timeout", testBusyAutomationSkipsWithoutLockTimeout],
    ["connector does not rewrite inventory automatically", testConnectorRewritesNewReviewInSheet],
    ["Structure review rephrases after edits", testStructureReviewRephrasesAfterEdits],
    ["Structure failure keeps copy and backs off", testStructureFailureKeepsCopyAndBacksOff],
    ["Structure batch limit keeps waiting copy", testStructureBatchLimitNeverClearsWaitingRows],
    ["Sheet-only queue fills and replaces", testSheetOnlyQueueFillsAndReplaces],
    ["keyword does not claim other-trade reviews", testKeywordDoesNotClaimOtherTradeReviews]
  ];
  let failed = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      console.log(`  pass  ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAIL  ${name}`);
      console.error(error);
    }
  }
  if (failed) {
    console.error(`
${failed} of ${tests.length} Fudge smoke tests failed.`);
    process.exitCode = 1;
    return;
  }
  console.log(`
All ${tests.length} Fudge smoke tests passed.`);
})();
