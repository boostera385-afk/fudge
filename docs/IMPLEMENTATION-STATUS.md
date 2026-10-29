# Fudge backend implementation status

## Versioned catalog cache development — 2026-10-29

Added `backend-catalog.js` and a trusted internal read-preview command, independently
gated by `CATALOG_DOWNLOAD_RELEASED = false`. Production uploads also remain false.
Cache validates bounded exact snapshots, segregates account/business keys, detects
same-generation conflicts/downgrades, permits higher-generation rollback, serializes
refreshes and retains last-good data on transient download/storage failures. Service
rechecks user and membership online; it does not use cache to bypass auth checks.
Cache is never applied to existing Sheet/local service rules. Setup resets displayed
preview metadata on identity/target changes; no automatic network refresh occurs.
See `SERVICE-CATALOG-CACHE.md` for limits. No hosted deployment, rule import or
release change performed. Validation: 67 backend tests, 127 smoke tests and module
syntax checks PASS. Live browser/REST/cache capacity/retention acceptance pending.

## Queue read-efficiency hardening — 2026-10-29

Inactive drains with no retired cancellation epochs now perform only the status
scan, not a redundant sweep. Active drains reuse the selection/sweep snapshot rather
than reading/cloning the queue again. Fresh returned status still reads current
storage. Captures after the selection snapshot remain for later batches; retired
epochs are still swept while paused/release-off. Existing drain coalescing is
unchanged and now explicitly tested against overlapping alarm/manual calls.
Validation: 55 backend tests PASS, including 1,000 queued fixtures with exactly 25
acknowledged/975 pending and all 1,000 intents retained; 127 smoke tests PASS;
service syntax and diff checks PASS. This is a fixture workload, not a real-browser
performance benchmark, crash-safety proof or guarantee of no busy states. No
collection/Sheet behavior, upload release, retention or backend storage changed.

## P3 service-configuration preview handoff — 2026-10-29

The dashboard repository adds local-only catalog validation under
`/dashboard/settings/services`, using the user's private snapshot's Services rules
as input. No service configuration is downloaded to Fudge, no current Services
sync is replaced, and no backend storage/activation exists yet. Fudge source is
unchanged in this slice; prior 51/127 test results are historical, not rerun evidence.
Both master-plan copies record remaining versioned storage, access, activation,
cache/recovery and single-writer cutover gates. Private workbook/catalog copies
remain excluded from Git and are not migration fixtures.

## P3 receipt visibility handoff — 2026-10-29

Setup now displays at most 20 newest saved acknowledgment receipts for the current
target, with record ID, revision ID/number and local acknowledgment time only.
Invalid metadata and other business targets are excluded; no original payload,
author details or tokens are included. These are local saved receipts, not a fresh
backend verification or proof of full queue delivery. The dashboard's new staff-only
`/dashboard/fudge` shows bounded backend receipt metadata for manual ID comparison;
automated reconciliation, keywords and review/writeback remain incomplete.
Validation actually run: 51 backend tests and 127 smoke tests PASS. No live intake
or signed-in UI acceptance performed; upload release remains false. This milestone
is committed independently in each owning repository, not as a combined repo.

## Shared verification email handoff — 2026-10-29

The dashboard repository now has regenerated Fudge + ND branded Auth templates
and setup instructions at `supabase/templates/README.md`. No hosted Auth settings
were changed; real Site URL, SMTP/domain setup and delivery acceptance remain
pending. Verification requires a deliberate confirmation-page click, then separate
Fudge sign-in; it does not release intake or create shared-team membership. Dashboard
validation for this slice: 524 tests / 31 files, typecheck, lint and build PASS.
No Fudge source changed in the email-template slice; its prior 49/127 results are
historical, not rerun email-delivery evidence.

## Simplified shared email account — 2026-10-29

Fudge now uses the same public Supabase app identity as the ND dashboard's ignored
`.env.local`: pinned project `xtefjnfdjnxwrpkoydaj`. A public-only config generator
copies no server-side settings/secrets. Removed the API-key input from setup;
added email/password signup with email verification instructions and shared login.
Signup never accepts returned tokens as an extension session. Passwords remain
unstored; existing trusted session storage and upload gates are unchanged.

Single-business sign-in auto-selects the authorized business paused; multi-business
selection remains under Advanced. No RLS/organization schema was removed. First-time
verified users can explicitly create an empty private business through the existing
guarded RPC; no shared membership is self-assigned. Both apps share credentials,
not browser sessions. No live signup, membership creation, intake write or deployment
was performed. Read-only Auth settings show email enabled, signup enabled and email
autoconfirm false; delivery/templates/redirect acceptance remains a live test.

Validation: 49 backend fixture tests PASS, 127 smoke tests PASS, setup/worker syntax
and diff whitespace checks PASS. Real browser signup/login/email and first-account
setup are not yet accepted. Prior dated sections below are historical.

## Read-only connection diagnostic — 2026-10-28

