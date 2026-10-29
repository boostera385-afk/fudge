# Fudge + ND Master Automation Implementation Guide

Plan version: 1.0 | Updated: 2026-10-28 | Status: proposed implementation, not delivered automation.

## 1. Purpose and authority

Unify Fudge collection, cleanup, approval, ND Master, local Incogniton execution, profile operations, post checks, comments and reporting in one dashboard. Automate routine work; reserve people for content authorization, identity challenges, uncertain results, policy decisions and destructive changes.

This guide is saved identically in both repositories at `docs/MASTER-AUTOMATION-PLAN.md`. The dashboard copy is the editing authority for cross-system architecture; update the Fudge copy in the same change. Repository instructions and actual implementation-status records remain authoritative for permissions and delivered functionality. This guide does not authorize deployment, paid resources, production writes, commits or live browser actions.

## 2. Reviewed baseline and important limits

Sources: Fudge `docs/RECOMMENDED-WORKFLOW.md`, `docs/SUPABASE-FOUNDATION.md` and raw-ingestion SQL; supplied workbook inspected read-only; dashboard `AGENTS.md`, `docs/IMPLEMENTATION-STATUS.md`, `docs/WORKBOOK-WORKFLOW-REVIEW.md`, `docs/DASHBOARD-PARITY-ROADMAP.md`, `docs/WORKER-BRIDGE.md`, `docs/PUBLISHING-PROTOCOL.md`, Sheet connector documentation and monitoring agent source. No live Sheet, signed-in platform workflow or target database was validated for this plan.

| Existing part | Actual boundary | Next responsibility |
| --- | --- | --- |
| Fudge extension | Local collection and existing Sheets/Apps Script workflow; no Supabase uploader | Local-first authenticated upload with durable retry and progress |
| Fudge raw SQL | Undeployed, per-user append-only ingestion foundation | Reconcile ownership with dashboard workspaces; add revision handling before connection |
| Source Sheet | Separate cleanup interface described by user; exact layout not supplied | Confirm mapping, editable columns and explicit approval representation |
| Operational workbook | Seven task tabs; snapshot, not a live connection | Map safe named columns and quarantine unheaded side-data |
| Dashboard | Next.js/Supabase reporting, drafts, profile inventory, Sheet preview and monitoring controls in source | Central orchestration and exception-focused daily UX |
| Local monitoring agent | Narrow outbound RPC allowlist; one post per profile visit; not live-accepted | Pair safely, validate selectors, pilot checks/comments |
| Publishing protocol | Local-only SQL and inspection UI; no connected publisher/release button | Reviewed submit adapter, durable recovery and gated release |
| Desktop automation | Profile, cookie/proxy, onboarding, posting/listing and other flows remain present | Preserve until each tested worker replacement is accepted |
| Sheet connector | Safe metadata read/import; no writeback | Durable, restricted, versioned synchronization |

The user-selected single shared Supabase target is `xtefjnfdjnxwrpkoydaj` (2026-10-28), used by both Fudge and the ND dashboard. This supersedes the earlier selection of `tyczcognqypqxrvkbmrk`; do not connect it as a second ingestion database or synchronize projects. Earlier hosted results for the selected project are historical, not proof of current schema/Auth readiness. Reinspect it before changes and preserve existing data, migrations and authorized access. The other project is left untouched; deletion or repurposing requires separate approval.

The prior workbook review records 68 Posted-prefixed rows without exact links, empty declared profile IDs, unknown publication dates and unheaded side-data. Recheck these against the current live Sheet before remediation. Imported Posted is an unverified claim, never proof of live visibility. Sheet-generated IDs are not Incogniton UUIDs.

Development-copy update (2026-10-28): all seven screenshot-listed ND Master tabs were verified by header-only reads; exact safe mappings are saved in the dashboard repository's `docs/ND-MASTER-SCHEMA.md`. This is not a data-row audit. The profile-creation tab's screenshot shows a mixed posting-schema region requiring quarantine; the Bulk proxy import tab is actually a cookie-import layout. Keep development IDs private, production untouched and execution/writeback disabled until their separate gates pass.

## 3. Target architecture and system ownership

