# Fudge backend implementation status

## Dashboard identity/workspace security handoff — 2026-10-29

The dashboard now implements central fresh-user/email-confirmation checks before
business reads and actions, explicit authorized workspace selection for multiple
memberships, account-bound untrusted session preferences, and stale-form context
rejection for all 30 existing business form action entrypoints. Single-business
staff retain automatic selection. Revoked selection does not silently switch to
another business. Notification feed/acknowledgment and handled-ID storage use the
same account/business context. Switching changes no worker/session authorization.

Real-DAL tests do not mock the guard; fixtures cover unconfirmed/direct-action
rejection, role/revocation/overflow/malformed results, old tabs/accounts, cookie
flags and UI. Dashboard full validation passed: typecheck, lint, **712 tests /
50 files**, production build, and signed-out local route HTTP checks (temporary
test server stopped afterward). Fudge freshly reran **67 backend + 127 smoke**
tests and all tracked JS/CJS syntax checks: PASS. This is application-layer hardening, not a deployed SQL policy
change or new live cross-account/browser acceptance. Fudge's existing independent
verified-session/business checks remain unchanged; sessions are still separate.

No Fudge source change or extension deployment. Both release gates remain false,
backend catalog application and real Sheet delivery stay unwired. No live upload,
Sheet edit, browser operation or production migration occurred. The shared master
plans contain the same new checkpoint; frozen pre-test checkpoints are unchanged
and both shared file pairs remain byte-identical. The audit
below remains historical evidence; its central-app/selection gaps are superseded
in source by this slice, not all remaining automation gaps.

## Cross-repository readiness review — 2026-10-29

**NOT READY for end-to-end automation; passing fixtures are not an error-free or
live-production certification.** Dashboard's current `docs/IMPLEMENTATION-STATUS.md`
contains the detailed source/hosted findings. This entry supersedes stale counts
below, not the frozen pre-test checkpoint or remaining feature acceptance gates.

Fresh checks actually run:
- `node --test tests/backend.test.js`: **67 PASS**.
- `node tests/smoke.test.js`: **127 PASS**.
- `node --check` for every tracked `.js`/`.cjs`: PASS.
- Dashboard: typecheck/lint PASS, **649 tests / 43 files PASS**, build PASS;
  production-dependency npm audit reports zero known vulnerabilities.
- Worker: **35 unittest cases PASS**; current Python interpreter lacks Playwright
  and documented private worker/adapter files were not found. No browser ran.
- Shared master plans and frozen readiness checkpoints remain byte-identical;
  all F01–F36/N01–N08 tracker IDs are present once, none fully signed off.

Shared hosted target reverified read-only: **11 deployed migrations, not 12**;
the dashboard's twelfth local file is the intentionally undeployed publishing
protocol. Do not apply this repo's superseded per-user ingestion experiment or
blindly push either migration directory. All 50 deployed function bodies match
the applied dashboard source (CRLF/edge whitespace normalized; aggregate MD5
`3a152185d42690fe6f4b8c9790039072`). All 25 public tables have RLS; anonymous
table reads and authenticated direct table mutations are denied. This is not a
full schema/constraint parity or live tenant-isolation certification. ND Test
has generation 1 with **2 test rules**, not the 21-rule business catalog; intake,
bindings, publications, check jobs and writeback intents remain zero. No hosted
publishing table or Edge Function exists.

Business/source link saved locally in both repos at
`backups/business-source/REFERENCE.private.json`, confirmed Git-excluded. It is
not the operational ND Master. Anonymous read-only Services/keyword probes
found **21 rules / 41 distinct request keywords / 27 exact missing mappings**;
rule fields equal the previous private snapshot. Dashboard preview/contract and
Fudge snapshot validation accept the 21 rules (0 errors, 23 warnings), and all
configured keyword identities resolve offline. Semantic matching of the 27
exact misses remains unaccepted; no aliases were invented. No review, phone,
name or media values were fetched. Owner review of anonymously readable business
sharing is recommended; permissions were not changed.

`UPLOAD_RELEASED` and `CATALOG_DOWNLOAD_RELEASED` stay **false**. Backend cache
never applies rules; `sheets.js` Services sync still owns `serviceRules`. No
dashboard outbox deliverer, connected publisher, one-click dated-cohort refresh,
or dashboard profile/onboarding/cookie/proxy execution exists. Keep desktop and
legacy workflows preserved and non-overlapping; no automation was started.

