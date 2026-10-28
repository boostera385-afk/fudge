# Recommended workflow and implementation plan

> **Mostly a proposal.** Existing collection uses local storage and Sheets. The shared [Supabase intake schema](../supabase/README.md) is deployed and an opt-in uploader is implemented, but upload release remains off pending acceptance/policy/pilot gates. Dashboard draft/approval and monitoring foundations exist; the connected review, ND Master writeback, publishing and results workflow remains incomplete. Use [the master plan](MASTER-AUTOMATION-PLAN.md) and implementation-status records for current scope. The older per-user SQL is not the shared deployment contract.

## Goal

Make the existing workflow easier to monitor and less dependent on slow Sheet operations:

```text
Fudge → source Sheet → cleanup → ND Master Sheet → Incogniton automation → results check
```

Use a backend as the durable system of record and queue, while retaining Sheets as the team's familiar review and approval interface. Keep the current integration available during a staged migration.

## Proposed architecture

```text
Google pages → Fudge extension → authenticated ingestion API
                                     │
                                     ▼
                           Supabase Postgres: raw records
                                     │
                         cleanup / validation worker
                                     ▼
                         cleaned records + review queue
                                     │
                    source Sheet ↔ human corrections / approval
                                     │
                          approved records only
                                     ▼
                              ND Master Sheet
                                     │
                     authorized Incogniton job runner
                                     ▼
                    result verification → job status / Sheet
```

The diagram describes logical responsibilities, not a promise that the existing extension or Incogniton already supports this integration. Confirm its supported APIs and permitted use before choosing an adapter.

## Recommended components

| Component | Responsibility |
| --- | --- |
| Fudge extension | Collect, store locally first, and upload batches asynchronously. Continue scanning when the backend is temporarily unavailable. |
| Supabase Auth and Postgres | Authenticated access, persistent records, jobs, approvals, audit history, and access control. Postgres is the intended system of record. |
| Trusted API / Supabase Edge Functions | Authenticate callers, validate batches, enforce permissions, and expose restricted operations. |
| Background worker | Clean records, synchronize Sheets, claim jobs, retry transient failures, and run reconciliation. Choose hosting after confirming throughput and runtime requirements. |
| Source Sheet | Human inspection, correction, and approval; not the authoritative database. |
| ND Master Sheet | Operational view of approved work and its result status. Actual columns and mapping are to be confirmed. |
| Incogniton adapter | Consume explicitly approved jobs through a supported integration and report results. |
| Results checker | Verify destination state where possible; record evidence, errors, and verification status. |

Supabase reduces reliance on Apps Script for every operation, but cannot eliminate Google page-load times, third-party outages, API quotas, network delays, or the time taken by Incogniton. Measure the existing system and the new system before claiming speed improvements.

## Raw-to-result data flow

1. **Collect:** Fudge saves a review locally, including its original text, source identifiers and URL, business, rating, collection time, and available photo URLs.
2. **Ingest:** Upload batches to an authenticated API using an idempotency key. Only acknowledge records after a durable backend commit. Keep unacknowledged records locally and retry with backoff.
3. **Preserve raw data:** Store the original payload and provenance separately from later transformations. Avoid overwriting the source with cleaned or AI-generated text.
4. **Clean and validate:** Normalize fields, check required values and links, classify services, identify duplicates, and flag uncertain results. Rules and exceptions require owner approval.
5. **Review:** Sync eligible records to the source Sheet with a stable record ID. Capture corrections and approval decisions back in the backend.
6. **Approve:** Require an explicit approval before creating an automation job. Rejected or ambiguous records do not proceed.
7. **Publish to ND Master:** Batch-sync approved records using stable IDs. Record the mapped destination and last successful sync.
8. **Execute and verify:** An authorized runner claims a job, reports its outcome, and the checker records whether the intended result was actually observed. A button click alone is not proof of success.

### Record and job states

These are proposed states; finalize transitions and ownership during implementation.

| Stage | Example states |
| --- | --- |
| Data | `collected`, `cleaning`, `needs_review`, `approved`, `rejected` |
| Automation job | `queued`, `processing`, `succeeded`, `failed`, `verification_pending`, `verified` |

Track error reason, attempt count, timestamps, and the actor responsible for each transition. A failed job must be distinguishable from an idle queue. Define separately which failures can be retried automatically and which require human action.

## Proposed data model

The following are logical entities, not finalized SQL tables or column definitions:

| Entity | Key fields and purpose |
| --- | --- |
| `raw_reviews` | Internal UUID, source review ID, source/business identity, original payload, source URL, collection timestamp, ingestion idempotency key. |
| `cleaned_reviews` | Raw record ID, normalized fields, service classification, validation results, transformation version, processing timestamp. |
| `review_decisions` | Record ID, decision, reviewer, correction, reason, timestamp, and version reviewed. |
| `sheet_sync_state` | Stable record ID, destination, mapping/version, last successful sync, last error. Do not use a row number as the permanent identity because rows can move. |
| `automation_jobs` | Job ID, approved record/version, destination, state, attempts, lease/claim owner, timestamps, error details. |
| `job_results` | Job ID, reported outcome, verification outcome, timestamp, and authorized evidence/reference. |
| `audit_events` | Actor, action, entity, timestamp, and relevant metadata; avoid storing secrets. |