```text
Google source pages -> Fudge -> local library + durable upload outbox
                                      |
                               authenticated ingestion
                                      v
                     Supabase: original records + revisions
                                      |
                      cleanup / validation / duplicate flags
                                      v
                  Dashboard review <-> optional Source Sheet view
                                      |
                       approved content + exact target snapshot
                                      v
                    durable jobs + explicit session authorization
                                      |
                         outbound-only local worker polling
                                      v
                         Incogniton / authorized browser flow
                                      |
                         exact result + evidence / ambiguity
                                      v
                 publication ledger -> exact-post check/comment jobs
                                      |
                  dashboard results + durable ND Master sync outbox
```

- Supabase is the durable system of record and queue. The dashboard is the control interface, not a browser execution host.
- Fudge owns local collection and original provenance; collection must continue through backend outages.
- A hosted application worker handles cleanup and Sheet synchronization; a local worker alone handles Incogniton/browser tasks. Select hosting after measuring runtime and volume.
- Sheets are projections and designated human-input surfaces, not independent task engines. Assign one writer per field during migration.
- The local worker polls over HTTPS. Never expose Incogniton, debugging ports or a generic remote-code endpoint.
- Keep Fudge and the dashboard as separate repositories with a versioned API contract, not copied application trees. Add compatibility checks before changing a contract.
- Retain desktop launchers, `core/` and `gui/`; do not run legacy and new jobs concurrently on the same profile.

## 4. Operating model: minimum necessary human involvement

| Work | Automatic after setup/authorization | Human gate |
| --- | --- | --- |
| Collection | Local save, deduplication, upload, retry, reconciliation | Explicit collection consent/start; rights and retention policy |
| Cleanup | Deterministic normalization, validation, service rules, duplicate suggestions | Ambiguous matches or material content changes |
| Approval | Queue and notify; reuse unchanged approved revision | Approve exact content, destination, audience and media; reviewed batch approval allowed |
| Publishing | Dispatch approved jobs during active authorized session; capture result | Explicit session release and approval; changed content/target invalidates authorization |
| Checks/comments | Due scheduling, exact-link checks, comment deduplication, safe writeback | Removal evidence review, unknown identity, incomplete/ambiguous page |
| Profiles | Inventory refresh, readiness checks, approved creation/maintenance jobs | Genuine onboarding data, verification, cookie/proxy replacement |
| Reposting | Detect candidates and prepare linked draft | Fresh approval and policy review; never automatically repost removed content |
| Recovery | Safe network retries and result reconciliation | Possible duplicate submission, destructive changes or unknown external effect |

No artificial engagement, random likes/comments, manufactured testimonials, CAPTCHA bypass, identity evasion or proxy rotation to evade restrictions. Third-party reviews/photos require lawful, permitted use; do not present another customer's experience as an account holder's own experience. Comment collection does not authorize replying, deleting or blocking.

Start work once per 8–10 hour session and explicitly authorize the permitted task families/profiles. Pause/end blocks new claims; it does not falsely report that an in-flight submission was stopped. The current agent's eight-hour exit remains until a reviewed change. No unattended 24/7 browser operation is part of this plan. While the machine is off, show stored results and stale timestamps honestly.

## 5. Data model and stable identities

Reuse/extend existing `reporting_*` entities instead of creating a parallel customer, profile or publication ledger. Names below are logical responsibilities, not instructions to create duplicate tables.

| Entity | Required identity / information |
| --- | --- |
| Workspace/customer | Tenant ID, authorized membership/role, customer timezone |
| Raw record/revision | Source + stable source ID + workspace; immutable payload, checksum, provenance and observed time |
| Cleaned revision | Raw revision reference, rules version, normalized fields, validation issues |
| Content/approval | Immutable content revision, target/customer/profile UUID, audience, approved media manifest, reviewer/time |
| Profile assignment | Actual Incogniton UUID, worker, customer, account label, inventory claim versus observed readiness |
| Task/job attempt | Type, immutable payload version, deduplication key, lease token, deadline, attempt and recovery state |
| Publication | Internal ID, canonical external ID/URL, exact profile/customer, sourced or unknown publication time, parent repost reference |
| Check/comment | Exact publication, outcome/evidence, observed UTC time, source; stable external comment ID and collection completeness |
| Sheet mapping/outbox | Spreadsheet/tab identity, stable record ID, mapping version, expected version, delivery state |
| Audit/session | Actor, action, target, session authorization, server timestamp; redacted metadata |

