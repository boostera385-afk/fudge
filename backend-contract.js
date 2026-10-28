/* Versioned, dependency-free intake projection. Shared by collector and worker. */
(() => {
  "use strict";
  const PROJECT_REF = "xtefjnfdjnxwrpkoydaj";
  const ORIGIN = `https://${PROJECT_REF}.supabase.co`;
  const INTENT_PREFIX = "fudgeBackendIntent:";
  const uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const text = (value, max) => typeof value === "string" && !value.includes("\0") && Array.from(value).length <= max;
  const url = (value) => text(value, 4096) && /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^\s]*)?$/.test(value);
  const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
  const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
  function validObservation(value, now) {
    if (typeof value !== "string") return false;
    const parts = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$/.exec(value);
    if (!parts) return false;
    const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return false;
    if (parts[7] !== "Z" && (Number(parts[7].slice(1, 3)) > 15 || Number(parts[7].slice(4)) > 59)) return false;
    return Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 300000;
  }
  function validReview(value, now = Date.now()) {
    if (!exact(value, ["source", "source_review_id", "observed_at", "payload"])) return false;
    const p = value.payload;
    return value.source === "google" && text(value.source_review_id, 512) && value.source_review_id.length > 0 && !/[\s\u0000-\u001f\u007f]/.test(value.source_review_id)
      && validObservation(value.observed_at, now)
      && exact(p, ["text", "rating", "author", "business_name", "place_id", "source_url", "photo_urls", "display_date"])
      && text(p.text, 30000) && p.text.trim().length > 0 && Number.isInteger(p.rating) && p.rating >= 1 && p.rating <= 5
      && text(p.author, 300) && text(p.business_name, 500) && text(p.place_id, 512) && text(p.display_date, 200)
      && url(p.source_url) && Array.isArray(p.photo_urls) && p.photo_urls.length <= 30 && p.photo_urls.every(url) && bytes(p) <= 120000;
  }
  function project(review, now = Date.now()) {
    if (!review || typeof review !== "object") return null;
    const value = { source: "google", source_review_id: review.googleReviewId, observed_at: review.collectedAt,
      payload: { text: review.text, rating: review.rating, author: review.author === undefined ? "" : review.author, business_name: review.placeName === undefined ? "" : review.placeName, place_id: review.placeId === undefined ? "" : review.placeId,
        source_url: review.sourceUrl, photo_urls: Array.isArray(review.photos) ? [...review.photos] : review.photos, display_date: review.date === undefined ? "" : review.date } };
    return validReview(value, now) ? value : null;
  }
  function validTarget(config) {
    return config?.version === 1 && uuid(config.targetId) && uuid(config.organizationId) && uuid(config.userId);
  }
  function captureWrites(config, incoming, { now = Date.now(), randomUUID = () => crypto.randomUUID() } = {}) {
    if (!validTarget(config) || config.enabled !== true) return {};
    const writes = {};
    for (const original of incoming) {
      const review = project(original, now);
      writes[`${INTENT_PREFIX}${randomUUID()}`] = { version: 1, targetId: config.targetId, organizationId: config.organizationId, userId: config.userId,
        cancelEpoch: cancellationEpoch(config),
        localId: text(original?.id, 512) ? original.id : "", createdAt: now, status: review ? "pending" : "blocked", attempts: 0, nextAttemptAt: 0,
        reason: review ? "" : "Source identity, fields, timestamp or size needs repair; original stays in the local library.", review };
    }
    return writes;
  }
  function cancellationEpoch(config) { return uuid(config.cancelEpoch) ? config.cancelEpoch : config.targetId; }
  function receiptsMatch(reviews, response) {
    if (!Array.isArray(response) || response.length !== reviews.length) return false;
    const records = new Set(), revisions = new Set();
    return response.every((r, i) => {
      if (!exact(r, ["source", "source_review_id", "record_id", "revision_id", "revision", "inserted_record", "inserted_revision"])) return false;
      if (r.source !== reviews[i].source || r.source_review_id !== reviews[i].source_review_id || !uuid(r.record_id) || !uuid(r.revision_id)
        || !Number.isInteger(r.revision) || r.revision < 1 || r.revision > 2147483647 || typeof r.inserted_record !== "boolean" || typeof r.inserted_revision !== "boolean"
        || (r.inserted_record && (!r.inserted_revision || r.revision !== 1)) || records.has(r.record_id) || revisions.has(r.revision_id)) return false;
      records.add(r.record_id); revisions.add(r.revision_id); return true;
    });
  }
  const api = { PROJECT_REF, ORIGIN, INTENT_PREFIX, uuid, bytes, validReview, project, validTarget, captureWrites, receiptsMatch, cancellationEpoch };
  globalThis.FudgeBackendContract = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
