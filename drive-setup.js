const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const icon = (name) => `<svg class="icon icon--sm"><use href="#i-${name}" /></svg>`;
const setLabel = (button, text) => { (button.querySelector("[data-label]") || button).textContent = text; };
let connectorCode = "";
let connectorSecret = "";
let toastTimer;

function showToast(message, variant = "info") {
  const toast = $("#toast");
  toast.className = `toast show${variant === "error" ? " toast--error" : ""}`;
  toast.innerHTML = `${icon(variant === "error" ? "alert" : "check")}<span>${escapeHtml(message)}</span>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4800);
}

function renderConnection(database) {
  const card = $("#connectionCard");
  card.dataset.state = database ? "connected" : "idle";
  $("#connectionTitle").textContent = database ? "Fudge database connected" : "Not connected";
  $("#connectionDetail").textContent = database ? "Automatic Sheets fulfillment and public Drive image links are ready." : "The connector will create Fudge tabs and a Fudge Reviews folder in your Drive.";
  $("#disconnectButton").hidden = !database;
  $("#copyConnectionButton").hidden = !database;
}

async function loadSetup() {
  const result = await chrome.runtime.sendMessage({ type: "GET_SCRIPT_SETUP" });
  if (!result.ok) throw new Error(result.error);
  connectorSecret = result.appsScriptSecret;
  const template = await fetch(chrome.runtime.getURL("apps-script.gs")).then((response) => response.text());
  connectorCode = template.replaceAll("__FUDGE_SECRET__", connectorSecret.replaceAll("\\", "\\\\").replaceAll('"', '\\"'));
  $("#scriptPreview").textContent = `${connectorCode.split("\n").slice(0, 5).join("\n")}\n\n… complete connector ready to copy`;
  $("#webAppUrl").value = result.appsScriptUrl || "";
  const status = await chrome.runtime.sendMessage({ type: "GET_SHEETS_STATUS" }).catch(() => null);
  renderConnection(status?.ok && status.connectionReady ? result.sheetsDatabase : null);
}

$("#copyScript").addEventListener("click", async () => {
  await navigator.clipboard.writeText(connectorCode);
  showToast("Complete protected connector copied. Paste it into Apps Script.");
});

$("#connectButton").addEventListener("click", async () => {
  const button = $("#connectButton");
  const url = $("#webAppUrl").value.trim();
  button.disabled = true;
  setLabel(button, "Testing connector…");
  try {
    const result = await chrome.runtime.sendMessage({ type: "SAVE_SCRIPT_SETUP", url, secret: connectorSecret });
    if (!result.ok) throw new Error(result.error);
    renderConnection(result.database);
    showToast("Connected. Fudge created the database tabs and turned automation on.");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    setLabel(button, "Connect Sheet and Drive");
  }
});

$("#copyConnectionButton").addEventListener("click", async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: "GET_CONNECTION_CODE" });
    if (!result.ok) throw new Error(result.error);
    await navigator.clipboard.writeText(result.connectionCode);
    showToast("Connection code copied. Paste it into Fudge on the other computer.");
  } catch (error) {
    showToast(error.message, "error");
  }
});

$("#disconnectButton").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "DISCONNECT_SCRIPT" });
  if (!result.ok) return showToast(result.error, "error");
  $("#webAppUrl").value = "";
  renderConnection(null);
  showToast("Connector removed from Fudge. Your Sheet and Drive files were not deleted.");
});

loadSetup().catch((error) => showToast(error.message, "error"));
