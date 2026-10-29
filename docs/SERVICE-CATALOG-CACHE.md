# Backend service-catalog cache — gated development implementation

Updated: 2026-10-29. **Downloads OFF; rule application is not implemented.**

`backend-catalog.js` validates v1 published snapshots and keeps one last-known-good
snapshot per authenticated-user/business key. It is configuration, never authority
to upload, approve content, use media, create memberships or run a browser job.
No catalog is applied to `serviceRules`, shared classification or Sheet sync.

## Implemented

- Exact snapshot/13-field rule validation, supported UUIDs, explicit flags, bounded
  text and arrays, 1–500 rules, 256 KiB client rule budget and collector-key collision
  rejection. The backend draft has a separate 512 KiB JSONB storage ceiling.
- Positive monotonic activation generation independent of revision number, allowing
  an explicitly published rollback to an older revision with a newer generation.
- Same-generation changed content is a conflict, not an overwrite. Object key order
  alone does not cause a conflict; term/rule array order is preserved.
- Serialization within one cache instance. New malformed/conflicting responses or
  failed writes do not replace the saved snapshot. Auth/permission failures and
  no published configuration are not permission to use cached rules.
- Cache module can retain/return a saved preview on a transient download failure;
  a full browser restart preserves local cache data. Different accounts/businesses
  never inherit that preview. Saved local data is validated, not cryptographically
  signed; do not treat browser storage as a trusted authorization source.
- Internal setup command rechecks current user and business membership before a
  read RPC; if those online checks fail, it does not bypass them using the cache.
  The UI receives metadata, not full rules. No unreviewed automatic refresh occurs.

`CATALOG_DOWNLOAD_RELEASED = false` in `backend-worker.js` blocks the command before
network work; the setup button stays disabled. `UPLOAD_RELEASED` independently
remains false. The read RPC is `reporting_get_service_catalog_v1`; its database
implementation is deployed from dashboard source `20261029165237_service_catalog_v1.sql`
as hosted `20261029165416`, with FK indexes source `20261029165727` / hosted
`20261029165815`. See dashboard `docs/DB-DEPLOYMENT-20261029-CATALOG.md`. Hosted
rollback-only SQL smoke passed and retained no fixture rows. Do not enable downloads
merely because SQL passed; actual Auth/REST/permissions and ownership acceptance remain.

## Remaining gates

Real REST/Auth/RLS/connection contention; live acceptance of dashboard inactive
staging, exact revision diff/activation UI and explicit approval; freshness/retention/deletion
policy and storage-pressure bounds; offline-expired-auth behavior acceptance;
browser recovery; classification fixtures; and single-writer handoff from existing
Services sync. The cache does not itself clear, merge or replace any current rules.
No production rule catalog or user's historical workbook has been imported.

Validation: `node --test tests/backend.test.js` 67 PASS; `node tests/smoke.test.js`
127 PASS; cache/service/setup syntax checks PASS. Tests use fixtures/fake release
flags only. These are not live load/performance or crash-safety acceptance.
