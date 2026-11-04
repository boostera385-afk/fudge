# Database acceptance: Fudge intake v1 - 2026-11-04

This records what was actually verified against the hosted shared database on
2026-11-04, and what was not. It is database-contract evidence only. It is not
an installed-extension, Google, Drive or client acceptance test.

## Environment

- Hosted project: `xtefjnfdjnxwrpkoydaj` (the same project the dashboard uses;
  no separate Fudge database).
- Migrations at run time: 34. `fudge_ingestion_v1` is hosted as
  `20261028203642`; the local source name is
  `nd-automation/supabase/migrations/20261028203213_fudge_ingestion_v1.sql`.
- Contract read from the live database, not from the repository copy:
  - `public.reporting_ingest_fudge_reviews_v1(org uuid, reviews jsonb)` -
    SECURITY INVOKER, empty `search_path`, delegates to
    `private_reporting.ingest_fudge_reviews_v1`.
  - Private implementation is SECURITY DEFINER with explicit verified-staff and
    `auth.uid()` checks.
  - `anon` has no EXECUTE on either function; `authenticated` has EXECUTE on
    both. `anon` has no SELECT on the tables.
  - `reporting_fudge_records` and `reporting_fudge_revisions` have RLS enabled,
    `authenticated` holds SELECT only, and the only policies are staff-read
    (`private_reporting.is_staff`). No client INSERT/UPDATE/DELETE path exists.

## Method and rollback proof

The MCP SQL connection runs as `postgres` (`bypassrls`, not superuser), which
allows fixture creation while still exercising real permission paths.

- Each run built its own throwaway organization, auth users and memberships
  inside one `DO` block.
- Real permission paths were tested with `SET LOCAL ROLE anon` /
  `SET LOCAL ROLE authenticated` plus `request.jwt.claims`, so RLS, grants and
  the staff gate were actually evaluated rather than bypassed.
- Every run ended with a deliberate `raise exception`, aborting the transaction
  before commit. Results were carried out in the exception message.
- After all runs: `reporting_fudge_records = 0`,
  `reporting_fudge_revisions = 0`, `0` smoke organizations and `0` smoke auth
  users remained. Nothing persisted.

Two authoring mistakes in the test SQL itself (a uuid-typed variable used for a
count, and an `int` cast of a boolean) raised `22P02`/`42`-class errors during
drafting. Those were defects in the probe, not in the schema; they were
corrected and re-run green. They are noted so the record is not overstated.

## Results - 41 checks, all correct in final state

### Positive path, replay and ownership (9)

- Valid 2-review staff batch -> 2 records, 2 revisions, each `revision = 1`,
  `inserted_record = true`, `inserted_revision = true`.
- Counts after the first batch: records 2 / revisions 2.
- Byte-identical replay -> `inserted_record = false`,
  `inserted_revision = false`, same `revision_id`, counts unchanged.
- A more complete copy of the same identity -> `revision = 2` on the same
  record; `record_id` unchanged.
- Revision 1 text still held the original text after the upgrade (first payload
  is never overwritten).
- Cross-workspace write (staff of A calling with B's org) ->
  `42501 Verified workspace staff required`.
- RLS read scope for staff of A: own workspace 2 rows, other workspace 0.
- Non-member `authenticated` user reading both tables -> 0 rows.

### Rejections and boundaries (27)

| Denied or rejected | Observed |
| --- | --- |
| `anon` calling the RPC | `42501 permission denied for function` |
| `anon` selecting the tables | `42501 permission denied for table` |
| Authenticated with no JWT | `Verified workspace staff required` |
| Non-member authenticated user | `Verified workspace staff required` |
| Member whose email is not verified | `Verified workspace staff required` |
| Non-existent organization id | `Verified workspace staff required` |
| Duplicate identity within one batch | `Duplicate identity within batch` |
| `observed_at` 6 minutes in the future | `Observation timestamp is in the future` |
| `observed_at` without timezone | `Zoned observation timestamp required` |
| Rating `4.5` | `Invalid allowlisted source payload` |
| Rating `0` | `Invalid allowlisted source payload` |
| Extra payload key | `Invalid allowlisted source payload` |
| Extra envelope key | `Invalid review envelope` |
| `http://` source URL | `Invalid allowlisted source payload` |
| Source other than `google` | `Stable Google review identity required` |
| Identity containing whitespace | `Stable Google review identity required` |
| Identity longer than 512 characters | `Stable Google review identity required` |
| Whitespace-only text | `Invalid allowlisted source payload` |
| Text longer than 30 000 characters | `Invalid allowlisted source payload` |
| `photo_urls` not an array | `Invalid allowlisted source payload` |
| Empty batch | `Batch exceeds count or byte limits` |
| 101-item batch | `Batch exceeds count or byte limits` |
| Direct `INSERT` as `authenticated` | `42501 permission denied for table` |
| Direct `UPDATE` as `authenticated` | `42501 permission denied for table` |
| Direct `DELETE` as `authenticated` | `42501 permission denied for table` |
| 100-item batch (upper boundary) | Accepted, 100 results |
| Rating `5` then `5.0` for the same identity | Same revision, `inserted_revision = false` |

The rating check confirms the documented normalisation: only the rating's
numeric representation is normalised for hashing, so `5` and `5.0` are one
revision rather than a spurious duplicate.

### Operator authorization (3 + 2)

The existing ND Test operator account (email and user id deliberately not
recorded here) was checked as itself:

- Email verified, not banned, member of the `ND Test` organization with role
  `operator`.
- Read before intake: 0 rows for that organization.
- Live staff gate: intake accepted, `revision = 1`.
- Read after intake: exactly 1 record and 1 revision, its own workspace only.

This check asserted the account's identity as JWT claims inside an aborted
transaction. No password, OTP, session token or sign-in was used, and nothing
was created, changed or stored for that account.

## Local suites re-run the same day

- `node --test tests/backend.test.js` - **67 passed**.
- `node --test tests/setup.test.js tests/versions.test.js` - **19 passed**.
- `node tests/smoke.test.js` - **138 assertions passed**.

These are fixture-based offline suites. They do not exercise Google, Drive,
the connector or a real browser.

## Not proven by this record

- The installed extension UI, its Auth sign-in, storage and service-worker
  restart behaviour.
- The Sheet/Drive connector round trip, inventory allocation or writeback.
- Backend upload. `UPLOAD_RELEASED` and `CATALOG_DOWNLOAD_RELEASED` remain
  `false` and were not changed.
- Cross-account isolation with real end-user accounts (only the operator's own
  workspace and synthetic fixtures were exercised).
- Rate limiting and concurrency beyond the transaction-scoped advisory lock.
  Concurrent submissions were not tested here.

## Still required before live acceptance

- A dedicated development Sheet and Drive location, created and authorized by
  the owner. The acceptance checklist forbids using a production Sheet.
- An installed browser session signed in as an authorized staff user.
- Per-step evidence for `docs/FLOW-ACCEPTANCE-CHECKLIST.md` steps 1-6.

This record was committed on the owner's request. No database changes were made.
