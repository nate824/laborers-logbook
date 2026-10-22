---
name: Supervisor (signer) qualifications model
description: How a signer's multiple method+level qualifications are stored and kept backward compatible
---
A signer/supervisor holds a list of `{ method, level }` qualifications in a `qualifications`
JSON column. The original single `ndtMethod` + `certificationLevel` columns are intentionally
kept (not dropped) for backward compatibility with older readers (emails, vendor PDF adapters).

**Rule:** `canonicalizeSupervisorWrite` (in `shared/schema.ts`) is the single source of truth
that mirrors `qualifications[0]` into the legacy columns on every write — but only when
`qualifications` is present in the write (empty array clears them; partial writes without it
leave legacy fields untouched). It is applied at all server write boundaries (REST
POST/PATCH and MCP create/update), NOT just in the client.

**Why:** Mirroring only in the frontend let non-UI writers (MCP, scripts) save qualifications
while leaving legacy fields stale, breaking backward compat. Centralizing on the server keeps
the two representations consistent regardless of caller.

**How to apply:** Any new write path for supervisors must run input through
`canonicalizeSupervisorWrite` before persisting. On read, use `signerToQualifications`
(`client/src/types.ts`) which falls back to the legacy fields when `qualifications` is empty.
