# Optional ND backend intake — development implementation

Updated: 2026-10-28. Code is implemented with local/mock tests. **Upload release
is OFF.** The shared intake schema is deployed as `20261028203642`; no real source
upload or live pilot was performed. See `../supabase/README.md` for the boundary.

## Implemented files

- `backend-contract.js`: pinned project, allowlisted originals, ID/date/size checks,
  immutable capture keys, cancellation epochs and complete ordered receipts.
- `backend-service.js`: existing-account sign-in, verified identity and staff
  workspace discovery, refresh, target isolation, pause/history/retry/cancel/drain.
- `backend-worker.js`: trusted internal-page commands, session-storage isolation,
  one-minute MV3 alarm/startup recovery and explicit false upload-release gate.
- `backend-setup.html` / `.js`: side-panel **ND backend intake -> Setup** screen.
- `shared.js`: collection stores its library and unique capture-intent snapshots
  in the same local set request after explicit enablement; no network await.
- `manifest.json`: optional access only to the selected shared Supabase project;
  Auth/worker code is not injected as a content script.

Existing shared/config/writer/Sheets imports and scan/Sheet acknowledgment keys
are preserved. The matching server design is the dashboard repository's
`docs/FUDGE-INGESTION-V1.md` and `supabase/migrations/20261028203213_fudge_ingestion_v1.sql`.

## Review setup

1. Preserve important local data, then reload the existing unpacked extension in
   `chrome://extensions` or `edge://extensions`. Keep its folder/key/identity;
   do not remove/reinstall it.
2. Open side panel -> **ND backend intake -> Setup**. Opening it reads local
   status only; it does not sign in, start collection or migrate data.
3. For an explicitly authorized Auth test, get the shared project's **publishable**
   key from the administrator. Use an existing verified dashboard staff account.
   Sign-in requests only the pinned project's optional host permission. Never
   paste a service-role/secret/management token or send your password to chat.
4. Choose the exact workspace from authenticated staff memberships. Selection is
   always paused. No historical library baseline is silently uploaded. Changing
   account/workspace never retargets old intents; returning restores that target.
5. Upload enablement, historical queueing and manual upload stay release-gated.
   There is no message/checkbox override for the false release constant. Auth
   review is not an intake pilot. Use the dashboard for account recovery; no
   account/membership is created or self-assigned here.
6. After signing in and selecting a workspace, **Test backend reads (no upload)**
   re-verifies the user and staff membership, then requests `limit=0` on the two
   intake tables scoped to that workspace. It retrieves no review rows and never
   calls the intake RPC. Its result is temporary and cleared on sign-in,
   sign-out or workspace selection. A pass checks only the current authenticated
   read surface; it does not prove cross-tenant RLS, write acceptance, browser
   recovery or upload release readiness. A missing schema, denied access or network
   problem is reported without displaying server response bodies.

## Credentials and session lifecycle

Passwords are sent once to the pinned HTTPS Auth endpoint and cleared from the
form. Access/refresh tokens live only in `chrome.storage.session` restricted to
`TRUSTED_CONTEXTS`. Content scripts cannot read them. Persistent local-library
storage access is not globally restricted because that would break collection.

Worker suspension within a browser session preserves Auth state; browser restart,
extension reload/update/disable requires sign-in again. The durable queue stays
on disk. No persistent password or refresh token is used. The verified publishable
key is remembered locally for convenience: it is public app configuration, not a
user credential. Server membership remains authoritative, never these local IDs.

Sign-out pauses and clears local Auth before attempting remote local-scope logout.
Remote failure is reported as unverified; it never revives the local session or
claims every access token was revoked. Requests reject redirects and never log
raw server bodies or credentials. Only the exact internal setup page may invoke
backend controls; content scripts cannot call Auth/workspace/queue commands.

## Queue and receipt guarantees

Only explicit enablement on a released target captures subsequent observations.
Historical migration is separately confirmed. Projection copies source fields
before a local duplicate merge can replace them; rewrites/classification/Drive and
credential fields are excluded. Missing real Google review IDs remain blocked;
local fingerprints are not promoted to source identities. Invalid data stays in
the original library for repair, never silently acknowledged.

Unique per-capture storage keys prevent multiple collector tabs overwriting one
shared queue array. Collection plus intents use one local set request and report
write failure. This does not redesign the existing library's cross-tab merge
semantics or prove real-browser crash atomicity; those acceptance tests remain.

Each drain sends at most 25 distinct IDs and a 256 KiB envelope, validates every
payload, and acknowledges only a complete ordered matching receipt set. Newer
capture keys cannot be cleared by an older receipt. Acknowledged intents retain
receipt metadata and clear the copied payload; local library originals remain.
Lost responses/failed local ack can replay source content safely only because the
matching backend must deduplicate transactionally.

Transient failures use bounded jitter/backoff and Retry-After, blocking after
eight attempts. Expired Auth waits for sign-in; schema/permission/invalid/receipt
failures block instead of looping. Status exposes counts and at most twenty
blocked local IDs/reasons, not source rows or tokens.

## Pause, cancellation and deletion

Controls serialize against one bounded in-flight request. Pause/cancel/sign-out
stop subsequent work, not an already committed batch. Pause retains the backlog.
Cancel requires confirmation, pauses the target and retires its capture epoch.
An older collector write finishing after cancellation is swept to cancelled with
payload cleared, even after restart and while release is off; it cannot resume
as new consent. Cancellation epochs survive workspace switches.

Library deletion and backend snapshots/copies are separate. Clear dialogs now
warn to pause/cancel unwanted pending snapshots first. Clearing the local library
does not delete acknowledged backend records, Drive files or an in-flight request.
Backend retention/deletion support needs separate implementation/approval before
live enablement. The queue does not silently discard data to enforce a disk cap;
storage-pressure thresholds, receipt retention and cleanup policy remain gates
before production scale.

## Tests and remaining gates

```powershell
node --test tests/backend.test.js
node tests/smoke.test.js
```

Tests use fake HTTP/Auth/storage plus actual shared collection code in a VM.
They cover release/consent, target/account isolation, refresh/restart, retry,
receipt/capture races, cancellation, write failure, size/count limits and trusted
controls. They do not prove real Chrome/Edge permission UI, worker eviction,
extension reload, live Auth or hosted database/browser acceptance.
The optional read diagnostic is additionally covered by mocked identity, staff
membership, empty-row reads, denied/missing/malformed responses and internal-sender
tests. It has not been tested with a real extension sign-in or browser permission.

Before changing `UPLOAD_RELEASED` in `backend-worker.js`:

1. Review server contract, rights, workspace ownership, retention/deletion policy;
   complete remaining local/staging/concurrency and restore acceptance. The intake
   migration is already deployed; do not reapply it. Never reset existing
   tables or apply the older per-user Fudge SQL unchanged to the shared backend.
2. Test real Chrome/Edge permission denial/session isolation, restart/worker kill,
   source recovery, stale membership, receipt retry and pending-cancel races.
3. Test real PostgreSQL contention, grant/RLS denials and exact contract parity;
   local mocks/single-runtime PGlite are not hosted concurrency acceptance.
4. Resolve storage/receipt retention, deletion and consent wording/media rights.
5. Separately approve a small authorized intake pilot and reviewed release change.
   Historical upload stays off unless separately requested. Intake never approves
   publication or enables profile automation/Sheet writeback. P2 is not complete.
