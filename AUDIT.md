# Fudge 0.24.6 — Complete Extension Audit

Audited October 20, 2026 (originally 0.9.19, October 17, 2026; re-issued through
0.24.6). Scope: Manifest V3 configuration, Google Search/Maps
scraping, five-star stopping logic, classification, duplicate prevention, local
persistence, Sheets allocation and resume behavior, Drive uploads, sidebar/dashboard
bindings, accessibility, and packaging.

## Result

The extension passes all 99 automated regression checks and JavaScript syntax checks.
See `RELIABILITY-AUDIT.md` for the 0.25.0 reliability pass: the single Start/Stop
switch, scan-slot leases, and the Sheet connector's own rephrasing lock, triggers and
failure reporting.
Every file referenced by the manifest exists, every HTML ID is unique, UI scripts are
external/CSP-safe, and all JavaScript-to-HTML bindings resolve.

## Updates since the 0.9.19 audit

- Service rules (0.24.0): the Services tab now owns the Google search term,
  specialist business-name signals, review signals, required and excluded signals,
  Google topic-filter signals, service family, subcategory, strict-topic behavior,
  specialist-family inventory behavior, preferred rewrite phrase, and equivalent
  service phrases. Existing rows receive the trained
  defaults once. New services and later adjustments require only a Sheet edit. The
  extension uses these rules while collecting, and Apps Script reads the same table
  when assigning stored reviews without Chrome installed. Connector version 28 adds
  the expanded Services schema and removes code that forcibly inserted specific
  service rows.
- City distribution (0.24.0): each service receives a stable shuffled order of
  Cities instead of every service starting at the first row. An unfinished
  service/city checkpoint remains pinned until exhausted, then that service moves
  to its next unfinished city. Explicit cities in Structure still take priority.

- Parallel scanning: up to **two Places tabs** run at once, each driven by its own
  per-id job under `scanJobs`, opened a few seconds apart and on different service
  keywords. `scanJob` remains as a mirror of the most recently updated runner so the
  side panel keeps displaying a live job.
- Result pages are capped at **four per keyword/city** in `background.js` and
  `content.js`. The side panel offers 1, 2, 3, or 4 pages, 4 by default, and older
  saved settings of 5 are clamped to the ceiling.
- Google block pages (`/sorry/`, reCAPTCHA, "unusual traffic") are treated as a pause:
  the run stops as *Blocked by Google*, no business is marked visited, nothing is
  marked Exhausted, and a cooldown ladder of 15, 30, 60, then 120 minutes gates new
  jobs. A clean run resets the ladder.
- Website writer (0.23.0): the dashboard detail sheet can rewrite a review into
  website copy through OpenAI `gpt-5.6-luna`, enforcing six privacy rules — no
  business names, no locations (strict, with a self-check before answering), no
  dates, no weather, no foreign phone numbers, the reviewer's first-person voice preserved
  with no "NAME said" narration, and original crew, staff, or business names
  replaced with names from the operator's own crew list. Reviews that name no
  person get one or two names from the list woven in, in list order. Contact
  presentation varies every rewrite — phone woven into a sentence, short closing
  line, "check the card", a private-message reference, or no contact mention at
  all — so ten rewrites never look alike. The phone field accepts several
  numbers, comma separated; every one is allowed by the safety check and foreign
  numbers are still flagged. Every rewrite is checked locally against those
  rules before display; relative phrases such as "call today" are allowed in a
  phone-carrying closing line and flagged only in the review body. The API key
  is stored in Apps Script Script properties. Reviews inventory is never rewritten
  automatically; the Website Copy action runs only when explicitly requested.
