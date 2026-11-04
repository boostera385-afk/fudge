const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const icon = (name) => `<svg class="icon icon--sm"><use href="#i-${name}" /></svg>`;
const setLabel = (button, text) => { (button.querySelector("[data-label]") || button).textContent = text; };
let connectorCode = "";
let connectorSecret = "";
let setupGeneration = 0;
let toastTimer;

function showToast(message, variant = "info") {
  const toast = $("#toast");
  toast.className = `toast show${variant === "error" ? " toast--error" : ""}`;
  toast.innerHTML = `${icon(variant === "error" ? "alert" : "check")}<span>${escapeHtml(message)}</span>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4800);
}

function renderConnection(database, running = false) {
  const card = $("#connectionCard");
  card.dataset.state = database ? "connected" : "idle";
  $("#connectionTitle").textContent = database ? "Fudge Sheet connection saved" : "Not connected";
  $("#connectionDetail").textContent = database ? `Saved setup found. Use Sync now to check it. ${running ? "Collection is on and continues with the sidebar closed." : "Collection stays stopped until Start collecting."} Drive uploads can create public image links.` : "The connector will create Fudge tabs and a Fudge Reviews folder in your Drive.";
  $("#disconnectButton").hidden = !database;
  $("#copyConnectionButton").hidden = !database;
}

async function loadSetup() {
  const generation = ++setupGeneration;
  connectorCode = "";
  $("#copyScript").disabled = true;
  $("#connectButton").disabled = true;
  $("#scriptPreview").textContent = "Preparing your protected connector…";
  const result = await chrome.runtime.sendMessage({ type: "GET_SCRIPT_SETUP" });
  if (!result?.ok) throw new Error(result?.error || "Setup could not be loaded. Reopen this page and try again.");
  if (typeof result.appsScriptSecret !== "string" || result.appsScriptSecret.length < 24) throw new Error("Protected connector is not ready. Reopen setup and try again.");
  const response = await fetch(chrome.runtime.getURL("apps-script.gs"));
  if (!response.ok) throw new Error("Connector file could not load. Reload the extension, then reopen setup.");
  const template = await response.text();
  const version = template.match(/const FUDGE_CONNECTOR_VERSION = (\d+);/);
  const declaration = 'const FUDGE_SECRET = "__FUDGE_SECRET__";';
  if (!version || !template.includes(declaration)) throw new Error("Connector file is incomplete. Reload the extension, then reopen setup.");
  if (generation !== setupGeneration) return;
  connectorSecret = result.appsScriptSecret;
  connectorCode = template.replace(declaration, () => `const FUDGE_SECRET = ${JSON.stringify(connectorSecret)};`);
  $("#scriptPreview").textContent = `Protected connector v${version[1]} ready to copy. The private secret is included in the copy, not shown here.`;
  $("#copyScript").disabled = false;
  $("#connectButton").disabled = false;
  $("#webAppUrl").value = result.appsScriptUrl || "";
  const status = await chrome.runtime.sendMessage({ type: "GET_SHEETS_STATUS" }).catch(() => null);
  if (generation === setupGeneration) renderConnection(status?.ok && status.connectionReady ? result.sheetsDatabase : null, status?.runState === "running");
}

$("#copyScript").addEventListener("click", async () => {
  try {
    if (!connectorCode) throw new Error("Connector is not ready. Wait for it to load or reopen setup.");
    await navigator.clipboard.writeText(connectorCode);
    showToast("Protected connector copied. Keep it private; paste it into Apps Script and deploy a New version.");
  } catch (_error) {
    showToast(connectorCode ? "Could not copy the connector. Allow clipboard access and try again." : "Connector is not ready. Wait for it to load or reopen setup.", "error");
  }
});

$("#connectButton").addEventListener("click", async () => {
  const button = $("#connectButton");
  const url = $("#webAppUrl").value.trim();
  button.disabled = true;
  setLabel(button, "Testing connector…");
  try {
    if (!connectorCode) throw new Error("Protected connector is not ready. Reopen setup and try again.");
    const result = await chrome.runtime.sendMessage({ type: "SAVE_SCRIPT_SETUP", url, secret: connectorSecret });
    if (!result.ok) throw new Error(result.error);
    renderConnection(result.database, result.runState === "running");
    // Imported connection codes and recovery can select a different secret.
    // Refresh the generated copy so a later update preserves the live connection.
    try {
      await loadSetup();
      showToast(result.runState === "running" ? "Connected. Collection is still on and continues with the sidebar closed." : "Connected. Collection stays stopped until you press Start collecting.");
    } catch (_error) {
      renderConnection(result.database, result.runState === "running");
      showToast("Connection saved. Reopen setup before copying an updated connector. Collection state was not changed by this display error.", "error");
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = !connectorCode;
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
  try {
    const result = await chrome.runtime.sendMessage({ type: "DISCONNECT_SCRIPT" });
    if (!result?.ok) throw new Error(result?.error || "Disconnect could not finish. Try again.");
    $("#webAppUrl").value = "";
    renderConnection(null);
    showToast("Connector removed from Fudge. Your Sheet and Drive files were not deleted.");
  } catch (error) {
    showToast(error.message, "error");
  }
});

const setupReady = loadSetup().catch((error) => showToast(error.message, "error"));
