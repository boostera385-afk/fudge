(() => {
  let running = false;
  // The job this tab is actually working on, so a repeated start message answers
  // with it instead of registering a second job that nothing will ever run.
  let currentJob = null;
  const MAX_RESULT_PAGES = 4;
  const safePageLimit = (value) => Math.min(MAX_RESULT_PAGES, Math.max(1, Number(value) || MAX_RESULT_PAGES));
  const expandedReviewControls = new WeakSet();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // How long to keep scrolling a business whose review topics did not match.
  const UNMATCHED_TOPIC_BUDGET_MS = 4000;
  // How long to insist on photo-backed reviews before accepting text-only ones.
  const PHOTO_GRACE_MS = 5 * 60 * 1000;
  const photoGraceExpired = (job) => {
    const since = Date.parse(job?.keywordStartedAt || job?.startedAt || "");
    return Boolean(since) && Date.now() - since > PHOTO_GRACE_MS;
  };
  const textOf = (node) => node?.textContent?.trim() || "";
  const first = (root, selectors) => selectors.map((selector) => root.querySelector(selector)).find(Boolean);
  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 3 && rect.height > 3 && getComputedStyle(node).visibility !== "hidden";
  };
  // Waits for something to appear on the page.
  //
  // This used to be a plain poll loop: look, sleep 110 ms, look again, until the
  // budget ran out. Chrome throttles timers in a hidden tab to roughly one wake a
  // minute, so in a background tab that loop looked once or twice inside a
  // seven-second budget and then reported nothing there — and a business whose
  // panel was merely still rendering was closed again as "no reviews". That is the
  // open-and-close-without-checking behaviour, and it is also why the same keyword
  // worked on a second or third run with the tab in front.
  //
  // DOM mutations are not throttled. Whatever we are waiting for announces itself
  // the moment it is inserted, so the condition is re-tested then, however little
  // the timers are firing. The timer is kept as a backstop for conditions no
  // mutation reports, such as an element gaining size through layout.
  const waitFor = (test, timeout = 9000, interval = 110) => {
    const immediate = test();
    if (immediate) return Promise.resolve(immediate);
    return new Promise((resolve) => {
      const started = Date.now();
      let settled = false;
      let lastCheck = 0;
      let observer = null;
      let ticker = null;
      let deadline = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        clearInterval(ticker);
        clearTimeout(deadline);
        resolve(value);
      };
      const check = () => {
        if (settled) return;
        lastCheck = Date.now();
        const value = test();
        if (value) finish(value);
        else if (lastCheck - started >= timeout) finish(null);
      };
      // Every batch of mutations is checked, with no rate limiting. Skipping one
      // would mean deferring it onto a timer, and a timer is exactly what cannot be
      // relied on here. The cost is bounded anyway: an observer callback carries all
      // the records queued since the last microtask checkpoint, so a thousand
      // mutations made together cost one check, not a thousand.
      const onMutation = check;
      try {
        observer = new MutationObserver(onMutation);
        observer.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, characterData: true });
      } catch (_error) {
        // No observer available: the timer below still does the whole job, exactly
        // as this function behaved before.
        observer = null;
      }
      ticker = setInterval(check, interval);
      deadline = setTimeout(() => finish(null), timeout);
      check();
    });
  };
  // Several tabs can run at once, so this tab's job must be looked up by id rather than
  // assuming the single most recent job belongs to it.
  // Google's rate-limit interstitial. Treating it as "no reviews here" is what
  // silently marked businesses visited that were never actually read.
  const googleBlockPage = () => {
    if (/^\/sorry\//.test(location.pathname)) return true;
    if (/\/sorry\/index|google\.com\/sorry/i.test(location.href)) return true;
    if (document.querySelector("form#captcha-form, #recaptcha, iframe[src*='recaptcha']")) return true;
    const body = textOf(document.body).slice(0, 1200);
    return /unusual traffic|not a robot|verify you are human|systems have detected/i.test(body);
  };
  // Reloading the extension does not update the content script already running in
  // an open tab; it orphans it. chrome.runtime.id disappears when that happens, and
  // the old script must stop rather than loop on a runtime that is gone.
  const extensionGone = () => {
    try { return !chrome.runtime?.id; } catch (_error) { return true; }
  };
  const jobWasStopped = async (jobId) => {
    // An orphaned script cannot reach storage either, and anything it did would be
    // invisible to the extension that replaced it.
    if (extensionGone()) return true;
    const { scanJobs = {}, scanJob = null } = await chrome.storage.local.get({ scanJobs: {}, scanJob: null }).catch(() => ({}));
    const mine = scanJobs[jobId] || (scanJob?.id === jobId ? scanJob : null);
    return !mine || mine.status !== "running";
  };
  const parseRating = (card) => {
    const ratingNode = first(card, ["[role='img'][aria-label*='star']", "[aria-label*='stars']", ".kvMYJc"]);
    const label = ratingNode?.getAttribute("aria-label") || textOf(ratingNode);
    const match = label.match(/([0-5](?:[.,]\d)?)/);
    if (match) return Number(match[1].replace(",", "."));
    const googleSearchStars = [...card.querySelectorAll(".k0Ysuc .h3PQJ > svg")];
    if (googleSearchStars.length) {
      // Search sometimes keeps five SVG slots and paints only the earned stars.
      // Counting every SVG therefore turns a four-star review into a five-star one.
      const filled = googleSearchStars.filter((star) => {
        const path = star.querySelector("path");
        const color = `${path?.getAttribute("fill") || ""} ${path?.getAttribute("stroke") || ""} ${path ? getComputedStyle(path).fill : ""}`.toLowerCase();
        return /#fabb05|#fbbc04|rgb\(250,\s*187,\s*5\)|rgb\(251,\s*188,\s*4\)/.test(color);
      }).length;
      if (filled >= 1 && filled <= 5) return filled;
      return googleSearchStars.length >= 1 && googleSearchStars.length <= 5 ? googleSearchStars.length : 0;
    }
    return 0;
  };
  const photoUrls = (card) => {
    const attached = [...card.querySelectorAll(".SeRB9d, [alt*=' in review by'], [alt*='review by'][data-index], [alt^='Photo'][data-index], [role='listitem'] [data-index]")]
      .map((node) => node.currentSrc || node.src || node.getAttribute("data-src") || node.querySelector("img")?.currentSrc || node.querySelector("img")?.src || node.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1]);
    const images = [...card.querySelectorAll("button img, a img")]
      .filter((image) => {
        const width = image.naturalWidth || Number(image.getAttribute("width")) || image.clientWidth;
        const height = image.naturalHeight || Number(image.getAttribute("height")) || image.clientHeight;
        const label = image.closest("button, a")?.getAttribute("aria-label") || "";
        return !image.matches(".NBa7we, [class*='avatar']") && !/profile|avatar/i.test(label) && !(width && height && width <= 80 && height <= 80);
      })
      .map((image) => image.currentSrc || image.src);
    const backgrounds = [...card.querySelectorAll("button[style*='background-image'], [role='button'][style*='background-image']")]
      .filter((node) => /photo|image/i.test(`${node.getAttribute("aria-label") || ""} ${node.getAttribute("alt") || ""}`))
      .map((node) => node.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1]);
    return [...new Set([...attached, ...images, ...backgrounds])]
      .filter((src) => src && !/googleusercontent\.com\/a-|profile|s40-c|s64-c/i.test(src))
      .map(Fudge.originalPhotoUrl);
  };
  const getPlace = () => {
    // Search Places currently uses RjvGlb for the selected business heading and
    // OSrXXb for its mirrored title. Prefer those before generic page headings,
    // which can contain the search query or a different business from the list.
    const selectors = [
      "[role='dialog'] h2.RjvGlb.pb3iw", "[role='dialog'] h2.RjvGlb", "h2.RjvGlb.pb3iw", "h2.RjvGlb",
      "[role='dialog'] .OSrXXb", "[role='dialog'][jsname='ujKaBc'] .jFeinc .aACPyb",
      "h1.DUwDvf", "[data-attrid='title']", "[role='main'] h1", ".OSrXXb", "h1"
    ];
    for (const selector of selectors) {
      const match = [...document.querySelectorAll(selector)]
        .find((node) => visible(node) && textOf(node).length > 1 && !/^reviews?$/i.test(textOf(node)));
      if (match) return textOf(match).replace(/\s+/g, " ").trim();
    }
    return "Google business";
  };
  const waitForPlaceIdentitySettled = async (timeout = 2200) => {
    let last = "";
    let stable = 0;
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const current = getPlace();
      if (current !== "Google business" && current === last) {
        stable += 1;
        if (stable >= 3) return current;
      } else {
        last = current;
        stable = 0;
      }
      await sleep(110);
    }
    return getPlace();
  };
  const getPlaceId = () => {
    const cid = new URL(location.href).searchParams.get("cid");
    if (cid) return cid;
    const dataEd = first(document, ["[role='dialog'] [data-ed*='!1s0x']", "[data-ed*='!1s0x']"])?.getAttribute("data-ed") || "";
    const featureId = dataEd.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1];
    if (featureId) return featureId;
    const entityId = first(document, ["[role='dialog'] [id*='/g/']", "[role='dialog'] [id*='/m/']", "[id^='qnqHob/g/']", "[id^='qnqHob/m/']"])?.id || "";
    const entity = entityId.match(/(?:^|\/)((?:g|m)\/[^/?]+)/)?.[1];
    if (entity) return entity;
    if (location.pathname === "/search") return `name:${Fudge.normalize(getPlace())}`;
    return location.pathname.split("/").filter(Boolean).slice(-1)[0] || getPlace();
  };
  const findCards = () => {
    const selectors = [".bwb7ce[data-id]", "[data-review-id]", ".jftiEf", "div[role='article']"];
    const seen = new Set();
    return selectors.flatMap((selector) => [...document.querySelectorAll(selector)]).map((node) => node.closest(".bwb7ce[data-id], .jftiEf, div[role='article']") || node).filter((node) => {
      const key = node.getAttribute("data-id") || node.getAttribute("data-review-id") || node.querySelector("[data-review-id]")?.getAttribute("data-review-id") || `${textOf(node).slice(0, 100)}|${node.querySelectorAll("img").length}`;
      if (seen.has(key) || !visible(node) || !parseRating(node)) return false;
      seen.add(key);
      return true;
    })
    // Several selectors are merged above, so the result is grouped by selector
    // rather than by position. The "stop at the first sub-five-star" rule below
    // only holds if these are in document order.
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  };
  const reviewText = (card) => {
    // Search Places now puts most review copy directly in `.d83Iyc`, without the
    // older gbdaZe/EJ8fFf wrappers. The lookup is already scoped to one review
    // card, so accepting the direct node cannot pull text from another review.
    const selectors = [".d83Iyc", ".wiI7pd", ".MyEned", "[data-review-text]", ".review-full-text", "[jsname='fbQN7e']"];
    const candidates = selectors.flatMap((selector) => [...card.querySelectorAll(selector)]).map((source) => {
      const copy = source.cloneNode(true);
      copy.querySelectorAll(".zMjRQd, .FrlmTe, [aria-label^='Read more']").forEach((node) => node.remove());
      return textOf(copy).replace(/\s+/g, " ").trim();
    }).filter(Boolean);
    return candidates.sort((a, b) => b.length - a.length)[0] || "";
  };
  const expandLoadedReviews = async () => {
    const controls = findCards()
      .filter((card) => parseRating(card) === 5)
      .flatMap((card) => [...card.querySelectorAll("a.FrlmTe[aria-label^='Read more'], button[aria-label^='Read more'], [role='button'][aria-label^='Read more']")]);
    let clicked = 0;
    controls.forEach((control) => {
      if (expandedReviewControls.has(control)) return;
      expandedReviewControls.add(control);
      control.click();
      clicked += 1;
    });
    if (clicked) await sleep(170);
  };
  const collectLoaded = () => {
    const placeName = getPlace();
    const placeId = getPlaceId();
    const placeCategory = getPlaceCategory();
    const cards = findCards();
    const reviews = cards.map((card) => {
      const rating = parseRating(card);
      const photos = photoUrls(card);
      const text = reviewText(card);
      const author = textOf(first(card, [".p7f0Nd .rhtdWc", ".d4r55", ".TSUbDb", "[data-review-author]", "button[aria-label] div:first-child"])) || "Google reviewer";
      const date = textOf(first(card, [".k0Ysuc .m6Mr5d", ".rsqaWe", ".dehysf"])) || "Recently";
      const avatar = first(card, ["img.NBa7we", "img[class*='avatar']"])?.src || "";
      if (rating !== 5 || !text) return null;
      const serviceLabels = textOf(first(card, [".zMjRQd [aria-label]", ".ME0dBc"]));
      const service = Fudge.classify(`${text} ${serviceLabels}`);
      const googleReviewId = card.getAttribute("data-review-id") || card.querySelector("[data-review-id]")?.getAttribute("data-review-id") || "";
      const reviewMode = photos.length ? "photo" : "without-picture";
      const review = { author, avatar, date, rating, text, photos, reviewMode, placeName, placeId, placeCategory, googleReviewId, service, serviceLabels, sourceUrl: location.href, collectedAt: new Date().toISOString() };
      return { ...review, id: googleReviewId ? `google:${googleReviewId}` : Fudge.reviewKey(review) };
    }).filter(Boolean);
    return { reviews, scanned: cards.length, placeName };
  };
  const findScroller = () => {
    const cards = findCards();
    let node = cards[0]?.parentElement;
    while (node && node !== document.body) {
      if (node.scrollHeight > node.clientHeight + 180 && ["auto", "scroll"].includes(getComputedStyle(node).overflowY)) return node;
      node = node.parentElement;
    }
    return ["div[role='feed']", ".m6QErb[aria-label]", "div[role='dialog'] div"].map((selector) => [...document.querySelectorAll(selector)]).flat().find((candidate) => candidate.scrollHeight > candidate.clientHeight + 180);
  };
  const feedSignature = () => findCards().slice(0, 8)
    .map((card) => card.getAttribute("data-review-id") || card.getAttribute("data-id") || textOf(card).slice(0, 60))
    .join("|");
  // Returns once the review list stops changing, rather than after a fixed delay.
  // Existence is waited for first, through waitFor, because that part survives a
  // throttled background tab; only the short settle afterwards needs real samples.
  const waitForFeedSettled = async (timeout = 5000) => {
    const started = Date.now();
    if (!await waitFor(() => feedSignature() || null, timeout, 120)) return false;
    let last = null;
    let stable = 0;
    while (Date.now() - started < timeout) {
      const signature = feedSignature();
      if (signature && signature === last) {
        stable += 1;
        if (stable >= 2) return true;
      } else {
        stable = 0;
        last = signature;
      }
      await sleep(120);
    }
    return false;
  };
  // Not filtered by visibility: Maps closes the sort menu once an item is picked,
  // so the checked item is hidden by the time it is worth reading.
  const highestIsSelected = () => {
    const checked = [...document.querySelectorAll("[role='radio'][aria-checked='true'], [role='menuitemradio'][aria-checked='true'], [role='option'][aria-selected='true']")];
    if (checked.some((node) => /highest/i.test(`${textOf(node)} ${node.getAttribute("aria-label") || ""}`))) return true;
    const radio = first(document, ["[role='radio'][data-sort='3']", ".YCQwEb[role='radio'][data-sort='3']"]);
    return Boolean(radio && radio.getAttribute("aria-checked") === "true");
  };
  // Confirms the sort from the data rather than from the control. If Google changes
  // its markup, this degrades to a full feed scan — slow but complete — instead of
  // trusting a descending order that is not there and under-collecting.
  const feedLooksDescending = () => {
    const ratings = findCards().map(parseRating).filter(Boolean);
    if (ratings.length < 2) return true;
    return ratings.every((rating, index) => index === 0 || ratings[index - 1] >= rating);
  };
  // Google Maps puts the sort behind a button that opens a menu; the Places
  // dialog in Search uses an inline radiogroup. Both are handled.
  const openSortMenuAndPickHighest = async () => {
    const trigger = first(document, [
      "button[data-value='Sort']",
      "button[aria-label*='Sort review']",
      "[role='button'][aria-label*='Sort review']",
      "button[jsaction*='sortBy']",
      "[role='button'][data-value='Sort']"
    ]);
    if (!trigger || !visible(trigger)) return false;
    trigger.click();
    const item = await waitFor(() => {
      const items = [...document.querySelectorAll("[role='menuitemradio'], [role='menuitem'], [role='option'], [role='radio']")].filter(visible);
      return items.find((node) => /highest/i.test(`${textOf(node)} ${node.getAttribute("aria-label") || ""}`)) || null;
    }, 4000, 100);
    if (!item || !/highest/i.test(`${textOf(item)} ${item.getAttribute("aria-label") || ""}`)) return false;
    item.click();
    return true;
  };
  // ---- Google's own "Filter reviews" topic chips -------------------------
  // Far stronger evidence than reading the text: Google has already grouped the
  // reviews by what they are about.
  const topicGroup = () => [
    "[role='radiogroup'][aria-label*='Filter reviews']",
    "span.zbMVab[role='radiogroup']"
  ].flatMap((selector) => [...document.querySelectorAll(selector)]).find(visible) || null;
  const reviewTopicChips = () => {
    const group = topicGroup();
    if (!group) return [];
    return [...group.querySelectorAll("[role='radio'][data-id], [role='radio'][jsname='fb7che']")].filter(visible);
  };
  // The chip's text runs the label into the count ("toilet replacement6"); the
  // aria-label keeps them apart ("toilet replacement 6 reviews").
  const topicLabel = (chip) => {
    const labelled = chip.querySelector("[aria-label]") || chip;
    const raw = labelled.getAttribute("aria-label") || textOf(chip);
    return raw.replace(/\s*[\d,]+\s*reviews?\s*$/i, "").trim();
  };
  const topicCount = (chip) => Number(textOf(chip.querySelector(".SiE59d")).replace(/[^\d]/g, "")) || 0;
  const expandReviewTopics = async () => {
    const group = topicGroup();
    if (!group) return false;
    const more = [...group.querySelectorAll("[role='button']")]
      .find((node) => visible(node) && /more review topic|^\+\d+$/i.test(`${node.getAttribute("aria-label") || ""} ${textOf(node)}`.trim()));
    if (!more) return false;
    const before = reviewTopicChips().length;
    more.click();
    await waitFor(() => reviewTopicChips().length > before, 3000, 110);
    return true;
  };
  // Review cards often render before the topic carousel. A strict decision made
  // at that moment looks fast but falsely skips the business. Settle dynamically:
  // return quickly once a topic group is stable, otherwise allow Google a short
  // window to finish rendering before concluding that no filter exists.
  const waitForReviewTopicsSettled = async (timeout = 6500) => {
    let last = "";
    let stable = 0;
    const started = Date.now();
    // Whether the carousel exists at all is the decision that actually matters —
    // a missing one skips the business — so it is waited for through waitFor, which
    // reacts to the DOM rather than to a timer Chrome may have throttled to once a
    // minute. The stability loop below then only has to confirm the chip list is
    // complete before it is read.
    if (!await waitFor(topicGroup, timeout, 120)) return false;
    while (Date.now() - started < timeout) {
      const group = topicGroup();
      const chips = reviewTopicChips();
      const more = group ? [...group.querySelectorAll("[role='button']")]
        .some((node) => visible(node) && /more review topic|^\+\d+$/i.test(`${node.getAttribute("aria-label") || ""} ${textOf(node)}`.trim())) : false;
      const signature = group ? `${chips.map(topicLabel).join("|")}|more:${more}` : "";
      if (group && signature === last) {
        stable += 1;
        if (stable >= 3) return true;
      } else {
        last = signature;
        stable = 0;
      }
      await sleep(120);
    }
    return Boolean(topicGroup());
  };
  // Google shows the business category beside the rating ("Garage door supplier").
  const getPlaceCategory = () => textOf([
    ".A5yTVb", "[jsname='ZfUr6c'] .A5yTVb", ".DkEaL", "button[jsaction*='category']", ".YhemCb"
  ].flatMap((selector) => [...document.querySelectorAll(selector)]).find(visible));
  // A company whose own name or category already *is* the speciality has nothing to
  // narrow: every review is about that work. "Halo Overhead Doors / Garage door
  // supplier" needs no filter for "garage door repair", but a general plumber does
  // need one for "toilet replacement".
  const businessIsSpecialised = (keyword) => {
    const identity = `${getPlace()} ${getPlaceCategory()}`;
    return Fudge.businessMatchesKeyword(identity, keyword);
  };
  const selectReviewTopic = async (keyword) => {
    if (!keyword) return { applied: false, skip: false };
    // The title itself can lag behind the clicked result. Wait for it to stop
    // changing before deciding whether this is already a specialist business.
    await waitForPlaceIdentitySettled();
    if (businessIsSpecialised(keyword)) return { applied: false, skip: false, specialised: true };
    const topicRequired = Fudge.requiresTopicMatch(keyword);
    if (topicRequired) await waitForReviewTopicsSettled();
    // Re-check after the detail panel settles in case the first title belonged to
    // the previously selected business.
    if (businessIsSpecialised(keyword)) return { applied: false, skip: false, specialised: true };
    // The hidden topics behind "+6" are where the specific ones usually live.
    await expandReviewTopics();
    if (topicRequired) await waitForReviewTopicsSettled(1200);
    let chips = reviewTopicChips();
    // A general plumbing business is only worth scrolling for a toilet request
    // when Google exposes a toilet topic. Other services retain the safe fallback
    // because Google's topic list is often incomplete.
    //
    // No chips at all is ambiguous: this business may genuinely have no topic
    // filter, or the carousel may still be on its way. Deciding on the first read
    // closed businesses that were merely slow, which is why the same keyword
    // worked on a second or third run. Look once more, with a fresh window, before
    // concluding anything.
    if (!chips.length && topicRequired) {
      await waitForReviewTopicsSettled();
      await expandReviewTopics();
      await waitForReviewTopicsSettled(1200);
      chips = reviewTopicChips();
    }
    if (!chips.length) {
      return {
        applied: false,
        skip: topicRequired,
        unknownTopics: !topicGroup(),
        reason: topicRequired ? "required topic unavailable" : ""
      };
    }
    const ranked = chips
      .map((chip) => ({ chip, label: topicLabel(chip), count: topicCount(chip) }))
      .map((item) => ({ ...item, score: Fudge.topicKeywordMatchScore(item.label, keyword) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.count - a.count);
    // For toilet work at a general plumber, no toilet chip means skip immediately.
    // For other services, keep the broad fallback because the topic list is only
    // a short summary and may omit valid reviews.
    if (!ranked.length) return { applied: false, skip: topicRequired, topics: chips.map(topicLabel), reason: topicRequired ? "required topic unavailable" : "" };
    const best = ranked[0];
    best.chip.click();
    await waitFor(() => best.chip.getAttribute("aria-checked") === "true", 3000, 110);
    await waitForFeedSettled(5000);
    return { applied: true, skip: false, topic: best.label, count: best.count };
  };

  const selectHighestSort = async () => {
    if (highestIsSelected()) return true;
    const radio = await waitFor(() => first(document, [
      "[role='radiogroup'][aria-label*='Sort'] [role='radio'][data-sort='3']",
      ".YCQwEb[role='radio'][data-sort='3']",
      "[role='radio'][data-sort='3']"
    ]), 2200, 110);
    let clicked = false;
    if (radio && visible(radio)) {
      radio.click();
      clicked = true;
    } else {
      clicked = await openSortMenuAndPickHighest();
    }
    if (!clicked) return false;
    // Clicking is not the point — the feed re-ordering is. Scanning before the
    // new order lands is what made Fudge skip straight to the next business.
    await waitFor(highestIsSelected, 3000, 110);
    await waitForFeedSettled(5000);
    return (highestIsSelected() || clicked) && feedLooksDescending();
  };
  // timeBudgetMs caps how long a feed is walked. Used when Google listed review
  // topics but none matched: the topics are not exhaustive, so the reviews we want
  // may still be in there — worth a short look rather than skipping the business.
  const scanReviewFeed = async (jobId, sortedHighest, { timeBudgetMs = 0 } = {}) => {
    const startedAt = Date.now();
    const found = new Map();
    const scannedCards = new Set();
    let unchanged = 0;
    let placeName = getPlace();
    let stopped = false;
    let reachedLowerRating = false;
    // Step grows while each scroll still overlaps the rows we already read, and is
    // cut back the moment it does not. That keeps it fast on a feed that renders
    // quickly without ever jumping over reviews.
    let step = 1.6;
    let previousKeys = new Set();
    let lastStopCheck = 0;
    for (let pass = 0; pass < 220; pass += 1) {
      // Reading the job from storage on every pass costs more than it is worth.
      if (Date.now() - lastStopCheck > 400) {
        lastStopCheck = Date.now();
        if (await jobWasStopped(jobId)) { stopped = true; break; }
      }
      if (timeBudgetMs && Date.now() - startedAt > timeBudgetMs) break;
      await expandLoadedReviews();
      const batch = collectLoaded();
      placeName = batch.placeName;
      batch.reviews.forEach((review) => found.set(review.id, review));
      const cards = findCards();
      const cardKey = (card) => card.getAttribute("data-review-id") || card.getAttribute("data-id") || textOf(card).slice(0, 120);
      const currentKeys = new Set(cards.map(cardKey));
      cards.forEach((card) => scannedCards.add(cardKey(card)));

      // No shared card between two consecutive screens means the last scroll flew
      // past rows that never rendered. Go back and retry with a smaller step.
      const overlaps = previousKeys.size === 0 || [...currentKeys].some((key) => previousKeys.has(key));
      previousKeys = currentKeys;

      // Highest-rating sort is descending, so the first review below five stars is
      // the end of the block worth collecting — everything after it rates lower by
      // definition. Everything on screen has already been collected above, so it is
      // safe to stop here and move to the next business.
      // Only trust this when the sort was actually confirmed; otherwise fall back
      // to scrolling the whole feed.
      if (sortedHighest && cards.map(parseRating).some((rating) => rating && rating < 5)) {
        // Only trust this when the ratings on screen really are descending. A faster
        // loop can read the feed in the instant after the sort is clicked but before
        // the re-ordered rows land, and the stale order ends the scan on its first
        // four-star row with almost nothing collected.
        if (feedLooksDescending()) {
          reachedLowerRating = true;
          break;
        }
        await waitForFeedSettled(2500);
        continue;
      }

      const scroller = findScroller();
      if (!scroller) break;
      if (!overlaps) {
        // Rewind by one screen and slow down before reading again.
        step = Math.max(0.8, step / 2);
        scroller.scrollBy({ top: -scroller.clientHeight, behavior: "auto" });
        await waitFor(() => findCards().length > 0, 600, 60);
        previousKeys = new Set();
        continue;
      }
      const beforeTop = scroller.scrollTop;
      const beforeHeight = scroller.scrollHeight;
      const beforeCards = cards.length;
      scroller.scrollBy({ top: Math.max(600, scroller.clientHeight * step), behavior: "auto" });
      // Continue the moment the next rows render instead of waiting out a fixed
      // delay — this is most of the speed-up on a feed that renders quickly.
      const rendered = await waitFor(
        () => scroller.scrollHeight !== beforeHeight || findCards().length !== beforeCards,
        800,
        45
      );
      if (rendered) step = Math.min(2.6, step + 0.2);
      else {
        // Nothing appeared: ease off and give a lazy feed a nudge rather than
        // sitting on a spinner.
        step = Math.max(0.8, step - 0.4);
        await sleep(90);
        if (unchanged >= 1) {
          scroller.scrollBy({ top: -120, behavior: "auto" });
          await sleep(70);
          scroller.scrollBy({ top: 160, behavior: "auto" });
          await sleep(90);
        }
      }
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 18;
      const moved = scroller.scrollTop !== beforeTop || scroller.scrollHeight !== beforeHeight;
      unchanged = moved ? 0 : unchanged + 1;
      if ((atEnd && unchanged >= 2) || unchanged >= 6) break;
    }
    return { reviews: [...found.values()], scanned: scannedCards.size, placeName, stopped, reachedLowerRating };
  };
  const reviewButtons = () => [...document.querySelectorAll("button, a, [role='tab'], [role='button']")]
    .filter((node) => visible(node) && /(^|\s)reviews?(\s|$)/i.test(`${textOf(node)} ${node.getAttribute("aria-label") || ""}`));
  // Identifies which business's reviews are on screen, so the previous business's
  // cards are never mistaken for the new one's.
  const reviewSignature = () => findCards().slice(0, 3)
    .map((card) => card.getAttribute("data-review-id") || card.getAttribute("data-id") || textOf(card).slice(0, 40))
    .join("|");
  // How long to let a freshly opened business finish rendering before concluding
  // that it has no reviews. Google is slowest on the first businesses of a newly
  // loaded results page, and four seconds was not enough for them.
  const REVIEWS_APPEAR_MS = 7000;
  const reviewsControl = () => {
    const exact = [...document.querySelectorAll(".uTV2Pe [jscontroller='NkTNVb'][role='button'][data-async-fc]")]
      .filter((node) => /^reviews?$/i.test(textOf(node.querySelector(".PbOY2e"))));
    const candidates = [...exact, ...reviewButtons()];
    return candidates.find((node) => /^reviews?$/i.test(textOf(node))) || candidates[0] || null;
  };
  const openReviews = async (staleSignature = null) => {
    const freshFeed = () => Boolean(findCards().length) && reviewSignature() !== staleSignature;
    // Google swaps the panel heading a frame or two before it renders the reviews
    // tab or the feed itself, and openBusinessAt hands over the moment the heading
    // changes. Deciding in that instant reported "Reviews unavailable" for a
    // business that was merely still loading — and from the second business on,
    // every one of them, because only the first has no previous heading to change.
    // Wait for whichever lands first instead of reading the DOM once.
    const ready = await waitFor(() => {
      if (freshFeed()) return { feed: true };
      const control = reviewsControl();
      return control ? { control } : null;
    }, REVIEWS_APPEAR_MS, 90);
    // Nothing at all turned up: no feed, and not even a Reviews control. There is
    // very likely nothing here, so say so plainly rather than let the caller spend
    // another full budget reopening a business that has no reviews.
    if (!ready) return { opened: false, lifeless: true };
    if (ready.feed) return { opened: true };
    ready.control.click();
    // A control was there but its feed did not come: that is a business worth one
    // more try, because something was clearly loading.
    return await waitFor(freshFeed, 10000) ? { opened: true } : { opened: false, lifeless: false };
  };
  // Paid results sit above the organic ones and are repeated on every results
  // page, so without this they get opened again for each page.
  const isSponsored = (node) => {
    const container = node?.closest("[jscontroller='AtSb']") || node;
    if (!container) return false;
    if (container.getAttribute("data-is-ad") === "1") return true;
    if (container.hasAttribute("local-ad-unit")) return true;
    if (container.querySelector("[data-ad-tracking-url], a[href^='/aclk?'], a[href*='googleadservices']")) return true;
    return /^sponsored$/i.test(textOf(container.querySelector(".gghBu, .U3A9Ac")));
  };
  const findBusinessTargets = () => {
    const exactButtons = [...document.querySelectorAll("[jscontroller='AtSb'][id^='tsuid_'] [jsname='ZfUr6c'][role='button'], [jscontroller='AtSb'][id^='tsuid_'] [jsaction*='IEAdff'][role='button']")];
    const exactContainers = [...document.querySelectorAll("[jscontroller='AtSb'][id^='tsuid_']")];
    const fallbackContainers = [...document.querySelectorAll(".VkpGBb, [data-cid][data-ved], .rllt__details")];
    const candidates = exactButtons.length ? exactButtons : exactContainers.length ? exactContainers : fallbackContainers.length ? fallbackContainers : [...document.querySelectorAll("a[href*='/maps/place/']")];
    const seen = new Set();
    return candidates.filter((node) => {
      const container = node.closest("[jscontroller='AtSb'][id^='tsuid_']") || node;
      const label = textOf(node).replace(/\s+/g, " ").trim();
      const title = textOf(first(node, [".dbg0pd .OSrXXb", "h3", "[role='heading']", ".dbg0pd", ".OSrXXb"])) || label;
      const key = container.id || node.id || node.getAttribute("data-cid") || first(node, ["a[href*='/maps/place/']"])?.getAttribute("href") || Fudge.normalize(title).slice(0, 100);
      if (!key || seen.has(key) || !visible(node) || label.length < 3) return false;
      if (isSponsored(node)) return false;
      seen.add(key);
      return true;
    });
  };
  const businessTargetId = (target) => {
    const container = target?.closest("[jscontroller='AtSb'][id^='tsuid_']") || target;
    const directionHref = first(container, ["a[href*='/maps/dir/'][href*='!1s']"])?.getAttribute("href") || "";
    const featureId = directionHref.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1];
    const pvId = first(container, ["[id^='pv-/g/']", "[id^='pv-/m/']"])?.id?.replace(/^pv-/, "");
    const dataFeatureId = first(container, ["[data-feature-id]"])?.getAttribute("data-feature-id");
    // The tsuid_ container id embeds the page's event id, so it is different on
    // every results page and must never be used to recognise a business again.
    return container?.getAttribute("data-cid")
      || target?.getAttribute("data-cid")
      || featureId
      || pvId
      || dataFeatureId
      || first(target, ["a[href*='/maps/place/']"])?.getAttribute("href")
      || Fudge.normalize(textOf(first(container, [".dbg0pd .OSrXXb", ".dbg0pd", "[role='heading']"])) || textOf(target)).slice(0, 120);
  };
  const openBusinessAt = async (index) => {
    const targets = findBusinessTargets();
    const target = targets[index];
    // Same shape as openReviews below, so every caller can read .opened without
    // checking what kind of answer it got. No target means nothing to reopen.
    if (!target) return { opened: false, lifeless: true };
    target.scrollIntoView({ block: "center" });
    await sleep(80);
    const clickable = target.matches("a,button,[role='button']") ? target : first(target, ["[jsname='ZfUr6c'][role='button']", "[jsname='ZfUr6c'] [role='button']", "[jsaction*='IEAdff'][role='button']", "[jsname^='pv-'][role='button']", ".cXedhc", "[role='button']", "h3"] ) || target;
    const beforePlace = getPlace();
    const staleSignature = reviewSignature();
    const swapped = () => getPlace() !== beforePlace || (Boolean(findCards().length) && reviewSignature() !== staleSignature);
    // A click that lands while the previous panel is still closing is swallowed by
    // Google and nothing happens. One attempt then looks exactly like "this business
    // has no reviews", and the business is skipped for good. Retry instead — the
    // first wait is short, so a business that opens straight away costs nothing.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      clickable.click();
      if (await waitFor(swapped, attempt === 0 ? 1200 : 2400, 70)) return openReviews(staleSignature);
      await sleep(110 * (attempt + 1));
    }
    return openReviews(staleSignature);
  };
  const closeReviewLayer = () => {
    const dialog = [...document.querySelectorAll("[role='dialog']")].find(visible);
    const close = dialog ? first(dialog, ["button[aria-label*='Close']", "[role='button'][aria-label*='Close']"]) : null;
    close?.click();
  };
  const nextPageButton = () => {
    // Google's page-navigation anchor can have a zero-size box because its child
    // controls are floated. The href is still valid, so do not reject pnnext with
    // the generic visibility check used for normal buttons.
    const direct = document.querySelector("a#pnnext[href], #botstuff a[href]#pnnext");
    if (direct && direct.getAttribute("aria-disabled") !== "true") return direct;
    return [
      "[role='navigation'] a[aria-label*='Next page']",
      "[role='navigation'] a[aria-label='Next']",
      "#botstuff [role='link'][aria-label*='Next']",
      "#botstuff .lROzbb[role='button'][aria-label='Next']"
    ].flatMap((selector) => [...document.querySelectorAll(selector)])
      .find((node) => visible(node) && node.getAttribute("aria-disabled") !== "true") || null;
  };
  const resultsPageFromUrl = () => Math.max(1, Math.floor((Number(new URL(location.href).searchParams.get("start")) || 0) / 20) + 1);
  // A dropped message must never end a scan. The service worker can be evicted
  // mid-reply, and losing one progress update is nothing compared with abandoning
  // the run — which is what an unhandled rejection here used to do.
  const updateJob = async (patch) => {
    const response = await chrome.runtime.sendMessage({ type: "SCAN_JOB_UPDATE", patch }).catch(() => null);
    if (response?.job) currentJob = response.job;
    return response?.job || { ...(currentJob || {}), ...patch };
  };
  const finishJob = async (patch) => chrome.runtime.sendMessage({ type: "SCAN_JOB_COMPLETE", patch }).catch(() => null);
  const saveBatch = async (result, job) => {
    const { sheetKnownReviewIds = [], sheetKnownReviewFingerprints = [], sheetKnownReviewContentKeys = [], activeServiceKeywords = [], serviceRules = [] } = await chrome.storage.local.get({ sheetKnownReviewIds: [], sheetKnownReviewFingerprints: [], sheetKnownReviewContentKeys: [], activeServiceKeywords: [], serviceRules: [] });
    Fudge.setServiceRules(serviceRules);
    const known = new Set(sheetKnownReviewIds);
    const knownFingerprints = new Set(sheetKnownReviewFingerprints);
    const knownContent = new Set(sheetKnownReviewContentKeys);
    let sheetDuplicates = 0;
    let offTrade = 0;
    const targetCandidates = new Set();
    const specialistCandidates = new Set();
    const targetServiceId = job.serviceKeyword ? Fudge.serviceIdentity(job.serviceKeyword).id : "";
    const contextualReviews = result.reviews.map((review) => ({
      ...review,
      reviewTopic: job.reviewTopic || "",
      serviceLabels: [review.serviceLabels, job.reviewTopic].filter(Boolean).join(" ")
    }));
    const eligible = contextualReviews.filter((review) => {
      if (known.has(review.id) || knownFingerprints.has(Fudge.reviewKey(review)) || knownContent.has(Fudge.reviewContentKey(review))) { sheetDuplicates += 1; return false; }
      // After PHOTO_GRACE_MS of hunting one keyword without filling it, take good
      // five-star reviews that simply have no photo rather than keep searching.
      const photoOptional = job.reviewMode !== "without-picture" && photoGraceExpired(job);
      const modeMatches = job.reviewMode === "without-picture"
        ? review.photos.length === 0
        : (review.photos.length > 0 || photoOptional);
      if (!modeMatches) return false;
      const targetMatch = !job.serviceKeyword || Fudge.matchesServiceKeyword(review, job.serviceKeyword);
      const specialistInventory = job.serviceKeyword && Fudge.shouldCollectSpecialistInventory(review, job.serviceKeyword);
      if (!targetMatch && !specialistInventory) return false;
      // Keep only trades listed on the Services tab. An empty list means the user
      // has not filled it in yet, so nothing is filtered out.
      if (activeServiceKeywords.length && !activeServiceKeywords.some((keyword) => Fudge.matchesServiceKeyword(review, keyword) || Fudge.shouldCollectSpecialistInventory(review, keyword))) {
        offTrade += 1;
        return false;
      }
      if (targetMatch) targetCandidates.add(review.id);
      if (specialistInventory) specialistCandidates.add(review.id);
      return true;
    }).map((review) => {
      const targetMatch = targetCandidates.has(review.id);
      const belongsToTargetFamily = targetMatch || specialistCandidates.has(review.id);
      const sourceServiceId = belongsToTargetFamily ? targetServiceId : (review.sourceServiceId || "");
      return {
        ...review,
        sourceServiceId,
        service: belongsToTargetFamily && job.serviceKeyword ? Fudge.classifyForKeyword({ ...review, sourceServiceId }, job.serviceKeyword) : review.service,
        matchedKeyword: belongsToTargetFamily ? (job.serviceKeyword || "") : (review.matchedKeyword || ""),
        searchCity: job.city || review.searchCity || "",
        searchKeyword: job.serviceKeyword || review.searchKeyword || "",
        reviewMode: job.reviewMode || review.reviewMode
      };
    });
    const saved = await Fudge.addReviews(eligible);
    saved.targetAccepted = (saved.acceptedIds || []).filter((id) => targetCandidates.has(id)).length;
    saved.offTrade = offTrade;
    const { duplicatesBlocked } = await chrome.storage.local.get({ duplicatesBlocked: 0 });
    const duplicates = saved.duplicates + sheetDuplicates;
    if (duplicates) await chrome.storage.local.set({ duplicatesBlocked: duplicatesBlocked + duplicates });
    let driveError = "";
    if (job.saveToDrive && eligible.length && !job.auto) {
      // The slowest message Fudge sends: it uploads every picture to Drive through
      // Apps Script. When that outlives the message channel, or the worker is
      // evicted mid-upload, the send rejects — and letting that reach the scan loop
      // ended the whole run over pictures that are only a nice-to-have. The reviews
      // are already saved locally by this point; Drive is caught up later.
      const drive = await chrome.runtime.sendMessage({ type: "SAVE_REVIEWS_TO_DRIVE", reviews: eligible }).catch((error) => ({ ok: false, error: error.message }));
      if (!drive?.ok) driveError = drive?.error || "Pictures will be uploaded to Drive on a later pass.";
    }
    return { ...saved, duplicates, driveError };
  };
  const runJob = async (initialJob) => {
    if (running) return;
    running = true;
    let job = initialJob;
    currentJob = initialJob;
    // Walking one long review feed can go minutes without a progress update, and
    // background.js treats a job that has gone quiet as dead so its slot can be
    // reused. This keeps the lease current while the work is genuinely ongoing.
    const heartbeat = setInterval(() => {
      if (!job?.id) return;
      chrome.runtime.sendMessage({ type: "SCAN_JOB_UPDATE", patch: { id: job.id } }).catch(() => {});
    }, 45000);
    try {
      const { serviceRules = [] } = await chrome.storage.local.get({ serviceRules: [] });
      Fudge.setServiceRules(serviceRules);
      const isPlacesResults = location.pathname === "/search" && (new URL(location.href).searchParams.get("udm") === "local" || findBusinessTargets().length > 0);
      if (!isPlacesResults) {
        job = await updateJob({ stage: "Opening reviews", currentBusiness: getPlace() });
        const opened = (await openReviews()).opened;
        if (!opened) {
          await finishJob({ stage: "Reviews unavailable", businessesVisited: 0 });
          return;
        }
        job = await updateJob({ stage: "Narrowing to the review topic" });
        const topic = await selectReviewTopic(job.serviceKeyword);
        job = await updateJob({ stage: "Sorting highest first" });
        const sortedHighest = await selectHighestSort();
        job = await updateJob({ stage: topic.unknownTopics ? "Topic list did not load — scanning the full feed" : topic.skip ? "Quick look — no matching topic" : sortedHighest ? "Collecting five-star reviews" : "Scanning the full feed" });
        const result = await scanReviewFeed(job.id, sortedHighest, { timeBudgetMs: topic.skip ? UNMATCHED_TOPIC_BUDGET_MS : 0 });
        const saved = await saveBatch(result, { ...job, reviewTopic: topic.topic || "", saveToDrive: result.stopped ? false : job.saveToDrive });
        if (result.stopped) {
          await updateJob({ stage: "Stopped by user", reviewsSaved: (job.reviewsSaved || 0) + saved.accepted, targetMatches: (job.targetMatches || 0) + saved.targetAccepted, duplicates: saved.duplicates });
          return;
        }
        await finishJob({ stage: "Complete", businessesVisited: (job.businessesVisited || 0) + 1, reviewsSaved: (job.reviewsSaved || 0) + saved.accepted, targetMatches: (job.targetMatches || 0) + saved.targetAccepted, duplicates: saved.duplicates, driveError: saved.driveError });
        return;
      }
      if (job.auto) {
        const urlPage = resultsPageFromUrl();
        if (Number(job.currentPage || 1) > urlPage) {
          // The runner was restored with a newer checkpoint than Google's URL
          // (for example after a tab reload). Return to the saved page instead of
          // silently scanning page one again.
          const resume = new URL(location.href);
          resume.searchParams.set("start", String((Number(job.currentPage) - 1) * 20));
          await updateJob({ stage: `Restoring page ${job.currentPage}`, businessIndex: 0 });
          location.href = resume.toString();
          return;
        }
      }
      // Commit pagination only after the next document has actually loaded.
      const loadedPage = resultsPageFromUrl();
      if (loadedPage > Number(job.currentPage || 1)) {
        job = await updateJob({ stage: `Resuming page ${loadedPage}`, currentPage: loadedPage, businessIndex: 0, pageAdvanced: true });
      }
      if (job.auto && job.currentPage > 1 && job.businessIndex > 0 && (job.visitedPlaceIds || []).length) {
        const resumeTargets = findBusinessTargets();
        const expectedAnchor = job.visitedPlaceIds[job.visitedPlaceIds.length - 1];
        const actualAnchor = businessTargetId(resumeTargets[job.businessIndex - 1]);
        if (expectedAnchor && actualAnchor && expectedAnchor !== actualAnchor) {
          // Google reordered this page. Re-scan this page from its first card and
          // rely on visited Place IDs for deduplication; never throw away the page
          // checkpoint and restart the city from page one.
          job = await updateJob({ stage: `Results changed — safely resuming page ${job.currentPage}`, businessIndex: 0 });
        }
      }
      while (true) {
        if (googleBlockPage()) {
          // Stop here without recording progress: businessIndex and visitedPlaceIds
          // stay exactly where they were so this work is retried, not written off.
          await finishJob({ stage: "Blocked by Google", blocked: true, businessIndex: job.businessIndex || 0 });
          return;
        }
        // A slow or changed results page is not evidence that the city is exhausted.
        const targets = findBusinessTargets().length ? findBusinessTargets() : await waitFor(() => {
          const found = findBusinessTargets();
          return found.length ? found : null;
        }, 10000, 200);
        if (!targets) {
          await finishJob({ stage: "Results did not load — will retry", businessIndex: job.businessIndex || 0 });
          return;
        }
        for (let index = job.businessIndex || 0; index < targets.length; index += 1) {
          if (await jobWasStopped(job.id)) return;
          if (googleBlockPage()) {
            await finishJob({ stage: "Blocked by Google", blocked: true, businessIndex: index });
            return;
          }
          const targetId = businessTargetId(targets[index]);
          if ((job.visitedPlaceIds || []).includes(targetId)) {
            job = await updateJob({ stage: "Skipping previously visited business", businessIndex: index + 1 });
            continue;
          }
          const businessLabel = textOf(targets[index]).replace(/\s+/g, " ").slice(0, 90);
          job = await updateJob({ stage: "Opening business", businessIndex: index, currentBusiness: businessLabel });
          let panel = await openBusinessAt(index);
          if (!panel.opened) {
            if (googleBlockPage()) {
              await finishJob({ stage: "Blocked by Google", blocked: true, businessIndex: index });
              return;
            }
            // One slow panel is not proof that a business has no reviews, so a
            // business that was clearly loading gets a second try. One where
            // nothing appeared at all — no feed, not even a Reviews control — is
            // taken at its word, because reopening every empty business doubles the
            // time a page takes for no reviews gained.
            if (!panel.lifeless) {
              closeReviewLayer();
              await waitFor(() => !findCards().length, 900, 60);
              job = await updateJob({ stage: "Reopening business", businessIndex: index });
              panel = await openBusinessAt(index);
            }
          }
          if (!panel.opened) {
            job = await updateJob({ stage: "Reviews unavailable", businessIndex: index + 1 });
            continue;
          }
          const placeId = getPlaceId();
          if ((job.visitedPlaceIds || []).includes(placeId)) {
            closeReviewLayer();
            job = await updateJob({ stage: "Skipping previously visited business", businessIndex: index + 1 });
            continue;
          }
          job = await updateJob({ stage: "Narrowing to the review topic", currentBusiness: getPlace() });
          const topic = await selectReviewTopic(job.serviceKeyword);
          job = await updateJob({ stage: "Sorting highest first", currentBusiness: getPlace() });
          const sortedHighest = await selectHighestSort();
          // Google's topic list is not exhaustive: a business can still hold the
          // reviews we want without a chip naming them. Worth a short look rather
          // than skipping the business outright.
          job = await updateJob({
            stage: topic.unknownTopics
              ? "Topic list did not load — scanning the full feed"
              : topic.skip ? "Quick look — no matching topic" : sortedHighest ? "Collecting five-star reviews" : "Scanning the full feed",
            currentBusiness: getPlace()
          });
          const result = await scanReviewFeed(job.id, sortedHighest, { timeBudgetMs: topic.skip ? UNMATCHED_TOPIC_BUDGET_MS : 0 });
          const saved = await saveBatch(result, { ...job, reviewTopic: topic.topic || "", saveToDrive: result.stopped ? false : job.saveToDrive });
          const visitedPlaceIds = [...new Set([...(job.visitedPlaceIds || []), placeId, targetId].filter(Boolean))];
          job = await updateJob({
            stage: result.stopped ? "Stopped by user" : saved.driveError ? "Saved locally; Drive needs attention" : "Business complete",
            businessIndex: index + 1,
            businessesVisited: (job.businessesVisited || 0) + 1,
            reviewsSaved: (job.reviewsSaved || 0) + saved.accepted,
            targetMatches: (job.targetMatches || 0) + saved.targetAccepted,
            duplicates: (job.duplicates || 0) + saved.duplicates,
            driveError: saved.driveError || job.driveError || "",
            visitedPlaceIds,
            lastPlaceId: placeId,
            businessEligible: saved.accepted,
            businessCompleted: true
          });
          if (result.stopped) return;
          if (job.auto && Number(job.targetCount || 0) > 0 && Number(job.targetMatches || 0) >= Number(job.targetCount)) {
            await finishJob({ stage: "Target reached", visitedPlaceIds, currentPage: job.currentPage, businessIndex: index + 1 });
            return;
          }
          closeReviewLayer();
          // Continue as soon as the panel is really gone, so the next click cannot
          // land on a closing dialog and be swallowed.
          await waitFor(() => !findCards().length, 700, 50);
        }
        const pageLimit = safePageLimit(job.pageLimit);
        if (await jobWasStopped(job.id)) return;
        if (job.currentPage >= pageLimit) {
          await finishJob({ stage: `Page limit reached (${pageLimit} page${pageLimit === 1 ? "" : "s"})` });
          return;
        }
        // Closing the last review dialog and rendering Google's footer can race.
        // Give the real pagination control a brief chance to appear before this
        // city is permanently marked exhausted.
        const next = nextPageButton() || await waitFor(nextPageButton, 2800, 140);
        if (!next) {
          await finishJob({ stage: "End of results" });
          return;
        }
        const nextAnchor = next.matches("a[href]") ? next : next.closest("a[href]");
        const nextHref = nextAnchor?.href || "";
        const oldUrl = location.href;
        const oldSignature = findBusinessTargets().map((node) => node.getAttribute("data-cid") || Fudge.normalize(textOf(node)).slice(0, 80)).join("|");
        const nextPage = Number(job.currentPage || 1) + 1;
        job = await updateJob({ stage: `Loading page ${nextPage}` });
        // A direct navigation is more reliable than clicking the floated inner
        // button. The content script resumes the still-running job after reload.
        if (nextHref && nextHref !== oldUrl) {
          location.href = nextHref;
          return;
        }
        const clickable = visible(next) ? next : [...next.querySelectorAll("[role='button'], button")].find(visible);
        if (!clickable) {
          await finishJob({ stage: "Could not load the next results page" });
          return;
        }
        clickable.click();
        const changed = await waitFor(() => {
          const signature = findBusinessTargets().map((node) => node.getAttribute("data-cid") || Fudge.normalize(textOf(node)).slice(0, 80)).join("|");
          return location.href !== oldUrl || (signature && signature !== oldSignature);
        }, 12000, 400);
        if (location.href !== oldUrl) return;
        if (!changed) {
          await finishJob({ stage: "Could not load the next results page" });
          return;
        }
        job = await updateJob({ stage: `Scanning page ${nextPage}`, currentPage: nextPage, businessIndex: 0, pageAdvanced: true });
      }
    } catch (error) {
      // Anything to do with the extension being reloaded, or a message that went
      // nowhere, is not something the operator can act on and not a reason to show
      // a scary failure. The run ends either way; only the wording differs.
      const messaging = /message channel closed|Extension context invalidated|Receiving end does not exist|Could not establish connection/i.test(error.message || "");
      if (messaging) await finishJob({ stage: "Paused — Fudge was reloaded. Press Start to continue.", businessIndex: job?.businessIndex || 0 });
      else await finishJob({ stage: "Stopped with an error", error: error.message });
    } finally {
      clearInterval(heartbeat);
      running = false;
      currentJob = null;
    }
  };
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // The runner answers before it is asked to start, so background.js can tell
    // "the page is listening" from "the page is still loading" instead of firing
    // three blind start messages and closing the tab when they all miss.
    if (message?.type === "FUDGE_PING") {
      sendResponse({ ok: true, running, url: location.href });
      return true;
    }
    if (message?.type !== "FUDGE_START_SCAN") return;
    // Already working: hand back the live job. Creating another one left a record
    // that claimed to be running while no loop was driving it, and that record held
    // one of the two scanning slots.
    if (running && currentJob) {
      sendResponse({ ok: true, job: currentJob, alreadyRunning: true });
      return true;
    }
    const job = {
      id: crypto.randomUUID(),
      status: "running",
      auto: Boolean(message.options?.auto),
      searchKey: message.options?.searchKey || "",
      serviceKeyword: message.options?.serviceKeyword || "",
      city: message.options?.city || "",
      query: message.options?.query || "",
      reviewMode: message.options?.reviewMode || "photo",
      // Starts the five-minute clock after which photo-less reviews are accepted.
      keywordStartedAt: message.options?.keywordStartedAt || new Date().toISOString(),
      targetCount: Number(message.options?.targetCount || 0),
      visitedPlaceIds: message.options?.visitedPlaceIds || [],
      pageLimit: safePageLimit(message.options?.pageLimit),
      saveToDrive: Boolean(message.options?.saveToDrive),
      currentPage: Number(message.options?.currentPage || 1),
      businessIndex: Number(message.options?.businessIndex || 0),
      businessesVisited: 0,
      reviewsSaved: 0,
      targetMatches: 0,
      sourceUrl: location.href
    };
    chrome.runtime.sendMessage({ type: "SCAN_JOB_START", job }).then((response) => {
      sendResponse({ ok: true, job: response.job });
      runJob(response.job);
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
  setTimeout(async () => {
    const response = await chrome.runtime.sendMessage({ type: "GET_SCAN_JOB" }).catch(() => null);
    if (response?.job?.status === "running") runJob(response.job);
  }, 1200);
})();