- Sheet connector version 34: Structure adds Numbers (L) and Rephrased Content
  (M) and shows `Rephrasing...` in the output cell while a request is running.
  Its prompt and API call live in Apps Script; one authorized edit trigger
  updates M when E or L changes, and a one-minute trigger catches external
  writes and retries temporary failures with backoff. Permanent API errors stop until
  the row is edited, prior content is restored when a refresh fails, and column M stays
  visible without expanding the row. That trigger also assigns queued reviews, avoiding the old
  lock race between two edit handlers. The Sheet's Fudge menu saves the API key
  without editing Script properties. Rephrasing uses strict minimal edits and
  does not polish, expand, or embellish the original. A Names tab supplies first
  names in a saved random cycle, so every name is used before a new shuffled cycle
  begins. The prompt treats the Structure Service Keyword as authoritative
  and converts conflicting season, product, or subservice details, such as holiday
  or Halloween lights becoming Christmas Lights Installation and spring repair
  becoming opener repair when that is the requested keyword. Local validation also
  requires the configured service phrase and rejects configured conflicting services
  left in the draft. Original staff and
  organization names are removed. Contact lines
  use varied, natural patterns derived from the supplied training CSV instead of
  repeated scheduling language. Weather is removed in the prompt and
  checked again locally. Their matchers require installation
  and exterior evidence respectively, keeping repair and interior-painting reviews
  out. Upholstery Cleaning accepts only reviews that explicitly mention a sofa or
  couch, while Carpet Cleaning accepts only carpet, carpeting, or rug reviews.
  Garage-door subcategories are locked so installation reviews cannot fill track,
  spring, opener, cable, panel, or maintenance requirements. Multiple picture URLs in
  one cell are each clickable. Queue fulfillment uses independent `onEdit` plus one-minute triggers
  (runs without Chrome or the extension), formula-injection-safe writes, 21 px locked
  rows, and no automatic column resizing. When the deployed copy is older than the
  extension expects, syncing continues and the side panel reports it as out of date.
- Extension 0.22.8 adds a portable Fudge connection code so another installation
  can reuse the same deployment URL together with its matching private secret.

## Corrections made during this audit

- Expanded Furniture Assembly language to cover assembly verbs, flat-pack/IKEA work,
  wardrobes, dressers, beds and frames, bunk beds, cribs, cots, dining/dinning tables,
  desks, chairs, shelving, bookshelves, drawers, nightstands, armoires, cabinets,
  vanities, patio/office furniture, entertainment units, and storage units.
- Expanded Junk Removal language to cover remove/removed/removal, hauling, cleanouts,
  clearouts, trash, debris, mattress and the common `matress` misspelling, waste,
  rubbish, clutter, dumpsters, disposal, discarded items, and pickups.
- Preserved the specialist-family lock so words such as `moved` or `removed` cannot
  steal a garage-door review for Moving or Junk Removal.
- Fixed Drive photo alignment. A failed first upload no longer shifts the second
  picture's Drive link into the first picture's position.
- Fixed empty Drive selections. Saving zero selected reviews no longer uploads the
  complete library by mistake.
- Persisted each successful Drive upload batch immediately so a later failed batch
  cannot lose already-created Drive links from local state.
- Fixed duplicate merging so Drive links stay aligned when a later copy of the same
  review contains additional pictures.
- Fixed a Sheets/local-storage race that could erase a newly scraped review when a
  Sheet sync finished at the same moment. Sync now merges only Sheet-owned status
  fields into the newest local library snapshot.
- Fixed stale running jobs after Chrome or the runner tab closes. Fudge validates the
  saved tab and resumes from the spreadsheet checkpoint instead of remaining blocked.
- Fixed Stop behavior for automatic jobs. Stop now pauses Sheets automation, and job
  completion honors that switch instead of restarting itself on the next alarm.
- Closed orphan Google runner tabs when startup fails.
- Applied stemming consistently when classifying a specialist review into its precise
  service subsection.
- Cleared every Sheet duplicate cache during legacy-connector migration.
- Protected all Apps Script writes from spreadsheet-formula injection. Review text,
  names, cities and other external strings beginning with `=`, `+`, `-`, or `@` are
  written as text.
