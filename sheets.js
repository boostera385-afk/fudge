const SheetsService = (() => {
  const STRUCTURE_HEADERS = ["Request ID", "Review Type", "Service Keyword", "City", "Review", "Picture Links", "Quality Check", "Status", "Review ID", "Business", "Updated At"];
  const REVIEW_HEADERS = ["Review ID", "Fingerprint", "Service", "Subcategory", "City", "Business", "Place ID", "Review", "Review Type", "Original Picture Links", "Drive Picture Links", "Status", "Used At", "Request ID", "Source URL", "Collected At", "QC Note", "Website Copy", "Phone"];
  const PROGRESS_HEADERS = ["Search Key", "Service Keyword", "City", "Query", "Page", "Next Business", "Exhausted", "Visited Place IDs", "Updated At"];
  const CITY_HEADERS = ["City", "Status", "Last Used", "Exhausted Keywords", "Notes"];
  const SERVICE_HEADERS = ["Service Keyword", "Status", "Reviews Collected", "Notes", "Search Term", "Business Name Keywords", "Review Keywords", "Required Review Keywords", "Google Filter Keywords", "Exclude Keywords", "Service Family", "Subcategory", "Topic Filter Required", "Collect Family Reviews", "Rewrite Service Phrase", "Equivalent Service Phrases"];
  // The connector lives inside the user's spreadsheet, so it can be older than the
  // extension. Anything above version 1 knows about the Cities and Services tabs.
  const REQUIRED_CONNECTOR_VERSION = 40;
  // The selected tab limit controls how many distinct keywords the Sheet returns.
  const DEFAULT_PARALLEL_JOBS = 3;
  const MAX_PARALLEL_JOBS = 6;
  const NO_PICTURE_TEXT = "No picture found";
  const CONNECTION_CODE_PREFIX = "FUDGE1|";
  let syncing = false;
  let syncChain = Promise.resolve();
  // Consecutive self-clearing failures. Retrying quietly forever is its own kind of
  // broken, so after a few in a row Fudge stops calling it a passing hiccup.
  let softFailures = 0;
  let connectorVersion = 0;
  // How long a single connector request may take before Fudge gives up on it. The
  // Apps Script side can be held up by its own rephrasing pass, and a fetch with no
  // deadline left the whole sync wedged with nothing on screen to explain it.
  const REMOTE_TIMEOUT_MS = 120000;
  // Conditions that resolve by themselves. These are not the user's problem and are
  // never shown as "Needs attention": Fudge is already going to try again.
  const transientError = (message = "") => /busy rephrasing|did not answer in time|did not finish loading|lock timeout|holding the lock|another fudge|network|failed to fetch|temporarily|rate|try again|429|50[0234]/i.test(String(message));
  const softError = (message) => {
    const error = new Error(message);
    error.transient = true;
    return error;
  };

  const now = () => new Date().toISOString();
  const clean = (value) => String(value == null ? "" : value).trim();
  const ruleList = (value) => {
    const text = clean(value);
    if (!text || /^(?:-|none)$/i.test(text)) return [];
    return text.split(/[|;\n]+/).map(clean).filter(Boolean);
  };
  const ruleText = (items) => (items || []).join(" | ");
  const yes = (value) => /^(?:yes|true|1|required)$/i.test(clean(value));
  const modeFrom = (value) => /self\s*write|without\s*(?:a\s*)?picture|no\s*picture/i.test(clean(value)) ? "without-picture" : "photo";
  const modeLabel = (mode) => mode === "without-picture" ? "Without Picture" : "With Picture";
  // Keep every review's pictures in one Sheet cell. New builds write one URL per
  // line; accepting pipes as well keeps inventories made by older builds usable.
  const splitLinks = (value) => clean(value).split(/\r?\n|\|/).map((item) => item.trim()).filter(Boolean);
  const searchKey = (service, city, mode) => [Fudge.normalize(service), Fudge.normalize(city), mode].join("|");
  // Structure rows may use harmless wording variants (for example "Christmas
  // Light Installation" and "Christmas Lights Installation"). Group known
  // services by their classified family/subcategory so every occurrence is
  // fulfilled as one batch, while unknown keywords remain safely separate.
  const requirementKey = (service, city, mode) => {
    const classified = Fudge.serviceIdentity(service);
    const concept = classified.matched
      ? `${classified.id}:${classified.subcategory.id}`
      : `raw:${Fudge.normalize(service)}`;
    return [concept, Fudge.normalize(city), mode].join("|");
  };
  const pad = (row, length) => Array.from({ length }, (_, index) => clean(row[index]));
  const validUrl = (value) => /^https:\/\/script\.google\.com\/macros\/s\/[a-z0-9_-]+\/exec(?:\?.*)?$/i.test(clean(value));
  const parseConnection = (value, fallbackSecret = "") => {
    const input = clean(value);
    if (!input.startsWith(CONNECTION_CODE_PREFIX)) return { url: input, secret: clean(fallbackSecret), shared: false };
    const parts = input.split("|");
    if (parts.length !== 3) throw new Error("The Fudge connection code is incomplete.");
    try {
      return { url: decodeURIComponent(parts[1]), secret: decodeURIComponent(parts[2]), shared: true };
    } catch (_error) {
      throw new Error("The Fudge connection code is invalid. Copy it again from the connected computer.");
    }
  };
  const createConnectionCode = (url, secret) => {
    const cleanUrl = clean(url);
    const cleanSecret = clean(secret);
    if (!validUrl(cleanUrl) || cleanSecret.length < 24) throw new Error("Connect the Sheet before copying its connection code.");
    return `${CONNECTION_CODE_PREFIX}${encodeURIComponent(cleanUrl)}|${encodeURIComponent(cleanSecret)}`;
  };

  const connection = async () => {
    const settings = await chrome.storage.local.get({ appsScriptUrl: "", appsScriptSecret: "", appsScriptSecretBackup: "" });
    if (!settings.appsScriptSecret && settings.appsScriptSecretBackup) {
      settings.appsScriptSecret = settings.appsScriptSecretBackup;
      await chrome.storage.local.set({ appsScriptSecret: settings.appsScriptSecret });
    }
    return settings;
  };

  async function remote(action, payload = {}) {
    const { appsScriptUrl, appsScriptSecret } = await connection();
    if (!validUrl(appsScriptUrl) || !appsScriptSecret) {
      const error = new Error("Finish the easy Google Sheets setup in Fudge first.");
      error.code = "SCRIPT_SETUP_REQUIRED";
      throw error;
    }
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), REMOTE_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(appsScriptUrl, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, secret: appsScriptSecret, ...payload }),
        signal: abort.signal
      });
    } catch (error) {
      if (abort.signal.aborted) throw softError("The Fudge connector did not answer in time. It is usually busy rephrasing; Fudge will try again on its own.");
      // No network, or Chrome cancelled the request. Nothing for anyone to fix.
      throw softError(`The Fudge connector could not be reached just now (${error.message}). Fudge will try again on its own.`);
    } finally {
      clearTimeout(deadline);
    }
    if (!response.ok) {
      // 404 from script.google.com means Google will not serve this deployment to
      // the signed-in browser at all, so it is never a secret problem. It is almost
      // always access "Only myself" (which keeps working for the owner, so only the
      // people they share the URL with ever see this) or a second Google account.
      if (response.status === 404) throw new Error("Google returned 404, so this deployment is not shared with this computer. The owner must open Deploy → Manage deployments → ✏️, set Execute as Me and Who has access to Anyone, and deploy. If this browser is signed in to several Google accounts, make the one that should use the Sheet the default account.");
      if (response.status === 401 || response.status === 403) throw new Error("Google blocked this deployment. Change the web app access to Anyone and deploy a new version.");
      // Google throttling or a hiccup on its side: Fudge retries, nobody acts.
      if (response.status === 429 || response.status >= 500) {
        throw softError(`Google was busy (${response.status}). Fudge will try again on its own.`);
      }
      throw new Error(`The Fudge connector could not be reached (${response.status}).`);
    }
    const raw = await response.text();
    let result = null;
    try { result = JSON.parse(raw); } catch (_error) {}
    // Read the version even from a refusal. A connector that is too old to answer
    // without blocking is exactly the case where Fudge needs to be able to say so,
    // and learning the version only from successful replies meant it never could.
    if (result && Number(result.connectorVersion)) connectorVersion = Number(result.connectorVersion);
    if (!result) {
      const authorizationPage = /authorization|authorize|permission|access denied|sign in|accounts\.google/i.test(raw);
      const message = authorizationPage
        ? "Google needs one-time permission for the updated connector. In Apps Script, select fudgeInstallAutomation, click Run, approve access, then deploy a new version."
        : "Apps Script returned a web page instead of connector data. Confirm the /exec deployment uses Execute as Me and access Anyone, then deploy a new version.";
      throw new Error(message);
    }
    if (!result.ok) {
      const permissionError = /ScriptApp|getProjectTriggers|script\.scriptapp|permission to call/i.test(result.error || "");
      const secretError = /secret does not match/i.test(result.error || "");
      // Google's own wording for this is alarming and says nothing useful. It means
      // the Sheet was mid-rephrase. On the current connector that clears by itself
      // within a minute. On an older one it does not: that version holds the same
      // lock for the whole rephrasing batch, so every sync waits thirty seconds and
      // gives up, nothing is ever read, and no scan is ever queued. Fudge has the
      // deployed version in hand here, so it says which of the two this is.
      if (/lock timeout|holding the lock/i.test(result.error || "")) {
        throw connectorVersion && connectorVersion < REQUIRED_CONNECTOR_VERSION
          ? new Error(`The Sheet is blocked by its own rephrasing, because the connector deployed in it is version ${connectorVersion} and Fudge needs ${REQUIRED_CONNECTOR_VERSION}. That older version holds one lock for everything, so syncing can never get through and no scan can start. Use Change sheet → Copy connector, paste it over all the code in Apps Script, save, then Deploy → Manage deployments → ✏️ → Version: New version → Deploy.`)
          : softError("The Sheet was busy rephrasing, so this sync was skipped. Fudge will retry automatically within a minute.");
      }
      if (transientError(result.error || "")) throw softError(result.error);
      if (secretError) {
        // Short, and marked so connecting can try this installation's other secrets
        // before anyone is asked to do anything. The long explanation lives on the
        // setup page, where there is room for it.
        const mismatch = new Error("This deployment answers to a different secret. Copy the connector from this page again, paste it over the Apps Script code, save, then Deploy → Manage deployments → ✏️ → New version.");
        mismatch.secretMismatch = true;
        throw mismatch;
      }
      throw new Error(permissionError
        ? "The deployed connector still contains the old trigger setup. Copy the newest connector, save it, run fudgeInstallAutomation once, and deploy a new version."
        : result.error || "The Fudge connector could not complete this request.");
    }
    connectorVersion = Number(result.connectorVersion) || 1;
    return result;
  }

  async function configure(url, secret) {
    const parsed = parseConnection(url, secret);
    const appsScriptUrl = clean(parsed.url);
    const appsScriptSecret = clean(parsed.secret);
    if (!validUrl(appsScriptUrl)) throw new Error("Paste the deployed Apps Script URL ending in /exec.");
    if (appsScriptSecret.length < 24) throw new Error("The Fudge connector secret is missing.");
    await chrome.storage.local.set({ appsScriptUrl, appsScriptSecret, appsScriptSecretBackup: appsScriptSecret });
    try {
      // A deployment baked earlier by this same installation answers to a secret
      // this installation still holds — just not the newest one. Try each in turn
      // and connect quietly with whichever works, rather than making the operator
      // re-copy and redeploy the connector for a problem Fudge can solve itself.
      const result = await connectWithKnownSecret(appsScriptSecret);
      await ensureAutomation();
      const database = { spreadsheetId: result.spreadsheetId, spreadsheetUrl: result.spreadsheetUrl, connectedAt: now(), connector: "apps-script" };
      // Connecting a sheet prepares everything and collects nothing. Fudge waits
      // for Start, so linking a sheet can never surprise someone with open tabs.
      await chrome.storage.local.set({ sheetsDatabase: database, runState: "stopped", sheetsAutomation: false, saveToDrive: true });
      await chrome.storage.local.remove(["driveClientId", "driveOAuth", "driveProfile", "driveFolderId"]);
      return database;
    } catch (error) {
      await chrome.storage.local.remove(["appsScriptUrl", "sheetsDatabase"]);
      throw error;
    }
  }

  async function connectWithKnownSecret(preferred) {
    const candidates = await knownSecrets(preferred);
    let mismatch = null;
    for (const candidate of candidates) {
      await chrome.storage.local.set({ appsScriptSecret: candidate, appsScriptSecretBackup: candidate });
      try {
        const result = await remote("setup");
        await rememberSecret(candidate);
        return result;
      } catch (error) {
        // Only a secret mismatch is worth trying the next one for. Anything else —
        // a 404, an authorization page, a connector that is simply unreachable — is
        // the same whichever secret is used, so it is reported straight away.
        if (!error.secretMismatch) throw error;
        mismatch = error;
      }
    }
    await chrome.storage.local.set({ appsScriptSecret: preferred, appsScriptSecretBackup: preferred });
    throw mismatch || new Error("The Fudge connector secret is missing.");
  }

  async function disconnect() {
    // Every cache keyed to the old spreadsheet must go, or the next sheet inherits
    // this one's "already known" sets and silently refuses to record anything.
    // appsScriptSecretOwn deliberately survives: it is baked into connectors this
    // installation generated, so discarding it would strand its own deployments.
    await chrome.storage.local.remove(["appsScriptUrl", "appsScriptSecret", "appsScriptSecretBackup", "sheetsDatabase", "sheetsStatus", "sheetKnownReviewIds", "sheetKnownReviewFingerprints", "sheetKnownReviewContentKeys", "recordedBusinessKeys", "activeServiceKeywords", "serviceRules"]);
    await chrome.storage.local.set({ runState: "stopped", sheetsAutomation: false, saveToDrive: false });
  }

  async function getSetup() {
    const settings = await chrome.storage.local.get({ appsScriptUrl: "", appsScriptSecret: "", appsScriptSecretBackup: "", appsScriptSecretOwn: "", sheetsDatabase: null });
    if (!settings.appsScriptSecret && settings.appsScriptSecretBackup) {
      settings.appsScriptSecret = settings.appsScriptSecretBackup;
      await chrome.storage.local.set({ appsScriptSecret: settings.appsScriptSecret });
    }
    const hadUsableSecret = clean(settings.appsScriptSecret).length >= 24;
    // appsScriptSecretOwn is this installation's own identity and is written once.
    // Disconnecting no longer discards it, so a deployment this installation baked
    // stays reachable after a reconnect instead of rejecting its own secret.
    if (clean(settings.appsScriptSecretOwn).length < 24) {
      settings.appsScriptSecretOwn = hadUsableSecret ? clean(settings.appsScriptSecret) : `${crypto.randomUUID()}-${crypto.randomUUID()}`;
      await chrome.storage.local.set({ appsScriptSecretOwn: settings.appsScriptSecretOwn });
    }
    // Every secret this installation has ever shown on this page is kept, so a
    // connector deployed with any of them can still be connected to later.
    await rememberSecret(settings.appsScriptSecretOwn);
    await rememberSecret(settings.appsScriptSecret);
    // While connected, the connector must be re-copied with the secret the live
    // deployment already answers to, or the "deploy a new version" upgrade breaks
    // every other installation sharing that Sheet.
    if (!hadUsableSecret) {
      settings.appsScriptSecret = settings.appsScriptSecretOwn;
      settings.appsScriptSecretBackup = settings.appsScriptSecretOwn;
      await chrome.storage.local.set({ appsScriptSecret: settings.appsScriptSecret, appsScriptSecretBackup: settings.appsScriptSecret });
    }
    settings.connectionReady = Boolean(settings.sheetsDatabase?.connector === "apps-script" && validUrl(settings.appsScriptUrl) && hadUsableSecret);
    return settings;
  }

  // Every secret this installation has ever used. A deployment baked at any point
  // by this copy of Fudge answers to one of them, so connecting can find the right
  // one by itself instead of asking the operator to re-copy the connector.
  async function knownSecrets(preferred = "") {
    const stored = await chrome.storage.local.get({
      appsScriptSecret: "", appsScriptSecretBackup: "", appsScriptSecretOwn: "", appsScriptSecretHistory: []
    });
    const all = [preferred, stored.appsScriptSecret, stored.appsScriptSecretBackup, stored.appsScriptSecretOwn, ...(stored.appsScriptSecretHistory || [])];
    return [...new Set(all.map(clean).filter((value) => value.length >= 24))];
  }

  async function rememberSecret(secret) {
    const value = clean(secret);
    if (value.length < 24) return;
    const { appsScriptSecretHistory = [] } = await chrome.storage.local.get({ appsScriptSecretHistory: [] });
    if (appsScriptSecretHistory.includes(value)) return;
    await chrome.storage.local.set({ appsScriptSecretHistory: [value, ...appsScriptSecretHistory].slice(0, 10) });
  }

  async function getConnectionCode() {
    const settings = await connection();
    return createConnectionCode(settings.appsScriptUrl, settings.appsScriptSecret);
  }

  // The connector reports the health of its own automation — whether its triggers
  // exist and what the last rephrasing error was — alongside every read, so the
  // side panel can say "rephrasing is not installed" instead of staying silent.
  let connectorAutomation = null;

  async function ensureAutomation() {
    try {
      const result = await remote("installAutomation");
      if (result.automation) connectorAutomation = result.automation;
      return { ok: true, automation: result.automation || null };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  // Manual twins of the Sheet's own triggers, for when waiting is not wanted.
  // Everything still happens automatically; these just do it now.
  async function fillRowsNow() {
    const result = await remote("processQueue");
    if (result.automation) connectorAutomation = result.automation;
    return { ok: true, filled: Number(result.filled) || 0, replaced: Number(result.replaced) || 0, rephrased: Number(result.rephrased) || 0 };
  }

  async function rephraseNow() {
    const result = await remote("rephraseNow");
    if (result.automation) connectorAutomation = result.automation;
    return { ok: true, rephrased: Number(result.rephrased) || 0, pending: Number(result.pending) || 0, automation: result.automation || null };
  }

  async function batchGet(_spreadsheetId, ranges, driving = false) {
    const result = await remote("read", { ranges, driving });
    if (result.automation) connectorAutomation = result.automation;
    return result.values || ranges.map(() => []);
  }
  async function batchWrite(_spreadsheetId, data, deferRephrase = false) {
    if (!data.length) return { totalUpdatedRows: 0 };
    const result = await remote("batchWrite", { updates: data, deferRephrase });
    if (deferRephrase && Array.isArray(result.touchedRows) && result.touchedRows.length) {
      // The one-minute Sheet automation and five-minute rephrase trigger remain
      // fallbacks if the worker is stopped before this independent request finishes.
      remote("rephraseRows", { rows: result.touchedRows }).catch(() => {});
    }
    return result;
  }
  async function appendRows(_spreadsheetId, tab, rows) {
    if (!rows.length) return null;
    return remote("appendRows", { tab, rows });
  }
  async function rewriteReview(review, phone, names) {
    return remote("rewriteReview", { review: { text: review.text || "", author: review.author || "", business: review.placeName || "", city: review.searchCity || "" }, phone, names });
  }

  async function ensureDatabase() {
    const { sheetsDatabase = null } = await chrome.storage.local.get({ sheetsDatabase: null });
    const result = await remote("setup");
    const database = { spreadsheetId: result.spreadsheetId, spreadsheetUrl: result.spreadsheetUrl, connectedAt: sheetsDatabase?.connectedAt || now(), connector: "apps-script" };
    await chrome.storage.local.set({ sheetsDatabase: database });
    // Setup itself stays free of trigger permissions, so the Sheet's own automation
    // is installed right after it, separately and tolerantly. Nobody should have to
    // open the Apps Script editor and run a function by hand for rephrasing to
    // happen — that manual step is why it worked for some sheets and not others.
    await ensureAutomation();
    return database;
  }

  // The Reviews tab's status column is shared ground: the Apps Script connector
  // runs its own QC replacements there on an edit trigger and cannot see
  // chrome.storage. A status only ever moves up this ladder, so neither side can
  // undo the other's work by being out of date.
  const STATUS_RANK = { rejected: 2, used: 1, unused: 0 };
  const statusRank = (value) => STATUS_RANK[Fudge.normalize(value)] || 0;

  function localReviewRow(review, websiteCopy = "", phone = "") {
    // A five-star review taken after the photo grace period has no pictures; say
    // so in the column rather than leaving it blank.
    const originalLinks = (review.photos || []).length ? review.photos.join("\n") : NO_PICTURE_TEXT;
    const driveLinks = (review.drivePhotos || []).map((photo) => Fudge.driveShareLink(photo?.shareLink || photo?.id || photo?.viewLink || photo?.directLink || "")).filter(Boolean).join("\n");
    return [review.id, Fudge.reviewKey(review), review.service?.label || "", review.service?.subcategory?.label || "", review.searchCity || "", review.placeName || "", review.placeId || "", review.text || "", modeLabel((review.photos || []).length ? "photo" : "without-picture"), originalLinks, driveLinks, review.rejectedAt ? "Rejected" : review.usedAt ? "Used" : "Unused", review.usedAt || "", review.requestId || "", review.sourceUrl || "", review.collectedAt || now(), review.rejectedAt ? "Rejected during quality checking" : "", String(websiteCopy || ""), String(phone || "")];
  }

  function inventoryItem(values, rowNumber) {
    const row = pad(values, REVIEW_HEADERS.length);
    const classifiedService = Fudge.classify(`${row[2]} ${row[3]}`);
    // The service columns are authoritative after collection. Also repair older
    // rows affected by the ambiguous word "moved" when the business itself is
    // unmistakably a garage-door specialist.
    const sourceServiceId = Fudge.businessMatchesKeyword(row[5], "Garage Door Repair")
      ? "garage-doors"
      : classifiedService.matched ? classifiedService.id : "";
    return { row, rowNumber, id: row[0], fingerprint: row[1], service: row[2], subcategory: row[3], classifiedService, sourceServiceId, city: row[4], business: row[5], placeId: row[6], text: row[7], mode: modeFrom(row[8]), originalLinks: splitLinks(row[9]), driveLinks: splitLinks(row[10]).map((link) => Fudge.driveShareLink(link)).filter(Boolean), status: Fudge.normalize(row[11]) || "unused" };
  }

  const inventoryIdentityKeys = (item) => {
    const keys = [];
    if (item?.id) keys.push(`id:${item.id}`);
    if (item?.fingerprint) keys.push(`fingerprint:${item.fingerprint}`);
    const text = Fudge.normalize(item?.text || "");
    const place = Fudge.normalize(item?.placeId || item?.business || "");
    if (text && place) keys.push(`content-place:${Fudge.reviewContentKey(item)}`);
    return keys;
  };

  const structureIdentityKeys = (state, item) => item
    ? inventoryIdentityKeys(item)
    : [
      state.row[8] ? `id:${state.row[8]}` : "",
      state.row[4] && state.row[9] ? `content-place:${Fudge.reviewContentKey({ text: state.row[4], placeName: state.row[9] })}` : ""
    ].filter(Boolean);

  function itemMatches(item, requirement) {
    if (item.status !== "unused" || item.mode !== requirement.mode) return false;
    const target = Fudge.serviceIdentity(requirement.service);
    if (item.sourceServiceId && target.matched && item.sourceServiceId !== target.id) return false;
    // A requirement with no city draws on the whole inventory. Pinning every
    // review to one city fragments the pool once there are many cities.
    const wantedCity = Fudge.normalize(requirement.city);
    if (wantedCity && Fudge.normalize(item.city) !== wantedCity) return false;
    return Fudge.matchesServiceKeyword({
      service: item.classifiedService,
      sourceServiceId: item.sourceServiceId,
      text: item.text,
      business: item.business,
      placeName: item.business
    }, requirement.service);
  }

  // A sync asked for by a button, or by a start, waits for the one in flight and
  // then runs. Returning "already running" made the caller believe it had an answer
  // when nothing had been read, and the Start button reported the wrong reason.
  function sync(options = {}) {
    if (syncing && options.scheduled) return Promise.resolve({ ok: true, skipped: "sync already running" });
    const run = syncChain.catch(() => {}).then(() => syncPass(options));
    syncChain = run.catch(() => {});
    return run;
  }

  let headerCheckBusy = false;
  async function maintainHeaders(spreadsheetId) {
    if (headerCheckBusy) return;
    const { sheetHeaderCheck = null } = await chrome.storage.local.get({ sheetHeaderCheck: null });
    if (sheetHeaderCheck?.spreadsheetId === spreadsheetId && Date.now() - Date.parse(sheetHeaderCheck.checkedAt || "") < 24 * 60 * 60 * 1000) return;
    headerCheckBusy = true;
    try {
      const headerRead = await batchGet(spreadsheetId, ["Reviews!A1:S1", "Services!A1:P1"]);
      const topUps = [
        { range: "Reviews!A1:S1", expected: REVIEW_HEADERS, source: headerRead?.[0]?.[0] || [] },
        { range: "Services!A1:P1", expected: SERVICE_HEADERS, source: headerRead?.[1]?.[0] || [] }
      ].flatMap(({ range, expected, source }) => {
        const header = pad(source, expected.length);
        const isFudgeHeader = header.every((value, index) => !value || value === expected[index]);
        return isFudgeHeader && expected.some((value, index) => value !== header[index])
          ? [{ range, values: [header.map((value, index) => value || expected[index])] }]
          : [];
      });
      if (topUps.length) await batchWrite(spreadsheetId, topUps);
      await chrome.storage.local.set({ sheetHeaderCheck: { spreadsheetId, checkedAt: now() } });
    } catch (_error) { /* Header maintenance retries later and never holds up collecting. */ }
    finally { headerCheckBusy = false; }
  }

  async function syncPass(options = {}) {
    syncing = true;
    try {
      const settings = await chrome.storage.local.get({ sheetsDatabase: null, runState: "", sheetsAutomation: false, parallelTabs: DEFAULT_PARALLEL_JOBS });
      if (!settings.sheetsDatabase?.spreadsheetId) return { ok: false, needsSetup: true, error: "Connect the Fudge spreadsheet first." };
      const running = settings.runState ? settings.runState === "running" : Boolean(settings.sheetsAutomation);
      if (!running && !options.force) return { ok: true, paused: true };
      const spreadsheetId = settings.sheetsDatabase.spreadsheetId;
      const coreRanges = ["Structure!A2:K", "Reviews!A2:S", "'Search Progress'!A2:I"];
      const extraRanges = ["Cities!A2:E", "Services!A2:P"];
      let connectorOutdated = false;
      let readValues;
      try {
        readValues = await batchGet(spreadsheetId, [...coreRanges, ...extraRanges], running);
      } catch (error) {
        // An older connector does not know these tabs and refuses the whole request.
        // Fall back to the tabs it does know so everything else keeps working.
        if (!/invalid fudge (range|tab)/i.test(error.message)) throw error;
        connectorOutdated = true;
        readValues = [...(await batchGet(spreadsheetId, coreRanges, running)), ...extraRanges.map(() => [])];
      }
      if (connectorVersion && connectorVersion < REQUIRED_CONNECTOR_VERSION) connectorOutdated = true;
      const [structureRows, reviewRows, progressRows, cityRows, serviceRows] = readValues;
      // The Services tab is the list of trades actually offered. Anything outside it
      // is not worth collecting, so the scanner is told about it up front.
      const services = [];
      const seenServices = new Set();
      const serviceRuleUpdates = [];
      (serviceRows || []).forEach((source, index) => {
        const row = pad(source, SERVICE_HEADERS.length);
        const key = Fudge.normalize(row[0]);
        if (!row[0] || seenServices.has(key)) return;
        seenServices.add(key);
        const rowNumber = index + 2;
        // Existing Sheets start with only A:D. Seed the current trained behavior
        // once, then every value in E:N belongs to the Sheet and can be edited
        // without another extension release. A dash or "none" means an intentional
        // empty list.
        if (row.slice(4).every((value) => !clean(value))) {
          const seeded = Fudge.defaultServiceRule(row[0]);
          row[4] = seeded.searchTerm;
          row[5] = ruleText(seeded.businessSignals);
          row[6] = ruleText(seeded.reviewSignals);
          row[7] = ruleText(seeded.requiredSignals);
          row[8] = ruleText(seeded.topicSignals);
          row[9] = ruleText(seeded.excludeSignals);
          row[10] = seeded.family;
          row[11] = seeded.subcategory;
          row[12] = seeded.topicRequired ? "Yes" : "No";
          row[13] = seeded.collectFamilyInventory ? "Yes" : "No";
          row[14] = seeded.rewriteServicePhrase;
          row[15] = ruleText(seeded.equivalentServicePhrases);
          serviceRuleUpdates.push({ range: `Services!A${rowNumber}:P${rowNumber}`, values: [row] });
        }
        const rule = {
          keyword: row[0],
          searchTerm: row[4] || row[0],
          businessSignals: ruleList(row[5]),
          reviewSignals: ruleList(row[6]),
          requiredSignals: ruleList(row[7]),
          topicSignals: ruleList(row[8]),
          excludeSignals: ruleList(row[9]),
          family: row[10] || row[0],
          subcategory: row[11] || row[0],
          topicRequired: yes(row[12]),
          collectFamilyInventory: yes(row[13]),
          rewriteServicePhrase: row[14] || row[0],
          equivalentServicePhrases: ruleList(row[15])
        };
        services.push({ keyword: row[0], key, paused: Fudge.normalize(row[1]) === "paused", row, rowNumber, rule });
      });
      const serviceRules = services.map((service) => service.rule);
      Fudge.setServiceRules(serviceRules);
      // getReviews() also loads the rules from local storage while normalizing old
      // inventory. Persist this Sheet snapshot first so it cannot restore the
      // previous sync's rules in the middle of this run.
      await chrome.storage.local.set({ serviceRules });
      const activeServiceKeywords = services.filter((service) => !service.paused).map((service) => service.keyword);
      // A paused trade drops every review it finds during collection, so its scans
      // can never fill the row that reads "Waiting for reviews". Job generation
      // must respect the same switch the scanner already applies.
      const pausedKeywordSet = new Set(services.filter((service) => service.paused).map((service) => Fudge.normalize(service.keyword)));
      // Search Progress is the single source of truth for what has been exhausted.
      // The Cities tab is the user's input list plus a readable mirror of that truth.
      const progressByKey = new Map(progressRows.map((row, index) => [clean(row[0]), { row: pad(row, PROGRESS_HEADERS.length), rowNumber: index + 2 }]).filter(([key]) => key));
      const cities = [];
      const seenCities = new Set();
      (cityRows || []).forEach((source, index) => {
        const row = pad(source, CITY_HEADERS.length);
        const key = Fudge.normalize(row[0]);
        if (!row[0] || seenCities.has(key)) return;
        seenCities.add(key);
        cities.push({ name: row[0], key, row, rowNumber: index + 2 });
      });
      const reviewById = new Map(reviewRows.map((row, index) => [clean(row[0]), { row: pad(row, REVIEW_HEADERS.length), rowNumber: index + 2 }]).filter(([id]) => id));
      const reviewByFingerprint = new Map(reviewRows.map((row, index) => [clean(row[1]), { row: pad(row, REVIEW_HEADERS.length), rowNumber: index + 2 }]).filter(([fingerprint]) => fingerprint));
      const localReviews = await Fudge.getReviews();
      // Inventory rows are source material, so writing them to Reviews must never
      // spend API credits. Only a filled Structure row is rewritten automatically;
      // the dashboard's Website writer remains available when explicitly clicked.
      const newRows = [];
      const newEntries = [];
      localReviews.forEach((review) => {
        const fingerprint = Fudge.reviewKey(review);
        if (reviewById.has(review.id) || reviewByFingerprint.has(fingerprint)) return;
        const row = localReviewRow(review, "", "");
        newRows.push(row);
        // One entry per appended row, shared by both indexes, holding the position
        // implied by the read until the connector reports the real one below.
        const entry = { row, rowNumber: reviewRows.length + newRows.length + 1 };
        newEntries.push(entry);
        reviewById.set(review.id, entry);
        reviewByFingerprint.set(fingerprint, entry);
      });
      if (newRows.length) {
        const appended = await appendRows(spreadsheetId, "Reviews", newRows);
        // A review appended now can be used to fill a row in this same sync, and
        // its "Used" mark is written by row number. That number cannot be inferred
        // from the read: the tab's last row counts anything in it, while the read
        // stops at the last row carrying a value in the columns Fudge asks for.
        // Being one row out marked a different review as used, so take the position
        // the connector reports whenever it offers one.
        const startRow = Number(appended?.startRow) || 0;
        // The connector drops rows it already holds, so a skip means these entries
        // are not the rows that were written and their positions are unknown. A
        // rowNumber of 0 keeps this sync from writing a status to a guessed row;
        // the next sync reads the tab and picks them up properly.
        if (Number(appended?.skipped) > 0 || Number(appended?.appended) !== newEntries.length) {
          newEntries.forEach((entry) => { entry.rowNumber = 0; });
        } else if (startRow > 1) {
          newEntries.forEach((entry, index) => { entry.rowNumber = startRow + index; });
        }
      }

      const updates = [...serviceRuleUpdates];
      const localById = new Map(localReviews.map((review) => [review.id, review]));
      reviewById.forEach((entry, id) => {
        const originalLinks = splitLinks(entry.row[9]).join("\n");
        const driveLinks = splitLinks(entry.row[10]).map((link) => Fudge.driveShareLink(link)).filter(Boolean).join("\n");
        if (entry.row[9] !== originalLinks || entry.row[10] !== driveLinks) {
          entry.row[9] = originalLinks;
          entry.row[10] = driveLinks;
          updates.push({ range: `Reviews!J${entry.rowNumber}:K${entry.rowNumber}`, values: [[originalLinks, driveLinks]] });
        }
        const local = localById.get(id);
        if (!local) return;
        const serviceLabel = local.service?.label || entry.row[2];
        const subcategoryLabel = local.service?.subcategory?.label || entry.row[3];
        if (entry.row[2] !== serviceLabel || entry.row[3] !== subcategoryLabel) {
          entry.row[2] = serviceLabel;
          entry.row[3] = subcategoryLabel;
          updates.push({ range: `Reviews!C${entry.rowNumber}:D${entry.rowNumber}`, values: [[serviceLabel, subcategoryLabel]] });
        }
        const desired = local.rejectedAt ? "Rejected" : local.usedAt ? "Used" : "Unused";
        const sheetStatus = entry.row[11];
        const pushStatus = () => {
          entry.row[12] = local.usedAt || "";
          updates.push({ range: `Reviews!L${entry.rowNumber}:M${entry.rowNumber}`, values: [[entry.row[11], entry.row[12]]] });
        };
        if (!entry.rowNumber) {
          // Position unknown this sync (see the append above); never guess a row.
        } else if (statusRank(desired) > statusRank(sheetStatus)) {
          // This library knows the review has been spent and the Sheet does not yet.
          entry.row[11] = desired;
          local.releasedAt = null;
          pushStatus();
        } else if (statusRank(sheetStatus) > statusRank(desired) && local.releasedAt) {
          // Someone freed this review on the dashboard. That is a deliberate
          // instruction, so it is the one case that may send a status back down.
          entry.row[11] = desired;
          local.releasedAt = null;
          pushStatus();
        } else if (statusRank(sheetStatus) > statusRank(desired)) {
          // The Sheet is ahead — the connector filled or rejected this review while
          // Chrome was not watching. Catch the library up instead of undoing it;
          // overwriting here is what turned a rejected review back into "Unused"
          // and put it straight back in the pool.
          if (Fudge.normalize(sheetStatus) === "rejected") {
            local.rejectedAt = local.rejectedAt || now();
            local.usedAt = null;
          } else {
            local.usedAt = local.usedAt || entry.row[12] || now();
          }
          local.requestId = local.requestId || entry.row[13] || "";
        }
      });

      // Rows are filled from the first matching review, so the order here is the
      // priority. A review Fudge could only file under "General repairs" or a
      // family's catch-all subsection says the least about what the job was, so it
      // sinks to the bottom and is used only once nothing better is left. The sort
      // is stable, so everything else keeps the order it already had.
      const inventory = [...reviewById.entries()]
        .map(([id, entry]) => ({ ...inventoryItem(entry.row, entry.rowNumber), id }))
        .sort((a, b) => Number(Fudge.isCatchAllClassification(a.classifiedService)) - Number(Fudge.isCatchAllClassification(b.classifiedService)));
      const structureState = [];
      let carriedMode = null;
      structureRows.forEach((source, index) => {
        const row = pad(source, STRUCTURE_HEADERS.length);
        const rowNumber = index + 2;
        const marker = modeFrom(row[1] || row[2]);
        const markerOnly = /self\s*write|without\s*(?:a\s*)?picture|no\s*picture/i.test(row[2]) && !row[3] && !row[4];
        if (markerOnly) { carriedMode = "without-picture"; return; }
        const service = row[2]; const city = row[3];
        if (!service) {
          // Silently dropping a row the user filled in looks like a lost request.
          if (row[1] || row[3] || row[4]) {
            row[7] = "Needs a service keyword";
            row[10] = now();
            updates.push({ range: `Structure!A${rowNumber}:K${rowNumber}`, values: [row] });
          }
          return;
        }
        const mode = /self\s*write|without\s*(?:a\s*)?picture|no\s*picture/i.test(row[1]) ? "without-picture" : carriedMode || marker;
        carriedMode = null;
        if (!row[0]) row[0] = `REQ-${rowNumber}`;
        // Snapshotted as read, so the write-back below can tell a row that genuinely
        // changed from one that was merely looked at again.
        const state = { row, rowNumber, requestId: row[0], mode, service, city, original: row.slice() };
        if (Fudge.normalize(row[6]) === "change it") {
          const oldId = row[8];
          const old = inventory.find((item) => item.id === oldId);
          if (old) {
            old.status = "rejected"; old.row[11] = "Rejected"; old.row[12] = ""; old.row[13] = row[0]; old.row[16] = "Rejected during quality checking";
            updates.push({ range: `Reviews!L${old.rowNumber}:Q${old.rowNumber}`, values: [[old.row[11], old.row[12], old.row[13], old.row[14], old.row[15], old.row[16]]] });
            const local = localById.get(oldId);
            if (local) { local.rejectedAt = now(); local.usedAt = null; local.releasedAt = null; }
          }
          row[4] = ""; row[5] = ""; row[7] = "Replacing"; row[8] = ""; row[9] = "";
        }
        structureState.push(state);
      });

      // A review may appear twice in an old Sheet under different Google IDs or
      // fingerprints. Claim every already-filled review by ID, fingerprint and a
      // text+business fallback. If the same underlying review filled two Structure
      // rows, keep the first assignment and return the later row to the queue.
      const claimedReviewKeys = new Set();
      const claimedOwners = new Map();
      structureState.filter((state) => state.row[8] || state.row[4]).forEach((state) => {
        const item = inventory.find((candidate) => candidate.id === state.row[8]);
        const keys = structureIdentityKeys(state, item);
        const duplicateOwner = keys.map((key) => claimedOwners.get(key)).find(Boolean);
        if (!duplicateOwner) {
          keys.forEach((key) => { claimedReviewKeys.add(key); claimedOwners.set(key, item?.id || state.row[8] || state.requestId); });
          return;
        }
        // A separate duplicate Reviews row must never be offered again. When the
        // exact same Review ID was assigned twice, preserve its first valid use.
        if (item && duplicateOwner !== item.id) {
          item.status = "rejected";
          item.row[11] = "Rejected";
          item.row[12] = "";
          item.row[13] = "";
          item.row[16] = "Duplicate review blocked automatically";
          updates.push({ range: `Reviews!L${item.rowNumber}:Q${item.rowNumber}`, values: [[item.row[11], item.row[12], item.row[13], item.row[14], item.row[15], item.row[16]]] });
          const local = localById.get(item.id);
          if (local) { local.rejectedAt = now(); local.usedAt = null; local.releasedAt = null; local.requestId = ""; }
        }
        state.row[4] = "";
        state.row[5] = "";
        state.row[6] = "";
        state.row[7] = "Replacing duplicate";
        state.row[8] = "";
        state.row[9] = "";
        state.row[10] = now();
      });

      // Rows filled before this change hold the scraped googleusercontent URL, or
      // an older Drive shape. Whenever the review behind a row has Drive links, the
      // cell is brought into line. Rows whose pictures never reached Drive are left
      // exactly as they are rather than emptied.
      structureState.filter((state) => state.row[8]).forEach((state) => {
        const item = inventory.find((candidate) => candidate.id === state.row[8]);
        if (!item || !item.driveLinks.length) return;
        const links = item.driveLinks.join(String.fromCharCode(10));
        if (clean(state.row[5]) !== links) state.row[5] = links;
      });
      const unfilled = structureState.filter((state) => !state.row[8] && !state.row[4]);
      unfilled.forEach((requirement) => {
        const candidate = inventory.find((item) => itemMatches(item, requirement) && !inventoryIdentityKeys(item).some((key) => claimedReviewKeys.has(key)));
        // Already waiting and still waiting is not a change. Stamping it every
        // minute is what made Updated At churn on rows nobody had touched.
        if (!candidate) { requirement.row[7] = "Waiting for reviews"; return; }
        inventoryIdentityKeys(candidate).forEach((key) => { claimedReviewKeys.add(key); claimedOwners.set(key, candidate.id); });
        candidate.status = "used"; candidate.row[11] = "Used"; candidate.row[12] = now(); candidate.row[13] = requirement.requestId;
        requirement.row[4] = candidate.text;
        requirement.row[5] = (candidate.driveLinks.length ? candidate.driveLinks : []).join("\n");
        requirement.row[6] = "QC needed"; requirement.row[7] = "Filled"; requirement.row[8] = candidate.id; requirement.row[9] = candidate.business; requirement.row[10] = now();
        if (candidate.rowNumber > 1) updates.push({ range: `Reviews!L${candidate.rowNumber}:N${candidate.rowNumber}`, values: [[candidate.row[11], candidate.row[12], candidate.row[13]]] });
        const local = localById.get(candidate.id);
        if (local) { local.usedAt = candidate.row[12]; local.releasedAt = null; local.requestId = requirement.requestId; }
      });

      // Only rows that actually changed are written. Writing every row on every
      // sync churned Updated At on untouched rows, and cost a full rewrite of the
      // tab each minute — with the connector reformatting and re-reading each one.
      // That is most of the slowness, and all of the timestamp noise.
      structureState.forEach((state) => {
        const changed = state.row.some((value, index) => index !== 10 && clean(value) !== clean(state.original[index]));
        if (!changed) return;
        state.row[10] = now();
        updates.push({ range: `Structure!A${state.rowNumber}:K${state.rowNumber}`, values: [state.row] });
      });
      const deficits = new Map();
      const ensureDeficit = (requirement) => {
        const key = requirementKey(requirement.service, requirement.city, requirement.mode);
        const existing = deficits.get(key);
        if (existing) return existing;
        // Seed groups from every Structure row, not just the currently empty
        // rows. This preserves the first occurrence as the batch priority after
        // its own row has been filled. Without it, a different keyword between
        // two repeated requirements could jump the queue on the next sync.
        const created = { ...requirement, key, amount: 0, unfilled: 0 };
        deficits.set(key, created);
        return created;
      };
      // `unfilled` counts only what an empty Structure row needs. The rest is the
      // spare buffer kept behind a row that is already filled and waiting on QC,
      // and that is worth searching for only once nothing is still empty.
      const addDeficit = (requirement, amount, forEmptyRow = false) => {
        if (amount <= 0) return;
        const existing = ensureDeficit(requirement);
        existing.amount += amount;
        if (forEmptyRow) existing.unfilled += amount;
      };
      structureState.forEach(ensureDeficit);
      structureState.filter((state) => !state.row[8] && !state.row[4]).forEach((state) => addDeficit(state, 3, true));
      const reserved = new Set(claimedReviewKeys);
      structureState.filter((state) => state.row[8] && Fudge.normalize(state.row[6]) === "qc needed").forEach((state) => {
        let found = 0;
        inventory.forEach((item) => {
          const keys = inventoryIdentityKeys(item);
          if (found >= 2 || keys.some((key) => reserved.has(key)) || !itemMatches(item, state)) return;
          keys.forEach((key) => reserved.add(key));
          found += 1;
        });
        addDeficit(state, 2 - found);
      });

      if (services.length) {
        const counts = new Map();
        services.forEach((service) => counts.set(service.key, 0));
        inventory.forEach((item) => {
          const candidate = { service: item.classifiedService, sourceServiceId: item.sourceServiceId, text: item.text };
          services.forEach((service) => {
            if (Fudge.matchesServiceKeyword(candidate, service.keyword)) counts.set(service.key, counts.get(service.key) + 1);
          });
        });
        services.forEach((service) => {
          const collected = String(counts.get(service.key) || 0);
          const status = service.paused ? "Paused" : "Active";
          if (clean(service.row[1]) === status && clean(service.row[2]) === collected) return;
          service.row[1] = status;
          service.row[2] = collected;
          updates.push({ range: `Services!A${service.rowNumber}:D${service.rowNumber}`, values: [service.row.slice(0, 4)] });
        });
      }
      if (cities.length) {
        const progressByCity = new Map();
        progressByKey.forEach((entry) => {
          const key = Fudge.normalize(entry.row[2]);
          if (!key) return;
          progressByCity.set(key, [...(progressByCity.get(key) || []), entry.row]);
        });
        cities.forEach((city) => {
          const rows = progressByCity.get(city.key) || [];
          if (!rows.length) return;
          const exhaustedKeywords = [...new Set(rows.filter((row) => Fudge.normalize(row[6]) === "yes").map((row) => clean(row[1])).filter(Boolean))].join(" | ");
          const lastUsed = rows.map((row) => clean(row[8])).filter(Boolean).sort().pop() || "";
          // Only touch a city row when something about it actually changed; a
          // thousand-row rewrite on every sync is what this avoids.
          if (clean(city.row[1]) === "In use" && clean(city.row[2]) === lastUsed && clean(city.row[3]) === exhaustedKeywords) return;
          city.row[1] = "In use";
          city.row[2] = lastUsed;
          city.row[3] = exhaustedKeywords;
          updates.push({ range: `Cities!A${city.rowNumber}:E${city.rowNumber}`, values: [city.row] });
        });
      }
      if (updates.length) await batchWrite(spreadsheetId, updates, true);
      if (localReviews.length) {
        // A content scan can finish while this Sheet sync is writing. Re-read the
        // library and merge only the Sheet-owned status fields so a stale sync
        // snapshot can never erase reviews or pictures collected moments later.
        const statusById = new Map(localReviews.map((review) => [review.id, {
          usedAt: review.usedAt || null,
          rejectedAt: review.rejectedAt || null,
          releasedAt: review.releasedAt || null,
          requestId: review.requestId || ""
        }]));
        const latestReviews = await Fudge.getReviews();
        const reconciled = latestReviews.map((review) => statusById.has(review.id)
          ? { ...review, ...statusById.get(review.id) }
          : review);
        await Fudge.saveReviews(reconciled);
      }
      const isExhausted = (key) => Fudge.normalize(progressByKey.get(key)?.row[6]) === "yes";
      // A requirement names a keyword, not a place. Give each keyword a stable,
      // shuffled city order so every service does not begin in the first city in
      // the Sheet. Stability matters: reloads must resume a partly searched city
      // rather than rolling another random choice. Once that combination is
      // exhausted, the next city in that keyword's shuffled order takes over.
      // A city written on the Structure row still wins.
      const resolveTarget = (deficit) => {
        if (deficit.city) {
          const key = searchKey(deficit.service, deficit.city, deficit.mode);
          return isExhausted(key) ? null : { name: deficit.city, key };
        }
        if (!cities.length) {
          const key = searchKey(deficit.service, "", deficit.mode);
          return isExhausted(key) ? null : { name: "", key };
        }
        const available = cities.map((city) => {
          const key = searchKey(deficit.service, city.name, deficit.mode);
          return { name: city.name, key, progress: progressByKey.get(key)?.row || null };
        }).filter((candidate) => !isExhausted(candidate.key));
        // Cities take turns. A city used to stay pinned to its keyword until it was
        // marked exhausted, and exhaustion is only recorded when a scan runs out of
        // results or hits the page cap. Every other ending — target reached,
        // stopped, blocked, interrupted — left it pinned, so the same city was
        // searched again and again and the rest of the list was never reached.
        //
        // Nothing is lost by moving on: each city keeps its own checkpoint, so when
        // its turn comes round again it resumes exactly where it stopped.
        const byKeyword = (a, b) => {
          const score = (name) => parseInt(Fudge.hash([Fudge.normalize(deficit.service), Fudge.normalize(name), deficit.mode].join("|")), 36);
          return score(a.name) - score(b.name);
        };
        // A city nobody has searched yet comes first, in this keyword's own stable
        // shuffled order, so the list is covered before anything is revisited.
        const fresh = available.filter((candidate) => !candidate.progress).sort(byKeyword);
        if (fresh.length) return { name: fresh[0].name, key: fresh[0].key };
        // Then the one left alone the longest, which is what makes it a rotation
        // rather than a loop over whichever was touched last.
        const started = available.filter((candidate) => candidate.progress)
          .sort((a, b) => clean(a.progress[8]).localeCompare(clean(b.progress[8])) || byKeyword(a, b));
        return started.length ? { name: started[0].name, key: started[0].key } : null;
      };

      // Return one distinct keyword per available Google tab.
      const jobLimit = Math.min(MAX_PARALLEL_JOBS, Math.max(1, Number.parseInt(settings.parallelTabs, 10) || DEFAULT_PARALLEL_JOBS));
      const nextJobs = [];
      const claimedKeywords = new Set();
      const exhaustedEverywhere = [];
      const pausedEverywhere = [];
      // A keyword whose rows are all filled already has what it needs; any deficit
      // left on it is the spare buffer. Those go to the back, so every keyword with
      // an empty row is searched for first and the buffer is only topped up once
      // nothing is waiting. The sort is stable, so the Structure row order still
      // decides priority inside each group.
      const ordered = [...deficits.values()].sort((a, b) => Number(b.unfilled > 0) - Number(a.unfilled > 0));
      for (const deficit of ordered) {
        if (deficit.amount <= 0) continue;
        const keywordKey = Fudge.normalize(deficit.service);
        if (claimedKeywords.has(keywordKey)) continue;
        if (pausedKeywordSet.has(keywordKey)) {
          // Scanning for a paused trade can only exhaust cities: collection keeps
          // active Services trades only, so nothing it finds can fill the row.
          // Report it so the panel can explain why the row keeps waiting.
          pausedEverywhere.push(deficit.service);
          continue;
        }
        const target = resolveTarget(deficit);
        if (!target) {
          // Every city for this keyword is used up. Report it, then carry on down
          // the list: stopping here meant one exhausted keyword silently blocked
          // every keyword added after it, which looked exactly like Fudge ignoring
          // new Sheet entries. The exhausted keyword keeps its place and resumes as
          // soon as a city is added.
          exhaustedEverywhere.push(deficit.service);
          continue;
        }
        const progress = progressByKey.get(target.key)?.row || [];
        claimedKeywords.add(keywordKey);
        nextJobs.push({ auto: true, searchKey: target.key, serviceKeyword: deficit.service, city: target.name, reviewMode: deficit.mode, targetCount: deficit.amount, query: Fudge.buildSearchQuery(deficit.service, target.name), currentPage: Math.max(1, Number(progress[4]) || 1), businessIndex: Math.max(0, Number(progress[5]) || 0), visitedPlaceIds: clean(progress[7]).split("|").filter(Boolean) });
        if (nextJobs.length >= jobLimit) break;
      }
      const nextJob = nextJobs[0] || null;
      // Self-heal the Sheet's own automation. If its triggers are missing — never
      // installed, deleted, or disabled by Google after a run of failures — try
      // once per sync to put them back, then report whatever is still wrong.
      const repairAutomation = Boolean(connectorAutomation && !(connectorAutomation.queueTrigger && connectorAutomation.rephraseTrigger));
      const status = { ok: true, syncedAt: now(), spreadsheetId, connectorOutdated, serviceCount: activeServiceKeywords.length, newReviews: newRows.length, nextJobs, filled: unfilled.length - structureState.filter((state) => !state.row[8] && !state.row[4]).length, nextJob, cityCount: cities.length, exhaustedEverywhere: [...new Set(exhaustedEverywhere)], pausedEverywhere: [...new Set(pausedEverywhere)], automation: connectorAutomation };
      softFailures = 0;
      const sheetKnownReviewContentKeys = [...new Set(inventory.map((item) => Fudge.reviewContentKey(item)).filter(Boolean))];
      await chrome.storage.local.set({ sheetsStatus: status, activeServiceKeywords, serviceRules, sheetKnownReviewIds: [...reviewById.keys()], sheetKnownReviewFingerprints: [...reviewByFingerprint.keys()], sheetKnownReviewContentKeys });
      // These are maintenance requests. Let the caller open Google from the queue
      // before either round trip waits on Apps Script or its rephrasing process.
      maintainHeaders(spreadsheetId).catch(() => {});
      if (repairAutomation) ensureAutomation().catch(() => {});
      return status;
    } catch (error) {
      // A condition that clears itself is reported as a notice, not a failure. The
      // Sheet being mid-rephrase, Google throttling or a dropped connection are all
      // things Fudge is about to retry, and calling them errors made a working
      // setup look broken.
      if (!error.transient && !transientError(error.message)) throw error;
      softFailures += 1;
      // Quietly retrying forever is its own kind of broken. Once this has not
      // cleared for several minutes it stops being a passing hiccup and is named as
      // something to look at.
      const stuck = softFailures >= 5;
      // The last good read is kept. Replacing it outright threw away the job list
      // that keeps collecting going, so one unreadable minute stopped everything.
      const { sheetsStatus: previous = null } = await chrome.storage.local.get({ sheetsStatus: null });
      const status = {
        ...(previous && previous.ok !== false ? previous : {}),
        error: undefined,
        ok: true,
        retrying: true,
        stuck,
        notice: stuck
          ? `${error.message} This has not cleared for ${softFailures} tries, so it is worth a look: open the Sheet and choose Fudge → Rephrasing status, or re-copy the connector and deploy a new version.`
          : error.message,
        noticeAt: now()
      };
      await chrome.storage.local.set({ sheetsStatus: status });
      return status;
    } finally { syncing = false; }
  }

  // Serialize read-modify-write checkpoints from parallel runners and completion
  // handlers so a late response cannot overwrite a newer checkpoint.
  let progressChain = Promise.resolve();
  function recordProgress(job, exhausted = false) {
    const write = progressChain.catch(() => {}).then(() => writeProgress(job, exhausted));
    progressChain = write.catch(() => {});
    return write;
  }

  async function writeProgress(job, exhausted = false) {
    const { sheetsDatabase = null } = await chrome.storage.local.get({ sheetsDatabase: null });
    if (!sheetsDatabase?.spreadsheetId || !job?.searchKey) return;
    const [rows] = await batchGet(sheetsDatabase.spreadsheetId, ["'Search Progress'!A2:I"]);
    const index = rows.findIndex((row) => clean(row[0]) === job.searchKey);
    const stored = index >= 0 ? pad(rows[index], PROGRESS_HEADERS.length) : null;
    // A checkpoint may never move backwards. Progress is written from several
    // places, some of them with a job record that has been sitting in storage for a
    // while, and letting a stale one overwrite a newer position is what made a scan
    // walk the same pages and businesses again.
    const storedPage = stored ? Math.max(1, Number(stored[4]) || 1) : 1;
    const storedIndex = stored ? Math.max(0, Number(stored[5]) || 0) : 0;
    const page = Math.max(1, Number(job.currentPage) || 1);
    const businessIndex = Math.max(0, Number(job.businessIndex) || 0);
    const behind = stored && (page < storedPage || (page === storedPage && businessIndex < storedIndex));
    if (behind) return;
    // Visited businesses are only ever added to, never dropped, so a run that ends
    // early cannot make Fudge forget where it has already been.
    const visited = [...new Set([...clean(stored ? stored[7] : "").split("|").filter(Boolean), ...(job.visitedPlaceIds || [])])];
    const values = [[
      job.searchKey,
      job.serviceKeyword || (stored ? stored[1] : ""),
      job.city || (stored ? stored[2] : ""),
      job.query || (stored ? stored[3] : ""),
      behind ? storedPage : page,
      behind ? storedIndex : businessIndex,
      exhausted || Fudge.normalize(stored?.[6]) === "yes" ? "Yes" : "No",
      visited.join("|"),
      now()
    ]];
    if (index >= 0) await batchWrite(sheetsDatabase.spreadsheetId, [{ range: `'Search Progress'!A${index + 2}:I${index + 2}`, values }]);
    else await appendRows(sheetsDatabase.spreadsheetId, "Search Progress", values);
  }

  async function recordBusiness(job, placeId, business, eligible) {
    if (!placeId || !job?.serviceKeyword) return;
    const { sheetsDatabase = null, recordedBusinessKeys = [] } = await chrome.storage.local.get({ sheetsDatabase: null, recordedBusinessKeys: [] });
    if (!sheetsDatabase?.spreadsheetId) return;
    const key = [placeId, Fudge.normalize(job.serviceKeyword), Fudge.normalize(job.city || "")].join("|");
    if (recordedBusinessKeys.includes(key)) return;
    await appendRows(sheetsDatabase.spreadsheetId, "Businesses", [[placeId, job.serviceKeyword, job.city || "", business || "", now(), eligible || 0]]);
    await chrome.storage.local.set({ recordedBusinessKeys: [...recordedBusinessKeys, key].slice(-5000) });
  }

  async function saveReviews(requestedReviews) {
    const { reviews = [], drivePhotoIndex = {} } = await chrome.storage.local.get({ reviews: [], drivePhotoIndex: {} });
    const requestedIds = new Set((requestedReviews || []).map((review) => review.id));
    const pending = [];
    reviews.forEach((review) => {
      if (!requestedIds.has(review.id)) return;
      (review.photos || []).forEach((url, index) => {
        if (!drivePhotoIndex[url] && !review.drivePhotos?.[index]?.id) pending.push({ key: `${review.id}:${index}`, url, reviewId: review.id, index, placeName: review.placeName || "Google business", service: review.service?.label || "Review" });
      });
    });
    // A scan may save another review while the remote picture upload is in
    // progress. Merge the new Drive links into the latest library instead of
    // writing back the older snapshot captured before the request.
    const persistDriveState = async () => {
      const latest = await chrome.storage.local.get({ reviews: [], drivePhotoIndex: {} });
      const mergedIndex = { ...latest.drivePhotoIndex, ...drivePhotoIndex };
      const mergedReviews = latest.reviews.map((review) => ({
        ...review,
        drivePhotos: (review.photos || []).map((url, index) => mergedIndex[url] || review.drivePhotos?.[index] || null)
      }));
      await chrome.storage.local.set({ reviews: mergedReviews, drivePhotoIndex: mergedIndex });
      return mergedReviews;
    };
    let uploaded = 0; const errors = [];
    for (let offset = 0; offset < pending.length; offset += 10) {
      const result = await remote("uploadPhotos", { photos: pending.slice(offset, offset + 10) });
      (result.files || []).forEach((file) => { drivePhotoIndex[file.originalUrl] = file; uploaded += 1; });
      errors.push(...(result.errors || []));
      await persistDriveState();
    }
    const savedReviews = await persistDriveState();
    if (errors.length) throw new Error(`${uploaded} images uploaded; ${errors.length} failed. ${errors[0].error}`);
    return { uploaded, reviews: savedReviews };
  }

  const status = async () => {
    const settings = await chrome.storage.local.get({ sheetsDatabase: null, runState: "", sheetsAutomation: false, sheetsStatus: null, appsScriptUrl: "", appsScriptSecret: "", appsScriptSecretBackup: "" });
    const secret = clean(settings.appsScriptSecret || settings.appsScriptSecretBackup);
    const runState = settings.runState || (settings.sheetsAutomation ? "running" : "stopped");
    return { sheetsDatabase: settings.sheetsDatabase, runState, sheetsAutomation: runState === "running", sheetsStatus: settings.sheetsStatus, appsScriptUrl: settings.appsScriptUrl, automation: connectorAutomation, connectionReady: Boolean(settings.sheetsDatabase?.connector === "apps-script" && validUrl(settings.appsScriptUrl) && secret.length >= 24) };
  };
  return { configure, disconnect, getSetup, getConnectionCode, createConnectionCode, ensureDatabase, ensureAutomation, fillRowsNow, rephraseNow, sync, recordProgress, recordBusiness, saveReviews, status, rewriteReview };
})();
