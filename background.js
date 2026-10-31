importScripts("backend-contract.js", "backend-public-config.js");
importScripts("shared.js", "config.js", "rewriter.js", "sheets.js");
importScripts("backend-catalog.js", "backend-service.js", "backend-worker.js");

const SHEETS_ALARM = "fudge-sheets-sync";
const MAX_RESULT_PAGES = 4;
const DEFAULT_PARALLEL_TABS = 3;
const MAX_PARALLEL_TABS = 6;
// Keep Google pages slightly apart without making the third tab wait many seconds.
const JOB_STAGGER_MS = 750;
// Backoff ladder used when Google serves a block page.
const BLOCK_BACKOFF_MINUTES = [15, 30, 60, 120];
const JOB_GAP_MS = 1000;
// A running job must prove it is alive. The runner tab renews this lease while it
// works; a job whose lease has lapsed (Chrome closed, the worker was evicted, the
// tab was killed) is treated as interrupted instead of holding a slot forever.
const JOB_LEASE_MS = 4 * 60 * 1000;
const leaseExpired = (job) => {
  const until = Date.parse(job?.leaseUntil || "");
  if (Number.isFinite(until)) return Date.now() > until;
  // Jobs saved by an older version carry no lease; fall back to their last update.
  const updated = Date.parse(job?.updatedAt || "");
  if (Number.isFinite(updated)) return Date.now() > updated + JOB_LEASE_MS;
  // Undatable: let the tab check decide rather than killing a live scan.
  return false;
};
// Completion messages from several tabs can arrive together. Serialize cooldown
// changes so one Google block episode counts once, not once per runner.
let blockStateChain = Promise.resolve();
const updateBlockState = (work) => {
  const run = blockStateChain.catch(() => {}).then(work);
  blockStateChain = run.catch(() => {});
  return run;
};
async function noteGoogleBlock() {
  return updateBlockState(async () => {
    const { googleBlockStrikes = 0, blockedUntil = "" } = await getLocal({ googleBlockStrikes: 0, blockedUntil: "" });
    if (Date.parse(blockedUntil) > Date.now()) return blockedUntil;
    const strikes = Math.min(googleBlockStrikes + 1, BLOCK_BACKOFF_MINUTES.length);
    const minutes = BLOCK_BACKOFF_MINUTES[strikes - 1];
    const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    await setLocal({ googleBlockStrikes: strikes, blockedUntil: until });
    await chrome.notifications.create(`fudge-blocked-${Date.now()}`, {
      type: "basic",
      iconUrl: "assets/logo.png",
      title: "Fudge paused",
      message: `Google asked us to slow down. Resuming in ${minutes} minutes.`
    }).catch(() => {});
    return until;
  });
}

async function noteCleanGoogleRun(job) {
  return updateBlockState(async () => {
    const { googleBlockStrikes = 0, blockedUntil = "" } = await getLocal({ googleBlockStrikes: 0, blockedUntil: "" });
    if (!googleBlockStrikes) return;
    const startedAt = Date.parse(job?.startedAt || "");
    const cooldownEnd = Date.parse(blockedUntil);
    // A sibling that started before the block must not cancel an active cooldown.
    if (!Number.isFinite(startedAt) || (Number.isFinite(cooldownEnd) && startedAt < cooldownEnd)) return;
    await setLocal({ googleBlockStrikes: 0, blockedUntil: "" });
  });
}
const safePageLimit = (value) => Math.min(MAX_RESULT_PAGES, Math.max(1, Number(value) || MAX_RESULT_PAGES));
const safeParallelTabs = (value) => Math.min(MAX_PARALLEL_TABS, Math.max(1, Number.parseInt(value, 10) || DEFAULT_PARALLEL_TABS));
// `runState` is the one switch that decides whether Fudge may open Google on its
// own, and only the Start and Stop buttons write it. Connecting a sheet, finishing
// a job and syncing must never turn it on by themselves: that is what made Fudge
// appear to start whenever it felt like it.
const RUN_STATE_RUNNING = "running";
const RUN_STATE_STOPPED = "stopped";
// Declared before anything that runs at startup uses them: the run-state migration
// below is called while the worker is still being evaluated.
const getLocal = (defaults) => chrome.storage.local.get(defaults);
const setLocal = (value) => chrome.storage.local.set(value);
const isRunning = async () => (await getLocal({ runState: RUN_STATE_STOPPED })).runState === RUN_STATE_RUNNING;
const configuredParallelTabs = async () => safeParallelTabs((await getLocal({ parallelTabs: DEFAULT_PARALLEL_TABS })).parallelTabs);

