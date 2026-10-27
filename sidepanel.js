const elements = {
  card: document.querySelector("#scanCard"),
  stateLabel: document.querySelector("#stateLabel"),
  collect: document.querySelector("#collectButton"),
  stop: document.querySelector("#stopButton"),
  status: document.querySelector("#pageStatus"),
  progress: document.querySelector("#scanProgress"),
  progPage: document.querySelector("#progPage"),
  progBusinesses: document.querySelector("#progBusinesses"),
  progSaved: document.querySelector("#progSaved"),
  progStage: document.querySelector("#progStage"),
  saved: document.querySelector("#savedCount"),
  services: document.querySelector("#serviceCount"),
  duplicates: document.querySelector("#duplicateCount"),
  recent: document.querySelector("#recentReviews"),
  toast: document.querySelector("#toast"),
  pageSelect: document.querySelector("#pageLimitSelect"),
  parallelSelect: document.querySelector("#parallelTabsSelect"),
  saveToDrive: document.querySelector("#saveToDrive"),
  connectDrive: document.querySelector("#connectDrive"),
  driveStatus: document.querySelector("#driveStatus"),
  sheetsState: document.querySelector("#sheetsState"),
  sheetsStatus: document.querySelector("#sheetsStatus"),
  connectSheets: document.querySelector("#connectSheets"),
  automationState: document.querySelector("#automationState"),
  automationStatus: document.querySelector("#automationStatus"),
  manualRow: document.querySelector("#manualRow"),
  manualStatus: document.querySelector("#manualStatus"),
  fillRowsNow: document.querySelector("#fillRowsNow"),
  rephraseNow: document.querySelector("#rephraseNow"),
  rephraseRow: document.querySelector("#rephraseRow"),
  rephraseStatus: document.querySelector("#rephraseStatus"),
  repairAutomation: document.querySelector("#repairAutomation"),
  openSheetRow: document.querySelector("#openSheetRow"),
  openSheet: document.querySelector("#openSheet"),
  clearUnused: document.querySelector("#clearUnusedButton"),
  clearUnusedDialog: document.querySelector("#clearUnusedDialog")
};

const escapeHtml = (value = "") => value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const icon = (name, extra = "") => `<svg class="icon icon--sm ${extra}"><use href="#i-${name}" /></svg>`;
const setLabel = (button, text) => { (button.querySelector("[data-label]") || button).textContent = text; };
const openDashboard = () => chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
// Mirrors the one switch in background.js. Only the Start and Stop buttons change
// it, so the panel and the service worker can never disagree about whether Fudge
// is collecting.
let runState = "stopped";

document.querySelector("#openDashboard").addEventListener("click", openDashboard);
document.querySelector("#viewAll").addEventListener("click", openDashboard);

