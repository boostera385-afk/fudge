# Supabase raw-ingestion foundation

## Shared-backend implementation update (2026-10-28)

The active cross-system target is the existing shared dashboard backend
`xtefjnfdjnxwrpkoydaj`. The workspace-scoped revision-aware intake is now deployed:
dashboard source `supabase/migrations/20261028203213_fudge_ingestion_v1.sql`, hosted
version `20261028203642 fudge_ingestion_v1`. See that repository's
`docs/DB-DEPLOYMENT-20261028.md` and `docs/FUDGE-INGESTION-V1.md` for verification.
Extension upload release remains OFF. Do not reapply the shared migration from
this repo or apply this older per-user
milestone unchanged to the shared backend. Its source and historical tests below
remain preserved, not silently migrated or deleted.

**The remaining sections describe the superseded per-user local milestone, not
the active shared-backend deployment. Do not follow its deployment steps or call
its old RPC against the shared project.** No separate Fudge database is needed.
Existing collection/Sheets remain available; no historical library was uploaded.

## What is implemented

`supabase/migrations/202610280001_raw_ingestion.sql` creates an append-only raw-review table and an authenticated PostgreSQL RPC. Each record belongs to the authenticated Supabase user, who can read only their own records under row-level security. The RPC validates an entire batch in a single database transaction, accepts 1–100 records and at most 1 MiB, and identifies records by `(owner_id, source, source_review_id)`.

Replaying an identifier returns its existing database ID without overwriting the original payload. This also means a later, more complete copy is **not** automatically merged: a versioned revision mechanism is needed before enabling ingestion of upgrades. IDs without a reliable stable source identity require a separately reviewed strategy. User accounts are isolated; shared-team access is not implemented.

## Before deployment

1. Create or choose a Supabase project and use a **separate development environment** first. Do not run the migration on a production project without reviewing its security, retention, backup, deletion, and data ownership requirements.
2. Review and apply the SQL migration using your normal Supabase migration workflow. This repository does not provision a project, configure authentication, or deploy anything automatically.
3. Configure Supabase Auth for authorized users. Use a user access token and the project's publishable key for client calls. Never embed or distribute the service-role key. Keep secrets out of Git.
4. Run `psql -v ON_ERROR_STOP=1 -f supabase/tests/raw_ingestion.sql` against a disposable project after migration. It checks user isolation, anonymous and direct-write rejection, sequential deduplication, and invalid-batch atomicity, then rolls back. Also test concurrent submissions and oversized batches independently. These database-level tests have **not** been run in this environment.

## RPC contract

Call the PostgREST RPC `fudge_ingest_raw_reviews` as an authenticated user with JSON such as:

```json
{
  "p_reviews": [
    {
      "source": "google",
      "source_review_id": "example-stable-id",
      "payload": { "text": "Example original text", "sourceUrl": "https://example.com/" }
    }
  ]
}
```

The result is an array of `{source, source_review_id, id, inserted}` in input order. `inserted: false` means that identity already existed; its payload is not replaced, even if the submitted payload differs. If validation or any database operation fails, the whole request fails and no item in that request should be treated as acknowledged. After a lost response, retrying the same identifiers is safe. Enforce network, request, and account rate limits at the API/project layer before production; the function's batch limits are not rate limiting.

## Remaining work

Current extension source now implements optional Auth/workspace setup and the MV3
durable queue with local/mock tests; see [Backend uploader](BACKEND-UPLOADER.md).
Release stays off. This older milestone is not the deployment contract for the
new workspace/revision protocol.

- Complete real-browser/Auth/REST/concurrency acceptance for the implemented optional Auth/queue and deployed workspace/revision migration, then an approved small pilot; do not disable the current Sheets workflow.
- Resolve retention, consent, deletion, storage-pressure policy and local-to-backend reconciliation; shared workspace/revision storage is already deployed.
- Agree on the Source Sheet and ND Master columns, cleanup rules, approval flow, authorized Incogniton actions, and result verification before implementing those integrations.