// A scan that dies on the same page error keeps its Sheet checkpoint, so every
// unattended retry walks back into the same broken page — the exact "stops
// during scraping and never progresses" loop. After this many fruitless rounds
// the keyword/city stands down; a human Start or Sync now always gets one fresh
// attempt, and any run that ends normally or saves reviews clears the count.
const SCAN_ERROR_STRIKE_LIMIT = 3;
const DEAD_PAGE_STRIKE = /results did not load|could not load|stopped with an error|reviews unavailable/i;
async function recordScanStrike(searchKey, hit) {
  if (!searchKey) return;
  const { scanErrorStrikes = {} } = await getLocal({ scanErrorStrikes: {} });
  const next = { ...scanErrorStrikes };
  if (!hit) delete next[searchKey];
  else next[searchKey] = Math.min((next[searchKey] || 0) + 1, SCAN_ERROR_STRIKE_LIMIT);
  await setLocal({ scanErrorStrikes: next });
}
async function scanStrikeHeld(searchKey) {
  if (!searchKey) return false;
  const { scanErrorStrikes = {} } = await getLocal({ scanErrorStrikes: {} });
  return (scanErrorStrikes[searchKey] || 0) >= SCAN_ERROR_STRIKE_LIMIT;
}

async function ensureSheetsAlarm() {
  const alarm = await chrome.alarms.get(SHEETS_ALARM);
  if (!alarm || alarm.periodInMinutes !== 0.5) await chrome.alarms.create(SHEETS_ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
}

// Installations before 0.25 kept the switch in `sheetsAutomation`. Carry its value
// across once so an upgrade neither forgets a running setup nor silently starts.
async function migrateRunState() {
  const { runState = "", sheetsAutomation = false } = await getLocal({ runState: "", sheetsAutomation: false });
  if (runState === RUN_STATE_RUNNING || runState === RUN_STATE_STOPPED) return;
  await setLocal({ runState: sheetsAutomation ? RUN_STATE_RUNNING : RUN_STATE_STOPPED });
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  ensureSheetsAlarm().catch(() => {});
  await migrateRunState().catch(() => {});
  const { sheetsDatabase = null, appsScriptUrl = "" } = await getLocal({ sheetsDatabase: null, appsScriptUrl: "" });
  if (sheetsDatabase && (sheetsDatabase.connector !== "apps-script" || !appsScriptUrl)) {
    await chrome.storage.local.remove(["sheetsDatabase", "sheetsStatus", "sheetKnownReviewIds", "sheetKnownReviewFingerprints", "sheetKnownReviewContentKeys"]);
    await setLocal({ runState: RUN_STATE_STOPPED, sheetsAutomation: false, saveToDrive: false });
  }
});
// Chrome restarted, so nothing that claims to be running still is. Release those
// slots up front instead of waiting for a start attempt to discover them.
chrome.runtime.onStartup.addListener(async () => {
  ensureSheetsAlarm().catch(() => {});
  await migrateRunState().catch(() => {});
  await releaseDeadScanJobs("Chrome restarted — resuming from the saved Sheet checkpoint").catch(() => {});
  await closeOrphanRunnerTabs(true).catch(() => {});
});
ensureSheetsAlarm().catch(() => {});
migrateRunState().catch(() => {});

// Several tabs scan at once, so every job is kept under its own id. `scanJob` still
// mirrors the most recently updated one, because the side panel reads it.
let jobUpdateChain = Promise.resolve();
function updateScanJob(patch, sender) {
  const update = jobUpdateChain.catch(() => {}).then(() => writeScanJob(patch, sender));
  jobUpdateChain = update.catch(() => {});
  return update;
}

async function writeScanJob(patch, sender) {
  const { scanJobs = {}, scanJob = null } = await getLocal({ scanJobs: {}, scanJob: null });
  const tabId = patch.tabId || sender?.tab?.id;
  const id = patch.id
    || Object.values(scanJobs).find((entry) => entry.tabId && entry.tabId === tabId)?.id
    || scanJob?.id;
  const previous = (id && scanJobs[id]) || (id && scanJob?.id === id ? scanJob : null) || {};
  // A late heartbeat must not resurrect a stopped or completed runner.
  if (previous.id && previous.status !== "running" && !patch.status) return previous;
  const job = { ...previous, ...patch, id: id || previous.id, tabId: tabId || previous.tabId, updatedAt: new Date().toISOString() };
  // Every update from a live runner renews its lease. Anything else drops it, so a
  // finished, stopped or interrupted job can never look alive.
  if (job.status === "running") job.leaseUntil = new Date(Date.now() + JOB_LEASE_MS).toISOString();
  else job.leaseUntil = "";
  const nextJobs = { ...scanJobs };
  if (job.id) nextJobs[job.id] = job;
  // Keep the map from growing. A "running" record whose lease has lapsed counts as
  // finished here; before this, such a record was never removed and two of them
  // blocked every later scan permanently.
  const cutoff = Date.now() - 10 * 60 * 1000;
  Object.keys(nextJobs).forEach((key) => {
    const entry = nextJobs[key];
    const done = entry.status !== "running" || leaseExpired(entry);
    if (done && new Date(entry.updatedAt || 0).getTime() < cutoff) delete nextJobs[key];
  });
  await setLocal({ scanJobs: nextJobs, scanJob: job });
  return job;
}

const recordedScanJobs = async () => {
  const { scanJobs = {}, scanJob = null } = await getLocal({ scanJobs: {}, scanJob: null });
  // `scanJob` is only a mirror of the most recently updated runner, so it is used
  // solely when the map itself is empty (an installation upgraded mid-scan).
  return Object.values(scanJobs).length ? Object.values(scanJobs) : [scanJob].filter(Boolean);
};