Resolve the per-user Fudge versus workspace dashboard ownership model before applying ingestion SQL. An authenticated uploader must have permission for its selected workspace; never trust a client-supplied tenant ID alone. Define cross-workspace deduplication policy without exposing another tenant's records.

The first raw payload must remain immutable. A fuller recapture creates a linked revision, not silent replacement or permanent suppression by the original deduplication key. Unreliable source identities go to a reviewed fallback strategy. Unknown historical dates stay unknown; store all event times in UTC and display business time using `America/Los_Angeles` by default, with explicit customer override and separate device time.

## 6. End-to-end implementation contracts

### A. Fudge collection and upload

P2 checkpoint (2026-10-28): workspace/revision intake source `supabase/migrations/20261028203213_fudge_ingestion_v1.sql` is applied through MCP as hosted `20261028203642` after explicit approval. Local tests and hosted rollback-only receipt/revision/RLS/denial smoke checks passed; see dashboard `docs/DB-DEPLOYMENT-20261028.md`. Fudge implements optional verified-account/workspace setup, trusted session-only Auth tokens, immutable capture intents, bounded retries, strict receipts and cancellation epochs; see Fudge `docs/BACKEND-UPLOADER.md`. Upload release remains false. Real-browser/REST/concurrency acceptance, backup/restore, retention/deletion and an approved pilot remain pending; no real source or historical library was uploaded. Publishing protocol is not deployed. P2 is incomplete; do not apply older per-user SQL unchanged.

Email setup checkpoint (2026-10-29): Fudge and dashboard share one configured Supabase Auth project. Fudge signup/login uses bundled public identity; one authorized business auto-selects paused, multiple businesses remain advanced, and first-time private account setup is explicit. Dashboard account setup no longer requires a workspace-name form. Internal tenant isolation remains; shared credentials are not shared sessions. Live email/browser acceptance is pending and upload release stays false.

1. Add opt-in backend setup with authorized Supabase sign-in, workspace selection and connection test. Never package service-role/secret keys.
2. Persist review plus upload intent before scheduling network work; upload status must not modify existing Sheets acknowledgment state.
3. Use bounded batches and request timeouts. Existing raw RPC accepts 1–100 records and its database 1 MiB limit; client request-byte limits must be explicit and leave serialization overhead. Oversized individual records need a visible repair path.
4. Use MV3-compatible alarms/startup recovery; do not rely on service-worker memory or continuous timers. Serialize local queue mutations and preserve acknowledgments across browser restarts.
5. Refresh sessions safely; distinguish sign-in required, forbidden, invalid record, rate limit and transient failure. Apply jittered bounded backoff; stop automatic retries for permanent errors.
6. Acknowledge only after validated durable backend confirmation. Lost responses replay stable identities safely. Reconcile counts/IDs, not just a green upload indicator.
7. Historical local-library upload is separately opt-in. Show pending, uploaded, retrying, blocked and last success; backend disconnect must not erase local reviews or silently reassign queued data to another workspace.

### B. Cleanup, review and approved content

P3 visibility checkpoint (2026-10-29): dashboard `/dashboard/fudge` adds staff/verified-email-gated backend counts and bounded revision metadata; Fudge setup exposes bounded saved acknowledgment IDs for comparison. Failed reads are not zero, local backlog is not visible from the dashboard, and separate queries are not an atomic reconciliation snapshot. Live UI acceptance, automated reconciliation, backend keyword management, review/approval and durable Sheet writeback remain incomplete. No upload release or browser execution enabled.

Apply versioned deterministic rules first; AI assistance is optional, metered and never changes the raw source. Validate text, service classification, links and media rights; suspicious duplicate matches need review. Normalization that does not alter meaning can be automatic. Material rewrite remains a draft.

Approve exact revisions in the dashboard or designated Source Sheet approval columns. Sheet approvals must map to an authorized reviewer and expected revision; a typed Approved value from an unauthenticated source is insufficient. Bulk approval requires a reviewable preview and explicit confirmation. Editing content, audience, customer, profile or media after approval requires reapproval.