Review findings also include the dashboard's missing central verified-email
check for an already-sessioned/member unconfirmed user (newer protocol actions
check explicitly; fresh unassigned signup access was not demonstrated), unordered
first-membership selection for multi-business users, and unaccepted recovery,
real-browser/MV3, concurrency and retention/deletion gates. Legacy first-person
identity/service-changing rewrite prompts and Drive `ANYONE_WITH_LINK` sharing
must not be silently carried into the new pipeline: require lawful rights,
truthful attribution and private-media/retention decisions before cutover.

Hosted advisors still report 3 anon-executable worker and 21 authenticated
SECURITY DEFINER notices, disabled leaked-password protection, an intentional
private no-policy INFO and 27 unused-index INFOs; not a clean security bill.
Remediation: [worker RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
[staff RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
[password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
No real secrets or private business references found by targeted tracked-file
scans (not a whole-history security audit). SMTP remains deliberately deferred
for the internal tool; the older signup instructions do not prove email delivery.

Only local private reference and status documentation changed. No source edits,
schema changes, production writes, Sheet edits, extension deployment, installs,
release changes, commits or pushes were performed.

## Live-testing readiness checkpoint — 2026-10-29

The dashboard repository added the explicit Sheet writeback queue UI
(`/dashboard/settings/sheet-writeback`): staff + verified-email only, bounded
newest-25/total status view, confirmed enqueue with stable replay IDs and a
15-second abort, and pending-only cancellation, all stating plainly that
delivery is inactive — no Sheet cell is touched. Its current full dashboard
validation: 646 tests / 43 files, typecheck, lint and build PASS. No Fudge
source changed in this handoff; both Fudge release gates remain false. The
identical readiness checkpoint ("shield check") is now saved in both
repositories as `docs/LIVE-TESTING-READINESS-CHECKPOINT-20261029.md` and must
stay byte-identical until a dated post-testing record replaces it. Live testing
follows the checkpoint's ordered checklist: auth, catalog accept, Sheet
connection (development copy only), writeback queue (no Sheet change), worker
pairing and reporting/timezone correctness.

## Sheet writeback protocol handoff — 2026-10-29

After explicit authorization, the dashboard deployed a durable Sheet writeback
outbox protocol to the shared database: source `20261029175611` applied as
hosted `20261029180253`, with follow-up FK-index source `20261029180506` as
hosted `20261029180528` clearing the one new advisor finding. The protocol
records bounded append/update_cells intents per business with per-organization
ordering, replay-safe request/stable keys, leased bounded claim batches,
lease-stamped idempotent acknowledgments, retry exhaustion at five attempts,
lease-expiry reclaim and pending-only cancel. Hosted rollback-only smoke
passed; no fixture rows remain and all writeback/catalog counts are zero.
Nothing dispatches to any real Sheet yet: no connector, worker or Edge
Function writes through these tables, Fudge's own writeback remains the only
Sheet writer and both Fudge release gates remain false. Its current full
dashboard validation: 623 tests / 41 files, typecheck, lint and build PASS.
No Fudge source changed in this handoff; prior 67 backend/127 smoke results
are historical. See dashboard `DB-DEPLOYMENT-20261029-WRITEBACK.md` for full
evidence. The future shared deliverer and the separately approved
rule-application path remain gated on live acceptance and the ownership
decision.

## Shared catalog deployment handoff — 2026-10-29

After explicit authorization, the dashboard applied catalog source
`20261029165237` as hosted `20261029165416` and follow-up FK-index source
`20261029165727` as hosted `20261029165815`. Hosted rollback-only save/replay/
activation/rollback/access-denial smoke passed; no fixture records remain. No
business catalog imported or activated. Dashboard now offers explicit inactive
staging, exact immutable-revision review/diff and owner/admin activation; signed-in browser acceptance remains pending.
Its current full validation: 596 tests / 38 files, typecheck, lint and build PASS.
No Fudge source changed in this handoff; prior 67 backend/127 smoke results are
historical. Both Fudge release gates remain false and existing Sheet rules remain
unchanged. See dashboard `DB-DEPLOYMENT-20261029-CATALOG.md` for full evidence.

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
