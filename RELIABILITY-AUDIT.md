# Fudge — reliability audit (start/stop, searching, rephrasing)

Audited 2026-10-21 against the working copy at `Fudge (3)/Fudge`, version 0.24.6,
connector version 34. This covers the three complaints only: scans that get stuck or never
start, scans that start on their own, and rephrasing that happens only sometimes.

Every item below is a code path with a file and line, not a guess.

---

## A. Why a scan gets stuck or never starts

### A1 — Stale "running" jobs deadlock the runner permanently *(most likely main cause)*

- `background.js:67-71` prunes old entries from `scanJobs`, but only ones whose status is
  **not** `"running"`. A record stuck at `"running"` is never removed.
- Records get stuck whenever Chrome quits mid-scan, the service worker is evicted during
  startup, or the user closes the runner tab. Nothing closes them out: there is no
  `chrome.tabs.onRemoved` listener anywhere in the extension.
- `background.js:170-172` — `runSheetsAutomation` counts those records and breaks out of
  the start loop as soon as `running.length >= MAX_PARALLEL_TABS` (2).
- The only repair for a dead runner is at `background.js:113-117`, **inside**
  `startAutomaticJob` — which that break guarantees is never reached.

Net effect: two stale records and automation never starts again, on any keyword, forever.
The only recovery is pressing Stop, because `STOP_SCAN_JOB` (`background.js:265-274`) walks
every running job and marks it stopped. The user has no way to know that.

### A2 — The concurrency guards silently swallow the user's click

- `background.js:146` — `if (automationRunning) return { ok: true, skipped: ... }`
- `sheets.js:262` — `if (syncing) return { ok: true, skipped: ... }`

The 1-minute alarm (`background.js:28`, `background.js:200`) means a sync is in flight a
large fraction of the time. A click landing there gets the skip object, which carries no
`startedJob`, so `START_NEXT_JOB` falls through to its last branch and answers **"No
Structure rows are waiting for reviews right now."** (`background.js:356`). That is false,
nothing is queued, and nothing retries.

### A3 — One exhausted keyword blocks every keyword after it

`sheets.js:694-700`, in the job-selection loop:

    const target = resolveTarget(deficit);
    if (!target) { exhaustedEverywhere.push(deficit.service); break; }

A keyword whose cities are all marked Exhausted aborts the **whole remaining list**. Add a
new keyword below an exhausted one in Structure and it is never searched. This is exactly
"the keywords we added don't start". The comment says the stop is deliberate, but it blocks
unrelated keywords, not just that batch.

### A4 — The runner-tab handshake fails quietly and then lies about why

- `background.js:131-139`: after `waitForTab` returns (tab status `complete`), background
  sends `FUDGE_START_SCAN` three times, 650 ms apart, then gives up.
- Content scripts are declared `run_at: "document_idle"` (`manifest.json`), which on a cold
  Google results page regularly lands after that ~2 s window. All three attempts miss.
- The resulting throw is swallowed by `.catch(() => null)` at `background.js:174`, so it
  surfaces as the same false "No Structure rows are waiting" message as A2.

### A5 — The service worker can die mid-start and orphan a tab

`waitForTab` (`background.js:87-96`) and the retry loop poll with `setTimeout`, which does
**not** keep an MV3 service worker alive. If the worker is evicted there, the Google tab
stays open, the job record stays `"running"` (feeding A1), and the start message is never
sent.

---

## B. Why it "starts working whenever it wants"

### B1 — Three independent starters, two of which switch on permanent automation unasked

| Starter | Code | Effect |
|---|---|---|
| 1-minute alarm | `background.js:28`, `200` | Opens Google tabs on its own whenever `sheetsAutomation` is true |
| Start button (`START_NEXT_JOB`) | `background.js:345` | Writes `sheetsAutomation: true` **before** running |
| Connecting the sheet | `sheets.js:126`, `background.js:318` | Writes `sheetsAutomation: true` |
| Job completion | `background.js:296-299` | Re-arms itself 3.5 s after each job finishes |

So pressing Start once, or connecting a sheet once, silently enables a perpetual background
loop that opens tabs minutes or hours later. The side panel's "Automatic fulfillment"
toggle is the real switch, and nothing tells the user that Start flips it.

### B2 — Stop does not reliably stop

- `background.js:271` — `if (last?.auto) await setLocal({ sheetsAutomation: false })`.
  Pressed with nothing running, `targets = [null]`, the patch lands on whatever `scanJob`
  happens to mirror, and if that mirror is not an auto job, automation stays **on** and the
  alarm reopens tabs a minute later.
