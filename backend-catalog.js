/* Versioned configuration cache only. Never applies rules to collection/Sheets. */
(() => {
  "use strict";
  const C = globalThis.FudgeBackendContract || (typeof require === "function" ? require("./backend-contract.js") : null);
  const fields = ["keyword", "searchTerm", "family", "subcategory", "businessSignals", "reviewSignals", "requiredSignals", "topicSignals", "excludeSignals", "topicRequired", "collectFamilyInventory", "rewriteServicePhrase", "equivalentServicePhrases"];
  const termFields = ["businessSignals", "reviewSignals", "requiredSignals", "topicSignals", "excludeSignals", "equivalentServicePhrases"];
  const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
  const text = (value, max, required = true) => typeof value === "string" && Array.from(value).length <= max && !/[\u0000-\u001f\u007f]/.test(value) && (!required || value.trim().length > 0);
  const positive = (value) => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
  function validSnapshot(value, organizationId) {
    if (!exact(value, ["version", "organizationId", "generation", "revisionId", "revision", "rules"]) || value.version !== 1
      || !C.uuid(value.organizationId) || value.organizationId !== organizationId || !C.uuid(value.revisionId) || !positive(value.generation) || !positive(value.revision)
      || !Array.isArray(value.rules) || !value.rules.length || value.rules.length > 500) return false;
    const seen = new Set();
    for (const rule of value.rules) {
      if (!exact(rule, fields) || !text(rule.keyword, 200) || !text(rule.searchTerm, 500) || !text(rule.family, 500) || !text(rule.subcategory, 500)
        || !text(rule.rewriteServicePhrase, 500, false) || typeof rule.topicRequired !== "boolean" || typeof rule.collectFamilyInventory !== "boolean") return false;
      const key = rule.keyword.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      if (termFields.some((field) => !Array.isArray(rule[field]) || rule[field].length > 100 || rule[field].some((term) => !text(term, 300)))) return false;
    }
    return C.bytes(value.rules) <= 262144;
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
  }
  function create({ local, now = Date.now }) {
    let chain = Promise.resolve();
    async function refresh(target, load) {
      if (!C.uuid(target?.userId) || !C.uuid(target?.organizationId)) throw new Error("Sign in to the intended business before catalog download.");
      const key = `fudgeCatalog:${target.userId}:${target.organizationId}`;
      const saved = (await local.get({ [key]: null }))[key];
      const previous = saved?.userId === target.userId && validSnapshot(saved.snapshot, target.organizationId) ? saved.snapshot : null;
      const result = (state, snapshot = previous, available = Boolean(snapshot)) => ({ ok: true, state, available, snapshot });
      let candidate;
      try { candidate = await load(); }
      catch (error) {
        // Authorization failure is not permission to use a cached configuration.
        if (["auth", "permission"].includes(error.code)) return result("access_required", null, false);
        return result(error.code === "transient" ? "offline_cached" : "download_failed", previous, error.code === "transient" && Boolean(previous));
      }
      if (candidate === null) return result("unpublished", null, false);
      if (!validSnapshot(candidate, target.organizationId)) return result("invalid_response", previous, false);
      if (previous && candidate.generation < previous.generation) return result("stale_response");
      if (previous && candidate.generation === previous.generation
        && JSON.stringify(canonical(candidate)) !== JSON.stringify(canonical(previous))) return result("generation_conflict", previous, false);
      if (previous && candidate.generation === previous.generation) return result("unchanged");
      const snapshot = JSON.parse(JSON.stringify(candidate));
      try { await local.set({ [key]: { userId: target.userId, snapshot, downloadedAt: now() } }); }
      catch { return result("storage_failed"); }
      return result("downloaded", snapshot, true);
    }
    return { refresh: (target, load) => {
      const next = chain.catch(() => {}).then(() => refresh(target, load));
      chain = next.catch(() => {});
      return next;
    } };
  }
  const api = { create, validSnapshot };
  globalThis.FudgeBackendCatalog = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
