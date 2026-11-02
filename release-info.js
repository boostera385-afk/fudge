/* Public version labels only. Never render connector URLs, secrets or auth data. */
(() => {
  "use strict";
  function version(value) {
    return Number.isSafeInteger(value) && value > 0 ? `v${value}` : "unknown";
  }
  function render(status = {}) {
    let extension = "unknown";
    try { extension = chrome.runtime.getManifest().version || "unknown"; } catch (_error) { /* not a loaded extension */ }
    document.querySelectorAll("[data-extension-version]").forEach((node) => { node.textContent = extension; });
    const seen = status.connectionReady ? version(status.connectorVersion) : "not checked";
    const observed = Date.parse(status.connectorObservedAt || "");
    const at = Number.isFinite(observed) ? ` · observed ${new Date(observed).toISOString()}` : "";
    const message = `extension v${extension} · sheet connector last response ${seen}${at} · expected ${version(status.expectedConnectorVersion)}. Cached response, not a live health guarantee; sync to refresh.`;
    document.querySelectorAll("[data-release-info]").forEach((node) => { node.textContent = message; });
  }
  async function refresh() {
    try {
      const status = await chrome.runtime.sendMessage({ type: "GET_SHEETS_STATUS" });
      render(status?.ok ? status : {});
    } catch (_error) { render(); }
  }
  render();
  refresh();
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && ["sheetsConnectorObservation", "appsScriptUrl", "sheetsDatabase"].some((key) => key in changes)) refresh();
  });
})();