Enforce uniqueness with database constraints on suitable source IDs and ingestion keys. Fallback fingerprints can flag potential duplicates but should not silently merge uncertain records. Use transactions for state transitions and atomic job claims. Design a reconciliation process for partial failures across the database and Sheets; they cannot be updated in one shared transaction.

## Sheets synchronization

- Assign every record a stable backend ID and include it in each relevant Sheet row.
- Batch reads and writes; debounce frequent updates and retry transient errors with bounded backoff.
- Specify field ownership before enabling two-way sync. For example, backend owns IDs, source data, and job status; reviewers own designated correction and approval columns. Confirm the actual mapping with the team.
- Avoid overwriting newer human edits. Use a version or last-modified check and flag conflicts for review rather than silently choosing a winner.
- Keep a sync cursor or durable outbox, track failed writes, and periodically reconcile against the backend. Design for duplicate deliveries and row reordering.
- Start with the existing Apps Script connector where practical. Evaluate a backend Sheets API integration only after measuring actual bottlenecks and choosing a suitable Google authorization model.

## Reliability and performance

- Keep collection, ingestion, cleanup, Sheets sync, and automation independently retryable; a slow Sheet or AI request should not block the collector.
- Use bounded queues, request timeouts, exponential backoff with jitter, and a dead-letter/manual-review path after repeated failures.
- Use leases and idempotent processing. If a worker crashes after an external action, reconcile the destination before retrying to avoid repeating the action.
- Monitor queue age, ingestion failures, sync latency, review throughput, duplicate rate, job retries, and verification failures. Alert on sustained delays rather than a single transient error.
- Measure baseline and post-migration latency from collection to backend, review-ready, approval, ND Master, and verified result. Set performance targets only after measuring typical and peak load.
- Test offline collection, browser restart, duplicate submissions, partial Sheet failures, worker restarts, expired leases, rate limits, and human edits during sync.

## Security, privacy, and responsible use

- **Never include a Supabase service-role key or other privileged secret in the extension**, Sheets, or the repository. Browser extension code is readable. Use authenticated clients, server-side authorization, least privilege, and tested row-level security.
- Restrict Sheet access, backend operations, automation accounts, logs, and stored evidence to authorized users. Encrypt connections; choose retention, deletion, backup, and recovery policies before production use.
- Treat review text, names, photos, and source URLs as potentially sensitive third-party data. Confirm rights and applicable platform terms before collection, retention, transformation, or publication.
- Preserve provenance and require human approval. Do not represent altered or third-party content as authentic testimonials from customers of another business.
- Respect platform rate limits and security controls. Do not use browser profiles or automation to evade restrictions, CAPTCHAs, or account protections.

## Rollout plan

| Phase | Deliverables | Acceptance criteria |
| --- | --- | --- |
| 1. Discovery | Inventory current Sheet columns, cleanup rules, volume, timing, Incogniton actions, and verification requirements. Establish baseline metrics. | Workflow owners approve mappings, data ownership, and success criteria. |
| 2. Backend foundation | Supabase project, schema, restricted authentication, ingestion API, backups, logging, and tests. | Unauthorized access denied; repeated batches do not duplicate records; raw data survives retries. |
| 3. Parallel ingestion | Add local-first batch upload to Fudge while retaining the current Sheets workflow. | Records reconcile against the existing flow; failures retry without data loss. |
| 4. Cleanup and review | Implement versioned rules, validation, review queue, and decisions. | Original data remains available; ambiguous records require review; corrections are auditable. |
| 5. Sheet integration | Stable IDs, approved field mapping, batched sync, conflict detection, and reconciliation. | Edits and row movement do not corrupt records; failed syncs recover. |
| 6. Automation and results | Authorized Incogniton adapter, atomic job claims, reporting, and destination checks. | Jobs have traceable outcomes; duplicate execution and unverifiable results are handled explicitly. |
| 7. Controlled cutover | Pilot with a small set, monitor metrics, document operations, and expand gradually. | Owner approves accuracy, security, latency, and recovery; legacy flow remains available until cutover is accepted. |

### Rollback

Before each phase, back up the Sheet and configuration and document which system owns writes. Run a limited pilot first. If the new path fails, stop its workers and route new work through the existing Fudge/Sheets workflow; reconcile queued and completed records by stable ID before resuming either path. Do not run two independent writers against the same fields without an agreed ownership and reconciliation strategy.

## Open questions and decisions

1. What are the exact Source Sheet and ND Master Sheet columns, and which fields are editable by people?
2. What cleanup rules are currently applied to raw data, and who approves uncertain records?
3. What does Incogniton do with each approved row, and which supported API or integration will be used?
4. What destination evidence constitutes a successful result, and who handles failed or unverifiable jobs?
5. What are the expected daily volume, number of users, acceptable delay, retention period, and budget?
6. Who owns Supabase and Google credentials, and what are the required access, backup, and deletion policies?
7. Which existing reviews and historical Sheet rows should be migrated, and how will duplicate or conflicting records be resolved?

Resolve these questions before implementing the schema or connecting automation. Until then, this document is a recommendation rather than an operational guarantee.