- Added Sheet-native queue fulfillment. Manual Structure edits trigger immediately,
  and a one-minute Apps Script clock handles pasted/imported changes, so unused reviews
  can fill requirements and replace `Change it` rows without Chrome or the extension.
- Locked spreadsheet rows to 21 px after setup, manual edits, queue processing,
  appends, and extension writes, preventing multi-line picture links from expanding rows.
- Separated optional clock-trigger installation from normal Sheets and Drive requests.
  Manual edits now use the permission-free bound `onEdit` trigger, so missing ScriptApp
  permission can no longer block review saving or Drive uploads.
- Removed automatic column resizing from connector setup and tab creation. Existing
  user-defined column widths now remain untouched.

## Verified workflow behavior

- Only five-star reviews are retained. Photo requirements keep reviews with customer
  photos; Self Write/Without Picture requirements keep text-only reviews.
- The full review is expanded before extraction, and every discovered attached image
  is normalized to its original-size Google URL.
- Highest sort is confirmed before trusting the first sub-five-star review as the end
  of the useful block. If sort cannot be confirmed, Fudge scans the full feed rather
  than risk skipping five-star reviews.
- Fudge finishes the current business's complete five-star block before checking
  whether the requirement target has been reached.
- Repeated Structure keywords are pooled even when separated by unrelated rows. Each
  requirement is allocated one review plus two unused backups.
- Duplicate detection uses Google review ID, fingerprint, and normalized review text
  plus business/place identity. A duplicate cannot fill two Structure rows.
- QC `Change it` rejects the old inventory row, assigns a different unused review, and
  returns Quality Check to `QC needed`.
- Search resume stores query, page, next-business position, visited place IDs, known
  review identities, and exhaustion. Reordered results restart only the current page
  and skip known businesses.
- Pagination follows Google's real `pnnext` link, waits for late-rendered navigation,
  and never exceeds five result pages.
- Picture links stay one-per-line inside a single Sheet cell.
- Ready and Used data are cleared independently; clearing local data does not delete
  files already uploaded to Drive.

## UI and extension integrity

- Inter and Space Grotesk are bundled locally as variable fonts; no network font fetch
  is required and the type scale has an 11 px hard floor.
- Keyboard focus styles and reduced-motion preferences are present.
- Dynamic review text, names and messages are HTML-escaped before template insertion.
- The manifest uses a fixed extension key for a stable unpacked extension ID and limits
  host access to Google Search/Maps, Google image hosts, and Apps Script endpoints.
- No `eval`, dynamic code execution, or inline executable HTML scripts are present.

## Remaining external risks

These are platform constraints rather than known code defects:

- Google can change private DOM class names or review behavior at any time. Current
  selectors include the supplied Search Places markup and multiple fallbacks, but a
  future Google redesign may require a selector update.
- Chrome may throttle JavaScript timers in a background tab. The scan can run while
  another tab is focused, but foregrounding the runner can make a heavily throttled
  session faster.
- Apps Script and Drive have Google-account quotas. Large photo batches can pause on
  quota or image-fetch failures; Fudge keeps local reviews and completed upload links.
- A Google Workspace administrator may prohibit Anyone-with-the-link sharing.
- Formula-safety and independent Sheet fulfillment require connector version 7. An already deployed older Apps Script copy
  must be replaced and deployed as a new version for that protection to apply.

## Validation performed

- JavaScript syntax checks: `shared.js`, `sheets.js`, `background.js`, `content.js`,
  `dashboard.js`, `sidepanel.js`, `drive-setup.js`, `config.js`, `rewriter.js`, and
  `tests/smoke.test.js`.
- 68 regression tests covering classification, keyword evidence, specialist locks,
  duplicate identity, concurrent persistence, Drive alignment, Structure allocation,
  scattered requirements, QC replacement, Cities/Services behavior, resume,
  pagination, parallel tabs, connector compatibility, DOM bindings, formula safety,
  and the website writer's prompt (all six rules), safety checks, crew-name
  check, and cache.
- Manifest resource, duplicate HTML ID, and extension CSP checks.

