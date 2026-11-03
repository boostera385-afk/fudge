"use strict";
const field = (id) => document.getElementById(id);
let busy = false;
function message(text, state = "error") { field("backendStatus").textContent = text; field("backendStatus").dataset.state = state; }
// One plain sentence a person can read at a glance: are they signed in, and is
// their business connected. Queue numbers live with the queue controls below.
function connectionMessage(state) {
  const who = state.email ? ` as ${state.email}` : "";
  if (!state.signedIn) return { text: "Not signed in. Sign in with your Fudge / ND account to connect.", state: "off" };
  if (!state.organizationId) return { text: `Signed in${who}. Not connected to a business yet — set up or choose one in step 2.`, state: "partial" };
  return { text: `Connected. Signed in${who}; your business account is connected.${state.enabled ? "" : " Uploads are off."}`, state: "ok" };
}
function clearConnectionCheck() {
  field("connectionResult").textContent = "Not tested for the current selection. Test backend reads explicitly; this never releases uploads.";
  field("catalogResult").textContent = "Catalog preview not checked for this account selection. No cached catalog is applied to collection or Sheets.";
}
function choices(list) {
  field("createAccount").hidden = !Array.isArray(list) || list.length !== 0;
  field("advancedAccount").open = Array.isArray(list) && list.length > 1;
  field("workspace").replaceChildren();
  for (const item of list || []) {
    const option = document.createElement("option"); option.value = item.id; option.textContent = `${item.name} — ${item.id}`; field("workspace").append(option);
  }
}
async function send(type, values = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...values });
  if (!result?.ok) throw new Error(result?.error || "Backend worker is unavailable. Reload the extension after saving updates.");
  return result;
}
async function refresh() {
  const state = await send("BACKEND_STATUS");
  const counts = state.counts;
  const connection = connectionMessage(state);
  message(connection.text, connection.state);
  field("queueSummary").textContent = `Uploads ${state.enabled ? "enabled" : "paused"} · pending ${counts.pending} · blocked ${counts.blocked} · acknowledged ${counts.acknowledged} · cancelled ${counts.cancelled} · other targets ${counts.otherTargets}. ${state.reason}`;
  field("enableUploads").disabled = !state.releaseUploads;
  field("queueHistory").disabled = !state.releaseUploads;
  field("drainUploads").disabled = !state.releaseUploads;
  field("refreshCatalog").disabled = !state.releaseCatalog;
  if (!state.signedIn) field("createAccount").hidden = true;
  field("blockedItems").replaceChildren();
  for (const entry of state.blockedItems || []) {
    const item = document.createElement("li"); item.textContent = `${entry.localId || "Unidentified local source"}: ${entry.reason}`; field("blockedItems").append(item);
  }
  field("recentReceipts").replaceChildren();
  for (const receipt of state.recentReceipts || []) {
    const item = document.createElement("li");
    item.textContent = `Record ${receipt.recordId} · revision ${receipt.revision} · revision ID ${receipt.revisionId} · acknowledged locally ${new Date(receipt.acknowledgedAt).toISOString()}`;
    field("recentReceipts").append(item);
  }
  if (!state.recentReceipts?.length) {
    const item = document.createElement("li"); item.textContent = "No saved acknowledgments for this target. This does not mean your local reviews are missing."; field("recentReceipts").append(item);
  }
  field("releaseStatus").textContent = state.releaseUploads ? "Release enabled for reviewed backend deployment. Uploads still require explicit consent and workspace selection." : "The shared schema is deployed; uploads remain gated pending browser acceptance, policy review and pilot approval. This build never sends intake RPCs, including after sign-in or read checks.";
}
async function act(work) {
  if (busy) return;
  busy = true;
  try { await work(); await refresh(); } catch (error) { message(error.message || "Setup failed. Private details are not displayed."); }
  finally { busy = false; }
}
function authenticate(type) {
  if (busy) return;
  if (!field("signInForm").reportValidity()) return;
  // Must be initiated directly from the user's gesture, before another async call.
  const permission = chrome.permissions.request({ origins: ["https://xtefjnfdjnxwrpkoydaj.supabase.co/*"] });
  const password = field("password").value;
  field("password").value = "";
  act(async () => {
    clearConnectionCheck();
    if (!(await permission)) throw new Error("Project network permission was not granted. Nothing was connected.");
    const email = field("email").value.trim();
    field("authResult").textContent = type === "BACKEND_SIGN_UP" ? "Creating your account…" : "Signing in…";
    const result = await send(type, { email, password }).catch((error) => {
      field("authResult").textContent = `${type === "BACKEND_SIGN_UP" ? "Sign-up" : "Sign-in"} failed: ${error.message}`;
      throw error;
    });
    if (type === "BACKEND_SIGN_UP") {
      field("authResult").textContent = `Sign-up sent for ${email}. Open the verification email, click its link, then come back and press Sign in. ${result.message}`;
    } else {
      choices(result.workspaces);
      field("authResult").textContent = `Signed in as ${email}. ${result.workspaces.length === 1 ? "Your business account is connected." : "Choose or set up your business account in step 2."} Uploads remain paused.`;
    }
  });
}
field("signInForm").addEventListener("submit", (event) => { event.preventDefault(); authenticate("BACKEND_SIGN_IN"); });
field("signUp").addEventListener("click", () => authenticate("BACKEND_SIGN_UP"));
field("createAccount").addEventListener("click", () => act(async () => {
  if (!confirm("Create an empty private business account? If you belong to a team, cancel and ask its owner for access instead.")) return;
  clearConnectionCheck(); choices((await send("BACKEND_CREATE_ACCOUNT")).workspaces);
}));
field("loadWorkspaces").addEventListener("click", () => act(async () => choices((await send("BACKEND_WORKSPACES")).workspaces)));
field("refreshCatalog").addEventListener("click", () => act(async () => {
  const result = await send("BACKEND_REFRESH_CATALOG");
  field("catalogResult").textContent = `Catalog preview: ${result.state}; usable cached preview ${result.available ? "yes" : "no"}; generation ${result.generation ?? "unknown"}, revision ${result.revision ?? "unknown"}, rules ${result.rules}. Not applied to collection or Sheets.`;
}));
field("selectWorkspace").addEventListener("click", () => act(async () => { clearConnectionCheck(); await send("BACKEND_SELECT_WORKSPACE", { organizationId: field("workspace").value }); }));
field("signOut").addEventListener("click", () => act(async () => { clearConnectionCheck(); await send("BACKEND_SIGN_OUT"); choices([]); field("authResult").textContent = "Signed out. Uploads are paused; sign in again to reconnect."; }));
field("testConnection").addEventListener("click", () => act(async () => {
  field("connectionResult").textContent = "Checking verified staff access and empty table reads…";
  try {
    const result = await send("BACKEND_TEST_CONNECTION");
    field("connectionResult").textContent = `Read checks passed for workspace ${result.organizationId} at ${new Date(result.checkedAt).toISOString()}. No source rows fetched or uploaded. This does not test intake writes, prove RLS isolation or release uploads.`;
  } catch (error) {
    field("connectionResult").textContent = "Read checks did not pass. Review the setup error; nothing was uploaded or acknowledged.";
    throw error;
  }
}));
field("enableUploads").addEventListener("click", () => act(() => send("BACKEND_ENABLE", { enabled: true, confirmed: field("uploadConsent").checked })));
field("pauseUploads").addEventListener("click", () => act(() => send("BACKEND_ENABLE", { enabled: false })));
field("refreshStatus").addEventListener("click", () => act(async () => {}));
field("retryUploads").addEventListener("click", () => act(() => send("BACKEND_RETRY")));
field("drainUploads").addEventListener("click", () => act(() => send("BACKEND_DRAIN")));
field("queueHistory").addEventListener("click", () => act(() => send("BACKEND_QUEUE_HISTORY", { confirmed: field("historyConsent").checked })));
field("cancelPending").addEventListener("click", () => act(() => send("BACKEND_CANCEL_PENDING", { confirmed: field("cancelConsent").checked })));
refresh().catch((error) => message(error.message));
