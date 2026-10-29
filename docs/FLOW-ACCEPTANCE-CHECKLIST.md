# Fudge flow acceptance checklist

Updated: 2026-10-29. This is a practical test plan, not evidence that a live
flow has passed. Use an authorized account, permitted source material and a
dedicated development Sheet/Drive location. Do not send passwords, connection
codes, API keys, review text or private Sheet links in screenshots or chat.

## Automated baseline

- [x] `node --test tests/backend.test.js`: 40 passed on 2026-10-29.
- [x] `node tests/smoke.test.js`: 127 passed on 2026-10-29.
- These are local/fixture checks, not proof of live sites, account permissions,
  browser crash recovery, Sheet delivery or the integrated ND workflow.

## Live acceptance (not yet performed)

Record browser/version, extension ID, date, sanitized screenshots and the exact
result for each step. Stop on an unexpected write, identity challenge, permission
error or data discrepancy; preserve evidence and existing data. Do not install a
second copy, clear storage, or disconnect a working production Sheet to test.

1. **Preserve and open:** Back up important local data using the existing workflow.
   Reload the same unpacked extension without removing it. Confirm the extension
   ID and existing library, settings and Sheet connection are unchanged.
2. **Local collection:** With explicit permission, start a small authorized
   fixture collection on a supported Google page. Confirm start/stop behavior,
   captured text/photos and source identity, and that revisiting does not create
   duplicates. Confirm stopping prevents new work. Google markup may change.
3. **Library:** Inspect the captured fixture, classification, and copy action.
   Confirm a reload preserves the local item without modifying unrelated reviews.
4. **Development Sheet:** Only with a separately configured test connection and
   owner approval, verify connector authorization and a single fixture round trip:
   inventory, allocation, acknowledgment and duplicate prevention. Confirm the
   expected destination before any write. Do not use a production Sheet for this
   test; do not alter or redeploy its connector.
5. **Recovery:** With only test work active, verify offline/reconnect and browser
   or service-worker restart behavior; check local data and outstanding work
   against the saved baseline. Do not assume a mock restart proves crash safety.
6. **Optional backend:** Follow `BACKEND-UPLOADER.md` setup using an existing
   verified staff account. Select the intended workspace, then run **Test backend
   reads (no upload)**. Confirm permission denial and sign-out behavior where safe.
   This only checks a read surface, not writes or cross-workspace isolation.
7. **Explicitly deferred:** Backend upload, historical migration, retention and
   deletion, real contention/restore tests and a separately approved pilot remain
   gated. `UPLOAD_RELEASED` must remain false until all release gates in
   `BACKEND-UPLOADER.md` are met. Publishing, ND writeback and browser execution
   are separate incomplete workflows, not part of this acceptance.

## Fudge 2.0 follow-up

After acceptance, define the intended visual direction and scope before changing
branding, manifest version or release claims. Preserve extension identity, local
data, accessibility and the existing workflows. A new name or theme alone does not
make the unfinished integrated workflow production-ready.
