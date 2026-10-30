# ND room — two-machine setup and operation

Written 2026-10-30 for the two machines in the ND room after the four reported
issues (stuck "Waiting for reviews", scraping stops mid-process, setup on both
systems, and Fudge not opening the 4 pages). This describes what the code does
today — no per-machine job ownership exists — and the operating rules that
follow from it.

## 1. Install Fudge on both machines

The folder carries no connection: each fresh installation starts at the setup
page with its own private secret ("Connecting another computer" in
`README.md`).

1. Load the same extension build/folder on the second machine.
2. On the already-connected machine open **Change sheet → Copy connection
   code** (`FUDGE1|…`).
3. Paste that code into the setup field on the second machine. The bare `/exec`
   URL alone is insufficient — the code carries URL, secret and spreadsheet.
4. If the second machine reports **404**, the deployment is private (owner must
   set *Execute as: Me*, *Anyone* and redeploy). **Secret does not match** means
   new connector code was saved but never deployed as a **New version**.
5. Press **Sync now** on the second machine once. Panel should show a Sheets
   status line, not an error.

## 2. Run Start on ONE machine only

This is the most important rule in this document.

Both machines share one Sheet and read the same requirements, so **both
machines receive the same job list** (`nextJobs` — the same keyword/city
combinations) whenever they sync. There is no owner id anywhere in the job
records, and a ticket in `FUDGE1|` identifies the connector, not the machine.

What serializes correctly across machines:

- All Apps Script writes go through one `LockService` script lock, so two
  machines cannot corrupt the Sheet (writes queue behind each other).
- Reviews dedupe by identity on append, Search Progress checkpoints only move
  forward, and visited businesses are merged — so a genuine double-scan
  self-corrects on the next sync.

What is *not* protected:

- Both machines **will open their own Google tabs for the identical
  keyword/city** and scan the same pages at the same time. That doubles the
  Google-blocking risk (two IPs hammering the same queries), wastes half the
  work, and can reach the same page limits twice as fast.

**Operating rule:** designate one machine the runner. Press **Start** on it.
The other machine stays **Stopped** and is used for the human work — QC on the
Structure tab, adding cities/keywords, reviewing the Reviews/Services tabs,
the dashboard, and Apps Script edits. Nothing about that work requires the
scanning switch to be on; **Sync now** works while stopped.

("Paused" on the Services tab cannot split trades between machines — service
rules live in the shared Sheet, so a paused trade is paused everywhere.)

## 3. Per-machine settings — check these on the runner

These controls live in each browser's own storage, so they must be set on the
machine that actually runs (they are **not** shared by the connection code):

| Control | Where | Default | Meaning |
| --- | --- | --- | --- |
| **Google tabs** | Scan settings select | 3 (1–6) | How many Places tabs run in parallel — one per distinct keyword. |
| **Result pages** | Scan settings select | 4 | How deep each keyword/city scan pages into results (hard cap 4). |

Two different controls are often confused as "4 pages":

- **"Fudge opens 4 pages"** usually means **Google tabs = 4**. The default is
  **3 tabs**, and nothing sets it to 4 until it is chosen on that machine —
  that is the most common reason fewer pages open than expected.
- Even with the limit set, fewer tabs open whenever there are *fewer distinct
  keywords needing work* than the limit, a keyword's cities are all exhausted,
  a trade is paused on the Services tab, Google cooldown is active, live slots
  are occupied, or the Sheet reports no rows needing collection.

Remedies: set **Google tabs = 4** and **Result pages = 4** on the runner, make
sure at least four distinct keywords have deficits and unexhausted cities, and
keep the Services rows you want collected **Active**.

Everything else arrives through the shared Sheet and does not need per-machine
setup: Structure requirements, Services rules, Cities, Search Progress
checkpoints, and the rephrasing writer key.

The optional ND backend intake stays release-gated off on both machines; it
is not required for scraping and is not configured by this runbook.

## 4. Panel status meanings and remedies

| Panel message | Meaning | Remedy |
| --- | --- | --- |
| *"Not collecting while paused on the Services tab…"* / **Trade paused** | The waiting row's trade is switched off on the Services tab, so Fudge deliberately does not scan for it (its scans could never fill the row). | Set the row **Active** on the Services tab. |
| *"Every city is used up for …"* / **Waiting for cities** | The keyword has no city left to search. | Add cities on the Cities tab. |
| `Waiting for reviews` (Sheet, column H) | The row is empty and no collected review matches it yet. | Normally Fudge scans for it. If the panel also shows one of the states above, fix that first. |
| *"Held back: … kept failing on the same Google page. Press Start to try it again, or Sync now after checking it."* | The same keyword/city failed three rounds in a row on a dead page; unattended passes stopped retrying it. | Check Google for that keyword/city manually, then press **Start** or **Sync now** — human-triggered passes always get one more attempt. A run that saves reviews or finishes normally clears the hold by itself. |
| *"Google asked Fudge to slow down…"* (cooldown) | Google served a block page; all tab creation pauses 15–120 minutes. | Wait; consider lowering Google tabs in Scan settings. |
| *"Sheet check stalled — Press Sync now"** | The last sync attempt is older than 5 minutes while collecting. | Press **Sync now**. |
| *"Needs attention: …"* | The sync failed with an action-required error (auth, 404, secret mismatch, missing tab). | Follow the message; see the 404/secret table above. |

## 5. Why unattended runs no longer stall

Two fixes from 2026-10-30 exist because of the reported stalls:

1. **Paused trades no longer earn scans** — job generation obeys the Services
   pause switch, instead of scanning for a trade whose every result is then
   discarded. Those scans used to burn through cities while the row kept
   reading "Waiting for reviews".
2. **Dead pages stand down** — a keyword/city that fails the same way three
   unattended rounds in a row is held back (with the panel message above)
   instead of walking back into the same broken page forever, because the
   checkpoint keeps the failing page. A human Start/Sync bypasses the hold
   once; saving reviews or a normal ending clears it.

Both are covered by the regression suite (`node tests/smoke.test.js`: "paused
trades do not open scans", "dead pages stand down instead of retrying
forever").

## 6. Quick check-out list for both machines

- [ ] Same extension build loaded on both machines
- [ ] Connection code `FUDGE1|…` pasted on the second machine — no errors on Sync now
- [ ] One machine designated runner; the other stays **Stopped**
- [ ] Runner: Google tabs set to the wanted count (default 3; choose 4 for 4 parallel pages)
- [ ] Runner: Result pages = 4 (default)
- [ ] Structure/Cities/Services tabs hold the keywords you expect to see opened
- [ ] Start pressed on the runner only — then watch the panel for the states
      in section 4