- The Stop button only exists while `scanJob` reads `"running"` (`sidepanel.js:56-64`,
  `renderJob`). `scanJob` is only a mirror of the most recently updated job
  (`background.js:56-73`), so with two parallel tabs it can show the finished one — hiding
  Stop while the other tab is still scanning.

---

## C. Why rephrasing is a lottery

### C1 — Automatic rephrasing depends on a trigger nothing installs for you

`processStructureRewrites_` runs from exactly two places: `fudgeRewriteOnEdit`
(`apps-script.gs:1180`) and `fudgeProcessQueue` (`apps-script.gs:1189`). Both triggers are
created by `ensureAutomationTriggers_` (`apps-script.gs:1152`), which is called from one
place only — `fudgeInstallAutomation` (`apps-script.gs:1200`), a function the operator must
select and Run by hand in the Apps Script editor. Neither `setup_()` nor `doPost` ever
calls it.

If that step was skipped, or the code was re-pasted and redeployed without re-running it,
or Google auto-disabled the trigger after repeated failures, **there is no automatic
rephrasing at all** — and nothing in the extension or the Sheet says so.

### C2 — Rows the extension fills can only be rephrased by the clock trigger

Edit triggers do not fire for the connector's own `batchWrite_` writes. So Structure rows
filled by the extension depend **entirely** on the 1-minute `fudgeProcessQueue`. When that
single trigger is missing or disabled, hand-typed edits still rephrase while
extension-filled rows never do. That asymmetry is the "sometimes it rephrases" pattern.

### C3 — A 1-minute trigger doing OpenAI calls burns the daily script quota

`fudgeProcessQueue` fires every minute and rewrites up to 12 rows per run
(`apps-script.gs:1058`, `limit || 12`), each run blocking on `UrlFetchApp.fetchAll`.
Consumer Google accounts get roughly 90 minutes of **total** script runtime per day. Tens
of seconds per minute exhausts that well before the day is over, after which every trigger
stops until the quota resets — silently.

### C4 — The rephraser and the extension fight over the same script lock

- `doPost`'s `read` / `batchWrite` / `appendRows` take `withLock_`, i.e.
  `LockService.getScriptLock()` with `waitLock(30000)` (`apps-script.gs:53-58`, `76-80`).
- `fudgeProcessQueue` and `fudgeRewriteOnEdit` take the **same** script lock
  (`withAutomationLock_`, `apps-script.gs:84-92`) and hold it for the whole OpenAI batch.

Consequences, both observed symptoms:

- A sync arriving during a rewrite batch waits 30 s, throws, and the extension reports a
  connector error → **"sometimes it gives errors."**
- `fudgeRewriteOnEdit` waits only 5 s (`apps-script.gs:1186`) and then returns
  `{ skipped: true }` with no message at all, so **the user's own edit is dropped
  silently** whenever the clock trigger holds the lock.

### C5 — Failed rephrases are written as if they succeeded *(main rephrasing cause)*

`rewriteTexts_` turns **every** failure, HTTP errors included, into a success
(`apps-script.gs:983-997`):

    } else results[index] = { ok: true, result: writerFallbackResult_(job, evaluated.copy, evaluated.error) };

`processStructureRewrites_` then writes that fallback into column M **and stamps the
success note** (`apps-script.gs:1134-1140`), so the row is never looked at again. The
fallback is the original review with local scrubbing applied — which reads exactly like
"it didn't rephrase."

The retry/backoff machinery (`writerRecordStructureFailure_`, `writerFailureNote_`) is
effectively dead code on this path: it only runs if `rewriteTexts_` itself throws.

### C6 — The model id is hardcoded, and a rejected request is invisible

`writerSettings_` (`apps-script.gs:304-312`) returns no `model`, so `writerFetchOptions_`
always sends `"gpt-5.6-luna"` (`apps-script.gs:876`) together with `temperature: 0` and
`reasoning_effort: "none"`. If that model id or that parameter combination is rejected for
the key in use, every row 400s — and by C5 the result looks like a successful
non-rephrase. Worth verifying against the account that owns the key; the Fudge menu can set
the key but cannot test it.

### C7 — Smaller rephrasing issues

- `writerSettings_().enabled` is never consulted by `processStructureRewrites_`
  (`apps-script.gs:1059` checks only `.key`), so the Writer-enabled switch does nothing for
  Structure rephrasing.
- Failures live only in a cell note and the Apps Script log. Nothing in the side panel or
  the Sheet reports "rephrasing is broken".
- `config.js` still ships `model: "gpt-5.6-luna"` on a legacy path with an empty key — dead
  config that invites confusion about where the model is set.

---

## D. Fix plan

### D1. One explicit switch, one owner (the start/stop you asked for)