let toastTimer;
function showToast(message, variant = "info") {
  elements.toast.className = `toast show${variant === "error" ? " toast--error" : ""}`;
  elements.toast.innerHTML = `${icon(variant === "error" ? "alert" : "check")}<span>${escapeHtml(message)}</span>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 4200);
}

/* A single source of truth for the card's appearance.
   state: idle | ready | running | done | error
   Stop is shown whenever Fudge is switched on — not only while a tab happens to
   be mid-scan — because the thing being stopped is the automation, and hiding the
   button between jobs is what made Stop feel like it did not work. */
function setState(state, { label, source } = {}) {
  elements.card.dataset.state = state;
  if (label) elements.stateLabel.textContent = label;
  if (source) elements.status.textContent = source;
  const running = state === "running";
  const stoppable = running || runState === "running";
  elements.collect.disabled = stoppable;
  elements.collect.hidden = stoppable;
  elements.stop.hidden = !stoppable;
  elements.progress.hidden = !running;
  setLabel(elements.collect, "Start collecting");
  setLabel(elements.stop, running ? "Stop scan" : "Stop collecting");
}

function renderJob(job) {
  if (!job) {
    if (runState !== "running") detectPage();
    return;
  }
  if (job.status === "running") {
    setState("running", { label: "Scanning", source: job.currentBusiness || "Walking the review feed" });
    elements.progPage.textContent = job.currentPage || 1;
    elements.progBusinesses.textContent = job.businessesVisited || 0;
    elements.progSaved.textContent = job.reviewsSaved || 0;
    elements.progStage.textContent = job.stage || "Starting";
    return;
  }
  const failed = Boolean(job.error) || /error|could not/i.test(job.stage || "");
  const businesses = job.businessesVisited || 0;
  const summary = `${businesses} business${businesses === 1 ? "" : "es"} checked · ${job.reviewsSaved || 0} new review${job.reviewsSaved === 1 ? "" : "s"}`;
  // With collecting switched on, the last job having finished does not mean Fudge
  // has stopped — the next scheduled check is about 30 seconds away. Saying "Stopped" beside a
  // Stop button and a Running switch is what made a working session look dead.
  const collecting = runState === "running";
  if (failed) {
    setState("error", { label: collecting ? "Retrying" : "Needs attention", source: job.error || job.stage });
  } else if (collecting) {
    setState("ready", { label: "Running", source: `${summary} · looking for the next requirement` });
  } else {
    setState("done", { label: job.status === "stopped" ? "Stopped" : "Finished", source: summary });
  }
  if (job.driveError) showToast(`Reviews saved locally. Drive: ${job.driveError}`, "error");
}

/* The status line now reflects the actual tab, instead of a fixed string. */
// The connector is only usable with all three pieces present: the Sheet record, a
// valid /exec URL and the shared secret. sheets.js decides this; nothing in the UI
// may second-guess it, or the panel says "Connected" while requests fail.
async function sheetsReady() {
  const status = await chrome.runtime.sendMessage({ type: "GET_SHEETS_STATUS" }).catch(() => null);
  return Boolean(status?.ok && status.connectionReady);
}

async function detectPage() {
  if (runState === "running") return;
  const offPageSource = async () => {
    // With a sheet connected Fudge no longer needs the user to navigate anywhere.
    if (!await sheetsReady()) return { label: "No source", source: "Open Google Maps, or connect your sheet to run on its own." };
    return runState === "running"
      ? { label: "Running", source: "Collecting is on. Fudge opens Google for the next requirement itself." }
      : { label: "Ready", source: "Press Start and Fudge opens Google Places for the next requirement." };
  };
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (runState === "running") return;
    const url = tab?.url || "";
    if (/google\.com\/maps|maps\.google\.com/.test(url)) {
      return setState("ready", { label: "Ready", source: "Google Maps — open a business’s reviews, then scan." });
    }
    if (/google\.com\/search/.test(url)) {
      return setState("ready", { label: "Ready", source: "Google Places results — Fudge will walk every business." });
    }
    const off = await offPageSource();
    if (runState === "running") return;
    setState(off.label === "No source" ? "idle" : "ready", off);
  } catch {
    if (runState === "running") return;
    setState("idle", { label: "No source", source: "Open Google Maps, or connect your sheet to run on its own." });
  }
}

// Rephrasing happens inside the Sheet, so when it breaks the extension used to
// show nothing at all. The connector now reports its own health and it is said
// out loud here, with a button that reinstalls the missing triggers.
function renderRephrasing(connected, automation) {
  elements.manualRow.hidden = !connected;
  if (!connected || !automation) {
    elements.rephraseRow.hidden = true;
    return;
  }
  elements.manualStatus.textContent = automation.lastRunAt
    ? `Last rephrasing run ${new Date(automation.lastRunAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Rows are also rephrased the moment they are filled.`
    : "Rows are rephrased the moment they are filled. These run it again on demand.";
  const missing = !automation.queueTrigger || !automation.rephraseTrigger;
  const problem = missing || !automation.writerConfigured || automation.lastError || automation.triggerError;
  elements.rephraseRow.hidden = !problem;
  elements.repairAutomation.hidden = !missing && !automation.triggerError;
  if (!problem) return;
  if (!automation.writerConfigured) {
    elements.rephraseStatus.textContent = "No OpenAI key is saved in the Sheet. Use its Fudge menu → Set OpenAI API key.";
    return;
  }
  if (automation.triggerError) {
    elements.rephraseStatus.textContent = "The Sheet could not check its own triggers. Open it and run Fudge → Install automatic rephrasing once.";
    return;
  }
  if (missing) {
    elements.rephraseStatus.textContent = "Automatic rephrasing is not installed in the Sheet, so filled rows stay unrephrased.";
    return;
  }
  elements.rephraseStatus.textContent = `Last rephrasing error: ${automation.lastError}`;
}

function recentCard(review) {
  const photo = review.drivePhotos?.[0]?.directLink || review.photos?.[0];
  const subcategory = review.service.subcategory?.label || "General";
  return `<article class="recent-card">
    ${photo
      ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy" />`
      : `<span class="recent-card__no-photo">Text<br />only</span>`}
    <div class="recent-card__body">
      <span class="service-dot" style="--dot:${escapeHtml(review.service.color || "#d8ff2f")}">${escapeHtml(subcategory)}</span>
      <p>${escapeHtml(review.text.slice(0, 104))}${review.text.length > 104 ? "…" : ""}</p>
      <footer>
        <small>${escapeHtml(review.author)}</small>
        <small>·</small>
        <small>${review.photos.length} photo${review.photos.length === 1 ? "" : "s"}</small>
      </footer>
    </div>
  </article>`;
}

let renderRevision = 0;
async function render() {
  const revision = ++renderRevision;
  const reviews = await Fudge.getReviews();
  const readyReviews = reviews.filter((review) => !review.usedAt && !review.rejectedAt);
  const meta = await chrome.storage.local.get({
    duplicatesBlocked: 0,
    scanPageLimit: "4",
    parallelTabs: 3,
    saveToDrive: false,
    scanJob: null,
    scanJobs: {},
    sheetsDatabase: null,
    appsScriptUrl: "",
    runState: "stopped",
    blockedUntil: "",
    driveUploadError: "",
    sheetsStatus: null
  });
  const verified = await chrome.runtime.sendMessage({ type: "GET_RUN_STATE" }).catch(() => null);
  const sheetsConnected = await sheetsReady();
  if (revision !== renderRevision) return;
  runState = (verified?.ok ? verified.runState : meta.runState) === "running" ? "running" : "stopped";
  elements.saved.textContent = readyReviews.length;
  elements.clearUnused.disabled = readyReviews.length === 0;
  elements.services.textContent = new Set(readyReviews.map((review) => review.service.id)).size;
  elements.duplicates.textContent = meta.duplicatesBlocked;
  elements.pageSelect.value = ["1", "2", "3", "4"].includes(String(meta.scanPageLimit)) ? String(meta.scanPageLimit) : "4";
  const tabLimit = verified?.parallelTabs || meta.parallelTabs;
  elements.parallelSelect.value = String(tabLimit);
  // A half-finished setup used to look identical to a working one.
  const setupIncomplete = !sheetsConnected && Boolean(meta.sheetsDatabase);
  elements.saveToDrive.checked = sheetsConnected && meta.saveToDrive;
  elements.driveStatus.textContent = sheetsConnected ? "Connected through Apps Script" : setupIncomplete ? "Setup incomplete — reconnect" : "Connect Sheets first";
  setLabel(elements.connectDrive, "Setup");
  elements.openSheetRow.hidden = !sheetsConnected;
  elements.sheetsState.className = `pill${sheetsConnected ? " pill--ok" : ""}`;
  elements.sheetsState.innerHTML = `<i class="dot"></i>${sheetsConnected ? "Connected" : setupIncomplete ? "Setup incomplete" : "Not connected"}`;
  const collecting = runState === "running";
  const activeTabs = verified?.jobs?.length || 0;
  const activeJob = verified?.jobs?.[0] || (!verified?.ok && meta.scanJob?.status === "running" ? meta.scanJob : null);
  const cooldownMinutes = Math.max(0, Math.ceil((Date.parse(meta.blockedUntil || "") - Date.now()) / 60000) || 0);
  const stageAge = Date.now() - Date.parse(meta.sheetsStatus?.updatedAt || "");
  const currentStage = Boolean(meta.sheetsStatus?.stage && Number.isFinite(stageAge) && stageAge < 5 * 60_000);
  elements.automationState.className = `pill${collecting ? " pill--ok" : ""}`;
  elements.automationState.innerHTML = `<i class="dot"></i>${collecting ? cooldownMinutes ? "Paused" : "On" : "Stopped"}`;
  elements.automationStatus.textContent = !sheetsConnected
    ? "Connect a sheet, then press Start."
    : collecting
      ? cooldownMinutes
        ? `Google asked Fudge to slow down. Collection resumes in about ${cooldownMinutes} minute${cooldownMinutes === 1 ? "" : "s"}.`
        : `On. ${activeTabs} Google tab${activeTabs === 1 ? "" : "s"} active; limit ${tabLimit}. Checks Structure about every 30 seconds.`
      : "Off. Nothing opens on its own until you press Start.";
  if (meta.sheetsStatus?.connectorOutdated) elements.sheetsStatus.textContent = "Sheet connector is out of date — use Change sheet to re-copy it.";
  else if (meta.sheetsStatus?.error) elements.sheetsStatus.textContent = `Needs attention: ${meta.sheetsStatus.error}`;
  else if (meta.driveUploadError) elements.sheetsStatus.textContent = `Reviews saved. Picture upload will retry: ${meta.driveUploadError}`;
  // Something that clears itself. Said plainly, without the alarm of an error.
  else if (meta.sheetsStatus?.retrying) elements.sheetsStatus.textContent = meta.sheetsStatus.notice;
  else if (cooldownMinutes) elements.sheetsStatus.textContent = `Google paused collection for about ${cooldownMinutes} more minute${cooldownMinutes === 1 ? "" : "s"}.`;
  else if (activeJob?.auto) elements.sheetsStatus.textContent = `${activeJob.stage || "Scanning"} · ${activeJob.serviceKeyword || "Google"}${activeJob.city ? ` · ${activeJob.city}` : ""} · page ${activeJob.currentPage || 1} of ${activeJob.pageLimit || 4}.`;
  else if (currentStage) elements.sheetsStatus.textContent = meta.sheetsStatus.stage;
  else if (collecting && meta.sheetsStatus?.stage) elements.sheetsStatus.textContent = "The Sheet check has not finished. Press Sync now to retry.";
  else if (meta.sheetsStatus?.nextJob) elements.sheetsStatus.textContent = `Next: ${meta.sheetsStatus.nextJob.serviceKeyword} · ${meta.sheetsStatus.nextJob.city}`;
  else if (meta.sheetsStatus?.exhaustedEverywhere?.length) elements.sheetsStatus.textContent = `Every city is used up for ${meta.sheetsStatus.exhaustedEverywhere.join(", ")}. Add more cities.`;
  else if (meta.sheetsStatus?.syncedAt) elements.sheetsStatus.textContent = "No Structure rows need collection right now. Add a keyword or raise a target to start more work.";
  else if (setupIncomplete) elements.sheetsStatus.textContent = "The connector secret or URL is missing. Use Change sheet to reconnect.";
  else elements.sheetsStatus.textContent = sheetsConnected ? "Connected. Waiting for Structure requirements." : "Creates Structure, Services, Cities, Reviews, Progress and Businesses tabs.";
  renderRephrasing(sheetsConnected, meta.sheetsStatus?.automation || null);
  setLabel(elements.connectSheets, sheetsConnected ? "Sync now" : "Connect");
  // Any live runner drives the card, not just the mirrored one: with several tabs
  // scanning, the mirror could show the finished job and hide the Stop button.
  // The service worker answers with the runners it has just verified, so a record
  // left behind by a closed tab cannot keep the card stuck on "Scanning".
  const live = verified?.ok
    ? verified.jobs || []
    : Object.values(meta.scanJobs || {}).filter((job) => job?.status === "running");
  renderJob(live[0] || verified?.lastJob || meta.scanJob);
  if (collecting && !live.length) {
    if (meta.sheetsStatus?.error) setState("error", { label: "Needs attention", source: meta.sheetsStatus.error });
    else if (meta.sheetsStatus?.retrying) setState("ready", { label: "Retrying", source: meta.sheetsStatus.notice || "Checking the Sheet again shortly" });
    else if (cooldownMinutes) setState("ready", { label: "Paused", source: `Google cooldown: about ${cooldownMinutes} minute${cooldownMinutes === 1 ? "" : "s"} left` });
    else if (currentStage) setState("ready", { label: "Starting", source: meta.sheetsStatus.stage });
    else if (meta.sheetsStatus?.stage) setState("error", { label: "Sheet check stalled", source: "Press Sync now to retry the Sheet check" });
    else if (meta.sheetsStatus?.exhaustedEverywhere?.length) setState("ready", { label: "Waiting for cities", source: `Add cities for ${meta.sheetsStatus.exhaustedEverywhere.join(", ")}` });
    else if (meta.sheetsStatus?.syncedAt && !meta.sheetsStatus.nextJobs?.length) setState("ready", { label: "Waiting for work", source: "No Structure rows need collection right now" });
    else setState("ready", { label: "Running", source: "Checking Sheet requirements" });
  }
  elements.recent.innerHTML = readyReviews.slice(0, 3).map(recentCard).join("")
    || `<div class="empty empty--sm">
          <span class="empty__icon">${icon("inbox")}</span>
          <p>Your five-star reviews land here.</p>
        </div>`;
}

elements.connectSheets.addEventListener("click", async () => {
  elements.connectSheets.disabled = true;
  const connected = await sheetsReady();
  setLabel(elements.connectSheets, connected ? "Syncing…" : "Opening…");
  try {
    if (!connected) {
      await chrome.runtime.sendMessage({ type: "OPEN_SHEETS_SETUP" });
      showToast("Follow the two-step setup in the new tab.");
    } else {
      const result = await chrome.runtime.sendMessage({ type: "RUN_SHEETS_SYNC", force: true });
      if (!result?.ok) showToast(result?.error || "Could not sync Google Sheets.", "error");
      else showToast("Checking the Sheet now. Progress appears here shortly.");
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    elements.connectSheets.disabled = false;
    await render();
  }
});

// Once a sheet was connected the Connect button turned into "Sync now", which left
// no way back to the setup page to link a different sheet or disconnect.
document.querySelector("#relinkSheets").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "OPEN_SHEETS_SETUP" });
  showToast("Paste a different connector URL, or disconnect, in the new tab.");
});

// The manual twins of the Sheet's automatic work. Both exist alongside the
// triggers, not instead of them, so nothing has to be waited for.
const runSheetAction = async (button, label, type, describe) => {
  button.disabled = true;
  const previous = (button.querySelector("[data-label]") || button).textContent;
  setLabel(button, label);
  try {
    const result = await chrome.runtime.sendMessage({ type });
    if (!result?.ok) showToast(result?.error || "The Sheet could not run that just now. Fudge will keep trying on its own.", "error");
    else showToast(describe(result));
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    setLabel(button, previous);
    await render();
  }
};

elements.fillRowsNow.addEventListener("click", () => runSheetAction(
  elements.fillRowsNow,
  "Filling…",
  "FILL_ROWS_NOW",
  (result) => result.filled || result.replaced
    ? `Filled ${result.filled} row${result.filled === 1 ? "" : "s"}${result.replaced ? `, replaced ${result.replaced}` : ""}${result.rephrased ? `, rephrased ${result.rephrased}` : ""}.`
    : "Every row that could be filled already is."
));

elements.rephraseNow.addEventListener("click", () => runSheetAction(
  elements.rephraseNow,
  "Rephrasing…",
  "REPHRASE_NOW",
  (result) => result.rephrased
    ? `Rephrased ${result.rephrased} row${result.rephrased === 1 ? "" : "s"}.${result.pending ? ` ${result.pending} will be retried.` : ""}`
    : result.pending
      ? `No row could be rephrased; ${result.pending} will be retried.`
      : "Every row with a review is already rephrased."
));

elements.repairAutomation.addEventListener("click", async () => {
  elements.repairAutomation.disabled = true;
  setLabel(elements.repairAutomation, "Repairing…");
  try {
    const result = await chrome.runtime.sendMessage({ type: "REPAIR_SHEET_AUTOMATION" });
    if (!result?.ok) showToast(result?.error || "Could not reinstall the Sheet's automation.", "error");
    else if (result.automation?.queueTrigger && result.automation?.rephraseTrigger) showToast("Automatic rephrasing is installed.");
    else showToast("The Sheet would not let Fudge install its triggers. Open it and run Fudge → Install automatic rephrasing.", "error");
  } finally {
    elements.repairAutomation.disabled = false;
    setLabel(elements.repairAutomation, "Repair");
    await render();
  }
});

elements.openSheet.addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "OPEN_SHEETS_DATABASE" });
  if (!result?.ok) showToast(result?.error || "Could not open the Fudge database.", "error");
});

elements.pageSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ scanPageLimit: elements.pageSelect.value });
});

elements.parallelSelect.addEventListener("change", async () => {
  elements.parallelSelect.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "SET_PARALLEL_TABS", count: Number(elements.parallelSelect.value) });
    if (!result?.ok) showToast(result?.error || "Could not change the Google tab limit.", "error");
    else showToast(`Fudge will use up to ${result.parallelTabs} Google tab${result.parallelTabs === 1 ? "" : "s"}.`);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    elements.parallelSelect.disabled = false;
    await render();
  }
});

elements.saveToDrive.addEventListener("change", async () => {
  if (elements.saveToDrive.checked) {
    const { sheetsDatabase, appsScriptUrl } = await chrome.storage.local.get({ sheetsDatabase: null, appsScriptUrl: "" });
    if (sheetsDatabase?.connector !== "apps-script" || !appsScriptUrl) {
      elements.saveToDrive.checked = false;
      await chrome.runtime.sendMessage({ type: "OPEN_SHEETS_SETUP" });
      showToast("Connect the easy Sheets and Drive connector first.");
      return;
    }
  }
  await chrome.storage.local.set({ saveToDrive: elements.saveToDrive.checked });
  render();
});

elements.connectDrive.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "OPEN_SHEETS_SETUP" });
});

elements.collect.addEventListener("click", async () => {
  setState("running", { label: "Scanning", source: "Starting up" });
  elements.progStage.textContent = "Starting";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const supported = tab?.url?.includes("google.com/maps") || tab?.url?.includes("maps.google.com") || tab?.url?.includes("google.com/search");
    if (elements.saveToDrive.checked) {
      const { sheetsDatabase, appsScriptUrl } = await chrome.storage.local.get({ sheetsDatabase: null, appsScriptUrl: "" });
      if (sheetsDatabase?.connector !== "apps-script" || !appsScriptUrl) throw new Error("Connect the easy Sheets and Drive connector first.");
    }
    const pageLimit = String(Math.min(4, Math.max(1, Number(elements.pageSelect.value) || 4)));
    await chrome.storage.local.set({ scanPageLimit: pageLimit, saveToDrive: elements.saveToDrive.checked });
    if (await sheetsReady() || !supported) {
      // A connected Sheet always drives Start, regardless of the active tab.
      // Otherwise the same button silently switched to a one-off manual scan
      // whenever the user happened to have Google open.
      setState("running", { label: "Starting", source: "Reading Sheet requirements…" });
      elements.progStage.textContent = "Checking requirements";
      const started = await chrome.runtime.sendMessage({ type: "START_NEXT_JOB", pageLimit });
      if (started?.runState) runState = started.runState;
      if (!started?.ok) {
        // Fudge is switched on even when this first attempt found nothing to open,
        // so the card stays stopped-but-on rather than claiming an error it will
        // recover from by itself a minute later.
        await render();
        showToast(started?.error || "Could not open Google Places.", started?.retrying ? "info" : "error");
        return;
      }
      await render();
      showToast("Collecting is on. Checking the Sheet and opening Google for the next keyword.");
      return;
    }
    const result = await chrome.tabs.sendMessage(tab.id, { type: "FUDGE_START_SCAN", options: { pageLimit, saveToDrive: elements.saveToDrive.checked } });
    if (!result?.ok) throw new Error(result?.error || "Could not start the scan.");
    renderJob(result.job);
    showToast("Scan started. Fudge will notify you when it reaches the end.");
  } catch (error) {
    const message = /message channel closed|Receiving end does not exist|Could not establish connection/i.test(error.message)
      ? "Fudge lost contact with the page or restarted. Refresh the Google page, then try again."
      : error.message;
    setState("error", { label: "Needs attention", source: message });
    showToast(message, "error");
  }
});

elements.stop.addEventListener("click", async () => {
  elements.stop.disabled = true;
  setLabel(elements.stop, "Stopping…");
  const result = await chrome.runtime.sendMessage({ type: "STOP_SCAN_JOB" });
  elements.stop.disabled = false;
  if (result?.runState) runState = result.runState;
  if (!result?.ok) {
    setLabel(elements.stop, "Stop collecting");
    return showToast(result?.error || "Could not stop the scan.", "error");
  }
  await render();
  showToast("Stopped. Nothing will open until you press Start. Collected reviews stay saved.");
});

elements.clearUnused.addEventListener("click", async () => {
  const reviews = await Fudge.getReviews();
  const count = reviews.filter((review) => !review.usedAt).length;
  if (!count) return;
  document.querySelector("#clearUnusedCopy").textContent = `This permanently removes ${count} unused review${count === 1 ? "" : "s"} from Fudge. Used reviews and Google Drive files stay untouched.`;
  elements.clearUnusedDialog.showModal();
});

document.querySelector("#cancelClearUnused").addEventListener("click", () => elements.clearUnusedDialog.close());
elements.clearUnusedDialog.addEventListener("click", (event) => { if (event.target === elements.clearUnusedDialog) elements.clearUnusedDialog.close(); });
document.querySelector("#confirmClearUnused").addEventListener("click", async () => {
  const button = document.querySelector("#confirmClearUnused");
  button.disabled = true;
  button.textContent = "Clearing…";
  try {
    const result = await Fudge.clearUnusedReviews();
    elements.clearUnusedDialog.close();
    await render();
    showToast(`${result.removed} unused review${result.removed === 1 ? "" : "s"} cleared. Used reviews were not changed.`);
  } catch (error) {
    showToast(`Could not clear unused data. ${error.message}`, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Clear unused data";
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.scanJob && !changes.runState) renderJob(changes.scanJob.newValue);
  const liveCount = (jobs) => Object.values(jobs || {}).filter((job) => job?.status === "running").length;
  if (changes.reviews || changes.duplicatesBlocked || changes.sheetsDatabase || changes.appsScriptUrl || changes.runState || changes.sheetsStatus || changes.driveUploadError || changes.parallelTabs || changes.blockedUntil ||
    (changes.scanJobs && liveCount(changes.scanJobs.newValue) !== liveCount(changes.scanJobs.oldValue))) render();
});

chrome.tabs.onActivated.addListener(() => { if (elements.card.dataset.state !== "running") detectPage(); });
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url && elements.card.dataset.state !== "running") detectPage(); });

render();