### C. ND Master synchronization

Agree the two Sheets' IDs, tab names and column mappings before enabling writes. Reuse the separate dashboard connector; do not replace deployed Fudge/desktop scripts in place. First add restricted, authenticated, allowlisted write operations with replay protection, stable IDs, version checks and a durable delivery outbox. Validate both HTTP and application-level success. Restrict destination IDs server-side; never accept arbitrary spreadsheets from jobs.

Append dedicated fields where approved: `Record ID`, `Profile UUID`, `Published At`, `Check Outcome`, `Checked At`, `Check Reason`, `Sync Version`. Preserve existing `Post link` and execution `Status` semantics until cutover. A removed/moved row is a reconciliation event, not permission to target its former row number. Version mismatch raises a conflict; retrying sync never repeats publishing.

### D. Profile operations and authorized onboarding

Refresh real inventory through the local worker and reconcile exact UUIDs; duplicate names require explicit resolution. Inventory does not prove account readiness. Provide safe create/launch/stop/status tasks with explicit target and permissions. Store credentials in an OS-protected local vault, referenced by opaque local handles; do not upload passwords, cookies or proxy secrets to the dashboard.

Validate profile-creation results and persist the actual returned UUID. Keep genuine account onboarding separate from profile creation. Pause at identity/verification challenges for a person. Cookie/proxy changes require preview, replacement confirmation, redacted result and recovery instructions; protect exports with retention/deletion controls. Browser API health does not prove authentication or platform access.

### E. Controlled posting and listings

Reuse audited legacy flows behind typed adapters; fix legacy success-without-link and link-plus-chat-text results before use. Each allowlisted task snapshots approved content, profile, audience and validated attachments. Limit media size/type, validate approved paths/origins, prohibit arbitrary local file access, and check actual attachments before submitting.

Before submission, verify logged-in identity and intended audience. Persist a local submit-intent journal before the irreversible action. After submission, capture the exact new canonical kind-matching URL and result time; never select the first visible post as a fallback. Save the local result durably before sending it to the backend. Replay result submission safely without replaying the browser action.

Unknown outcome, crash after submit, or missing URL means `needs_reconciliation`, not safe retry or verified success. Follow the current publishing protocol's stricter permanent draft/revision deduplication and ambiguity guards; do not weaken them to enable reposting. Reposting is a new approved draft linked to the original publication and blocked until ambiguity is resolved. Missed publishing windows require review rather than a catch-up burst.

### F. Previous-100 checks and comments

Implement a dedicated per-profile policy; the existing limit of 100 due jobs per poll is not this requirement. Define previous as latest 100 known-dated tracked publications for the exact profile, using a deterministic tie-breaker. Show unknown-date links in a separate reconciliation cohort and older unchecked backlog separately. Confirm whether listings share the 100 limit or have their own quota before enabling this policy.

Do not claim full profile-history coverage from an incomplete imported ledger. Show known tracked count, missing-link count, unknown-date count, eligible count, checked count and remaining count. Historical platform discovery, if needed, is a separately authorized bounded adapter—not an assumed capability.

Schedule next-session checks for eligible prior-day publications and subsequent checks according to an explicit policy. Preserve the current 24-hour suppression including failed checks until a versioned retry policy is approved. Technical failures may later receive bounded safe retries; login/verification problems wait for intervention.

#### Required daily workflow: publish 100 today, refresh their status with one click tomorrow