- Replace `sheetsAutomation` with a single `runState`: `"stopped" | "running"`.
- The side-panel button is the only thing that writes it: **Start** → `running`,
  **Stop** → `stopped`. Remove the separate "Automatic fulfillment" checkbox, or demote it
  to a read-only status line.
- Connecting a sheet and completing a job must never write `runState` — they currently do
  (`sheets.js:126`, `background.js:318`, `background.js:345`).
- The alarm acts only when `runState === "running"`.
- Stop becomes unconditional: mark every job in `scanJobs` stopped, close every runner tab,
  set `runState: "stopped"` — drop the `if (last?.auto)` condition at `background.js:271`.
- Show Stop whenever **any** job is running, not just when the `scanJob` mirror is
  (`sidepanel.js:56-64`); drive the panel from `scanJobs`, not the mirror.

### D2. Make stale jobs impossible

- Give each running job a `leaseUntil` that the content script renews; treat an expired
  lease as dead.
- Validate tab liveness **before** the parallel-slot check in `runSheetsAutomation`
  (`background.js:170`), not inside `startAutomaticJob`.
- Add `chrome.tabs.onRemoved` to close out the job owning that tab.
- Prune `"running"` records older than the lease in `updateScanJob` (`background.js:67-71`).

### D3. Never swallow a manual start

- Have `runSheetsAutomation` and `sync` return the **in-flight promise** instead of
  `{ skipped }` (`background.js:146`, `sheets.js:262`), so a click waits for the current run
  and then acts.
- Make `START_NEXT_JOB` report the real reason: handshake failure, Google cooldown
  (`blockedUntil`), connector error. The "No Structure rows are waiting" message must only
  appear when that is actually true.

### D4. Fix job selection

- `continue` instead of `break` at `sheets.js:697`, so an exhausted keyword is reported but
  the rest of the list is still considered.

### D5. Fix the handshake

- Have the content script announce itself (`FUDGE_CONTENT_READY`) and have background wait
  for that, up to ~15 s, instead of three blind sends (`background.js:131-139`).
- Keep the worker alive across that wait with a port or an alarm rather than `setTimeout`.
- Optionally add the `scripting` permission and inject on demand, which removes the
  `document_idle` race entirely.

### D6. Fix the Apps Script side

- Install the triggers automatically: call `ensureAutomationTriggers_` from `setup_()` or a
  dedicated `installTriggers` action, so no one has to run anything by hand.
- Return the installed-trigger list and the last writer error from the connector, and show
  "Rephrasing trigger missing / last error" in the side panel.
- Split the work: keep the 1-minute trigger for queue assignment only (no network calls),
  and give rephrasing its own slower trigger (e.g. every 5 minutes, batch of 5) so the daily
  runtime quota survives.
- Stop sharing one lock (`apps-script.gs:76`, `84`): the rephrase path should use a
  different lock than the connector's read/write path, so a rewrite batch can never time out
  a sync and a sync can never drop an edit.
- **Stop writing fallback copy as success** (`apps-script.gs:983-997`, `1134-1140`): keep
  the previous content, record the real failure, and let the existing backoff retry it —
  which is what `writerRecordStructureFailure_` was built for.
- Make the model a Script property (`FUDGE_OPENAI_MODEL`) and add a Fudge-menu
  "Test rephrasing" that rewrites one row and shows the raw API error.

Ordering suggestion: **A1/D2 and C5/D6 first** — those two alone account for most of the
"stuck" and most of the "didn't rephrase". Then D1 (the single Start/Stop), then D3–D5.

---

## E. What was changed (0.25.0, 2026-10-21)

Every item in sections A–C is addressed below. The suite is at 99 passing checks,
including eleven new ones written for these fixes.

### Start and stop

- **One switch.** `runState` (`"running"` / `"stopped"`) replaces `sheetsAutomation`
  as the only thing that decides whether Fudge may open Google. Existing
  installations are migrated once on upgrade, so a setup that was collecting keeps
  collecting and a paused one stays paused.
- Only **Start collecting** and **Stop collecting** write it. Connecting a sheet
  (`sheets.js` `configure`, `ensureDatabase`), syncing, and finishing a job no
  longer turn collecting on.
- The alarm checks it before doing anything, so a stopped Fudge does not even sync.
- **Stop is unconditional**: it switches collecting off first, then ends every
  recorded runner and closes its tab. The old `if (last?.auto)` condition is gone.
- The side panel shows **Stop** whenever collecting is on, not only mid-scan, and
  reads the runners the service worker has just verified rather than the `scanJob`
  mirror. The "Automatic fulfillment" toggle is now a Running/Stopped status line.

### Getting stuck (A1, A2, A4, A5)

- Running jobs carry a **lease** (`JOB_LEASE_MS`, four minutes) that the runner tab
  renews every 45 seconds. A lapsed lease, or a tab that is gone, releases the slot.