// The single answer to "how many runners are really working". A job only counts
// while its tab is still on Google and its lease is current; everything else is
// released here, which is what frees the slot again.
async function liveRunningScanJobs(reason = "Restoring from the saved Sheet checkpoint") {
  const live = [];
  for (const job of (await recordedScanJobs()).filter((entry) => entry?.status === "running")) {
    if (!leaseExpired(job) && await onLivePlacesTab(job)) { live.push(job); continue; }
    // Keep the running record available for retry if the checkpoint fails.
    // Save where it got to. A run that ends by being interrupted — the tab closed,
    // the worker evicted, Chrome restarted — never recorded its place, so the next
    // run resumed from an older checkpoint and walked the same pages and businesses
    // again. recordProgress refuses to move a checkpoint backwards, so a stale job
    // record here cannot undo newer progress.
    try { if (job.auto) await SheetsService.recordProgress(job, false); }
    catch (_error) { continue; }
    await updateScanJob({ id: job.id, tabId: job.tabId, status: "interrupted", stage: reason });
  }
  return live;
}

const releaseDeadScanJobs = (reason) => liveRunningScanJobs(reason);

// How old the last sync's job list may be before Start stops trusting it. Inside
// this window the keyword it names is still almost certainly the right one; beyond
// it, Fudge would rather read the Sheet again than scan for something already done.
const CACHED_JOB_MAX_AGE_MS = 15 * 60 * 1000;

// Pressing Start used to wait for a complete read of the Sheet before a tab was
// even created — seconds at best, and much longer when the Sheet had rows to fill
// and rephrase first. The last sync already worked out which keyword comes next, so
// that is used to open the tab straight away and the fresh sync runs alongside it.
async function cachedJobSpecs() {
  const { sheetsStatus = null } = await getLocal({ sheetsStatus: null });
  const syncedAt = Date.parse(sheetsStatus?.syncedAt || "");
  if (!Number.isFinite(syncedAt) || Date.now() - syncedAt > CACHED_JOB_MAX_AGE_MS) return [];
  return (sheetsStatus.nextJobs?.length ? sheetsStatus.nextJobs : [sheetsStatus.nextJob]).filter(Boolean);
}

async function startFromCachedSpec({ activate = false, pageLimit = 4 } = {}) {
  const { blockedUntil = "" } = await getLocal({ blockedUntil: "" });
  if (blockedUntil && Date.now() < new Date(blockedUntil).getTime()) return { started: false, blockedUntil };
  const specs = await cachedJobSpecs();
  if (!specs.length) return { started: false };
  const running = await liveRunningScanJobs();
  if (running.length >= await configuredParallelTabs()) return { started: false, alreadyRunning: true };
  const busyKeys = new Set(running.map((entry) => entry.searchKey));
  for (const spec of specs) {
    if (busyKeys.has(spec.searchKey)) continue;
    // A failure here is not reported: the full path below runs next and will say
    // what went wrong with a freshly read Sheet behind it.
    const job = await startAutomaticJob(spec, { activate, pageLimit }).catch(() => null);
    if (job) return { started: true, job, spec };
  }
  return { started: false };
}

// A tab is opened before the runner inside it can report for duty. If the service
// worker is evicted in that gap, the tab is left on screen with nothing driving it
// and no job record to explain it. Each one is noted here while it is being handed
// over, and anything still unclaimed later is closed rather than left behind.
const notePendingRunnerTab = async (tabId) => {
  const { pendingRunnerTabs = [], pendingRunnerStartedAt = {} } = await getLocal({ pendingRunnerTabs: [], pendingRunnerStartedAt: {} });
  await setLocal({ pendingRunnerTabs: [...new Set([...pendingRunnerTabs, tabId])].slice(-8), pendingRunnerStartedAt: { ...pendingRunnerStartedAt, [tabId]: Date.now() } });
};

const clearPendingRunnerTab = async (tabId) => {
  const { pendingRunnerTabs = [], pendingRunnerStartedAt = {} } = await getLocal({ pendingRunnerTabs: [], pendingRunnerStartedAt: {} });
  const nextStartedAt = { ...pendingRunnerStartedAt };
  delete nextStartedAt[tabId];
  await setLocal({ pendingRunnerTabs: pendingRunnerTabs.filter((id) => id !== tabId), pendingRunnerStartedAt: nextStartedAt });
};

async function closeOrphanRunnerTabs(force = false) {
  const { pendingRunnerTabs = [], pendingRunnerStartedAt = {} } = await getLocal({ pendingRunnerTabs: [], pendingRunnerStartedAt: {} });
  if (!pendingRunnerTabs.length) return;
  const claimed = new Set((await recordedScanJobs()).map((job) => job?.tabId).filter(Boolean));
  const keep = [];
  const nextStartedAt = { ...pendingRunnerStartedAt };
  for (const tabId of pendingRunnerTabs) {
    if (claimed.has(tabId)) { keep.push(tabId); continue; }
    // A quick Start can be opening a tab alongside an alarm-driven pass. Give its
    // tab handshake time to finish before treating it as an orphan.
    const startedAt = Number(pendingRunnerStartedAt[tabId] || 0);
    if (!force && startedAt && Date.now() - startedAt < 60_000) { keep.push(tabId); continue; }
    await chrome.tabs.remove(tabId).catch(() => {});
    delete nextStartedAt[tabId];
  }
  await setLocal({ pendingRunnerTabs: keep, pendingRunnerStartedAt: nextStartedAt });
}

