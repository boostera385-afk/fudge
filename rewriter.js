// Fudge — Website writer.
// Rewrites a collected five-star review into publishable website copy using the
// connected Apps Script writer. The privacy rules are
// enforced in the prompt, then checked again locally before anything is shown.

(() => {
  // Rules are written in strict priority order and sent verbatim on every call.
  // They name the input fields the user prompt provides: reviewer_name, phone, names.
  const RULES = `
You rewrite customer reviews for a service business website. Follow these rules in order of priority:

MINIMAL EDIT: Preserve the reviewer's wording, tone, sentence order, level of detail, meaning, and approximate length. Do not polish, enhance, advertise, summarize, expand, or make the review more enthusiastic or professional. Do not add praise, adjectives, services, results, recommendations, guarantees, prices, timing, experiences, or facts. Change only what the numbered rules require.

1. NO BUSINESS NAME: Remove every mention of any business, company, organization, brand, school, or service-provider name anywhere in the review.
2. NO LOCATION: Remove all cities, states, neighborhoods, addresses, ZIP codes, street names, and place references of any kind. This is strict — a location slip is a failed rewrite.
3. NO DATE: Remove all dates, months, years, and relative time phrases like "last week" or "yesterday".
4. NO WEATHER: Remove every reference to weather, forecasts, rain, snow, storms, wind, sunshine, clouds, fog, heat, cold, or weather conditions. Weather must never appear in the finished review.
5. PHONE NUMBERS AND CTA: The only real phone number you may ever write is one supplied in the input field "phone". Never write any other number. The connector appends required_cta after the rewrite. If phone is empty, remove all phone numbers and add no contact invitation or reference.
6. KEEP THE REVIEWER'S VOICE: Keep the review written in the reviewer's own first-person voice (I, we, us, my, our). Never write phrases like "NAME said" and never narrate the review in third person — the finished text must read exactly as if the reviewer wrote it themselves. The name in the input field "reviewer_name" is attribution metadata only and must not appear inside the text.
7. PERSON NAME: Use the input field "replacement_name" exactly once in every finished review. For a company, crew, team, movers, or plural they/them subject, write "replacement_name and his team" on the first reference and keep later plural pronouns. For one worker, use replacement_name with he/him/his. Never reuse a person's name from the original and never use replacement_name as the reviewer or customer.
8. SERVICE WORDING: Use service_keyword terminology when the original clearly describes the same service with an equivalent term. When a business name contains generic service words, remove only the brand identity and preserve the service. For example, "Blinky’s Christmas Lights" must lose "Blinky’s" but keep a natural reference to Christmas lights installation. Change "holiday lights" to "Christmas lights" when service_keyword is "Christmas Lights Installation." Never invent work or change an unrelated review to force a match.

FINAL QUALITY CHECK: Work in three silent stages. Create the minimal rewrite, inspect its meaning, then proofread it strictly. Every sentence must be complete and natural. Correct fragments, missing subjects or articles, wrong pronoun case, subject-verb disagreement, singular-plural disagreement, duplicated or missing words, punctuation, spacing, and typos. Grammar corrections are required even when the original contains the mistake, while its facts, tone, order, and detail stay intact. Confirm that the described work is logically compatible with service_keyword when the original supplies that evidence. Never invent or convert a service to force a match. Return only the final checked review.
`.trim();

  const CTA_INSTRUCTION = `
Before replying, verify the answer contains: no business or company name, no city, state, neighborhood, street or address, no date or time phrase, no weather reference, no phone number other than the given one(s), no name from the original crew, and stays in the reviewer's first-person voice. If any of these appear, fix them before answering.
Reply with ONLY the minimally edited review text. No headings, no quotes around the whole answer, no explanations.
`.trim();

  const DEFAULT_MALE_NAMES = ["James", "Michael", "Daniel", "David", "Matthew", "Ryan", "Jason", "Andrew", "Brian", "Kevin"];
  const replacementNameFor = (text, names) => {
    const configured = String(names || "").split(/[,;/\n]+/).map((name) => name.trim().split(/\s+/)[0].replace(/[^A-Za-z'’-]/g, "")).filter(Boolean);
    if (configured.length) return configured[0];
    let hash = 0;
    const source = String(text || "");
    for (let index = 0; index < source.length; index += 1) hash = ((hash * 31) + source.charCodeAt(index)) >>> 0;
    return DEFAULT_MALE_NAMES[hash % DEFAULT_MALE_NAMES.length];
  };
  const ctaFor = (text, phoneValue) => {
    const phone = String(phoneValue || "").split(/[,;/]+/).map((value) => value.trim()).filter(Boolean)[0] || "";
    if (!phone) return "";
    const plural = /\b(?:team|crew|movers|they|them|their|these guys)\b/i.test(String(text || ""));
    const subject = plural ? "they" : "he";
    const object = plural ? "them" : "him";
    const possessive = plural ? "Their" : "His";
    const templates = [
      "{Possessive} number is {phone}.", "You can reach {object} at {phone}.", "Call {object} at {phone}.",
      "Contact {object} at {phone}.", "{Possessive} contact number is {phone}.", "{Subject} can be reached at {phone}.",
      "For anyone who needs similar help, {possessive} number is {phone}.",
      "If anyone needs {possessive} service, {possessive} number is {phone}.",
      "Here is {possessive} number: {phone}.", "You can call {object} at {phone}.",
      "Reach {object} at {phone}.", "{Possessive} phone number is {phone}."
    ];
    const source = `${String(text || "")}|${phone}`;
    let hash = 0;
    for (let index = 0; index < source.length; index += 1) hash = ((hash * 33) + source.charCodeAt(index)) >>> 0;
    return templates[hash % templates.length]
      .replace(/\{phone\}/g, phone)
      .replace(/\{Subject\}/g, subject.charAt(0).toUpperCase() + subject.slice(1))
      .replace(/\{object\}/g, object)
      .replace(/\{Possessive\}/g, possessive)
      .replace(/\{possessive\}/g, possessive.toLowerCase());
  };

  const alignServiceTerms = (copy, serviceKeyword) => {
    let cleaned = String(copy || "");
    const keyword = String(serviceKeyword || "").toLowerCase();
    if (/christmas\s+(?:light|lighting)/.test(keyword)) {
      cleaned = cleaned
        .replace(/\bholiday\s+lights?\s+installation\b/gi, "Christmas lights installation")
        .replace(/\bholiday\s+lighting\s+installation\b/gi, "Christmas lights installation")
        .replace(/\bholiday\s+lighting\b/gi, "Christmas lighting")
        .replace(/\bholiday\s+lights\b/gi, "Christmas lights");
    } else if (/holiday\s+(?:light|lighting)/.test(keyword)) {
      cleaned = cleaned
        .replace(/\bchristmas\s+lights?\s+installation\b/gi, "holiday lights installation")
        .replace(/\bchristmas\s+lighting\s+installation\b/gi, "holiday lights installation")
        .replace(/\bchristmas\s+lighting\b/gi, "holiday lighting")
        .replace(/\bchristmas\s+lights\b/gi, "holiday lights");
    }
    return cleaned;
  };
  const digitsOnly = (value) => String(value || "").replace(/\D+/g, "");
  const stripCountryCode = (digits) => (digits.length > 10 && digits.startsWith("1") ? digits.slice(1) : digits);
  const allowedPhoneSet = (phone) => new Set(
    String(phone || "")
      .split(/[,;/]+/)
      .map((entry) => stripCountryCode(digitsOnly(entry)))
      .filter((digits) => digits.length >= 7)
  );
  const normalize = (value = "") => String(value).toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

  // Phone-shaped sequences in the rewritten text. The country-code "1" prefix is
  // tolerated, and a digits run shorter than 7 is never treated as a phone.
  const PHONE_PATTERN = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g;

  // Date evidence: month names, weekday names, four-digit years, and the relative
  // phrases rule 3 forbids. Relative phrases are only policed in the review body —
  // "call today" inside the CTA is normal marketing language, not a review date.
  const DATE_PATTERNS = [
    /\b(?:january|february|march|april|june|july|august|september|october|november|december)\b/i,
    /\bMay\b|\bmay\s+\d{1,2}\b/,
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b(?:19|20)\d{2}\b/,
    /\b(?:thanksgiving|new year|easter|halloween|fourth of july|4th of july)\b/i
  ];
  const RELATIVE_DATE_PATTERNS = [
    /\b(?:yesterday|today|tomorrow)\b/i,
    /\b(?:last|this|next)\s+(?:week|month|year|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|night)\b/i,
    /\b(?:a|an|\d+)\s+(?:day|days|week|weeks|month|months|year|years|couple of days|few days)\s+ago\b/i
  ];
  const WEATHER_PATTERN = /\b(?:weather|forecast|rain(?:ed|ing|y)?|downpour|snow(?:ed|ing|y)?|storm(?:y|s)?|thunder(?:storm)?|lightning|wind(?:y|s)?|sun(?:ny|shine)?|cloud(?:s|y)?|fog(?:gy)?|hail(?:ed|ing)?|humid(?:ity)?|temperature(?:s)?|heat[ -]?wave|blizzard|hurricane|tornado|ice|icy|(?:freezing|icy|hot|cold|severe|bad)\s+(?:weather|conditions?|temperatures?|day)|(?:cold|warm)\s+front|(?:this|last|next|during the|in the)\s+(?:winter|summer|autumn|fall))\b|\b\d{1,3}\s*(?:°|degrees?)\s*(?:f|c|fahrenheit|celsius)?\b/i;

  // The closing contact line is exempt from the relative-date check only when it
  // carries one of the operator's own phone numbers; everything before it is body.
  const reviewBodyOf = (output, phone) => {
    const lines = String(output || "").split(/\n+/).filter((line) => line.trim());
    const allowed = allowedPhoneSet(phone);
    if (lines.length > 1 && allowed.size) {
      const lastLine = lines[lines.length - 1];
      const lastDigits = stripCountryCode(digitsOnly(lastLine));
      if (lastDigits && allowed.has(lastDigits)) return lines.slice(0, -1).join("\n");
    }
    return lines.join("\n");
  };

  // Words that are commonly capitalized mid-sentence but are never crew names.
  const NAME_CHECK_STOPWORDS = new Set([
    "the", "we", "they", "it", "he", "she", "you", "our", "their", "this", "that",
    "there", "then", "when", "what", "who", "how", "why", "all", "and", "but", "for",
    "not", "now", "also", "best", "great", "good", "very", "really", "definitely",
    "highly", "google", "thank", "thanks", "please", "yes", "his", "him", "her",
    "over", "after", "before", "again", "always", "never", "would", "could", "should",
    // Sentence-opening adjectives and adverbs that reviews love but rules never name.
    "honest", "honesty", "fair", "fairness", "zero", "excellent", "perfect",
    "wonderful", "amazing", "awesome", "fantastic", "incredible", "outstanding",
    "superb", "professional", "professionalism", "reliable", "reliability", "prompt",
    "punctual", "timely", "quick", "fast", "easy", "affordable", "reasonable",
    "impressive", "smooth", "seamless", "experienced", "knowledgeable", "friendly",
    "courteous", "fairly", "honestly", "overall", "finally", "additionally",
    "quality", "value", "service", "services", "team", "crew", "company", "business",
    // Seasons and general time words that are never people.
    "spring", "summer", "fall", "autumn", "winter", "morning", "afternoon",
    "evening", "today", "tomorrow", "yesterday", "week", "month", "year", "day"
  ]);

  // Rule 6 backstop: a capitalized word from the original review (other than the
  // reviewer, the provided names, or the business) must not survive the rewrite.
  const checkCrewNames = (originalText, output, { reviewerName, names, businessName } = {}) => {
    const allowed = new Set();
    for (const word of normalize(`${reviewerName || ""} ${names || ""} ${businessName || ""}`).split(" ")) allowed.add(word);
    const candidates = new Map();
    for (const match of String(originalText || "").matchAll(/\b[A-Z][a-z'’]{2,}\b/g)) {
      const display = match[0];
      const word = display.toLowerCase().replace(/['’]/g, "");
      if (!NAME_CHECK_STOPWORDS.has(word) && !allowed.has(word)) candidates.set(word, display);
    }
    const normalizedOutput = normalize(output);
    const leaks = [...candidates.entries()].filter(([word]) => normalizedOutput.includes(word)).map(([, display]) => display);
    if (leaks.length) {
      return [`Crew-name check: the original name(s) "${leaks.join('", "')}" may still appear. Use names from your list only.`];
    }
    return [];
  };

  // Returns the configured phone number that actually appears in a rewritten
  // text, or "" when none does — the Sheet's Phone column shows exactly this.
  const phoneForText = (text, phone) => {
    const allowed = allowedPhoneSet(phone);
    if (!allowed.size) return "";
    for (const match of String(text || "").match(PHONE_PATTERN) || []) {
      const digits = stripCountryCode(digitsOnly(match));
      if (allowed.has(digits)) return match.trim();
    }
    return "";
  };

  const buildMessages = ({ text, reviewerName, businessName, serviceKeyword, phone, names }) => {
    const name = String(reviewerName || "A customer").trim() || "A customer";
    const replacementName = replacementNameFor(text, names);
    const requiredCta = ctaFor(text, phone);
    const lines = [
      `reviewer_name: ${name}`,
      `phone: ${String(phone || "").trim() || "(none provided — do not invent a phone number and do not include a CTA)"}`,
      `required_cta: ${requiredCta || "none"}`,
      `replacement_name: ${replacementName}`,
      `service_keyword: ${String(serviceKeyword || "").trim() || "none"}`
    ];
    if (businessName) lines.push(`business name to remove: ${businessName}`);
    lines.push("", "Review to rewrite:", String(text || "").trim());
    return [
      { role: "system", content: `${RULES}\n\n${CTA_INSTRUCTION}` },
      { role: "user", content: lines.join("\n") }
    ];
  };

  // Local backstop for the rules. The model is trusted, but not implicitly:
  // anything suspicious is surfaced as a warning next to the rewrite.
  const checkText = (output, { phone, businessName, reviewerName, names, reviewText, requiredCta: suppliedCta } = {}) => {
    const warnings = [];
    const allowed = allowedPhoneSet(phone);

    const found = String(output || "").match(PHONE_PATTERN) || [];
    for (const match of found) {
      if (!allowed.has(stripCountryCode(digitsOnly(match)))) {
        warnings.push(`Contact check: found a phone number that is not yours ("${match.trim()}"). Only the number(s) from the "phone" field may appear.`);
      }
    }

    for (const pattern of DATE_PATTERNS) {
      const match = String(output || "").match(pattern);
      if (match) {
        warnings.push(`No-date check: found "${match[0]}". Dates and time phrases are not allowed.`);
        break;
      }
    }
    if (!warnings.length) {
      const body = reviewBodyOf(output, phone);
      for (const pattern of RELATIVE_DATE_PATTERNS) {
        const match = String(body).match(pattern);
        if (match) {
          warnings.push(`No-date check: found "${match[0]}". Relative time phrases are not allowed in the review body.`);
          break;
        }
      }
    }

    const weather = String(output || "").match(WEATHER_PATTERN);
    if (weather) warnings.push(`No-weather check: found "${weather[0]}". Weather references are not allowed.`);

    const normalizedOutput = normalize(output);
    const name = normalize(businessName);
    if (name) {
      const words = name.split(" ").filter((word) => word.length >= 4);
      const branded = words.find((word) => !["plumbing", "electric", "electrical", "heating", "cooling", "repair", "services", "service", "roofing", "painting", "garage"].includes(word));
      const phrases = [];
      // The wordmark itself — "acme", "joe's" — and 2+ word windows of the name.
      if (branded) phrases.push(branded.replace(/'/g, "").replace(/\s/g, " "));
      const windows = [];
      for (let size = Math.min(3, words.length); size >= 2; size -= 1) {
        for (let index = 0; index + size <= words.length; index += 1) windows.push(words.slice(index, index + size).join(" "));
      }
      phrases.push(...windows);
      const hit = phrases.find((phrase) => phrase && normalizedOutput.includes(phrase));
      if (hit) warnings.push(`No-business-name check: found "${hit}". Business names must be replaced with "the team" or "the service".`);
    }

    warnings.push(...checkCrewNames(reviewText, output, { reviewerName, names: replacementNameFor(reviewText, names), businessName }));
    if (String(reviewText || "").trim() || String(names || "").trim()) {
      const replacementName = replacementNameFor(reviewText, names);
      const replacementMatches = String(output || "").match(new RegExp(`\\b${replacementName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")) || [];
      if (replacementMatches.length !== 1) warnings.push(`Person-name check: include "${replacementName}" exactly once.`);
    }
    const requiredCta = suppliedCta || ctaFor(reviewText, phone);
    if (requiredCta && !String(output || "").includes(requiredCta)) warnings.push(`CTA check: append "${requiredCta}" exactly as the final sentence.`);

    return warnings;
  };

  const stripWrapping = (text = "") => String(text).trim().replace(/^["“](.*)["”]$/s, "$1").trim();

  const rewrite = async ({ review, phone, names }) => {
    if (typeof FUDGE_AI === "undefined" || !FUDGE_AI.apiKey || FUDGE_AI.apiKey === "PASTE_YOUR_OPENAI_API_KEY_HERE") {
      const result = await chrome.runtime.sendMessage({ type: "REWRITE_REVIEW", review, phone, names });
      if (!result?.ok) throw new Error(result?.error || "Connect the Sheet and set FUDGE_OPENAI_API_KEY in Apps Script Script properties.");
      const output = alignServiceTerms(stripWrapping(result.text || ""), review.subcategory || review.serviceKeyword || review.service);
      if (!output) throw new Error("The writer API returned an empty rewrite. Try again.");
      return { text: output, warnings: checkText(output, { phone, businessName: review.placeName, reviewerName: review.author, names, reviewText: review.text, requiredCta: result.cta }) };
    }
    const messages = buildMessages({ text: review.text, reviewerName: review.author, businessName: review.placeName, serviceKeyword: review.subcategory || review.serviceKeyword || review.service, phone, names });
    const response = await fetch(FUDGE_AI.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FUDGE_AI.apiKey}`
      },
      body: JSON.stringify({ model: FUDGE_AI.model || "gpt-5.6-luna", reasoning_effort: "none", messages, temperature: 0, max_completion_tokens: Math.min(1200, Math.max(220, Math.ceil(String(review.text || "").length / 2) + 120)) })
    });
    if (!response.ok) {
      let detail = "";
      try {
        const errorBody = await response.json();
        detail = errorBody?.error?.message || "";
      } catch { detail = ""; }
      throw new Error(`The writer API refused the request (${response.status}).${detail ? " " + detail : ""}`);
    }
    const body = await response.json();
    const output = alignServiceTerms(stripWrapping(body?.choices?.[0]?.message?.content || ""), review.subcategory || review.serviceKeyword || review.service);
    if (!output) throw new Error("The writer API returned an empty rewrite. Try again.");
    const warnings = checkText(output, { phone, businessName: review.placeName, reviewerName: review.author, names, reviewText: review.text });
    return { text: output, warnings };
  };

  /* Rewrites are cached per review id so reopening the detail sheet shows the
     last version instead of spending another API call. */
  const REWRITES_KEY = "websiteRewritesV23";

  const getRewrite = async (reviewId) => {
    const stored = await chrome.storage.local.get({ [REWRITES_KEY]: {} });
    return stored[REWRITES_KEY][reviewId] || null;
  };

  const saveRewrite = async (reviewId, result) => {
    const stored = await chrome.storage.local.get({ [REWRITES_KEY]: {} });
    const all = stored[REWRITES_KEY];
    all[reviewId] = { ...result, savedAt: new Date().toISOString() };
    await chrome.storage.local.set({ [REWRITES_KEY]: all });
  };

  // Cached rewrite when one exists; otherwise generate, cache, and return the
  // text. Used by the dashboard and by the automatic Sheet pipeline.
  const ensureRewrite = async (review, { phone, names } = {}) => {
    const cached = await getRewrite(review.id);
    if (cached?.text) return cached.text;
    const result = await rewrite({ review, phone, names });
    await saveRewrite(review.id, { text: result.text, warnings: result.warnings });
    return result.text;
  };

  globalThis.WebsiteWriter = { RULES, buildMessages, checkText, rewrite, ensureRewrite, getRewrite, saveRewrite, phoneForText, replacementNameFor, ctaFor, alignServiceTerms };
})();
