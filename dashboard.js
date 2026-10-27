const state = { reviews: [], filter: "all", view: "ready", query: "", sort: "recent", loaded: false };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const icon = (name, extra = "") => `<svg class="icon icon--sm ${extra}"><use href="#i-${name}" /></svg>`;
const setLabel = (button, text) => { (button.querySelector("[data-label]") || button).textContent = text; };
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

const sorters = {
  recent: (a, b) => String(b.collectedAt || "").localeCompare(String(a.collectedAt || "")),
  photos: (a, b) => b.photos.length - a.photos.length,
  length: (a, b) => (b.text || "").length - (a.text || "").length
};

function filteredReviews() {
  return state.reviews
    .filter((review) => {
      const matchesService = state.filter === "all" || review.service.id === state.filter;
      const matchesView = state.view === "used" ? Boolean(review.usedAt) : !review.usedAt;
      return !review.rejectedAt && matchesView && matchesService && Fudge.normalize(review.text).includes(Fudge.normalize(state.query));
    })
    .sort(sorters[state.sort] || sorters.recent);
}

/* ---------- Cells ---------- */

function photosCell(review) {
  const visible = review.photos.slice(0, 4);
  if (!visible.length) return `<div class="photos photos--none"><span>Text only</span></div>`;
  return `<div class="photos n${Math.min(visible.length, 4)}">
    ${visible.map((photo, index) => `<img src="${escapeHtml(review.drivePhotos?.[index]?.directLink || photo)}" alt="Review picture ${index + 1}" loading="lazy" />`).join("")}
    ${review.photos.length > 4 ? `<span class="photos__more">+${review.photos.length - 4}</span>` : ""}
  </div>`;
}

const LINKS_SHOWN = 6;