async function completeScanJob(patch, sender) {
  const job = await updateScanJob({ ...patch, status: "complete", completedAt: new Date().toISOString() }, sender);
  const failed = Boolean(job.error) || /error|could not/i.test(job.stage || "");
  await chrome.notifications.create(`fudge-${job.id || Date.now()}`, {
    type: "basic",
    iconUrl: "assets/logo.png",
    title: failed ? "Fudge scan stopped" : "Fudge scan complete",
    message: failed ? (job.error || job.stage) : `${job.businessesVisited || 0} businesses checked · ${job.reviewsSaved || 0} reviews saved.`
  });
  return job;
}

const waitForTab = async (tabId, timeout = 20000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error("The Fudge runner tab was closed.");
    if (tab.status === "complete") return tab;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Google search took too long to open.");
};

const onLivePlacesTab = async (job) => {
  const tab = job?.tabId ? await chrome.tabs.get(job.tabId).catch(() => null) : null;
  return Boolean(tab && /^https:\/\/(?:www\.)?google\.com\/(?:search|maps)/i.test(tab.url || ""));
};

// A tab reporting "complete" does not mean the content script is listening: it is
// injected at document_idle, which on a cold Google page lands well after that.
// Three blind sends 650 ms apart used to miss it, the tab was closed again and the
// side panel blamed the Sheet. Ask the page until it answers instead. Every call
// here is a Chrome API call, which also keeps the service worker alive.
const waitForContentScript = async (tabId, timeout = 25000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const pong = await chrome.tabs.sendMessage(tabId, { type: "FUDGE_PING" }).catch(() => null);
    if (pong?.ok) return true;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error("The Fudge runner tab was closed before the scan could start.");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
};

async function startAutomaticJob(spec, { activate = false, pageLimit = 4 } = {}) {
  if (!await isRunning()) return null;
  // A runner whose tab is gone or whose lease lapsed is not coming back; hand it to
  // the Sheet checkpoint. Only those jobs are rewritten, so a sibling tab still
  // scanning in parallel is left exactly as it is.
  const live = await liveRunningScanJobs();
  // Another keyword's live runner must never stop this one from opening a tab;
  // only a live runner already on this very search key makes this call redundant.
  const mine = live.find((job) => job.searchKey && spec.searchKey && job.searchKey === spec.searchKey);
  if (mine) return mine;
  if (live.length >= await configuredParallelTabs()) return null;
  const start = Math.max(0, (Number(spec.currentPage || 1) - 1) * 20);
  const url = "https://www.google.com/search?q=" + encodeURIComponent(spec.query) + "&udm=local&start=" + start;
  const { saveToDrive = false } = await getLocal({ saveToDrive: false });
  // Opened in the foreground when a person pressed the button, in the background
  // when the alarm did.
  const tab = await chrome.tabs.create({ url, active: activate });
  try {
    await notePendingRunnerTab(tab.id);
    // Memory Saver discards background tabs it thinks are idle. A discarded runner
    // loses its scan mid-page, so these tabs opt out for as long as they live.
    await Promise.resolve().then(() => chrome.tabs.update(tab.id, { autoDiscardable: false })).catch(() => {});
    const { sheetsStatus = null } = await getLocal({ sheetsStatus: null });
    await setLocal({ sheetsStatus: { ...(sheetsStatus || {}), stage: "Opening Google for " + spec.query, updatedAt: new Date().toISOString() } });
    await waitForTab(tab.id);
    if (!await waitForContentScript(tab.id)) {
      throw new Error(`Google's results page for “${spec.query}” did not finish loading in time. Fudge will try again shortly.`);
    }
    if (!await isRunning()) throw new Error("Collecting was stopped while Google opened.");
    const options = {
      ...spec,
      pageLimit: safePageLimit(pageLimit),
      saveToDrive: saveToDrive && spec.reviewMode === "photo"
    };
    let result;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      result = await chrome.tabs.sendMessage(tab.id, { type: "FUDGE_START_SCAN", options }).catch(() => null);
      if (result?.ok) {
        await clearPendingRunnerTab(tab.id);
        return result.job;
      }
      await new Promise((resolve) => setTimeout(resolve, 650));
    }
    throw new Error(result?.error || "Fudge could not start the automatic Google runner.");
  } catch (error) {
    await chrome.tabs.remove(tab.id).catch(() => {});
    await clearPendingRunnerTab(tab.id);
    throw error;
  }
}

let automationBusy = false;
let automationChain = Promise.resolve();
let reviewSyncTimer = null;
let reviewSyncPending = false;

// New reviews should reach the Sheet promptly, without one sync per business.
// If a sync is already running, request exactly one follow-up instead of dropping
// the update or building an unbounded queue of full Sheet reads.
function scheduleReviewSync() {
  reviewSyncPending = true;
  if (reviewSyncTimer || automationBusy) return;
  reviewSyncTimer = setTimeout(async () => {
    reviewSyncTimer = null;
    if (!reviewSyncPending) return;
    if (automationBusy) return;
    reviewSyncPending = false;
    if (await isRunning()) await runSheetsAutomation({ force: true }).catch(() => {});
  }, 2000);
}

