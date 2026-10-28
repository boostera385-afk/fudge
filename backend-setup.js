"use strict";
const field = (id) => document.getElementById(id);
let busy = false;
function message(text) { field("backendStatus").textContent = text; }
function choices(list) {
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
  message(`${state.signedIn ? "Signed in" : "Signed out"} · ${state.enabled ? "enabled" : "paused"} · workspace ${state.organizationId || "not selected"} · pending ${counts.pending} · blocked ${counts.blocked} · acknowledged ${counts.acknowledged} · cancelled ${counts.cancelled} · other targets ${counts.otherTargets}. ${state.reason}`);
  field("enableUploads").disabled = !state.releaseUploads;
  field("queueHistory").disabled = !state.releaseUploads;
  field("drainUploads").disabled = !state.releaseUploads;
  if (!field("publishableKey").value && state.publishableKey) field("publishableKey").value = state.publishableKey;
  field("blockedItems").replaceChildren();
  for (const entry of state.blockedItems || []) {
    const item = document.createElement("li"); item.textContent = `${entry.localId || "Unidentified local source"}: ${entry.reason}`; field("blockedItems").append(item);
  }
  field("releaseStatus").textContent = state.releaseUploads ? "Release enabled for reviewed backend deployment. Uploads still require explicit consent and workspace selection." : "Uploads are release-gated until backend deployment and pilot approval. This build never sends intake RPCs, including after sign-in.";
}
async function act(work) {
  if (busy) return;
  busy = true;
  try { await work(); await refresh(); } catch (error) { message(error.message || "Setup failed. Private details are not displayed."); }
  finally { busy = false; }
}
field("signInForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (busy) return;
  // Must be initiated directly from the user's gesture, before another async call.
  const permission = chrome.permissions.request({ origins: ["https://xtefjnfdjnxwrpkoydaj.supabase.co/*"] });
  const password = field("password").value;
  field("password").value = "";
  act(async () => {
    if (!(await permission)) throw new Error("Project network permission was not granted. Nothing was connected.");
    const result = await send("BACKEND_SIGN_IN", { publishableKey: field("publishableKey").value.trim(), email: field("email").value.trim(), password });
    choices(result.workspaces);
  });
});
field("loadWorkspaces").addEventListener("click", () => act(async () => choices((await send("BACKEND_WORKSPACES")).workspaces)));
field("selectWorkspace").addEventListener("click", () => act(() => send("BACKEND_SELECT_WORKSPACE", { organizationId: field("workspace").value })));
field("signOut").addEventListener("click", () => act(async () => { await send("BACKEND_SIGN_OUT"); choices([]); }));
field("enableUploads").addEventListener("click", () => act(() => send("BACKEND_ENABLE", { enabled: true, confirmed: field("uploadConsent").checked })));
field("pauseUploads").addEventListener("click", () => act(() => send("BACKEND_ENABLE", { enabled: false })));
field("refreshStatus").addEventListener("click", () => act(async () => {}));
field("retryUploads").addEventListener("click", () => act(() => send("BACKEND_RETRY")));
field("drainUploads").addEventListener("click", () => act(() => send("BACKEND_DRAIN")));
field("queueHistory").addEventListener("click", () => act(() => send("BACKEND_QUEUE_HISTORY", { confirmed: field("historyConsent").checked })));
field("cancelPending").addEventListener("click", () => act(() => send("BACKEND_CANCEL_PENDING", { confirmed: field("cancelConsent").checked })));
refresh().catch((error) => message(error.message));
