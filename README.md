# Fudge 2.0 — Google Review Collector & Sheets Fulfillment

<p align="center">
  <img src="https://img.shields.io/badge/Chrome%20%2F%20Edge-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white" alt="Chrome / Edge — Manifest V3">
  <img src="https://img.shields.io/badge/version-2.0-brightgreen" alt="Version 2.0">
  <img src="https://img.shields.io/badge/language-JavaScript-f7df1e?logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/dependencies-none-success" alt="Zero dependencies">
  <img src="https://img.shields.io/badge/backend-Google%20Sheets%20%2B%20Apps%20Script-34A853?logo=googlesheets&logoColor=white" alt="Google Sheets + Apps Script">
  <img src="https://img.shields.io/badge/AI-OpenAI%20Rewriter-412991?logo=openai&logoColor=white" alt="OpenAI rewriter">
</p>

**Fudge** is a Chrome/Edge Manifest V3 extension that collects and classifies five-star Google reviews, keeps a deduplicated local review library, and automatically fulfills a Google Sheets work queue — opening Google itself, scanning the right businesses, and filing the right reviews into your spreadsheet while you do something else.

For the complete cross-system implementation guide, start with the [Fudge + ND Master Automation Plan](docs/MASTER-AUTOMATION-PLAN.md). It covers ingestion, cleanup, approval, Sheets, local execution, profiles, checks, comments, controlled reposting, recovery and phased acceptance. This is a plan, not delivered end-to-end automation.

The [optional ND backend setup and durable uploader](docs/BACKEND-UPLOADER.md) is implemented with local/mock tests. Open **ND backend intake → Setup** after reloading this unpacked extension. The shared intake schema is deployed; **upload release stays off** pending browser acceptance, policy decisions and a pilot. Opening setup or signing in never migrates the existing library. Collection and Sheets behavior remain unchanged.

**Shared email account:** Fudge and the ND dashboard use the same Supabase project
and email/password account. Sign up once, verify your email, then sign in separately
in each app. No API-key entry is needed. A single authorized business connects
automatically paused; new users can explicitly set up an empty private business
account. Advanced selection remains available for users with multiple businesses.

For the proposed Supabase-backed source Sheet → cleanup → ND Master → automation workflow, see the [recommended setup and implementation plan](docs/RECOMMENDED-WORKFLOW.md). The [shared raw-ingestion schema](supabase/README.md) is deployed, but extension uploads remain off and the complete cross-system workflow is not delivered. The older per-user SQL is superseded; do not apply it to the shared project.

---

## 🏷️ Tags

`chrome-extension` · `manifest-v3` · `google-maps` · `google-search-places` · `google-sheets` · `google-apps-script` · `google-drive-api` · `openai-api` · `web-automation` · `review-collection` · `review-classification` · `side-panel` · `service-worker` · `javascript` · `vanilla-js` · `zero-dependencies` · `smoke-tests`

> Suggested **GitHub Topics** (Settings → General → Topics):
> `chrome-extension` `manifest-v3` `google-maps` `google-sheets` `apps-script` `openai` `web-automation` `review-collection` `javascript` `sidepanel`

## 📑 Table of contents