- User requirement: after publishing 100 posts today, from the next business day the operator can choose that publication-date cohort and click **Refresh post statuses** once. The system queues and checks the exact recorded posts automatically; no manual opening of each post/profile or individual status entry is required.
- This is a date-cohort check across the explicitly authorized profiles, distinct from the latest-100-per-profile policy above. Default to yesterday in the customer's business timezone, allow an earlier date, and keep newly published posts out of the selected prior-day cohort. Preserve cohort membership and report missing URLs or unknown publication dates separately; do not silently replace missing posts with other records.
- The button operates inside an active work session with explicitly authorized monitoring profiles. If setup or authorization is missing, show that prerequisite instead of silently authorizing profiles or starting browsers. The single click starts bounded background checks and live progress; it does not promise instant completion or unrestricted concurrency.
- Show cohort total, queued, running, checked, needs attention, missing-link and remaining counts, last observation time, and per-post outcome. Automatically update dashboard results and enqueue mapped ND Master check-field writeback after durable result commit. A failed Sheet delivery retries synchronization only. Never clear execution Status or trigger a repost.
- A first next-business-day check must be eligible even if publication was less than 24 hours ago; publication age is not check freshness. The current 24-hour suppression since an existing check remains the baseline. Before implementation, add a versioned explicit-refresh policy: a completed older check may be refreshed by this button, while a configurable freshness window, rate limits and pending/leased-job deduplication prevent rapid repeated checks. This deliberate refresh behavior requires new tests; it is not delivered by the current planner.
- Double-clicks, page refreshes, repeated requests and overlapping scheduled checks must reuse active jobs. Show recent results as recent rather than pretending they were checked again. Closing the dashboard must not lose queued work; actual execution still depends on worker availability and session authorization. Resume or reconcile interrupted work safely next session.
- Report Alive only from an exact-post observation. Login needed, Verification needed, Proxy issue, Network problem, Not accessible and Needs review are separate outcomes, not deletion. Confirmed removal requires validated evidence under the removal policy; the current adapter still cannot confirm it automatically. Available comment collection may share the visit without claiming complete coverage.
- Acceptance: create a fixture cohort of 100 publications, verify one click queues each eligible exact link once, exercise double-click/concurrent scheduler/offline-worker/session-end/restart scenarios, and reconcile every cohort item to a result, explicit skip or unresolved reason. Then perform the separately approved small live pilot before a 100-post operational check; this requirement is not authorization to publish 100 live posts for testing.

Check the exact URL and record Alive, Needs review, Login needed, Verification needed, Proxy issue, Network problem, Profile error or Not accessible honestly. No inaccessible page alone proves deletion. The current automated adapter does not confirm removal; add that only with validated positive evidence and human review gates.

Collect stable-ID comments linked to that exact publication; distinguish platform creation time from observation time, unknown author from inferred author, and unknown totals from zero. Record pagination/collapse limitations and completeness. Start with partial read-only collection, expand after validation; do not equate unread chats with comments. Deleted/edited comment detection requires explicit later support, not inference from one incomplete fetch.

Optimize profile visits only after baseline correctness: acquire exclusive profile ownership, process a bounded group with per-post results/checkpoints, close safely and release. Update the existing one-job lease protocol before batching; do not hold multiple untracked jobs in memory.

## 7. State, queue and recovery rules

- Content: `collected -> validated / needs_review -> approved / rejected`; an edit creates a new revision.
- Execution: `queued -> leased -> submitted / failed / needs_reconciliation`. Submission is not visibility verification.
- Observation: independent outcome history plus last sourced summary; technical failures never overwrite a previously observed visibility as removed.
- Sync: `pending -> delivered / retrying / conflict / failed`; independent from browser execution.

Use database transactions, unique deduplication constraints and atomic lease claims. Serialize all task families on the same profile, including legacy execution. A paused/expired session prevents new claims. Heartbeat loss, expired lease or credential revocation is not proof the browser stopped; reconcile ownership before reassignment.

Queue delivery is at-least-once; external browser side effects cannot be promised exactly-once. Use intent journals, result replay and reconciliation. Network retry, browser retry and Sheet retry are different operations. Define per-type attempt limits and dead-letter/manual-review reasons. Validate task schemas and payload sizes; workers reject unknown types, arbitrary code, unsafe URLs and unexpected fields.

## 8. Dashboard experience and observability

Implementation checkpoint (2026-10-28): staff-only `/dashboard/settings/sheet-setup` now provides numbered instructions, canonical connector-code copy, Sheet-ID extraction, private token generation, workspace-filled environment copy and a test of saved server settings. Organization staff reuse the connection. Admin environment save/restart remains required; this is not automatic server-secret persistence or a release of browser/writeback automation.

Keep the five daily sections: Home, Master Sheet, Run automation, Profiles and Results. Put advanced configuration under Settings / More. Add a clear Fudge ingestion/review view and publishing queue without requiring staff to re-enter cleaned content or every post manually.