function linksCell(review) {
  const links = review.photos.slice(0, LINKS_SHOWN).map((photo, index) => {
    const drive = review.drivePhotos?.[index];
    const url = drive?.viewLink || photo;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer" class="${drive ? "is-drive" : ""}" title="${drive ? "Google Drive copy" : "Original Google image"}">
      ${icon("arrow-ur")}<span>${index + 1}</span>
    </a>`;
  });
  const rest = review.photos.length - LINKS_SHOWN;
  if (rest > 0) links.push(`<button class="links__more" data-act="open" title="Show all ${review.photos.length} pictures">+${rest}</button>`);
  if (!links.length) return `<span class="no-links">No picture required</span>`;
  return `<div class="links${links.length === 1 ? " links--single" : ""}">${links.join("")}</div>`;
}

function metaLine(review) {
  const parts = [
    `<span>${icon("star", "icon--solid")}${review.rating || 5}.0</span>`,
    `<span>${icon("user")}${escapeHtml(review.author || "Google reviewer")}</span>`,
    `<span>${icon("image")}${plural(review.photos.length, "photo")}</span>`
  ];
  if (review.placeName) parts.splice(2, 0, `<span>${escapeHtml(review.placeName)}</span>`);
  return parts.join("");
}

function reviewRow(review) {
  return `<div class="table__row" data-id="${escapeHtml(review.id)}">
    <div class="cell cell--photos">${photosCell(review)}</div>
    <div class="cell cell--links">${linksCell(review)}</div>
    <div class="cell cell--text">
      <p>${escapeHtml(review.text)}</p>
      <div class="cell__meta">${metaLine(review)}</div>
    </div>
    <div class="cell cell--actions">
      <div class="row-actions">
        <button class="icon-btn icon-btn--sm icon-btn--bare" data-act="open" aria-label="Open full review">${icon("expand")}</button>
        <button class="icon-btn icon-btn--sm icon-btn--bare" data-act="copy" aria-label="Copy this review">${icon("copy")}</button>
        <button class="used-btn" data-act="used" aria-label="${review.usedAt ? "Move review back to Ready" : "Move review to Used"}">${review.usedAt ? "Restore" : "Used"}</button>
      </div>
    </div>
  </div>`;
}

/* ---------- Table ---------- */

function emptyState() {
  if (state.query) {
    return `<div class="empty">
      <span class="empty__icon">${icon("search")}</span>
      <h3>Nothing matches “${escapeHtml(state.query)}”.</h3>
      <p>Try a shorter phrase, or clear the search to see the whole library.</p>
      <button class="btn btn--ghost btn--sm" id="emptyClear">Clear search</button>
    </div>`;
  }
  if (state.filter !== "all") {
    return `<div class="empty">
      <span class="empty__icon">${icon("inbox")}</span>
      <h3>No reviews in this service yet.</h3>
      <p>Pick another service, or scan a business that does this kind of work.</p>
      <button class="btn btn--ghost btn--sm" id="emptyAll">Show all services</button>
    </div>`;
  }
  if (state.view === "used") {
    return `<div class="empty">
      <span class="empty__icon">${icon("archive")}</span>
      <h3>No used reviews yet.</h3>
      <p>Click Used on a review after you publish or deliver it. It will move here and stay saved.</p>
    </div>`;
  }
  return `<div class="empty">
    <span class="empty__icon">${icon("inbox")}</span>
    <h3>The library is empty.</h3>
    <p>Open a business on Google Maps or a Google Places results page, then start a scan from the Fudge side panel.</p>
  </div>`;
}

function renderTable() {
  const reviews = filteredReviews();
  const table = $("#reviewTable");
  table.setAttribute("aria-busy", "false");

  if (!reviews.length) {
    table.innerHTML = emptyState();
    $("#emptyClear")?.addEventListener("click", () => { $("#searchInput").value = ""; setQuery(""); });
    $("#emptyAll")?.addEventListener("click", () => { state.filter = "all"; renderChips(); renderTable(); });
    return;
  }

  const serviceOrder = state.filter === "all" ? Fudge.SERVICES.map((service) => service.id) : [state.filter];
  table.innerHTML = serviceOrder.flatMap((serviceId) => {
    const serviceItems = reviews.filter((review) => review.service.id === serviceId);
    if (!serviceItems.length) return [];
    const service = Fudge.SERVICES.find((item) => item.id === serviceId);
    return service.subcategories.map((subcategory) => {
      const items = serviceItems.filter((review) => review.service.subcategory?.id === subcategory.id);
      if (!items.length) return "";
      return `<section class="group">
        <header class="group__head">
          <span class="swatch" style="--service-color:${escapeHtml(service.color)}"></span>
          <div class="group__title">
            <small>${escapeHtml(service.label)}</small>
            <h2>${escapeHtml(subcategory.label)}</h2>
          </div>
          <span class="group__count">${items.length}</span>
          <span class="group__rule"></span>
        </header>
        <div class="table">
          <div class="table__head">
            <span>Pictures</span><span>Links</span><span>Review</span><span class="sr-only">Actions</span>
          </div>
          ${items.map(reviewRow).join("")}
        </div>
      </section>`;
    });
  }).join("");
}

function renderChips() {
  const visibleReviews = state.reviews.filter((review) => !review.rejectedAt && (state.view === "used" ? Boolean(review.usedAt) : !review.usedAt));
  const counts = visibleReviews.reduce((result, review) => {
    result[review.service.id] = (result[review.service.id] || 0) + 1;
    return result;
  }, {});
  const chips = [{ id: "all", label: "All services", color: "#d8ff2f" }, ...Fudge.SERVICES.filter((service) => counts[service.id])];
  $("#serviceChips").innerHTML = chips.map((service) => `
    <button class="chip" data-service="${service.id}" aria-pressed="${state.filter === service.id}" style="--chip:${escapeHtml(service.color)}">
      ${escapeHtml(service.label)}
      <span class="chip__count">${service.id === "all" ? visibleReviews.length : counts[service.id]}</span>
    </button>`).join("");
  $("#serviceChips").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    state.filter = button.dataset.service;
    renderChips();
    renderTable();
  }));
}

function renderStatusTabs() {
  const usable = state.reviews.filter((review) => !review.rejectedAt);
  const ready = usable.filter((review) => !review.usedAt).length;
  const used = usable.length - ready;
  $("#readyCount").textContent = ready;
  $("#usedCount").textContent = used;
  $("#statusHelp").textContent = state.view === "used"
    ? "Used reviews stay saved here and can be restored anytime."
    : "Reviews ready to copy, upload, or publish.";
  $("#clearUnusedButton").hidden = state.view !== "ready";
  $("#clearUnusedButton").disabled = ready === 0;
  $("#clearUsedButton").hidden = state.view !== "used";
  $("#clearUsedButton").disabled = used === 0;
  $("#statusTabs").querySelectorAll("[data-view]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
  });
}

function renderSummary() {
  const usable = state.reviews.filter((review) => !review.rejectedAt);
  $("#totalReviews").textContent = usable.length;
  $("#totalServices").textContent = new Set(usable.map((review) => review.service.id)).size;
  $("#librarySummary").textContent = usable.length
    ? `${plural(usable.length, "five-star review")}, sorted into precise service subcategories.`
    : "Clean customer proof, ready for wherever you need it.";
}

/* ---------- Detail sheet ---------- */

const sheet = $("#detailSheet");

function openDetail(id) {
  const review = state.reviews.find((item) => item.id === id);
  if (!review) return;
  state.detailId = review.id;
  $("#detailService").textContent = review.service.label;
  $("#detailSubcategory").textContent = review.service.subcategory?.label || "General";
  $("#detailGallery").innerHTML = review.photos.length ? review.photos
    .map((photo, index) => `<img src="${escapeHtml(review.drivePhotos?.[index]?.directLink || photo)}" alt="Review picture ${index + 1}" />`)
    .join("") : `<div class="photos photos--none"><span>Text-only review</span></div>`;
  $("#detailText").textContent = `“${review.text}”`;
  $("#detailMeta").innerHTML = metaLine(review);
  $("#detailLinks").innerHTML = review.photos.map((photo, index) => {
    const drive = review.drivePhotos?.[index];
    return `<a class="chip" href="${escapeHtml(drive?.viewLink || photo)}" target="_blank" rel="noreferrer">
      ${icon("arrow-ur")}${drive ? "Drive" : "Original"} ${index + 1}
    </a>`;
  }).join("");
  renderWriter(review);
  sheet.showModal();
}

/* ---------- Website writer ---------- */

const setWriterState = ({ output, warnings, error } = {}) => {
  const outputNode = $("#writerOutput");
  const warningNode = $("#writerWarnings");
  if (error) {
    outputNode.hidden = true;
    outputNode.textContent = "";
    warningNode.hidden = false;
    warningNode.classList.add("writer__warnings--error");
    warningNode.textContent = error;
    return;
  }
  warningNode.classList.remove("writer__warnings--error");
  if (warnings?.length) {
    warningNode.hidden = false;
    warningNode.textContent = warnings.join(" ");
  } else {
    warningNode.hidden = true;
    warningNode.textContent = "";
  }
  if (output) {
    outputNode.hidden = false;
    outputNode.textContent = output;
    $("#writerCopy").hidden = false;
  } else {
    outputNode.hidden = true;
    outputNode.textContent = "";
    $("#writerCopy").hidden = true;
  }
};

async function renderWriter(review) {
  const { websitePhone = "", writerCrewNames = "" } = await chrome.storage.local.get({ websitePhone: "", writerCrewNames: "" });
  $("#writerPhone").value = websitePhone;
  $("#writerNames").value = writerCrewNames;
  const saved = await WebsiteWriter.getRewrite(review.id);
  setWriterState(saved ? { output: saved.text, warnings: saved.warnings } : {});
  const runButton = $("#writerRun");
  setLabel(runButton, saved ? "Regenerate" : "Rewrite for website");
  runButton.disabled = false;
}

$("#writerPhone").addEventListener("change", (event) => {
  chrome.storage.local.set({ websitePhone: event.target.value.trim() });
});

$("#writerNames").addEventListener("change", (event) => {
  chrome.storage.local.set({ writerCrewNames: event.target.value.trim() });
});

$("#writerRun").addEventListener("click", async () => {
  const review = state.reviews.find((item) => item.id === state.detailId);
  if (!review) return;
  const button = $("#writerRun");
  const phone = $("#writerPhone").value.trim();
  const names = $("#writerNames").value.trim();
  await chrome.storage.local.set({ websitePhone: phone, writerCrewNames: names });
  button.disabled = true;
  setLabel(button, "Rewriting…");
  setWriterState({});
  try {
    const result = await WebsiteWriter.rewrite({ review, phone, names });
    await WebsiteWriter.saveRewrite(review.id, result);
    setWriterState({ output: result.text, warnings: result.warnings });
    setLabel(button, "Regenerate");
  } catch (error) {
    setWriterState({ error: error.message });
    setLabel(button, "Try again");
  } finally {
    button.disabled = false;
  }
});

$("#writerCopy").addEventListener("click", async () => {
  const text = $("#writerOutput").textContent;
  if (!text) return;
  await navigator.clipboard.writeText(text);
  showToast("Rewritten review copied.");
});

$("#detailClose").addEventListener("click", () => sheet.close());
sheet.addEventListener("click", (event) => { if (event.target === sheet) sheet.close(); });

/* ---------- Clipboard ---------- */

function sheetsRow(review) {
  const preferred = review.photos.map((photo, index) => review.drivePhotos?.[index]?.directLink || photo);
  const photoUrl = (preferred[0] || "").replace(/"/g, '""');
  const picture = photoUrl ? `=IMAGE("${photoUrl}")` : "";
  // A CHAR(10) formula creates visible line breaks inside one Google Sheets
  // cell, without clipboard newlines being mistaken for additional rows.
  const pictureLinks = preferred.length
    ? `="${preferred.map((url) => String(url).replace(/"/g, '""')).join('"&CHAR(10)&"')}"`
    : "";
  const text = (review.text || "").replace(/[\t\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `${picture}\t${pictureLinks}\t${safeText}`;
}

let toastTimer;
function showToast(message, variant = "info") {
  const toast = $("#toast");
  toast.className = `toast show${variant === "error" ? " toast--error" : ""}`;
  toast.innerHTML = `${icon(variant === "error" ? "alert" : "check")}<span>${escapeHtml(message)}</span>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3600);
}

async function copyForSheets() {
  const reviews = filteredReviews();
  if (!reviews.length) return showToast("There are no reviews to copy.", "error");
  await navigator.clipboard.writeText(reviews.map(sheetsRow).join("\n"));
  const button = $("#copyButton");
  button.classList.add("is-done");
  setLabel(button, "Copied");
  showToast(`${plural(reviews.length, "row")} copied. Paste into cell A1.`);
  setTimeout(() => { button.classList.remove("is-done"); setLabel(button, "Copy for Sheets"); }, 2200);
}

async function copyOne(id) {
  const review = state.reviews.find((item) => item.id === id);
  if (!review) return;
  await navigator.clipboard.writeText(sheetsRow(review));
  showToast("Review copied as a Sheets row.");
}

async function saveToDrive() {
  const button = $("#driveButton");
  button.disabled = true;
  const { sheetsDatabase, appsScriptUrl } = await chrome.storage.local.get({ sheetsDatabase: null, appsScriptUrl: "" });
  if (sheetsDatabase?.connector !== "apps-script" || !appsScriptUrl) {
    button.disabled = false;
    setLabel(button, "Save to Drive");
    await chrome.runtime.sendMessage({ type: "OPEN_SHEETS_SETUP" });
    return showToast("Connect the easy Sheets and Drive connector first.");
  }
  setLabel(button, "Uploading…");
  const result = await chrome.runtime.sendMessage({ type: "SAVE_REVIEWS_TO_DRIVE", reviews: filteredReviews() });
  button.disabled = false;
  setLabel(button, "Save to Drive");
  if (!result.ok) return showToast(result.error, "error");
  state.reviews = result.reviews;
  renderTable();
  showToast(`${plural(result.uploaded, "original image")} saved with public links.`);
}

/* ---------- Wiring ---------- */

function setQuery(value) {
  state.query = value;
  $("#clearSearch").hidden = !value;
  renderTable();
}

$("#searchInput").addEventListener("input", (event) => setQuery(event.target.value));
$("#clearSearch").addEventListener("click", () => { $("#searchInput").value = ""; setQuery(""); $("#searchInput").focus(); });
$("#sortSelect").addEventListener("change", (event) => { state.sort = event.target.value; renderTable(); });
$("#statusTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  state.view = button.dataset.view;
  state.filter = "all";
  renderStatusTabs();
  renderChips();
  renderTable();
});
$("#copyButton").addEventListener("click", () => copyForSheets().catch(() => showToast("Copy failed. Please try again.", "error")));
$("#driveButton").addEventListener("click", () => saveToDrive().catch((error) => showToast(error.message, "error")));
$("#rulesButton").addEventListener("click", () => showToast("Fudge keeps unique five-star reviews with photos by default. Sheet rows marked Self Write or Without Picture collect text-only reviews."));

const clearUsedDialog = $("#clearUsedDialog");
const clearUnusedDialog = $("#clearUnusedDialog");
$("#clearUnusedButton").addEventListener("click", () => {
  const count = state.reviews.filter((review) => !review.usedAt && !review.rejectedAt).length;
  if (!count) return;
  $("#clearUnusedCopy").textContent = `This permanently removes ${plural(count, "unused review")} from Fudge’s local library. Used reviews and Google Drive files stay untouched.`;
  clearUnusedDialog.showModal();
});
$("#cancelClearUnused").addEventListener("click", () => clearUnusedDialog.close());
clearUnusedDialog.addEventListener("click", (event) => { if (event.target === clearUnusedDialog) clearUnusedDialog.close(); });
$("#confirmClearUnused").addEventListener("click", async () => {
  const button = $("#confirmClearUnused");
  button.disabled = true;
  button.textContent = "Clearing…";
  try {
    const result = await Fudge.clearUnusedReviews();
    state.reviews = result.reviews;
    clearUnusedDialog.close();
    renderSummary();
    renderStatusTabs();
    renderChips();
    renderTable();
    showToast(`${plural(result.removed, "unused review")} cleared. Used reviews were not changed.`);
  } catch (error) {
    showToast(`Could not clear unused data. ${error.message}`, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Clear unused data";
  }
});

$("#clearUsedButton").addEventListener("click", () => {
  const count = state.reviews.filter((review) => review.usedAt && !review.rejectedAt).length;
  if (!count) return;
  $("#clearUsedCopy").textContent = `This permanently removes ${plural(count, "used review")} from Fudge’s local library. Ready reviews and Google Drive files stay untouched.`;
  clearUsedDialog.showModal();
});
$("#cancelClearUsed").addEventListener("click", () => clearUsedDialog.close());
clearUsedDialog.addEventListener("click", (event) => { if (event.target === clearUsedDialog) clearUsedDialog.close(); });
$("#confirmClearUsed").addEventListener("click", async () => {
  const button = $("#confirmClearUsed");
  button.disabled = true;
  button.textContent = "Clearing…";
  try {
    const result = await Fudge.clearUsedReviews();
    state.reviews = result.reviews;
    clearUsedDialog.close();
    renderSummary();
    renderStatusTabs();
    renderChips();
    renderTable();
    showToast(`${plural(result.removed, "used review")} cleared. Ready reviews were not changed.`);
  } catch (error) {
    showToast(`Could not clear Used data. ${error.message}`, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Clear Used data";
  }
});

/* One delegated listener for every row action, including rows rendered later. */
$("#reviewTable").addEventListener("click", (event) => {
  const action = event.target.closest("[data-act]");
  const row = event.target.closest(".table__row");
  if (!row) return;
  if (action?.dataset.act === "copy") return copyOne(row.dataset.id);
  if (action?.dataset.act === "used") {
    const review = state.reviews.find((item) => item.id === row.dataset.id);
    if (!review) return;
    Fudge.setReviewUsed(review.id, !review.usedAt).then((reviews) => {
      state.reviews = reviews;
      renderSummary();
      renderStatusTabs();
      renderChips();
      renderTable();
      showToast(review.usedAt ? "Review restored to Ready." : "Review moved to Used.");
    }).catch((error) => showToast(`Could not save that change. ${error.message}`, "error"));
    return;
  }
  if (action?.dataset.act === "open" || !event.target.closest("a")) openDetail(row.dataset.id);
});

async function init() {
  $("#versionLabel").textContent = chrome.runtime.getManifest().version;
  state.reviews = await Fudge.getReviews();
  const meta = await chrome.storage.local.get({ duplicatesBlocked: 0 });
  $("#totalDuplicates").textContent = meta.duplicatesBlocked;
  state.loaded = true;
  renderSummary();
  renderStatusTabs();
  renderChips();
  renderTable();
}

init();
