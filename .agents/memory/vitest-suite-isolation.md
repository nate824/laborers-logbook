---
name: Vitest full-suite isolation flakiness
description: Why a couple of tests intermittently fail only when running the whole vitest suite together
---
Running the whole suite with `npx vitest run` can intermittently report ~2 failures in
`tests/mcp-tools.test.ts` (around the batch verification email mock /
`sendBatchVerificationRequest` call-count assertions). The same file passes 6/6 when run
in isolation, and a re-run of the full suite passes 93/93.

**Why:** Test files share backing state (the real dev DB and module-level email mocks) and
run together, so ordering/state bleed across files makes a few assertions order-dependent.

**How to apply:** Before treating a full-run failure as a regression, re-run the affected
file in isolation (e.g. `npx vitest run tests/mcp-tools.test.ts`). If it passes alone, it's
isolation flakiness, not your change.