Home should show real pending approvals, blocked tasks, stale workers, missing links, ingestion lag, sync conflicts and check coverage. Run shows allowed task families, active session, exact profile scope, queue counts and pause/end behavior. Results separates submission, visibility, comments and sync status, with actual timestamps and evidence provenance. Never show invented live metrics.

Notify people on actionable exceptions and daily summary, not every successful task. Correlate extension record -> backend revision -> job -> publication -> check -> Sheet delivery using IDs. Monitor queue age, retries, ambiguity, worker heartbeat, duplicate prevention, sync lag and profile coverage. Redact credentials and unnecessary personal content from logs; keep evidence access restricted and retention bounded.

## 9. Security, Supabase and deployment

Verify the requested project and inspect existing schema/migrations before any write. Reconcile hosted versions with source filenames; never reset production or blindly push migrations. Establish separate development/staging and production environments, backups, tested restore, retention/deletion rules and owners. Select a Supabase paid/free tier only after measuring storage, connections, egress, Auth, recovery needs and budget; this guide makes no pricing claim or purchase authorization.

Use verified user Auth, workspace/customer RLS, least-privilege RPCs and tenant isolation tests. Workers use narrowly scoped revocable credentials, never service-role keys; preserve the current monitoring allowlist until new task protocols are reviewed. Require reauthentication/confirmation for sensitive administrative actions. Use HTTPS, origin/redirect validation, application rate limits and server-side destination allowlists. Restrict Sheets and private media access. Do not automatically carry forward public image-sharing settings.

Prefer ordinary PostgreSQL constraints, indexes and transactions. Enable no Postgres extension without a concrete need/security review. Existing monitoring needs no vector database. Database scheduling, if later chosen, may plan permitted backend work but must not bypass active browser-session authorization. Do not place credentials in SQL jobs. No new Nextdoor API is proposed.

## 10. Phased delivery backlog and acceptance gates

| Phase | Implement / owner | Required exit evidence |
| --- | --- | --- |
| P0 Discovery and safety | Dashboard lead: confirm source/master mappings, volume, rights, policies; inventory every F01–F36 item and its disposition | Signed mapping/ownership decisions, protected backup, explicit test accounts; no silent feature removal |
| P1 Backend readiness | Dashboard/backend: verify target, reconcile migrations, Auth/RLS and workspace setup | Correct project, authorized login, isolation/negative-access tests, restore procedure; separate deployment approval |
| P2 Fudge ingestion | Extension + backend: versioned workspace contract, revision model, durable outbox, status | Offline/restart/expired-auth/lost-response/duplicate/oversize tests; original records preserved and IDs reconcile |
| P3 Review and Sheet bridge | Dashboard + connector: revisions, approval, stable IDs, outbox, conflicts | Row moves, duplicate deliveries, human edits and partial failures do not lose/overwrite data; no posting side effects |
| P4 Monitoring pilot | Worker + dashboard: pairing, exact UUIDs, validated adapter, checks/comments, 100-policy | Small read-only pilot, technical/identity failures, truthful coverage and partial comments; approved 20-publication next-session acceptance |
| P5 Controlled publishing | Worker + dashboard: release controls, typed adapters, media, intent journal, recovery | Fixture tests then explicitly approved small live pilot; exact links, no blind duplicate submission, shutdown/revoke recovery |
| P6 Profile operations | Worker: inventory/create/launch/stop, approved local cookie/proxy workflows and genuine onboarding | UUID reconciliation, secret exclusion, human verification handoff, destructive confirmations; per-feature sign-off |
| P7 Repost and operational scale | Dashboard/worker: approved linked repost drafts, bounded visit batching, capacity tuning | Policy gates, ambiguity blocks, collision tests, measured latency and workload limits |
| P8 Cutover | Operators + engineering: end-to-end acceptance, backup/recovery drills and legacy retirement | Each F01–F36 item tested or explicitly deferred; one writer per field/profile; rollback rehearsed |

No calendar or throughput promise is made before P0 measurement. Scope each phase into small reviewed changes and keep production feature flags off until its exit gate passes.

## 11. Validation checklist for implementers