Added an explicit **Test backend reads (no upload)** action on the extension setup
page. It verifies the current authenticated user and staff workspace membership,
then requests two workspace-filtered `limit=0` intake-table reads; it never calls
the intake RPC, fetches source rows, changes consent/target/queue or bypasses the
release flag. The result is ephemeral and reset when identity/target is changed;
the UI explicitly distinguishes a read pass from write/RLS/browser acceptance.
Server error bodies and tokens are not displayed. Auth refresh may update the
trusted private session when required, but the check does not persist credentials.

Validation actually run: `node --test tests/backend.test.js` **40 PASS**, including
seven new mock tests for release-off read checks, target/session/identity/member
denials, malformed/denied/missing responses and trusted sender; `node
tests/smoke.test.js` **127 PASS**. No real browser Auth/permission/REST call was
performed. Live signed-in UI and response acceptance remain pending. Existing
collection and Sheets behavior are unchanged; uploads stay release-gated off.

## Shared database handoff — 2026-10-28

Session returned to Fudge at the user's request. The dashboard already applied
workspace/revision intake through MCP as hosted `20261028203642`, source
`supabase/migrations/20261028203213_fudge_ingestion_v1.sql` in that repository.
Its local 521-test suite/build and rollback-only hosted intake/RLS smoke passed;
those are dashboard-session results, not a new MCP verification from this folder.

No separate Fudge database or duplicate migration is needed. Preserved the older
per-user SQL/tests unchanged, with prominent superseded/do-not-deploy guidance in
`supabase/README.md` and `SUPABASE-FOUNDATION.md`. Added project-local OAuth MCP
configuration for the same project with SQL/migration/deploy approval prompts.
MCP reconnected automatically and was verified from this folder: correct project
URL, seven migrations including `20261028203642`, both intake tables and the RPC
present, zero public tables without RLS. No new hosted write, real
source upload or release-gate change was performed from Fudge. Next: reconnect
MCP, verify existing history/contract, then continue browser acceptance and policy
gates rather than applying the old migration. Existing code remains unchanged.

## P2 extension slice — 2026-10-28

Session moved to the Fudge repository at the user's request before extension edits.
Existing uncommitted work was preserved. Optional backend Auth/workspace UI,
immutable local capture intents, MV3 alarm/startup recovery, bounded uploader,
strict receipts, retries, session refresh, pause/cancel and target isolation are
implemented in source. See `BACKEND-UPLOADER.md` for exact behavior and limits.

**Upload release is false in `backend-worker.js`.** No user-source intake RPC,
historical migration, hosted DDL, live login, customer browser/profile action,
Sheet write/import, commit or push was performed. Auth/workspace and upload tests
use mocked HTTP/storage. Signing in remains an explicit optional user action;
opening the setup page alone makes no network request.

Credentials: no password or user Auth tokens in persistent local storage. Tokens
are limited to trusted extension-session storage; browser restart/reload requires
sign-in. Only public publishable configuration is remembered persistently. Optional
host permission is pinned to `xtefjnfdjnxwrpkoydaj`, not wildcard Supabase hosts.

Collection retains existing local/Sheets behavior. With a future released/consented
target, raw allowlisted observations and their per-capture intents use one local
write; old receipts cannot clear newer capture keys. Cancellation epochs prevent
late writes captured under retired consent from uploading after resume. Local
library deletion is distinct from queue cancellation/backend deletion; both clear
dialogs now disclose that boundary. No silent storage-cap dropping is implemented.

### Validation actually run

- `node --test tests/backend.test.js`: **33 tests PASS**.
- `node tests/smoke.test.js`: **127 existing smoke tests PASS**.
- `node --check` for contract, service, worker, setup, shared and background files:
  PASS; service checked again after final refresh-handling change.
- One-off offline cross-repository comparison: extension and dashboard collector
  projections agree on seven valid/invalid/extra-field fixtures. No network.
- Setup DOM bindings, exact internal sender gate, optional host permissions and
  false production release gate tested. Fake releases enabled only inside unit
  service fixtures, not the production worker.
- Both saved master-plan copies remain identical. `git diff --check` passes with
  existing Windows line-ending warnings.

An initial smoke test expected the exact legacy importScripts call; resolved by
keeping that call unchanged and adding backend imports before/after it, not by
weakening the assertion. Actual Chrome/Edge UI, permissions, real session refresh,
service-worker eviction/crash and intake pilot are **not live-accepted**.

### Next gates

1. Reload/review the existing unpacked extension (same identity, no reinstall).
2. Review backend contract, retention/deletion/storage policy and migration draft.
3. Use an approved local/staging PostgreSQL/CLI workflow for concurrency/advisors;
   separately approve any hosted deployment. No database reset/replay.
4. Run real Chrome/Edge Auth/permission/queue recovery acceptance on fixtures.
5. Separately approve a small intake pilot and reviewed release-gate change.
   Keep historical upload off unless explicitly requested. **P2 is not complete.**
