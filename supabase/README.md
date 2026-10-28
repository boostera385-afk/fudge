# Fudge database boundary

Fudge and the dashboard use **one shared Supabase project**:
`xtefjnfdjnxwrpkoydaj`. Repository changes do not create a separate database.

## Already applied — do not apply again

Hosted `20261028203642 fudge_ingestion_v1` creates the workspace-owned
`reporting_fudge_records`, `reporting_fudge_revisions` and authenticated
`reporting_ingest_fudge_reviews_v1(org, reviews)` RPC used by this extension.
Canonical migration source/history belongs in the dashboard repository, not a
second copied migration chain here. The shared project had seven migrations and
19 public RLS-enabled tables at the dashboard session's final verification.
Reverify through this repo's MCP before assuming the current state.

`migrations/202610280001_raw_ingestion.sql` and `tests/raw_ingestion.sql` are
preserved **superseded per-user experiments**, not the shared deployment contract.
Do not apply them, blindly push this directory or reset the database. They have
different ownership, RPC and receipt semantics from the current extension.

## Connect MCP here

1. Open `/mcps`, select **supabase**, and authenticate if requested.
2. If configuration has not refreshed automatically, run `/reload`.
3. Verify the runtime URL is `https://xtefjnfdjnxwrpkoydaj.supabase.co`, inspect
   migration history and confirm `20261028203642` before any changes.

Project-local `opencode.json` uses OAuth and restricts the connection to this
project. Migration, SQL and Edge Function deployment approvals remain enabled;
account/branching tools are excluded. No access token is stored in configuration.
Configuration alone is not proof of successful authentication. After this file
was added, MCP reconnected and read-only checks from the Fudge session verified
the correct URL, all seven migrations and both intake tables/RPC on 2026-10-28.

There is currently **no additional Fudge-specific migration identified**. The
next work is acceptance/configuration, not duplicate DDL. Extension Auth sign-in
uses its own verified staff user session; MCP sign-in does not sign in Fudge.
`UPLOAD_RELEASED` stays false pending the documented browser/policy/pilot gates.