- `liveRunningScanJobs()` is the single answer to "how many runners are really
  working", and it is consulted **before** the parallel-slot check, so a dead record
  can no longer block the very code that would have cleared it.
- `chrome.tabs.onRemoved` ends the job belonging to a closed tab, and
  `chrome.runtime.onStartup` releases everything left over from a previous Chrome.
- Stale `"running"` records are now pruned like finished ones.
- `runSheetsAutomation` and `SheetsService.sync` **serialise** instead of returning
  "already running": a scheduled pass may still be skipped, a run a person asked for
  never is.
- The runner tab is driven by a readiness **ping** (`FUDGE_PING`) with a 25-second
  budget instead of three blind sends over two seconds, and the content script
  answers a repeated start with its live job rather than registering a second one.
- Tabs opened but never claimed (worker evicted mid-handover) are closed on the next
  pass instead of accumulating.
- The Start button now reports the real reason — handshake timeout, Google cooldown,
  already running, every city exhausted, or a genuinely full Structure — and
  "No Structure rows are waiting" is gone.

### Keyword selection (A3)

- An exhausted keyword no longer aborts the queue (`break` → `continue`). It keeps
  its place and is still reported in `exhaustedEverywhere`, and the keywords after
  it are searched meanwhile.

### Rephrasing (C1–C7)

- `installAutomation` is a connector action the extension calls right after setup,
  and every sync that finds a trigger missing tries once to put it back. Nobody has
  to open the Apps Script editor; `fudgeInstallAutomation` remains as a fallback.
- Rephrasing runs under **its own lock** (`withWriterLock_`, a document lock), so a
  rewrite batch can no longer time out a connector request — the
  *"Lock timeout: another process was holding the lock for too long"* error — and a
  sync can no longer make the Sheet drop an edit you just made. That message is also
  translated into something true and reassuring if it ever appears again.
- Rephrasing has its own **five-minute trigger**, and the one-minute queue clock is
  rate-limited to the same cadence, so the account's ~90 minutes of daily script
  runtime is no longer spent on OpenAI calls once a minute.
- **A failed rephrase is recorded as a failure.** The locally repaired draft is still
  written when the cell would otherwise be empty (a rewrite that already passed its
  checks is never downgraded), but the row keeps a failure note, so the existing
  backoff retries transient errors and a permanent one is only paid for once.
- The real API message is kept in `FUDGE_LAST_WRITER_ERROR` and surfaced in the side
  panel, with a **Repair** button for missing triggers.
- The model is overridable with the script property `FUDGE_OPENAI_MODEL`, and a
  model that refuses `temperature` / `reasoning_effort` is retried without them
  instead of failing every row.
- The Sheet's Fudge menu gained **Install automatic rephrasing**, **Test rephrasing**
  (sends one row and shows the raw API response) and **Rephrasing status**.
- Connector version 35; the extension requires it and reports an older deployment as
  out of date, as before.

### Businesses opened and closed without being read

- `REVIEWS_APPEAR_MS` 4s → 7s, and a business that does not open is **closed and
  retried once** before being written off as "Reviews unavailable".
- The topic carousel gets a longer settle window (3.2s → 6.5s) and, when a
  topic-strict keyword finds no chips at all, it is re-read once with a fresh window
  before the business is skipped. A genuinely absent topic filter still skips, as
  before; a slow one no longer does.
- When the topic list never rendered, the stage says so, so this is visible in the
  side panel rather than looking like a deliberate four-second glance.

### Left as they are, deliberately

- `FUDGE_WRITER_ENABLED` still does not gate Structure rephrasing. It belongs to the
  dashboard's Website Copy writer; making Sheet rephrasing depend on it would change
  behavior people rely on.
- `config.js` keeps its legacy `FUDGE_AI` block. `rewriter.js` refuses to run without
  an API key there, which is the intended disabled state, and the normal path uses
  the connector.

---

## F. Instant rephrasing, manual buttons, and quiet retries (0.25.1)

### Rephrasing now happens on the spot

Rephrasing no longer waits for a clock in any path that actually changes a row:

