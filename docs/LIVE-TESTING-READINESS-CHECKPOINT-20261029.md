# Live-testing readiness checkpoint — 2026-10-29 ("shield check")

This checkpoint is saved byte-identically in both repositories
(`boostera385-afk/nd-automation` and `boostera385-afk/fudge`) immediately
before user-driven live testing begins. It records what is actually implemented
and verified, what stays off, and what live testing covers. It is not a
sign-off; per-feature acceptance evidence is still required during testing, and
every browser workflow below stays paused until its acceptance passes.

## Shared hosted database — `xtefjnfdjnxwrpkoydaj`

Twelve migrations in history; never reset; applied migrations never reapplied.
Local source filenames differ from hosted timestamps — preserve the mapping:

| Source (`nd-automation/supabase/migrations`) | Hosted version |
| --- | --- |
| `202610260001_reporting_foundation.sql` | `20261026185223 reporting_foundation` |
| `202610270001_post_checks_and_notifications.sql` | `20261026210947 post_checks_and_notifications` |
| `202610270002_monitoring_worker_bridge.sql` | `20261027185858 monitoring_worker_bridge` |
| `202610270003_worker_bridge_indexes.sql` | `20261027190052 worker_bridge_indexes` |
| `202610270004_content_drafts.sql` | `20261027200411 content_drafts` |
| `202610270005_profile_inventory.sql` | `20261027200913 profile_inventory` |
| `20261028203213_fudge_ingestion_v1.sql` | `20261028203642 fudge_ingestion_v1` |
| `20261029165237_service_catalog_v1.sql` | `20261029165416 service_catalog_v1` |
| `20261029165727_service_catalog_fk_indexes.sql` | `20261029165815 service_catalog_fk_indexes` |
| `20261029175611_sheet_writeback_v1.sql` | `20261029180253 sheet_writeback_v1` |
| `20261029180506_sheet_writeback_fk_indexes.sql` | `20261029180528 sheet_writeback_fk_indexes` |

### Hosted state verified at this checkpoint

- 25 public tables, all with row-level security; zero public tables without
  RLS; private schemas exist for worker credentials and protocol helpers.
- Zero unindexed foreign keys (final advisor state).
- Catalog revisions/heads/activations: 0/0/0. Writeback outbox/claims/acks:
  0/0/0. No customer, publication, comment, check or worker fixture rows were
  created by any deployment smoke; all hosted smokes were rollback-only.
- Newer RPC families (catalog, writeback): `anon` denied SELECT and EXECUTE
  everywhere; only `authenticated` may execute; public wrappers are SECURITY
  INVOKER; constrained implementations are private with empty search paths and
  fresh verified-staff checks.
- Security advisor counts unchanged from the established baseline: 3
  pre-existing anon-executable worker RPC notices (intentional
  hashed-credential pathways), 21 pre-existing authenticated/SECURITY DEFINER
  notices, one private worker-credential RLS-no-policy INFO, and
  leaked-password protection still disabled (Auth settings change requires
  the user's public HTTPS URL and sender decision — never via SQL).
- Performance advisor: unindexed-FK count zero; unused-index INFO 28 (new
  indexes retained pending real workload measurement; do not delete merely
  for zero usage).

## Dashboard (`nd-automation`) state at this checkpoint

Full validation recorded in `docs/IMPLEMENTATION-STATUS.md`: typecheck PASS,
lint PASS (0 warnings), **646 tests / 43 files PASS**, production build PASS
with all routes including `/dashboard/settings/services`,
`/dashboard/settings/services/[id]` and `/dashboard/settings/sheet-writeback`.

Implemented and locally verified only (not live-accepted):

- Auth/RLS data layer, verified-email staff boundaries, per-business
  isolation in every table and RPC.
- Reporting: customers, posts, comments, notifications, work sessions
  (8–10 hour human records; never unattended dispatch), today/yesterday and
  export views; business timezone `America/Los_Angeles`, times persisted UTC.
- Fudge intake receipts (read-only), EXP-staged queue protocol.
- Service catalog: local validation, explicit inactive staging, exact
  immutable-revision review/diff, owner/admin activation with embedded
  revision + base generation, stable replay IDs, 15-second aborts.
- Durably outboxed Sheet writeback protocol (order, replay-safe request and
  stable keys, leased claims, idempotent acks, retry exhaustion, expiry
  reclaim, pending-only cancel) and an explicit queue UI that states delivery
  is inactive. Nothing dispatches to any Sheet; no deliverer exists yet.
- Read-only master-Sheet preview and CSV fallback; snapshot connector
  bundling without secrets; worker bridge controls.
- No Nextdoor API; no Incogniton debugging-port exposure; no service-role
  key in the web app, worker or extension; no fabricated metrics, live
  statuses, comments or platform observations anywhere.

## Fudge state at this checkpoint

Backend unchanged by the recent handoffs; 67 backend tests and 127 smoke
tests are historical PASS results, not rerun evidence for this checkpoint.
Both release gates remain explicitly `false`: `UPLOAD_RELEASED` and
`CATALOG_DOWNLOAD_RELEASED`. Fudge's own Apps Script writeback remains the
only Sheet writer; versioned catalog preview cache exists behind its gate and
is never applied to existing Sheet/local service rules without the ownership
decision and live acceptance.

## What live testing covers (user-driven, in order)

Each step below runs in a real signed-in browser with the user's own
accounts/data; evidence is recorded per step; a failure stops that workflow
(it is never auto-retried with new IDs) and is reported honestly.

1. **Auth**: signup/sign-in/password reset with real email verification
   (requires the email setup decisions), wrong-password and cross-account
   isolation checks.
2. **Service catalog**: stage → review exact revision/diff → activate as
   verified owner/admin; review-only as operator; cross-business denial;
   timeout/replay behavior against the hosted backend.
3. **Sheet connection**: run the setup wizard against the user's own copy of
   a development Sheet only; never the production Sheet; verify read-only
   preview and no credential exposure.
4. **Writeback queue**: sign in as staff, queue one bounded intent, verify it
   appears pending, cancel it, and verify statuses; confirm **no Sheet cell
   changes** — delivery is inactive by design at this checkpoint.
5. **Worker pairing**: register the local worker, verify health/heartbeat/
   claim/lease recovery in `/dashboard/automation` with monitoring jobs only.
6. **Reporting correctness**: verify day boundaries with
   `America/Los_Angeles` business timezone, including DST, against real rows.

## Gates that must stay off unless explicitly reauthorized in writing

- Fudge `UPLOAD_RELEASED` and `CATALOG_DOWNLOAD_RELEASED`.
- Writeback delivery to any real Sheet (no deliverer worker exists; enabling
  requires the Sheet-vs-backend ownership decision plus delivery acceptance).
- Any publishing, engagement, onboarding or browser-executed platform action;
  all of those remain paused with manual legacy use during testing.
- No commits of `.env*`, `config.json`, customer exports, cookies, proxies,
  screenshots or private Sheet links (these rules stay in force during
  testing).

## Pending user decisions feeding later phases

- Sheet-vs-backend configuration ownership (gates Fudge catalog download and
  the separately approved rule-application path).
- Original business Sheet ingestion requires a downloaded copy (no Google
  connector is available in this environment); the private link must never be
  committed.
- Email verification sender address and public HTTPS site URL.
- Disposition of git-ignored local `backups/business-source/` snapshots
  (destructive; requires explicit confirmation) and whether to rewrite
  `9fa056c` history for generic fixture words (recommended against).

*End of checkpoint. Both repositories must keep this file byte-identical
until live testing concludes and a dated post-testing record replaces it.*