- Fudge: `node tests/smoke.test.js`; add uploader/revision/auth/storage/restart fixtures and documented manual MV3 lifecycle acceptance.
- Dashboard from `apps/web`: `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run build` when applicable. Record exact results; historical passes are not current passes.
- Worker from `apps/worker`: `python -m unittest discover`; add contract/adapter/journal tests without attaching development browser tools to customer sessions.
- Database: unauthorized/direct-write denial, cross-tenant/customer isolation, invalid worker credentials, stale approvals, payload limits, real concurrent claims and atomic completion. Single-connection embedded tests do not prove production contention.
- Integration: offline/restart, token refresh, duplicate/reordered events, stale worker, lost submit response, expired lease, pause/end/revoke races, proxy/login/verification errors, missing links and Sheet version conflicts.
- Time: Pacific DST, customer override, device timezone and sessions crossing midnight. Unknown publication/comment dates remain unknown.
- Live acceptance needs separate approval: authorized accounts only, exact profile/customer/audience, small volume, recorded expected versus observed outcomes. Never manufacture evidence or mark unrun checks passed.
- Security: no secrets/customer workbook/media in Git; test redaction, credential revocation, local-vault access, restore and retention deletion.

## 12. Daily operation, rollback and recovery

One-time setup: verify workspace and machine; connect Fudge and Sheets; reconcile customer/profile UUIDs; approve mapping and task policies; pair worker; complete pilots.

Daily operator flow: open Home -> resolve critical exceptions -> start work -> approve ready content/batches and permitted task scope -> let ingestion, sync, due checks and approved tasks run -> review exception summary -> end work. Approval is not a universal permission for arbitrary future content or profiles. Login/identity handoffs remain local and explicit.

At shutdown, stop new claims, persist in-flight intent/results, flush what is safe and display unresolved work. Next session reconciles existing results before new submissions; stale publishing schedules do not replay in bulk.

Rollback by subsystem: disable its feature flag/dispatch; stop and reconcile active workers; preserve queued records and audit history; return that field/task family to the documented legacy owner only after ownership handoff. Never clear statuses, delete queues, re-run ambiguous submissions, or reset the database to recover. Keep migration rollback data-preserving; destructive changes need separate approval.

## 13. Decisions required before enabling relevant phases

1. Exact Source Sheet / ND Master spreadsheet and tab mappings; reviewer-owned columns and authenticated approval method.
2. Authorized customers/accounts, content/media rights, cleanup rules and approval owner.
3. Whether the previous-100 policy includes both posts/listings, date ordering, unknown-date treatment and repeat-check frequency.
4. Volume, users, machine availability, retention, acceptable queue delay, recovery objectives and budget.
5. Which profile/onboarding actions are permitted; local vault owner and verification handoff process.
6. Repost criteria, audience policy and missed-schedule behavior; no auto-repost of removed content.
7. Historical migration scope and missing-link reconciliation ownership; no automatic import of credential columns.
8. Production project/environment owner, deployment approvals and feature-by-feature cutover sign-off.

Unresolved decisions block only their affected feature; use fixtures or read-only work elsewhere, not guessed production behavior.

## 14. First developer tasks and handoff discipline

1. Preserve existing uncommitted changes in both repositories. Read applicable `AGENTS.md`; inspect status before edits.
2. Create a phase/F01–F36 tracker with owner, dependency, implementation state, tests, deployment state and acceptance evidence. Link existing roadmap items; do not replace them with a false complete label.
3. Finalize a versioned shared ingestion/ownership contract and Source/ND Master mapping specification using safe metadata only.
4. Inspect the new Supabase target read-only when tools/access are available; propose missing migrations without applying them automatically.
5. Implement and test P2 locally after the P1 schema contract is settled; retain Fudge's existing Sheets flow and local data.
6. Continue P3/P4 before releasing live publishing. Build new adapters against fixtures and require explicit pilot approval.
7. After meaningful changes, update dashboard `docs/IMPLEMENTATION-STATUS.md`, relevant subsystem guide, both master-plan copies and Fudge documentation when its behavior changes. Distinguish implemented, locally tested, deployed and live-accepted.

This plan saves an implementation direction only. No migration, deployment, profile creation, publication, comment action, repost or live Sheet update was performed by creating it.