// A scheduled pass may be dropped when another run already owns the work. A run a
// person asked for never may: it waits its turn and then really runs, because
// answering "nothing is waiting" to a button press is how Fudge looked broken.
function runSheetsAutomation(options = {}) {
  if (automationBusy && options.scheduled) return Promise.resolve({ ok: true, skipped: "automation already running" });
  const run = automationChain.catch(() => {}).then(() => automationPass(options));
  automationChain = run.catch(() => {});
  return run;
}

async function automationPass({ force = false, interactive = false, activate = false, pageLimit = null, startJobs = true } = {}) {
  automationBusy = true;
  try {
    // Anything left over from a run the worker did not survive goes first.
    await closeOrphanRunnerTabs().catch(() => {});
    // Google asked us to stop; do not open anything until the cooldown expires.
    const { blockedUntil = "" } = await getLocal({ blockedUntil: "" });
    const cooling = blockedUntil && Date.now() < new Date(blockedUntil).getTime();
    const result = await SheetsService.sync({ force, interactive });
    // Upload saved pictures even when no Google search is queued. This is also the
    // path after a keyword has just been filled and the scan has finished.
    catchUpDriveUploads().catch(() => {});
    if (!startJobs || !await isRunning()) return { ...result, startedJob: false };
    if (cooling) return { ...result, startedJob: false, blockedUntil };
    let queued = (result.nextJobs && result.nextJobs.length ? result.nextJobs : [result.nextJob]).filter(Boolean);
    // A sync that could not read the Sheet carries no job list, and stopping there
    // meant one unreadable minute ended the whole collecting loop: the run finished,
    // nothing replaced it, and the panel sat on "looking for the next requirement"
    // indefinitely. The last known list keeps the work going until a sync succeeds.
    if (!queued.length && result.retrying) queued = await cachedJobSpecs();
    if (!queued.length) return { ...result, startedJob: false };
    // One tab per keyword, started in sequence so the pages do not load together.
    // A Start or a Sync now is a person asking for work, so it may always have
    // one more go at a page that stood down; the unattended passes may not.
    const humanIntent = Boolean(interactive || activate);
    const strikeHeld = [];
    const running = await liveRunningScanJobs();
    const maxTabs = await configuredParallelTabs();
    const selectedPageLimit = pageLimit == null
      ? safePageLimit((await getLocal({ scanPageLimit: MAX_RESULT_PAGES })).scanPageLimit)
      : safePageLimit(pageLimit);
    const busyKeys = new Set(running.map((entry) => entry.searchKey));
    const started = [];
    const startErrors = [];
    for (const spec of queued) {
      if (started.length + running.length >= maxTabs) break;
      if (busyKeys.has(spec.searchKey)) continue;
      if (!humanIntent && await scanStrikeHeld(spec.searchKey)) {
        strikeHeld.push(spec.serviceKeyword || spec.searchKey);
        continue;
      }
      // Space out tab openings slightly, without adding a wait after the last one.
      if (started.length) await new Promise((resolve) => setTimeout(resolve, JOB_STAGGER_MS));
      // A failure to open the runner is reported, never swallowed. Reporting it as
      // "no Structure rows are waiting" is what sent people looking at the Sheet
      // for a problem that was in the tab handshake.
      const job = await startAutomaticJob(spec, { activate: activate && started.length === 0, pageLimit: selectedPageLimit })
        .catch(async (error) => {
          startErrors.push(error.message);
          // A tab that never comes up repeats every half minute too. Count it the
          // same way — unless the run was stopped, which is not a dead page.
          if (!/stopped while google opened|runner tab was closed/i.test(error.message || "")) await recordScanStrike(spec.searchKey, true).catch(() => {});
          return null;
        });
      if (!job) continue;
      busyKeys.add(spec.searchKey);
      started.push(job);
    }
    // A tab that would not come up is a retry, not a fault. Say so in the status
    // line so nothing in the panel reads as a problem the user has to solve.
    if (!started.length && startErrors.length) {
      const { sheetsStatus = null } = await getLocal({ sheetsStatus: null });
      await setLocal({ sheetsStatus: { ...(sheetsStatus || {}), ok: true, retrying: true, notice: startErrors[0], noticeAt: new Date().toISOString() } });
    }
    // Standing a struck-out page down is reported the same way, never silent: the
    // row is still waiting and only the operator can fix the page or press Start.
    if (!started.length && !startErrors.length && strikeHeld.length) {
      const { sheetsStatus = null } = await getLocal({ sheetsStatus: null });
      await setLocal({ sheetsStatus: { ...(sheetsStatus || {}), ok: true, retrying: true, notice: `Held back: ${strikeHeld[0]} kept failing on the same Google page. Press Start to try it again, or Sync now after checking it.`, noticeAt: new Date().toISOString() } });
    }
    return { ...result, startedJob: started.length > 0, job: started[0] || null, startedJobs: started, startErrors, strikeHeld, runnersBusy: running.length };
  } catch (error) {
    // Anything that clears itself is a notice, not a failure: the next pass is a
    // minute away, so there is nothing for anyone to do about it.
    const transient = error.transient === true || /busy rephrasing|did not answer in time|did not finish loading|could not be reached just now|was busy \(/i.test(error.message || "");
    // A retry keeps whatever the last good sync worked out, so collecting can carry
    // on from it; only a real failure replaces the picture entirely.
    const { sheetsStatus: previous = null } = await getLocal({ sheetsStatus: null });
    const status = transient
      ? { ...(previous && previous.ok !== false ? previous : {}), error: undefined, ok: true, retrying: true, notice: error.message, noticeAt: new Date().toISOString() }
      : { ok: false, error: error.message, updatedAt: new Date().toISOString() };
    await setLocal({ sheetsStatus: status });
    return status;
  } finally {
    automationBusy = false;
    if (reviewSyncPending) scheduleReviewSync();
  }
}

// Reviews that have pictures but no Drive copy yet. Without this, a failed upload
// left a Picture Links cell empty for good, because uploading only ever happened
// during the scan that collected the review.
let driveUploadBusy = false;
async function catchUpDriveUploads() {
  if (driveUploadBusy) return;
  const { saveToDrive = false } = await getLocal({ saveToDrive: false });
  if (!saveToDrive) return;
  driveUploadBusy = true;
  try {
    const reviews = await Fudge.getReviews();
    const pending = reviews.filter((review) => (review.photos || []).some((url, index) =>
      !review.drivePhotos?.[index]?.id));
    if (!pending.length) {
      await setLocal({ driveUploadError: "" });
      return;
    }
    await SheetsService.saveReviews(pending.slice(0, 20));
    await setLocal({ driveUploadError: "" });
  } catch (error) {
    await setLocal({ driveUploadError: error.message || String(error) });
  } finally {
    driveUploadBusy = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SHEETS_ALARM) return;
  // Stopped means stopped: the alarm does not sync, does not allocate and does not
  // open tabs until the Start button says otherwise.
  isRunning().then((running) => {
    if (running) return runSheetsAutomation({ scheduled: true, force: true });
  }).catch(() => {});
});