- **You edit a review in the Sheet** → the edit trigger rephrases that row
  immediately (as before, but now under the writer lock, so it can no longer be
  dropped while something else holds the connector's lock).
- **The extension fills a row** → `batchWrite_` reports the Structure rows it
  touched and `doPost` rephrases exactly those rows in the same request, the moment
  the connector's lock is released. A script write fires no edit trigger, so these
  rows previously depended entirely on a clock — this is the change that removes the
  wait people actually noticed.
- **The Sheet fills a row by itself** (no Chrome) → `processQueue_` reports the rows
  it filled and they are rephrased in the same run, on the `read` path, on the
  one-minute trigger, and on a manual run.

The instant pass is capped at `FUDGE_INSTANT_REPHRASE_LIMIT` (10 rows) so pasting a
hundred rows cannot stall one request; the remainder is picked up immediately after.
Rows already up to date are skipped by note comparison, so a wide block costs sheet
reads, not OpenAI credits. The rephrase always runs **outside** the connector's
script lock, so instant rephrasing cannot reintroduce the lock timeout it replaced.

The only remaining wait is a row pasted or imported into the Sheet while Chrome is
closed: nothing fires for it, so the one-minute queue trigger catches it. The
five-minute sweep is now only a backstop for rows nothing touched.

### Manual buttons beside every automatic trigger

Everything still runs automatically. These do the same work on demand and skip every
cooldown, because pressing a button should not be answered with a wait.

- Side panel, under *Sheets automation* → **Fill rows now** and **Rephrase now**,
  plus the existing **Sync now** and **Repair**.
- The Sheet's own **Fudge** menu → **Rephrase now**, **Fill rows now**,
  **Set OpenAI API key**, **Install automatic rephrasing**, **Test rephrasing**,
  **Rephrasing status**.
- Connector actions `processQueue` and `rephraseNow` back both of those.

### Conditions that clear themselves are no longer errors

A Sheet busy rephrasing, Google throttling (429/5xx), a request that outran its
deadline, a dropped connection and a runner tab that was slow to come up are all
things Fudge is about to retry by itself. They are now reported as a plain notice in
the status line — *"…Fudge will try again on its own"* — instead of
**Needs attention**, and the Start button presents them as a retry rather than a
failure. Real problems (404 on the deployment, a wrong secret, a missing key, an
out-of-date connector) still read as problems, because those need a person.

The two pacing delays that remain are deliberate and protect you from Google's rate
limiting: four seconds between opening the two parallel scan tabs, and three and a
half seconds between finishing one keyword and starting the next.

---

## G. Final verification pass (0.25.3)

Four independent checks now cover this work, and all of them are green.

1. **Syntax** — all eleven JavaScript files, `apps-script.gs` included, parse.
2. **Static project check** — manifest resources exist; no duplicate HTML ids; no
   inline scripts or handlers (extension CSP); every `querySelector("#…")` on all
   three pages resolves; every message the UI sends has a handler; every
   `SheetsService.x()` call exists in the exports; every Apps Script helper, trigger
   target and menu target is defined; nothing serialises a live Sheet object; the
   connector and extension agree on version 35.
3. **Connector driven end to end** — `setup`, `installAutomation`, `read`,
   `batchWrite`, `processQueue`, `rephraseNow`, `status`, an unknown action and a
   wrong secret, all against a fake spreadsheet. This proves the queue fills a
   waiting row during a read, that the filled row **and** a row written by the
   extension are each rephrased inside that same request with no trigger involved,
   and that no live object leaks into the JSON.
4. **103 smoke tests**, including a sheet shaped like a real operator's: every row
   `Self Write`, the City column empty and no Cities tab. That still queues work.

### Two further defects found and fixed during this pass

- **A sync that could not read the Sheet was reported as an empty queue.** A
  self-clearing failure returns `ok: true` with no job list, so the Start button fell
  through to *"Every Structure row is filled, so there is nothing to collect"* — the
  opposite of what had happened, and exactly the kind of message that sends someone
  hunting through their Sheet for a problem that is in the connection. It now
  reports the real reason and marks it as a retry.
- **The same mistake in three more places**: "Sync now" said *"Fudge database
  synced"* for a sync that was skipped, and both connect paths reported plain
  success. All now distinguish *synced* from *not read yet*.

### Known, accepted limits

- A row pasted into the Sheet while Chrome is closed waits for the one-minute queue
  trigger; nothing fires for it, so there is nothing faster to hook.
- In a hidden or minimized tab, `waitFor` still sees everything (it runs on DOM
  mutations), but the pacing `sleep` calls between steps are timers, so a background
  scan is slower than a visible one. Correct either way.
- `waitForPlaceIdentitySettled` and the two "settled" loops still sample on a timer.
  Their verdicts are discarded by every caller, so no business is skipped on them,
  and throttling makes them wait longer rather than less — safe in that direction.

---

## H. Start latency (0.25.5)

**Reported:** pressing Start takes a noticeable moment before anything opens.

**Cause.** The click waited for a *complete* read of the Sheet before a tab was even
created: `START_NEXT_JOB` → `runSheetsAutomation` → `SheetsService.sync()` → only
then `chrome.tabs.create`. A sync reads Structure, Reviews, Search Progress, Cities
and Services, tops up headers, appends new reviews and writes every Structure row
back. Section F made it worse: the connector's `read` also filled the queue and
rephrased those rows inline, so the person pressing Start was waiting on OpenAI.

**Fixed, two ways.**

- **Start no longer waits for a sync.** The previous sync already worked out which
  keyword comes next, so Start opens the tab from that straight away and runs the
  fresh sync alongside it. A job list older than fifteen minutes is not trusted —
  there, Fudge still reads the Sheet first rather than scan for something that may
  already be done.
- **`read` no longer rephrases.** It is the one call the extension waits on with a
  person watching. The rows the queue fills during a read are written straight back
  by that same sync, and `batchWrite` rephrases them then — still instant, but off
  the path someone is waiting on. Sheets with no Chrome are unaffected: their
  one-minute queue run still rephrases what it fills, immediately.

**What remains, and cannot be removed.** Opening a Google results page and waiting
for its content script costs roughly two to five seconds. That is the page loading,
not Fudge deciding. The side panel shows *Opening Google Places* throughout.

Also fixed in this pass, both noticed earlier and set aside as minor:

- Rows to rephrase arrive scattered — the row someone edited plus whatever the queue
  filled elsewhere. One block was read from the first to the last, pulling in every
  row between them. Neighbours are now grouped and each group read on its own.
- The four-second pause between opening two scan tabs was taken after each job
  instead of between them, so every run ended with a wait for a tab that was never
  going to open.

---

## I. Collecting stopped after one run (0.26.0)

**Observed:** a run finished — 8 businesses, 63 new reviews, four Structure rows
filled — then no further tab opened. The switch still read *Running* and the panel
sat on *looking for the next requirement*, with the database line repeating
*"The Sheet was busy rephrasing, so this sync was skipped."*

**Cause, in three layers.**

1. `doPost`'s `read` ran `processQueue_()` **inside** the hard script lock
   (`apps-script.gs`, previously line 140). On a sheet with a hundred reviews and
   forty requirements that matcher is not quick, and the one-minute queue trigger
   runs the same work under the same lock. The two collided every minute and the
   extension's read waited thirty seconds and gave up.
2. A sync that cannot read carries no job list, and the runner stopped there. So a
   single unreadable minute ended the whole collecting loop: the finished run was
   never replaced.
3. The retry status **overwrote** the last good sync, destroying the job list that
   could have kept it going.

**Fixed.**

- **A read can no longer fail on a lock.** `withSoftLock_` takes the lock if it is
  free and reads either way; the queue only runs when the lock was free, which costs
  nothing because the extension allocates from the same pool itself moments later.
  At worst a read sees the sheet mid-update, which the next sync corrects.
- Writes keep a hard lock, waited out to 45 seconds — losing a write is worse than
  waiting for one.
- **Collecting carries on from the last known job list** when a sync cannot be read,
  so a Sheet hiccup no longer ends the loop.
- **A retry preserves the last good sync** instead of replacing it.

**Connector version 36.** Version 35 was given several different behaviours during
this work without the number changing, so a deployed copy could not be told apart
from another. That was a mistake; the number moves with behaviour from now on.

---

## J. The root cause, fixed once (0.26.1, connector 37)

Sections A–I fixed symptoms one at a time. This is the thing that kept producing
them.

**The Sheet and the extension were both allocating reviews to Structure rows.** Same
rows, same pool, same lock, both on a one-minute clock:

- `sheets.js` — `unfilled.forEach(...)` picks a matching review for every empty row.
- `apps-script.gs` — `processQueue_` does exactly the same job.
- `background.js` alarm: every minute. `fudgeProcessQueue` trigger: every minute.

That duplication is where the lock timeouts came from, which is what stopped a read
getting through, which is what left the extension with no job list, which is what
stopped collecting after a single run. Softening the locks treated the symptom.

**Only one of them allocates at a time now.** A `read` is the extension announcing
itself, and the Sheet stands down from allocating for three minutes afterwards. It
keeps rephrasing throughout — that is its own job and the extension never does it.
When Chrome closes or Stop is pressed, the extension stops syncing, the mark goes
stale and the Sheet picks the work back up by itself. No setting, no decision.

### The rest of the class, checked rather than waited for

- **Structure cells** — the connector only writes them from `processQueue_`, which
  no longer runs while the extension is driving. The extension writes `A:K`, leaving
  Numbers and Rephrased Content untouched.
- **Reviews status** — both sides write it, and that was already conflict-free by
  design: `STATUS_RANK` only ever lets a status move up the ladder.
- **Clocks** — the connector's one-minute trigger now defers, the five-minute
  rephrase sweep touches nothing the extension owns, and the extension's alarm is
  the only allocator while Chrome is open.

### Also corrected here

Tests read the connector version from the source instead of hard-coding it, so a
version bump can no longer fail a test that only meant "a current connector". That
brittleness produced one of this session's false alarms.

---

## K. Updated At churn, and the slowness behind it (0.26.2)

**Observed:** the Updated At column changes three or four times per keyword, and
everything feels slow.

**Cause — one line each.**

- `sheets.js`: every *unfilled* row was stamped `row[10] = now()` on every sync,
  whether or not anything had happened to it. Still waiting and still waiting is not
  a change.
- `sheets.js`: `structureState.forEach((state) => updates.push(...))` wrote **every**
  Structure row back on **every** sync. With forty rows and a sync every minute,
  plus one after each finished scan, that is the three or four rewrites per keyword.

That is also most of the slowness, because each written row makes the connector
reformat it, re-link it, and — since the instant-rephrase work — re-read it and its
note to decide nothing needed rephrasing. A sync that changed nothing still rewrote
and re-read the whole tab.

**Fixed.** Each row is snapshotted as it is read, and only rows that genuinely differ
are written. `Updated At` is stamped at that moment and only then, so it now means
"when this row last changed" rather than "when Fudge last looked at it". A sync where
nothing happened writes nothing at all.

### Scan speed: a trade-off from section F, narrowed

Section F widened the review-panel budget from four seconds to seven and added a
full reopen before giving up on a business. That fixed businesses being closed while
still loading, but it also meant a business with genuinely no reviews cost about
sixteen seconds instead of four, on every one of them.

`openReviews` now reports *why* it failed. If a Reviews control appeared but its feed
did not, the business was clearly loading and still gets its second try. If nothing
appeared at all — no feed, not even a control — it is taken at its word and skipped
immediately. Slow businesses keep the fix; empty ones stop paying for it.

Both openers now answer in one shape (`{ opened, lifeless }`), and the project check
fails if either returns a bare boolean again — a crash caught in this pass, before it
shipped, when one early return still did.

---

## L. "A listener indicated an asynchronous response…" (0.26.3)

**Observed:** the card shows *Retrying* with
*"A listener indicated an asynchronous response by returning true, but the message
channel closed before a response was received"*, and the run stops.

**Cause.** After **every completed business** the runner sent `SCAN_JOB_UPDATE` and
waited for the answer. The handler replied only after
`await Promise.allSettled([recordProgress, recordBusiness])` — two network round
trips to Apps Script. While the connector is busy those are slow, and if the service
worker was evicted in the meantime the channel closed with no reply. The rejection
reached `runJob`, whose catch ends the scan. One slow write after one business ended
the entire run.

**Fixed, three ways.**

- **The runner is answered first.** The Sheet writes happen afterwards and are not
  waited on. A checkpoint that does not make it is written again by the next
  business and by the job's completion, so nothing is lost that matters.
- **Every message handler now guarantees a reply.** Four of them —
  `SCAN_JOB_START`, `GET_SCAN_JOB`, `RUN_SHEETS_SYNC`, `OPEN_SHEETS_DATABASE` —
  returned `true` with no `catch`, so any throw closed the channel silently. A test
  now walks every handler in `background.js` and fails if one lacks a catch.
- **A dropped message no longer ends a scan.** `updateJob` and `finishJob` tolerate a
  failed send and carry on with what the tab already knows. Losing one progress
  update is nothing next to abandoning the run.

This also removes two Apps Script round trips from the critical path of every
business, which is a direct speed gain on top of section K.

---

## M. The same messaging error, after the first fix (0.26.4)

Section L fixed `SCAN_JOB_UPDATE` and it was not enough. Two reasons.

**1. One message was still uncaught.** `SAVE_REVIEWS_TO_DRIVE`, in `saveBatch` —
the slowest message Fudge sends, because the worker uploads every picture to Drive
through Apps Script. When that outlives the channel, or the worker is evicted
mid-upload, the send rejects into the scan loop and ends the run. Over pictures,
which are a nice-to-have, and after the reviews are already saved locally.

Fixing one call at a time is how this came back, so both the project check and the
suite now walk **every** `chrome.runtime.sendMessage` in `content.js` and fail if
any one of them lacks a catch.

**2. Reloading the extension does not reload the content script in an open tab.**
It orphans it: the old code keeps running, and `chrome.runtime.id` disappears
underneath it. So after a reload, a runner tab that was already open carries on with
the old, unfixed script — and produces the identical error. The runner now detects
this and stops cleanly instead of looping against a runtime that is gone.

**Also:** a messaging failure is no longer dressed up as a scan failure. It reports
*"Paused — Fudge was reloaded. Press Start to continue."* and keeps the business
index, rather than the red *Stopped with an error*.

### What this means in practice

After reloading the extension, **close any Google tabs Fudge had opened**. They are
running the previous version until they are closed, whatever the version number in
the side panel says.

---

## N. Connecting should just connect (0.26.5)

**Observed:** pasting the deployment URL answers with a paragraph of instructions
about secrets, connection codes and redeploying, and does not connect.

**Cause.** An installation holds up to three of its own secrets —
`appsScriptSecret`, `appsScriptSecretBackup` and `appsScriptSecretOwn` — and
`configure()` only ever tried one of them. A connector deployed earlier by this very
installation answers to one of the others, so Fudge had the right secret in storage
the whole time and still asked the operator to re-copy and redeploy the connector.

**Fixed.** Connecting now tries every secret this installation holds, in turn, and
connects with whichever the deployment answers to — keeping it as the current one.
Only a mismatch is worth trying the next candidate for; a 404, an authorization page
or an unreachable connector is reported immediately, because it would be identical
whichever secret was used.

Every secret the setup page has ever shown is also kept in
`appsScriptSecretHistory` (ten deep, and `disconnect` leaves it alone, as it already
does for `appsScriptSecretOwn`), so regenerating a secret can never strand a
deployment that is working.

**And when it genuinely cannot connect** — a deployment baked by a different
installation — the message is now one short line instead of a paragraph. The long
explanation stays on the setup page, where there is room for it.

---

## O. The same city, over and over (0.27.0)

**Observed:** Fudge searches one city — Azusa, CA — and never moves to the next. It
searches it again, and repeats pages and businesses within it.

**Two separate causes.**

**1. A started city was pinned to its keyword until it was "exhausted".** Exhaustion
is only recorded when a scan runs out of results or hits the page cap
(`background.js`: `/end of results|page limit reached/`). Every other ending — target
reached, stopped by the user, blocked by Google, interrupted, an error — left the
city unexhausted, and `resolveTarget` then chose that same city for ever. The rest of
the Cities tab was unreachable.

Cities now take turns. A city nobody has searched comes first, in the keyword's own
stable shuffled order, so the list is covered before anything is revisited; after
that the city left alone longest goes next. Nothing is lost, because each city keeps
its own checkpoint and resumes exactly where it stopped when its turn comes round.

**2. Checkpoints could move backwards, and interrupted runs never saved one.**
Progress is written from several places, some with a job record that has been in
storage a while, and a stale one could overwrite a newer position — so the next run
walked pages and businesses it had already done. A run that ended by being
interrupted (tab closed, worker evicted, Chrome restarted) recorded nothing at all.

`recordProgress` now refuses to move a checkpoint backwards, merges visited
businesses rather than replacing them, and an interrupted runner saves its place on
the way out. Because the no-regression rule is enforced inside `recordProgress`, a
stale record cannot undo newer progress no matter which path writes it.

---

## P. Picture links: one shape only (0.28.0, connector 38)

**Wanted:** `https://drive.google.com/file/d/FILE_ID/view?usp=sharing`, and nothing
else. Not the scraped `lh3.googleusercontent.com/...` URL, not
`drive.google.com/uc?export=view&id=...`.

**Where the other shapes came from.**

- The connector returned `directLink` (`uc?export=view`) and `viewLink`
  (`/view?usp=drivesdk`), and the Reviews *Drive Picture Links* column was built
  from `directLink || viewLink`.
- Structure *Picture Links* fell back to the scraped URL whenever a review had no
  Drive copy: `candidate.driveLinks.length ? candidate.driveLinks : candidate.originalLinks`.
  That URL expires and is not a link anyone can be given.

**Fixed.**

- `Fudge.driveShareLink()` turns any Drive reference — `uc?export=view&id=`,
  `open?id=`, `/file/d/…/view?usp=drivesdk`, or a bare file id — into the sharing
  form, and returns nothing for a googleusercontent URL, which is not a Drive link.
- The connector now also returns `shareLink` in that exact form. `directLink` stays,
  because the dashboard's `<img>` needs the bytes rather than the viewer page.
- Reviews *Drive Picture Links* and Structure *Picture Links* are written from it,
  so both columns carry one shape.
- Links already in the sheet are rewritten on the next sync: the Reviews J/K pass
  normalises them, and any already-filled Structure row whose review has Drive links
  is brought into line. A row whose pictures never reached Drive is left as it is
  rather than emptied.
- **Nothing falls back to the scraped URL.** Where a review's pictures have not
  reached Drive, the cell stays empty and `catchUpDriveUploads()` uploads them in
  the background on the next pass — bounded to twenty reviews and never waited on.
  Before this, a failed upload left that cell wrong for good, because uploading only
  ever happened during the scan that collected the review.

*Original Picture Links* still holds the scraped URLs. That column is the record of
where a picture came from, not a link to hand out.
