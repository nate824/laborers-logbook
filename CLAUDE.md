# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Laborers Logbook: a union spin-off of the Access Limited Field Hours Logbook (sibling repo `../../-TrackerLoger-ACL-`, itself a spin-off of `/home/n8/projects/OJTLogTracker`), built for LiUNA Laborers (pitched to Local 220, Bakersfield). It is the **member's own record**, never the official one: hours signed off by a foreman, a health-plan coverage/hour-bank estimate checked against the trust fund, apprenticeship progress, the out-of-work list, and a cert wallet. Background research and sources: `../RESEARCH.md`. UI must say "unofficial" and never use LiUNA branding.

Tabs (`ProfileHeader` navItems; bottom bar on phones): **Status** (`/status`, landing after login), **Work Hours** (`/hours`, `ProfilePage`; `/field-hours` kept as an alias), **Benefits** (`/benefits`), **Certs** (`/certs`), **Signers**. `/list` (out-of-work list history) is reached from the Status card. Rope Hours still exists at `/rope-hours` but is out of the nav.

**Work Hours** reuse the ACL `entries` table with two `FieldMethods`: `ON_THE_JOB` (details: employer, union "Union"/"Non-union", job #, county, work process, overtime, double time) and `CLASSROOM` (course, school). Work-process names are placeholders until we have the JAC's list. New rows default to on-the-job with the last employer/site (`laborers-last-job` in localStorage, `NewEntryForm`).

**Union rules live in `shared/union.ts`** (pure, tested in `tests/union-rules.test.ts`): `UNION_RULES` holds every number (300 hrs / 3 months to qualify, 1-month reporting lag so month M pays for M+2, 100/month deduction, 400 cap, non-union work zeroes the bank, 30-day re-register, CCL apprentice periods 4,000 OJT + 304 RSI, $49 dues). Several are UNVERIFIED as current (2013 SPD); change the constant, not the call sites. Functions: `healthStatus`, `apprenticeStatus`, `listStatus`, `fundCrossCheck`, `reminders`. The client computes everything on the device in `client/src/lib/union.ts` (`useUnionData`).

**Union tables** (`shared/schema.ts`, migrations in `runMigrations`): `users.union_profile` JSON (`UnionProfile`: classification, local #, prior OJT/RSI hours, starting bank, dues paid through), `fund_reports` (hours the fund shows per month/employer, typed in by the member), `dispatch_events` (REGISTERED / RE_REGISTERED / DISPATCHED / LAID_OFF / REFUSED). Routes in `server/unionRoutes.ts` (`/api/union/profile|fund-reports|dispatch`), all scoped to the session user; deletes take the owner id.

**Month keys** are `"YYYY-MM"`. Stored calendar dates are UTC midnight, so use `monthKey()`/`calendarDay()` (UTC) for them and `localMonthKey()` only for a real local "today"; tests pass in LA, UTC and Tokyo (`TZ=... npx vitest run tests/union-rules.test.ts`).

Inherited from ACL and unchanged: verification links (single/batch), crypto integrity, import (prompt now asks for ON_THE_JOB/CLASSROOM), PDF export (`fieldHoursSpec`: **Work Hours Log** and **Class / Training Log**), offline outbox, MCP server (no union tools yet), admin.

**Shared signer list**: every user sees every signer (`storage.getSupervisors()` takes no user). Only the user who added a signer, or an admin, can edit/delete it. Policy lives in `server/signers.ts`.

Brand: orange `--primary` inherited from ACL; header badge "LBR". Progress bars use a `bg-muted` track (the theme's `--secondary` is green).

## Commands

```bash
npm run dev        # dev server (tsx, NODE_ENV=development) — serves API + client on port 5000
npm run build      # vite build client + esbuild bundle server → dist/, copies form blanks/schemas
npm run start      # run production build (dist/index.js)
npm run check      # tsc type-check (noEmit)
npm run db:push    # drizzle-kit push — sync shared/schema.ts to the database

npm run dev:local  # local run on http://localhost:5050: Docker Postgres laborers-pg (port 5434, volume laborers-pg-data) + wsproxy 5489. Separate from the ACL app (acl-pg/5433/5000) so both run at once.
npm run seed:local # seed demo member + apprentice with hours, fund reports, list history, certs (accounts in scripts/local/seed.sh)

npx vitest run                              # run all tests
npx vitest run tests/forms/sprat_log_v1.test.ts   # single test file
npx vitest run -t "substring of test name"  # single test by name
```

Tests live in `tests/` (not co-located); `tsconfig.json` excludes `**/*.test.ts` from the type-check.

## Architecture

Three TypeScript roots, unified by path aliases (`@/` → `client/src`, `@shared` → `shared`, `@assets` → `attached_assets`):

- **`client/`** — React 18 + Vite SPA. Wouter routing (`client/src/App.tsx`), TanStack Query for server state, React Hook Form + Zod, shadcn/ui (Radix) in `client/src/components/ui`. Pages in `client/src/pages`.
- **`server/`** — Express. `index.ts` boots everything; `routes.ts` (~1800 lines) registers all `/api/*` routes and the session/auth middleware.
- **`shared/schema.ts`** — single source of truth: Drizzle table definitions, `drizzle-zod` insert schemas, exported row/insert types, and the `FieldMethods` enum (+ `fieldMethodLabel`). Both client and server import from here.

**Single port.** Everything serves on `PORT` (default 5000; dev:local uses 5050). In dev, Vite runs as Express middleware (`server/vite.ts`); in prod, Express serves the static build. The catch-all Vite/static route is registered last so it doesn't shadow API routes.

**Database.** Neon serverless Postgres over WebSockets (`server/db.ts`) + Drizzle ORM. Note there are **two** ways schema reaches the DB and you usually need both: `npm run db:push` for local dev, AND an idempotent `runMigrations()` (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) that runs on every server boot in `server/index.ts`. There is no runtime migrations folder — when you add a column to `shared/schema.ts`, also add it to `runMigrations()` so production picks it up.

**Auth.** Session-based: `express-session` + `connect-pg-simple` (Postgres `session` table), bcrypt password hashing. `requireAuth` and `requireAdmin` middleware gate routes; `req.session.userId` identifies the user.

## Domain model & core flows

Two parallel record types, each owned by a user and following the same lifecycle:
- **`entries`** — Work Hours (date, location, `method`, hours). `method` must be a `FieldMethods` key (enforced by `insertEntrySchema`). Internal names still say "OJT" (`OJTTable`, `ImportLogDialog type="ojt"`, `extractOJTRows`, `ShareSettings.ojtMethods`) — that's legacy naming, the UI says "Field Hours".
- **`ropeHours`** — rope-access work (start/end date, location, skills, hours).

**Adding/changing a field method**: edit `FieldMethods` + `FIELD_METHOD_LABELS` + `FIELD_METHOD_DETAILS` in `shared/schema.ts`. The entry/edit forms render detail inputs from `FIELD_METHOD_DETAILS` (`FieldDetailInputs`); `cleanEntryDetails` drops keys that don't belong to the method (client on save, server on create/patch, MCP tools). Give the method an export layout in `fieldHoursSpec` (`client/src/lib/exportSheets.ts`) if it has a logbook page. The table columns, totals, entry/edit/import pickers, export sheets (one PDF per method), MCP tools, commit validation and signer qualifications (`SIGNER_METHODS` = field methods + `ROPE_ACCESS`) all derive from it. Also update the AI import prompt (`OJT_INSTRUCTIONS` in `server/extraction.ts`) and the method table on `SkillzPage`.

Both tables carry the same three feature dimensions:
1. **Verification** — supervisor confirms hours via a unique-token link. Single (`/api/verify-request/:entryId`), rope (`/api/verify-request-rope/:id`) and batch (`/api/batch-verify-request`) flows. Each takes `channels: ["email","sms"]` and returns `{verificationUrl, smsBody, delivery}`. Delivery lives in `server/notify.ts` (`deliverSignatureRequest`): email via Resend templates in `server/email.ts`, text via Twilio's REST API (plain `fetch`, no SDK). Every channel is optional: with no keys the status is `not_configured` and the client's `SignatureLinkSent` screen offers **Email it from my phone** / **Text it from my phone** (`mailto:` / `sms:` links with the signer and message pre-filled), the share sheet, or copy. That is the default, intended path, not an error state. The request event in the audit trail records `channels`/`phone`. Links use `getBaseUrl(req)`: `APP_BASE_URL`, else the prod domain, else (dev) the request's host, so a link requested over the tailnet opens on the phone. `server/mailsender.ts` (MailerSend) is legacy and unused by these flows.
2. **Cryptographic integrity** (`server/crypto.ts`) — per-identity RSA keypairs (private key encrypted at rest with the server secret), data hashing, integrity signatures, and an audit trail stored on each record. Identities live in `userCryptoIdentities` / `supervisorCryptoIdentities`.
3. **Import provenance** — `sourceDocumentKey` / `sourceDocumentName` / `importedAt` link a record back to the uploaded log it was extracted from.

### Export (`client/src/lib/logSheet.ts`, `exportSheets.ts`, `ExportHoursDialog`)

The **Export** button (Field and Rope pages, plus the header / account menu) opens `ExportHoursDialog`: **Download PDF** or **Share hours** (Web Share with the PDF files; needs https or localhost, so the button is hidden over plain-http tailnet). PDFs are built on the device with jsPDF, so export works offline. Only verified records go in (imported ones count, with "Signed paper log" in the signature cell).
Sheets copy the ACL paper logbook's look (black title bar, its column headers; a logbook spread = one landscape table).
- Work Hours: **one PDF per kind**: **Work Hours Log** (Date, Employer, Union / Non-union, Job # / County, Work Process, Hours, OT / DT, Foreman Signature; totals Hours and OT) and **Class / Training Log** (Date, Course, School / Site, Hours, Instructor Signature). Unknown kinds fall back to a simple Date / Job # / Location / Hours / Signature sheet.
- Rope Hours: **ACL Work Log - Rope Hours** (default; Date(s), Project Number, Work Code, Work Details, Supervisor Signature & Log Line, Hours Worked, plus "Total Work Hours Since Previous Certification" from the latest SPRAT/IRATA cert's issue date, blank if none), and our own **SPRAT-style** / **IRATA-style** sheets.
- `buildLogSheet` sizes rows to their wrapped text and ends the table at the last entry: **never pad with blank rows**. Each page has a Page Total / Running Total footer per `spec.totals`.

### Official PDF form fill (`server/forms/`)

No longer used by the UI (replaced by the sheets above, at the user's request: the fixed-row official forms leave blank rows). Still used by the MCP `export_form` tool.


Exports verified hours into fillable vendor PDFs. The **registry** (`registry.ts`) maps each `FormId` to a blank AcroForm PDF, a JSON schema, and an **adapter**. An adapter (`adapters/*.ts`) is a pure function turning selected entries/ropeHours + user profile into `{ fieldName: value }`; `filler.ts` writes those into the blank with pdf-lib (sets `NeedAppearances`, keeps fields editable). Forms are either `kind: "ojt"` (consume `entries`) or `kind: "rope"` (consume `ropeHours` + supervisors). Only the rope forms (`sprat_log_v1`, `irata_log_v1`) are registered today; the `"ojt"` kind is kept for a future ACL field-hours form. Entry point: `POST /api/export-form`. Adapters throw typed errors (`FormCapacityError`, `EmptyExportError`, `NothingToExportError`) that the route maps to 422 codes. Blanks in `forms/blanks/` are committed binaries copied from the reference repo. To add a form: drop the blank in `forms/blanks/`, a schema in `forms/schemas/`, write an adapter, and register it. The build copies `blanks/` and `schemas/` into `dist/forms/`; `forms/paths.ts` resolves these dirs differently in dev vs prod.

### Log import (`server/extraction.ts`)

Two-step upload→review→commit. `POST /api/imports/extract` saves the file to object storage and returns extracted rows for the user to review; `POST /api/imports/commit` re-validates each row with Zod and bulk-inserts with source provenance. Extraction tries a **deterministic path first** for Sprat logbook exports (`.xlsx` via `xlsx`, and Sprat PDFs parsed by text layout — no AI, fully reproducible), and only falls back to **AI extraction** (OpenAI via Replit integration) for images and non-Sprat PDFs. Keep Sprat imports on the deterministic path.

### Replit integrations (`server/replit_integrations/`)

Object storage (used for uploaded import documents under `imports/<userId>/<uuid>`), plus image/chat/audio/batch helpers. Object storage backs `sourceDocumentKey` and the short-lived signed-URL endpoint `/api/source-document`.

### Offline / PWA (`client/src/lib/offline/`)

TanStack Query state is persisted to IndexedDB and a service worker is registered (`vite-plugin-pwa`). Mutations made offline are queued in an outbox and replayed on reconnect (`resumePausedMutations`). Bump the persist `buster` in `App.tsx` if cached query shapes change incompatibly.

Import `queryClient` only as `@/lib/queryClient`. In dev the server loads `/src/main.tsx?v=<nanoid>` (`server/vite.ts`), and a relative `./lib/queryClient` import from there resolved to a second module instance. The offline mutation defaults were then registered on one client while the UI used the other, so every save failed with "No mutationFn found".

`drizzle.config.ts` has `tablesFilter: ["!session"]` because the `session` table belongs to connect-pg-simple. Without it, `drizzle-kit push` (which `dev:local` runs on every start) drops the table and logs everyone out.

Auth gotchas caused by the persisted cache: (1) never full-page-reload after login — a reload restores the cached logged-out `["/api/user"]` (still fresh) and bounces to `/auth`; `AuthForm` writes the user into the cache instead and `AuthPage` redirects. (2) While the cache restores, queries report idle with no data; `useAuth().isLoading` includes `useIsRestoring()` so `ProtectedRoute` doesn't treat that as logged out.

### Mobile-first UI

Most use is on a phone in the field. Under 768px (`useIsMobile`) the app swaps layouts rather than squeezing the desktop one: `ProfileHeader` becomes a compact top bar (account menu holds export/admin/theme/logout) plus a fixed bottom tab bar; Work Hours renders `FieldHoursSummary` + `MobileFieldLog`/`EntryCard` instead of `OJTTable`; Rope Hours and Signers render card lists. Rules: no horizontal scrolling, primary action is a full-width button, secondary actions go in a ⋮ menu, tap targets ≥ 40px, page content uses `pb-mobile-nav` so the tab bar doesn't cover it. `EntryRow` and `EntryCard` share behavior through `useEntryActions` — change it there. Dialogs are capped to the viewport globally in `ui/dialog.tsx` / `ui/alert-dialog.tsx`.

To preview at phone size locally, serve a throwaway HTML page from `client/public/` that iframes `/status`, `/hours`, `/benefits` at 390×844 (same origin, so the session cookie works), and delete it afterwards.

### Dates

Calendar dates (`entries.date`, rope `startDate`/`endDate`, cert dates) are stored as UTC midnight of the picked day. Display them with `formatCalendarDate` from `shared/dates.ts` (formats in UTC); `toLocaleDateString()`/date-fns `format` on them shows the previous day west of UTC. Default date inputs with `todayLocalISODate()`, not `toISOString()`. Real timestamps (createdAt, verifiedAt) stay local.

## Environment variables

- `DATABASE_URL` — **required** (Neon Postgres connection string).
- `SESSION_SECRET` / `CRYPTO_SECRET` — session encryption and crypto-key wrapping (crypto ops throw without one).
- `RESEND_API_KEY` + `EMAIL_FROM` — transactional email (sender must be on a Resend-verified domain); without it, the request still succeeds and the user shares the link.
- `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + (`TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`) — optional server-sent texts; without them, texts go from the technician's own phone.
- `APP_BASE_URL` — public origin for links in emails/texts.
- See `.env.example`.
- `AI_INTEGRATIONS_OPENAI_API_KEY` + `AI_INTEGRATIONS_OPENAI_BASE_URL` — AI extraction fallback (Replit-provided).

## Conventions

- ES modules throughout (`"type": "module"`); `.ts` extensions allowed in imports (bundler resolution).
- Validate API input with Zod at the route boundary; for imports, validate the whole batch before any DB write so a bad row aborts the import.
- `replit.md` and `README.md` are inherited from the reference app (older NDT/OJT writeups); `shared/schema.ts` and the routes are authoritative.
- `npm run check` has ~24 pre-existing type errors inherited from the reference (VerifyPage, LoginPage, replit_integrations, etc.). Don't add new ones; compare the count before/after.
- Boot seeds an admin user (`setupAdmin` in `server/routes.ts`) with a hard-coded email/password — change before any real deployment.