// A runner tab the user closed ends that job immediately, instead of leaving a
// record that claims to be running and occupies a scanning slot.
chrome.tabs.onRemoved.addListener((tabId) => {
  recordedScanJobs().then(async (jobs) => {
    for (const job of jobs) {
      if (job?.status !== "running" || job.tabId !== tabId) continue;
      // Keep the job marked running until its checkpoint is saved. If the write
      // fails, the next alarm can still find the dead tab and retry it.
      try { await SheetsService.recordProgress(job, false); }
      catch (_error) { continue; }
      await updateScanJob({ id: job.id, tabId, status: "interrupted", stage: "Runner tab was closed — progress saved to the Sheet" });
    }
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Pacing for hidden runner tabs; see sleep() in content.js.
  if (message?.type === "FUDGE_SLEEP") {
    new Promise((resolve) => setTimeout(resolve, Math.min(5000, Math.max(0, Number(message.ms) || 0))))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "OPEN_DASHBOARD") {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    return;
  }
  if (message?.type === "OPEN_DRIVE_SETUP" || message?.type === "OPEN_SHEETS_SETUP") {
    chrome.tabs.create({ url: chrome.runtime.getURL("drive-setup.html") });
    return;
  }
  if (message?.type === "REWRITE_REVIEW") {
    SheetsService.rewriteReview(message.review || {}, message.phone || "", message.names || "")
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "SCAN_JOB_START") {
    updateScanJob({
      id: message.job.id,
      status: "running",
      auto: Boolean(message.job.auto),
      searchKey: message.job.searchKey,
      serviceKeyword: message.job.serviceKeyword,
      city: message.job.city,
      query: message.job.query,
      reviewMode: message.job.reviewMode,
      targetCount: message.job.targetCount,
      startedAt: message.job.startedAt || new Date().toISOString(),
      keywordStartedAt: message.job.keywordStartedAt || new Date().toISOString(),
      visitedPlaceIds: message.job.visitedPlaceIds || [],
      pageLimit: message.job.pageLimit,
      saveToDrive: message.job.saveToDrive,
      currentPage: message.job.currentPage || 1,
      businessIndex: message.job.businessIndex || 0,
      businessesVisited: message.job.businessesVisited || 0,
      reviewsSaved: message.job.reviewsSaved || 0,
      targetMatches: message.job.targetMatches || 0,
      sourceUrl: message.job.sourceUrl
    }, sender).then((job) => sendResponse({ ok: true, job }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "SCAN_JOB_UPDATE") {
    updateScanJob(message.patch, sender).then((job) => {
      // Answer the runner first. This used to reply only after two round trips to
      // Apps Script had finished, so every completed business left the scan waiting
      // on the Sheet — and when that reply was slow or the worker was evicted
      // meanwhile, the message channel closed and the whole run died with
      // "a listener indicated an asynchronous response...".
      sendResponse({ ok: true, job });
      if (job.auto && message.patch.businessCompleted && Number(message.patch.businessEligible) > 0) scheduleReviewSync();
      if (!job.auto || !(message.patch.businessCompleted || message.patch.pageAdvanced)) return;
      const writes = [SheetsService.recordProgress(job, false)];
      if (message.patch.businessCompleted) {
        writes.push(SheetsService.recordBusiness(job, message.patch.lastPlaceId, message.patch.currentBusiness, message.patch.businessEligible));
      }
      // Recorded after the fact. A checkpoint that does not make it is written
      // again by the next business, and by the job's completion.
      Promise.allSettled(writes).catch(() => {});
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "STOP_SCAN_JOB") {
    (async () => {
      // Stop is unconditional. It switches automation off first, so an alarm or a
      // finishing job cannot start anything while the tabs are being closed, and it
      // ends every recorded runner rather than only the mirrored one.
      await setLocal({ runState: RUN_STATE_STOPPED, sheetsAutomation: false });
      const running = (await recordedScanJobs()).filter((job) => job?.status === "running");
      let last = null;
      for (const entry of running) {
        last = await updateScanJob({ id: entry.id, tabId: entry.tabId, status: "stopped", stage: "Stopped by user", stoppedAt: new Date().toISOString() }, sender);
        if (entry.auto && entry.tabId) await chrome.tabs.remove(entry.tabId).catch(() => {});
      }
      if (!last) last = await updateScanJob({ status: "stopped", stage: "Stopped by user", stoppedAt: new Date().toISOString() }, sender);
      await setLocal({ sheetsStatus: { ok: true, stopped: true, stage: "Stopped. Press Start when you want Fudge to collect again.", updatedAt: new Date().toISOString() } });
      sendResponse({ ok: true, job: last, runState: RUN_STATE_STOPPED });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "SCAN_JOB_COMPLETE") {
    completeScanJob(message.patch, sender).then(async (job) => {
      if (job.auto) {
        // Reaching the selected limit completes this keyword/city combination;
        // otherwise automation would reopen the capped page forever. Four pages
        // is the global ceiling even if an older saved setting says "all" or 10.
        // "Blocked by Google" must never count as exhausted, or the keyword and
        // city would be written off without ever being read.
        const blocked = job.blocked === true || /blocked by google/i.test(job.stage || "");
        if (blocked) await noteGoogleBlock();
        else if (!job.error && /^(?:Target reached|Page limit reached|End of results|Complete)/i.test(job.stage || "")) await noteCleanGoogleRun(job);
        const exhausted = !blocked && /end of results|page limit reached/i.test(job.stage || "");
        await SheetsService.recordProgress(job, exhausted).catch(() => {});
        // The checkpoint keeps the page that just failed, so a dead page would be
        // retried forever. Count fruitless rounds; a normal ending or a run that
        // saved reviews clears the count for this keyword/city again.
        const progressing = exhausted || Number(job.reviewsSaved || 0) > 0 || /^(?:Target reached|Complete)/i.test(job.stage || "");
        const deadPage = !blocked && (Boolean(job.error) || DEAD_PAGE_STRIKE.test(job.stage || ""));
        await recordScanStrike(job.searchKey, deadPage && !progressing).catch(() => {});
        if (await isRunning() && !blocked) setTimeout(() => runSheetsAutomation({ force: true }).catch(() => {}), JOB_GAP_MS);
        if (job.tabId) setTimeout(() => chrome.tabs.remove(job.tabId).catch(() => {}), 300);
      }
      sendResponse({ ok: true, job });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "GET_SCAN_JOB") {
    getLocal({ scanJobs: {}, scanJob: null }).then(({ scanJobs, scanJob }) => {
      // The side panel wants the mirror; a content script wants its own job. With
      // several tabs scanning, `scanJob` mirrors whichever updated last, so looking
      // only at that left the other tab jobless after it paginated.
      const tabId = sender.tab?.id;
      if (!tabId) return sendResponse({ ok: true, job: scanJob });
      const mine = Object.values(scanJobs).find((job) => job.tabId === tabId)
        || (scanJob?.tabId === tabId ? scanJob : null);
      sendResponse({ ok: true, job: mine });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "SAVE_REVIEWS_TO_DRIVE") {
    SheetsService.saveReviews(message.reviews || []).then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "CONNECT_SHEETS") {
    // Connecting reads the Sheet and sets everything up. It deliberately does not
    // start collecting: that is the Start button's job and nobody else's.
    SheetsService.ensureDatabase().then(async (database) => {
      const sync = await runSheetsAutomation({ force: true, startJobs: false });
      if (!sync.ok) sendResponse({ ok: false, error: sync.error || "The Fudge database was connected, but its first sync failed.", database, sync });
      // Connected, but nothing was read yet. Say which of the two this is.
      else if (sync.retrying) sendResponse({ ok: true, database, sync, retrying: true, notice: sync.notice });
      else sendResponse({ ok: true, database, sync });
    }).catch((error) => sendResponse({ ok: false, needsSetup: error.code === "SCRIPT_SETUP_REQUIRED", error: error.message }));
    return true;
  }
  if (message?.type === "GET_SCRIPT_SETUP") {
    SheetsService.getSetup().then((setup) => sendResponse({ ok: true, ...setup })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "GET_CONNECTION_CODE") {
    SheetsService.getConnectionCode().then((connectionCode) => sendResponse({ ok: true, connectionCode })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "SAVE_SCRIPT_SETUP") {
    SheetsService.configure(message.url, message.secret).then(async (database) => {
      const sync = await runSheetsAutomation({ force: true, startJobs: false });
      sendResponse(sync.ok
        ? { ok: true, database, sync, retrying: Boolean(sync.retrying), notice: sync.notice || "" }
        : { ok: false, database, error: sync.error });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "DISCONNECT_SCRIPT") {
    SheetsService.disconnect().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "FILL_ROWS_NOW") {
    SheetsService.fillRowsNow()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "REPHRASE_NOW") {
    SheetsService.rephraseNow()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "REPAIR_SHEET_AUTOMATION") {
    SheetsService.ensureAutomation()
      .then((result) => sendResponse(result.ok ? { ok: true, automation: result.automation } : { ok: false, error: result.error }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "GET_SHEETS_STATUS") {
    SheetsService.status().then((status) => sendResponse({ ok: true, ...status })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "GET_RUN_STATE") {
    getLocal({ runState: RUN_STATE_STOPPED }).then(async ({ runState }) => {
      const live = await liveRunningScanJobs();
      const { scanJob = null } = await getLocal({ scanJob: null });
      sendResponse({ ok: true, runState, jobs: live, lastJob: scanJob, parallelTabs: await configuredParallelTabs() });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  // Kept so an older side panel or the dashboard cannot write the old key and
  // disagree with the button. Both map onto the one switch.
  if (message?.type === "SET_SHEETS_AUTOMATION") {
    const enabled = Boolean(message.enabled);
    setLocal({ runState: enabled ? RUN_STATE_RUNNING : RUN_STATE_STOPPED, sheetsAutomation: enabled }).then(() => {
      sendResponse({ ok: true, enabled });
      if (enabled) runSheetsAutomation({ force: true }).catch(() => {});
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  // A panel message must be answered before a Sheet read or Google tab handshake.
  // Those can take longer than Chrome keeps the message channel open. Progress and
  // the final outcome are reported through sheetsStatus instead.
  if (message?.type === "START_NEXT_JOB") {
    getLocal({ sheetsDatabase: null, appsScriptUrl: "", sheetsStatus: null }).then(async ({ sheetsDatabase, appsScriptUrl, sheetsStatus }) => {
      if (sheetsDatabase?.connector !== "apps-script" || !appsScriptUrl) {
        return sendResponse({ ok: false, error: "Connect your Google Sheet first, or open Google Maps and scan the page you are on." });
      }
      await setLocal({
        runState: RUN_STATE_RUNNING,
        sheetsAutomation: true,
        sheetsStatus: { ...(sheetsStatus || {}), ok: true, error: undefined, retrying: false, stage: "Checking Sheet requirements…", updatedAt: new Date().toISOString() }
      });
      const limit = safePageLimit(message.pageLimit);
      sendResponse({ ok: true, queued: true, runState: RUN_STATE_RUNNING });
      (async () => {
        // Use a recent job immediately; the Sheet refresh follows it. A stale
        // job waits for a fresh read so completed work is not scanned again.
        const quick = await startFromCachedSpec({ activate: true, pageLimit: limit });
        if (quick.started) await runSheetsAutomation({ force: true, pageLimit: limit });
        else await runSheetsAutomation({ force: true, interactive: true, activate: true, pageLimit: limit });
      })().catch(async (error) => {
        await setLocal({ sheetsStatus: { ok: false, error: error.message, updatedAt: new Date().toISOString() } });
      });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "RUN_SHEETS_SYNC") {
    // The Sync now button follows the same fast acknowledgement path.
    getLocal({ sheetsStatus: null }).then(async ({ sheetsStatus }) => {
      await setLocal({ sheetsStatus: { ...(sheetsStatus || {}), error: undefined, retrying: false, stage: "Checking Sheet requirements…", updatedAt: new Date().toISOString() } });
      sendResponse({ ok: true, queued: true });
      isRunning().then((running) => runSheetsAutomation({ force: true, interactive: Boolean(message.interactive), startJobs: running }))
        .catch(async (error) => setLocal({ sheetsStatus: { ok: false, error: error.message, updatedAt: new Date().toISOString() } }));
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "SET_PARALLEL_TABS") {
    (async () => {
      const requested = Number(message.count);
      if (!Number.isInteger(requested) || requested < 1 || requested > MAX_PARALLEL_TABS) {
        return sendResponse({ ok: false, error: `Choose 1 to ${MAX_PARALLEL_TABS} Google tabs.` });
      }
      await setLocal({ parallelTabs: requested });
      const running = await isRunning();
      sendResponse({ ok: true, parallelTabs: requested });
      if (running) runSheetsAutomation({ force: true }).catch(() => {});
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "OPEN_SHEETS_DATABASE") {
    getLocal({ sheetsDatabase: null }).then(async ({ sheetsDatabase }) => {
      if (!sheetsDatabase?.spreadsheetUrl) return sendResponse({ ok: false, error: "Connect the Fudge spreadsheet first." });
      await chrome.tabs.create({ url: sheetsDatabase.spreadsheetUrl });
      sendResponse({ ok: true });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