- [Highlights](#-highlights)
- [How it works](#-how-it-works)
- [Requirements](#-requirements)
- [Installation](#-installation)
- [Connect Google Sheets & Drive](#-connect-google-sheets--drive)
- [The connected Sheet](#-the-connected-sheet)
- [Automation model](#-automation-model)
- [Search & scan engine](#-search--scan-engine)
- [Review matching](#-review-matching)
- [Reviews without pictures](#-reviews-without-pictures)
- [Website writer & automatic rephrasing](#-website-writer--automatic-rephrasing)
- [Ready & Used](#-ready--used)
- [Interface & design system](#-interface--design-system)
- [Project structure](#-project-structure)
- [Testing](#-testing)
- [Updating the Sheet connector](#-updating-the-sheet-connector)
- [Troubleshooting & FAQ](#-troubleshooting--faq)
- [Privacy](#-privacy)
- [Responsible use](#-responsible-use)
- [Versioning & tags](#-versioning--tags)
- [License](#-license)

## ✨ Highlights

- **Exactly 5-star reviews** — with customer photos by default; text-only reviews when a Structure row is marked **Self Write** or **Without Picture**.
- **One copy of each review** — keyed by Google's review ID with an author/business migration fallback; a newly captured full review upgrades an older truncated copy.
- **Two-level classification** — precise subsections such as *Garage doors → Track & roller repair*, *HVAC → Thermostat*, or *Drywall → Texture matching*.
- **Family locking** — reviews from a confirmed specialist business stay inside that service family, so "moved" can never turn a garage-door review into a Moving review.
- **Google Sheets automation** — a full work queue with **Structure**, **Reviews**, **Search Progress**, **Businesses**, **Services**, **Cities**, and **Names** tabs.
- **Automatic 3× sourcing** — every required Structure row gets one assigned review plus two unused backups.
- **QC replacement** — set **Quality Check** to `Change it` to reject the assigned review, assign a replacement, and reset the cell to `QC needed`.
- **Parallel scanning** — three Google Places tabs by default (1–6 configurable), each working a different service keyword.
- **Fast sorted walking** — Fudge applies Google's **Highest** sort, walks only the five-star block, and moves on at the first lower rating.
- **Reliable resume** — page position, visited business/place IDs, and collected review IDs are stored in the Sheet, so reordering never causes duplicate work.
- **Google Drive originals** — optional uploads with link sharing set to *Anyone with the link — Viewer*.
- **Spam-resistant** — sponsored results are never opened, never re-visited across result pages.
- **Polite under blocks** — recognizes Google rate-limit pages and pauses 15 → 120 minutes instead of losing work.

### What it keeps, exactly

| Behavior | Detail |
| --- | --- |
| Row layout | Picture links are stored **one URL per line inside a single cell** in both the Structure and Reviews tabs |
| Row height | All spreadsheet rows stay fixed at **21 px**, including rows with multiple picture links |
| Columns | Fudge **never auto-resizes** columns; manually chosen widths remain unchanged |
| Copying | *Copy for Sheets* uses the same single-cell layout; picture column copies as an `IMAGE()` formula with review text adjacent |
| Images | Original-size Google image URLs plus clickable picture links in the dashboard |

## 🔍 How it works

```
 Google Maps / Google Search "Places" results
        │  content script opens businesses → Reviews → Highest sort
        ▼
 Five-star reviews (photos required by default)
        │  dedup by review ID / fingerprint / text+business identity
        ▼
 Local review library  (chrome.storage.local, unlimitedStorage)
        │  dashboard tables + Copy for Sheets + Drive upload
        ▼
 Google Sheet  (Structure ▸ Reviews ▸ Search Progress ▸ Businesses)
        ▲  Apps Script connector fills rows, rephrases, self-fills offline
        │
 Structure requirements → Fudge opens Google itself when inventory is short
```

1. A **Structure** row requests reviews for a `Service Keyword` (+ optional `City`).
2. Fudge first fills the row from reviews already in **inventory**.
3. If the pool is short, it opens Google searches, up to the configured tab limit.
4. Collected reviews are classified into the correct family/subsection and filed.
5. The row is marked **Used** in the Reviews tab; two backups stay unused for QC.

## ✅ Requirements

| Requirement | Detail |
| --- | --- |
| Browser | Chrome or Edge with **side panel** + **unlimited storage** (MV3) |
| Testing | [Node.js](https://nodejs.org) ≥ 18 for the smoke-test suite — nothing else; the extension itself has **zero npm dependencies** |
| Optional | Google account for Sheets/Drive automation; OpenAI API key for the writer |

## 📦 Installation

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Open either a business in Google Maps or a Google Search **Places** results page.
5. Choose a page limit of **1–4 result pages** in the Fudge sidebar (default 4).
6. Click **Start collecting**.

> Nothing else turns collecting on — connecting a sheet, syncing, or finishing a job never does. **Stop collecting** closes the runner tabs and switches automatic fulfillment off until you press Start again.

Google changes Maps markup periodically, so the DOM selectors in `content.js` are intentionally grouped in one place for maintenance. The Google Search Places support is matched to the current `AtSb` business-result cards, `NkTNVb` Reviews control, `ujKaBc` review dialog, `RjvGlb`/`OSrXXb` selected-business names, `bwb7ce` review cards, `h3PQJ` star blocks, `d83Iyc` review text (plus older wrappers), and `SeRB9d` attached-photo elements. Before saving, Fudge activates the `FrlmTe` **More** control and independently selects the longest full-text node.

### Stable unpacked extension ID

The public `key` in `manifest.json` fixes this development build to extension ID **`bhpbiejhocblflacbgkohbiejnhopdan`**. The key is public identity material, not a password or connector secret. Adding it changes the ID once for installations that previously relied on Chrome's path-derived unpacked ID — copy/preserve any important reviews from a previous installation before the first reload, because Chrome keeps extension storage isolated by extension ID.

## 🔗 Connect Google Sheets & Drive

Fudge uses a **protected Apps Script connector** — no Google Cloud Console project, no OAuth client. The website writer uses an OpenAI API key stored in Apps Script Script properties.

1. Choose **Connect** under *Sheets automation* in the Fudge sidebar.
2. Create or open the Google Sheet you want to use and choose **Extensions → Apps Script**.
3. Copy the complete protected connector from Fudge, replace the starter code, and save it.
4. Refresh the Sheet, then choose **Fudge → Set OpenAI API key** and paste your key (stored as `FUDGE_OPENAI_API_KEY`).
5. Select `fudgeInstallAutomation` beside **Run**, click **Run**, and approve Google's permissions once. Fudge installs triggers itself on first connect; this step is a fallback that grants the permission it needs.
6. **Deploy → New deployment → Web app**. Set **Execute as** = *Me*, access = *Anyone*, then deploy.
7. Paste the deployment URL ending in `/exec` into Fudge and choose **Connect Sheet and Drive**.

The connector carries a long random secret; every request without that exact secret is rejected. Fudge creates the Structure, Reviews, Search Progress, and Businesses tabs inside that Sheet, plus a **`Fudge Reviews`** Drive folder. Original review images download through Apps Script and are shared as *Anyone with the link — Viewer*. (Workspace administrators can prohibit public links — Fudge reports the error and keeps the reviews locally.)

### Connecting another computer

The folder carries no connection: each fresh installation generates its own private secret and starts at the setup page. On the already-connected machine, open **Change sheet → Copy connection code** and paste that `FUDGE1|…` code into the setup field on the other computer. The bare `/exec` URL alone is insufficient.

### Sharing someone else's extension

| Symptom | Meaning |
| --- | --- |
| **`404`** | Google refused to serve the deployment — it is private. The owner must open **Deploy → Manage deployments → ✏️**, set *Execute as: Me* and *Who has access: Anyone*, and redeploy. A multi-account browser can also `404` on a non-default account. |
| **`secret does not match`** | The connector is running with a different secret than the request. Either a bare `/exec` URL was pasted (use the `FUDGE1|` connection code), or new connector code was saved but **never redeployed** — `/exec` keeps serving the previously deployed *version* until a **New version** is deployed. |

Sharing the owner's deployment means the recipient reads and writes the **owner's** Sheet and Drive folder (the web app executes as its owner). For a separate database, each recipient copies the connector from their own setup page into their own Sheet.

## 📊 The connected Sheet

### Tabs

| Tab | Purpose |
| --- | --- |
| **Structure** | One requirement per row — `Service Keyword`, `City`, `Review Type` (`Self Write` / `Without Picture` for text-only), plus **Numbers** (column L) and **Rephrased Content** (column M) |
| **Reviews** | The review inventory — **Ready** until marked **Used** |
| **Search Progress** | Single source of truth for keyword/city exhaustion and resume points |
| **Businesses** | Log of visited businesses and place IDs |
| **Services** | Trade list and rule editor (see below) |
| **Cities** | Search locations — one city per row in column A (a thousand rows is fine) |
| **Names** | Crew names for the website writer, shuffled cyclically |

### Services — the rule editor

One service per row. Put `Paused` in **Status** to switch a row off — Fudge keeps only reviews matching an active row, so scans never fill the library with work you do not sell. Leave the tab empty and nothing is filtered. Existing A:D rows upgrade automatically on the next sync; trained defaults fill the new columns once, then the Sheet owns them.

| Column | What it controls |
| --- | --- |
| Service Keyword | The wording used in Structure and rephrasing |
| Search Term | The Google query before the city is added |
| Business Name Keywords | Words identifying a specialist business — allows scanning without a topic chip |
| Review Keywords | Any one of these must appear in the review |
| Required Review Keywords | Every listed word or phrase must appear |
| Google Filter Keywords | Words used to pick Google's review-topic chip |
| Exclude Keywords | Any one rejects the review |
| Service Family | Keeps reviews inside the correct trade |
| Subcategory | Keeps precise jobs separate inside a family |
| Topic Filter Required | `Yes` skips a general business with no matching Google topic |
| Collect Family Reviews | `Yes` also saves other subcategories from a confirmed specialist business |
| Rewrite Service Phrase | Preferred service wording in Rephrased Content |
| Equivalent Service Phrases | Alternate wording that should become the preferred phrase |

Separate alternatives with `|` (e.g. `sofa | couch`); use `-` or `none` for an intentionally empty list. Fudge writes back only **Status** and **Reviews Collected** — it never overwrites configured rule cells. The same rules are cached in the extension and read directly by Apps Script, so offline assignment follows the same service boundaries.

### Cities

You fill **Structure** requirements only. Leave `City` blank and Fudge gives each service its own **stable shuffled choice** from the Cities tab. Once a service starts a city it stays there until the combination is exhausted; a partially-searched city resumes at its saved page, business position, and visited Place IDs — including after Chrome restarts.

- Reaching the page limit (never more than 4) completes the keyword/city; the next sync moves to the next shuffled city.
- The keyword/city matrix is never generated upfront — a Search Progress row appears only after a city has really been searched.
- Cities tab mirrors status for reading (`Status`, `Last Used`, `Exhausted Keywords`) and rewrites only rows that actually changed.
- A city written on a Structure row still overrides the list; when every city is exhausted for a keyword, the side panel says so instead of stalling quietly.

## ⚙️ Automation model

Fudge has exactly **one switch**; the two buttons at the top of the side panel are the only things that move it.

**Start collecting**

- On a Google Maps business or Places results page → scans the page you are looking at.
- Anywhere else → takes the next outstanding Structure requirement, opens Google Places in a new foreground tab, and begins.
- Also switches automatic fulfillment **on**: Structure is checked every ~30 seconds while Chrome runs, and Fudge opens Google itself until you press Stop. Newly collected reviews also schedule a coalesced sync shortly after a business finishes; network or connector delays can add time.

**Stop collecting** — ends every running scan, closes Fudge's tabs, switches automation off. Reviews already collected stay saved and each scan's position is kept in **Search Progress**, so restarting resumes rather than repeating.

Manual buttons skip all cooldowns: side panel *Fill rows now*, *Rephrase now*, *Sync now*, *Repair*; Sheet menu *Fudge → Rephrase now / Fill rows now / Test rephrasing / Rephrasing status*.

### Retry behavior that matters

| Situation | What Fudge does |
| --- | --- |
| Business click swallowed (panel still closing) | Retries up to **3×** (first wait 1.2 s), waits for the previous panel to clear, and refuses a feed whose first reviews match the ones on screen |
| Feed scroll skips rows | Two screens with no shared review → rewinds one screen, halves the step, re-reads — speed can never silently skip reviews |
| Sort cannot be applied | Falls back to scrolling the **whole feed** — slower, but never under-collects |
| Blocked by Google (`/sorry/`, reCAPTCHA, "unusual traffic") | Current business is **not** marked visited; keyword/city is never marked Exhausted; cooldown ladder starts at **15** → 30 → 60 → **120 minutes**; one clean run resets to 15 |
| Keyword hunt with no photos | After **5 minutes**, accepts complete 5-star text-only reviews and writes **"No picture found"** |

## 🧭 Search & scan engine

### Query building

You never type a query — Fudge builds it from the Structure row:

| Service keyword in Structure | Google is searched for |
|---|---|
| `toilet replacement` | `toilet replacement in <city>` |
| `water heater replacement` | `water heater replacement in <city>` |
| `garage door track` | `garage door track in <city>` |
| `drywall texture matching` | `drywall texture matching in <city>` |
| `cabinet painting` | `cabinet painting in <city>` |
| `thermostat` | `thermostat in <city>` |

**Appliance repair is the one exception** — no business lists itself as a "washer repair" company, so every appliance speciality collapses to the trade: `washer repair`, `refrigerator not cooling`, `dishwasher repair` → `appliance repair in <city>`. To make another family behave like appliances, add `collapseToFamily: true` in `shared.js`. An unrecognized keyword is used verbatim; `City` is optional (without one, the row can fill from reviews collected in any city, and a row with a review type but no keyword is marked **Needs a service keyword**).

### Google's own review topics

Before scrolling anything, Fudge uses the **Filter reviews** chips Google shows above the reviews — stronger evidence than reading text afterwards. The filter is only used when the business needs it: `Garage`, `Assembly Help`, or `Ashton Sheetrock` are already specialists and are scanned without a topic filter; `Ashton Plumbing` still needs the toilet chip, `Ashton Electrical` still needs the Christmas-light chip.

When narrowing is needed, Fudge: (1) clicks **+N more review topics** first — the trades usually hide there; (2) scores every topic against the requirement, preferring the most specific and then the most-reviewed; (3) clicks the best topic; (4) applies **Highest** and scans the five-star block. For a precise requirement at a general company whose name/category is not specialist, a matching topic is **mandatory** — no toilet topic at a general plumber = the business is skipped, without scrolling. Otherwise no match still falls back to ~4 seconds of text-matched scanning. Sentiment topics (`courteous staff`, `fair pricing`, `prompt arrival`) never count.

**Sponsored results are never opened.** Paid placements are detected by `data-is-ad`, `local-ad-unit`, and `/aclk?` tracking links. Businesses are recognized by feature id / `/g` place id / `data-feature-id` — never the `tsuid_` container id, which changes on every results page (that is what previously re-visited the same sponsored business page after page).

### Scrolling the review feed

The feed is walked with an adaptive step (1.6 → 2.6 screens) that grows while each scroll overlaps rows already read and halves-and-rewinds when two consecutive screens share nothing. Each scroll continues the moment new rows render; a stalled lazy feed gets a small up-then-down nudge. The scan job is re-read from storage at most every 400 ms, and a sub-five-star row ends the scan only when on-screen ratings really are descending.

### How the scan works

Fudge does not read every review. For each business it sorts the feed by **Highest rating** and scrolls only as far as the five-star block goes:

1. Open the business and its reviews.
2. Select **Highest rating** — both layout families are handled (inline radiogroup in Search Places, sort menu behind a button in Maps).
3. **Verify the sort landed** two ways: the control reports Highest **and** on-screen ratings are non-increasing. The click alone is not trusted.
4. Collect five-star reviews with photos until something below five stars appears — because the order is descending, everything after it rates lower.

After the last business on a page, Fudge follows Google's real `pnnext` link. The next-page checkpoint is written to **Search Progress after the new page loads**, so a failed navigation does not skip a page. If Google reorders results, only the current page restarts and visited Place IDs are skipped. The city completes when the Next control genuinely does not exist or after page 4; a job may also stop earlier once its review target is reached.

Against a 32-review test feed holding 7 eligible reviews, the sorted path reads 12 cards in ~0.7 s where the full-feed fallback reads all 32 in ~6.9 s — and both find the same 7.

### Parallel Google tabs

**Three Places tabs run in parallel by default**; choose 1–6 in Scan settings. Each tab handles a different service keyword and jobs are stored per-id under `scanJobs` so tabs cannot overwrite each other's work. Increasing the limit fills free slots on the next Sheet read; decreasing it stops *new* tabs while scans underway finish. **Stop** ends every running job and closes its tabs. Result pages are capped at four per keyword/city.

Repeated keywords are combined across the entire Structure — three Christmas-light rows source as one nine-review batch with its original priority, and equivalent phrases (`Christmas Light Installation` / `Christmas Lights Installation`) group together.

## 🎯 Review matching

A review must be *about* the thing the keyword names. Fudge never resolves a precise keyword into a catch-all bucket: `toilet replacement` cannot be satisfied by a water-heater review.

- A keyword landing on a **precise subcategory** (`garage door track`, `ac repair`, `cabinet painting`) must match that subcategory.
- A keyword landing on a **family catch-all** is checked against review text — every meaningful word must appear, ignoring action words (repair, replacement, installation, service, fix, new), so `toilet replacement` looks for **toilet**.
- A keyword that simply **names the trade** (`plumbing`, `drywall`, `hvac`) accepts anything in that trade.

Services use flexible signal vocabularies rather than exact phrases — e.g. `window/windows`, `gutter/rainspout`, `carpet/rug`, `light/lights`, `move/moving/movers`, `TV/mount/mounted`, `toilet`, `paint/painter`, appliance names, drywall/outlet vocabulary; furniture assembly (`furniture`, `assemble`, `IKEA`, `wardrobe`, `dresser`); junk removal (`junk`, `haul`, `debris`, `cleanout`); upholstery (`upholstery`, `sofa`, `couch`); pressure washing (`pressure`, power-wash variants); picture hanging (`picture`, `frame`, `hung`, `artwork`, `gallery`). Matching is **stem-aware** (`springs` satisfies `spring`), **no AI call is involved** — the keywords carry the signal on their own.

A business-name match only decides whether Google's topic filter is needed; the review still needs a configured service signal. Garage specialists are the exception: track, spring, and opener reviews are collected together and classified into the correct subsection, but only reviews matching the current requirement count toward the stopping target — a spring review stays inventoried and can never fill a track-only row.

## 🪄 Reviews without pictures

A photo-backed review is always preferred. If Fudge has hunted one keyword for **five minutes** without filling the requirement, it starts accepting complete five-star reviews without photos and writes **"No picture found"** in the picture column so the row is obviously text-only.

## ✍️ Website writer & automatic rephrasing

The dashboard's review detail sheet has a **Website writer** that rewrites a collected review into publishable website copy using OpenAI's `gpt-5.6-luna`.

- **Removes** business names, locations, dates and relative-time phrases, weather references, original phone numbers, and original staff names.
- **Preserves** the reviewer's first-person voice; one replacement name comes from the Names tab.
- The Structure `Service Keyword` is **authoritative**: the prompt converts conflicting season, product, subservice, or related-service details, and the connector rejects leftover conflicting services.
- **Phone handling** — the only real number the writer may produce is yours (entered once in the writer's phone field; several allowed, comma separated). The connector appends one of twelve varied contact lines so wording changes while the number stays exact; an empty phone field produces no number or contact invitation.
- **Local double-check** — every rewrite is checked a second time before it is shown; a leftover business name, date, weather reference, original crew name, or foreign number is flagged for regeneration. "Call today" inside a CTA is understood as marketing language, not a date.
- Rewrites are cached per review and copied with one click; the original review and photos are never modified.

### Automatic rephrasing into the Sheet

Paste or change a review in **Structure → Review** (column E) and Apps Script rewrites it into **M (Rephrased Content)**. If column **L (Numbers)** holds a phone number the rewrite must include it; empty L → no phone number. Any change to Service Keyword, City, Review, Business, or Numbers refreshes the copy; clearing Review clears M. Authorized-edit triggers handle direct Sheet edits, and a one-minute trigger catches pasted/imported or script-written changes. API failures retry with delays (up to three attempts) while permanent key/request errors stop until the row is edited; existing copy stays visible on failure. The checker even distinguishes the word "may" from the month "May", and asks the model to fix one failed draft automatically before reporting an error.

The **Reviews** tab keeps **Website Copy** (column R) and **Phone** (column S) for explicit rewrites from the dashboard — inventory rows are never auto-rewritten, so syncing hundreds of reviews spends no API credits. Rephrasing runs only for filled Structure rows and is deliberately minimal: original wording, order, tone, detail, and approximate length preserved; only prohibited names, locations, dates, weather, phone handling, service terminology, and necessary grammar change.

Rephrasing is independent of Chrome: it runs as you edit, under a lock that can neither time out an extension request nor swallow your edit, with the five-minute trigger as backstop. Status is reported to the side panel and **Fudge → Rephrasing status**; **Fudge → Test rephrasing** sends one row and shows the raw API response; the model is overridable with the script property `FUDGE_OPENAI_MODEL`. The connector also fills new or changed requirements from the unused pool and handles `Change it` QC replacement while Fudge is stopped or uninstalled — collecting *new* reviews from Google still requires the extension.

With connector version 40 or newer, extension syncs submit touched Structure rows for rephrasing in a separate request after the Sheet write returns. This keeps OpenAI response time off the sync's critical path; the Sheet's triggers remain a fallback if that request is interrupted. Older connectors continue to rephrase within the write request until upgraded.

### Setup

Get an OpenAI API key at [platform.openai.com](https://platform.openai.com), refresh the Sheet, choose **Fudge → Set OpenAI API key** (stored in Script properties, never in script source), and deploy the latest connector. If a key was ever kept in `config.js`, remove it and rotate it — extension source files are readable.

## 🗂️ Ready & Used

Every review is **Ready** until you press **Used** on its row, which moves it to the **Used** tab. Nothing is deleted — used reviews stay saved and **Restore** puts them back. Counts, the *Freshly filed* list, *Copy for Sheets*, and *Save to Drive* act on the tab you are viewing, so a published review leaves the working set.

Reviews live in `chrome.storage.local` (survives browser restarts) with `unlimitedStorage`, so a large library is neither capped by quota nor evicted under storage pressure; failed writes are reported rather than passing silently.

## 🎨 Interface & design system

The UI is built from a single design system; `styles.css` is layered in fixed order — fonts, tokens, reset, primitives, side panel, dashboard, utilities — and overrides are never appended below the component layer (change a component or add a token instead). `AUDIT.md` records what was wrong with the previous interface and why each decision was made.

- **Type** — Space Grotesk (wordmark, headings, all numerals) + Inter (UI/body), bundled as variable `woff2` subsets in `assets/fonts/` so nothing is fetched at runtime; nine sizes on one scale, four real weights, 11 px floor, tabular numerals on every counter. See `assets/fonts/LICENSE.md`.
- **Tokens** — 4 px spacing scale, five radii, three-step text ramp, two-step border ramp; every text pairing on both surfaces passes **WCAG AA**.
- **Icons** — one inline SVG sprite per page: 24 px grid, 1.75 stroke, `currentColor`.
- **Side panel** — state-driven scan card (`idle / ready / running / done / error`) with live page, business, and review counts.
- **Dashboard** — 72 px icon rail, sticky toolbar (search, sort, service filters), content-sized grouped tables, detail sheet for long reviews and photos past the fourth.
- **Accessibility** — `:focus-visible` on every control (including the Drive switch), live regions on toasts and tables, `prefers-reduced-motion` and `forced-colors` support.

## 🧱 Project structure

```
Fudge/
├── manifest.json          # MV3 manifest — side panel, content scripts, permissions
├── background.js          # Service worker — scan jobs, automation loop, cooldowns
├── content.js             # Google Maps / Search content script — selectors, sort, scrolling
├── shared.js              # Service catalog & keyword families (extension + tests)
├── sheets.js              # Sheets/Drive connector client & sync engine
├── rewriter.js            # Local QC checker & writer client for the dashboard
├── config.js              # Legacy writer settings (API key intentionally empty)
├── sidepanel.html / .js   # Side-panel UI — start/stop, scan settings, Sheets automation
├── dashboard.html / .js   # Review library — tables, detail sheet, website writer
├── drive-setup.html / .js # Connect page — deployment URL or connection code
├── styles.css             # Layered design system (tokens → primitives → components)
├── apps-script.gs         # Apps Script connector template deployed into your Sheet
├── assets/
│   ├── fonts/             # Bundled variable woff2 subsets + license
│   └── logo.png
├── tests/
│   └── smoke.test.js      # Node smoke tests, zero dependencies
├── AUDIT.md               # UI audit — decisions behind the redesign
└── RELIABILITY-AUDIT.md   # Reliability audit — failure modes and their fixes
```

## 🧪 Testing

```bash
node tests/smoke.test.js
node --test tests/backend.test.js
```

Runs the smoke tests with plain Node — no test framework, no npm install. The suite covers used-data isolation, keyword/trade boundaries, QC replacement, transient-retry behavior, connector-version tolerance, parallel tab-job accounting, batch limits, and more.

The suite reads `REQUIRED_CONNECTOR_VERSION` straight from `sheets.js`, so bumping the connector version never breaks a test that only meant "a current connector".

## 🔁 Updating the Sheet connector

The connector is **Apps Script code living inside your spreadsheet** — `apps-script.gs` in this repo is only the template Fudge copies, and editing it does not change what is already deployed.

1. Side panel → **Change sheet** → **Copy connector**.
2. In your Sheet: **Extensions → Apps Script**, replace all the old code, save.
3. Refresh the Sheet, then **Fudge → Set OpenAI API key** and paste your key.
4. Run `fudgeInstallAutomation` and approve any requested permissions (Fudge reinstalls triggers itself after an update; a **Repair** button appears if it cannot).
5. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.**

The `/exec` URL never changes, so nothing needs re-pasting. Every connector returns `FUDGE_CONNECTOR_VERSION`; when the deployed copy is older, Fudge keeps syncing the tabs that copy understands and the side panel reports *"Sheet connector is out of date"* instead of failing silently. Changing the Google tab limit or check cadence requires no new deployment. Disconnecting via **Change sheet** clears every cache tied to the old spreadsheet (known review IDs, fingerprints, logged businesses), so the next sheet starts clean.

## 🛠️ Troubleshooting & FAQ

**Fudge shows *Paused*.** Google has asked the collector to slow down; new searches wait automatically.

**Side panel says "Sheet connector is out of date".** Follow [Updating the Sheet connector](#-updating-the-sheet-connector) — the deployed Apps Script is an older version than the extension expects.

**Getting `404` from the web app / "secret does not match".** See the [connection sharing](#sharing-someone-elses-extension) table — these mean different things and have different fixes.

**A new Structure row has not started.** New edits are detected on the next check (~every 30 s while Chrome is open); a new search waits if all runner slots are busy. Press **Sync now** to check immediately.

**Does the Sheet fill itself without Chrome?** Yes — the connector fills rows from existing inventory, rephrases filled rows, and handles QC replacement while Chrome is closed. It cannot browse Google; collecting more reviews requires the extension.

**Drive links stay empty.** *Upload originals* is off — reviews stay local. Turning it on uploads in the background so links appear after a later sync.

**A keyword/city is marked `Exhausted`.** Every Google page for that combination has been visited (page limit reached or no next page). The service moves to its next shuffled city automatically; silence means progress, not failure.

**Something was over-collected / wrongly re-visited.** The reliability audit in `RELIABILITY-AUDIT.md` documents each historical failure mode (duplicate sponsored visits, swallowed business clicks, skipped reviews, repeated pages) and the fix built for it.

## 🔒 Privacy

Fudge stores collected review data and Used status **locally in the browser** via `chrome.storage.local`. Data survives closing and reopening Chrome and persists until the extension is removed, its site data is cleared, or a confirmed **Clear unused data** / **Clear Used data** action runs. The existing Sheets connection sends structured review data and selected image URLs to the Apps Script web app deployed inside your own Google account. Optional ND backend sign-in sends credentials only to the pinned shared project's Supabase Auth endpoint; passwords are not stored and user tokens stay in trusted session storage. Backend upload release is currently off. A later approved release plus explicit consent may upload original-field snapshots and author/photo provenance to the selected organization. Queued snapshots/backend copies are separate from library deletion; pause/cancel unwanted pending snapshots first. See [backend privacy/lifecycle details](docs/BACKEND-UPLOADER.md). OpenAI receives text solely during an explicit rewrite/rephrase request, honoring the caching and rules above.

## ⚖️ Responsible use

Fudge automates browsing of Google (Maps/Search) and honors rate-limit pages by **pausing politely rather than circumventing them** — there is no CAPTCHA solving, proxying, or evasion. You are responsible for using Fudge within Google's Terms of Service, applicable law, and the platform account you automate it against. Published rewrites are presented as writer's drafts; you are responsible for what you publish.

## 🧾 Versioning & tags

- Extension version lives in `manifest.json` — current: **`2.0`**.
- Connector template version lives in `apps-script.gs` as `FUDGE_CONNECTOR_VERSION`; the extension's expectation in `sheets.js` as `REQUIRED_CONNECTOR_VERSION`.
- Git releases are tagged `v<version>` matching the manifest (e.g. [`v2.0`](https://github.com/boostera385-afk/fudge/releases)), so a connected Sheet's connector version can always be diffed against the template it came from.

## 📄 License

Copyright © 2026 boostera385-afk. All rights reserved. No open-source license has been attached yet — until one is added, all rights are retained and reuse requires permission. (Planning MIT/Apache-2.0? Open an issue or apply the license of your choice, then update this section and the badge.)

## 🤝 Contributing

This is a personal project — there is no formal contribution process yet. Bug reports and repro steps are welcome via [GitHub Issues](https://github.com/boostera385-afk/fudge/issues); include the extension version from the side panel, the affected service keyword, and (when relevant) the two audit files above for context.

---

<p align="center">
  <sub><b>Fudge</b> — collect once, classify precisely, fulfill automatically.</sub>
</p>
