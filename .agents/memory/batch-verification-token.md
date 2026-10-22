---
name: Batch verification shared token
description: Why entries.verification_token must NOT be unique
---
Batch verification (`POST /api/batch-verify-request`) stamps ONE shared
`verificationToken` across all entries in the batch so the supervisor gets a single
link (`/batch-verify/:token`) and `getEntriesByBatchToken` fetches them together.

**Rule:** `entries.verification_token` must NOT have a unique constraint. A unique
constraint makes batch verification fail at runtime with Postgres 23505
"duplicate key value violates unique constraint entries_verification_token_unique".

**Why:** The shared-token design directly conflicts with a per-row unique constraint.
Single-entry verify uses random UUIDs that never collide, so uniqueness was never needed.

**How to apply:** Keep `verificationToken: uuid("verification_token")` (no `.unique()`)
in `shared/schema.ts` for the entries table. Production schema changes apply via the
Replit Publish flow (publish diffs dev→prod and drops the constraint there).
