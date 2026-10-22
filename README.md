# Access Limited — Field Hours Logbook

A spin-off of the OJT Hours Tracker, tailored for **GeoStabilization / Access Limited**
steep-slope and rockfall-mitigation crews. Log field hours by **discipline** — rope
access, drilling, nozzle operations, scaling, shotcrete, mesh & barrier install,
grouting — get them **verified by supervisors over email**, and export them as
filled vendor PDF forms.

Built as a mobile-friendly PWA with offline support, cryptographic integrity
guarantees, and a deterministic Sprat-logbook importer.

> **Variant notes (vs. upstream TrackerLoger):**
> - `ropeHours` records carry an Access Limited `discipline`
>   (`shared/schema.ts` → `ACCESS_LIMITED_DISCIPLINES`); the DB column is added
>   idempotently by `runMigrations()` on boot.
> - Field Hours is the post-login landing page; the NDT "OJT Hours" tab is hidden
>   from nav (still reachable at `/profile`).
> - Branding: "Access Limited — Field Hours Logbook", orange primary theme.

---

## ✨ Features

- **📝 Hours logging** — track OJT/NDT hours (date, location, method, hours) and rope-access work (start/end date, location, skills, hours) from any device.
- **✅ Supervisor verification** — supervisors confirm logged hours via a unique, emailed token link. Supports single and batch verification flows.
- **🔐 Cryptographic integrity** — per-identity RSA keypairs, data hashing, integrity signatures, and a tamper-evident audit trail stored on every record.
- **📄 PDF form export** — export verified hours straight into fillable vendor PDF forms (e.g. SPRAT logbooks) via a pluggable adapter registry.
- **📥 Log import** — upload existing logbooks (`.xlsx`, PDF, images) and review extracted rows before committing. Sprat logs use a fully deterministic parser; other formats fall back to AI extraction.
- **📱 Offline / PWA** — works offline; mutations are queued in an outbox and replayed on reconnect.
- **👤 Admin panel** — user management with impersonation support.

---

## 🏗️ Architecture

Three TypeScript roots unified by path aliases (`@/` → `client/src`, `@shared` → `shared`):

| Layer | Stack |
|-------|-------|
| **`client/`** | React 18 + Vite SPA · Wouter routing · TanStack Query · React Hook Form + Zod · shadcn/ui (Radix) |
| **`server/`** | Express · session auth (bcrypt + `connect-pg-simple`) · Resend/nodemailer email · pdf-lib form filling |
| **`shared/`** | Drizzle schema + `drizzle-zod` — single source of truth for both client and server |

**Single port.** Everything serves on port **5000**. In dev, Vite runs as Express middleware; in prod, Express serves the static build.

**Database.** [Neon](https://neon.tech) serverless Postgres over WebSockets + [Drizzle ORM](https://orm.drizzle.team).

### Core data model

Two parallel record types, each owned by a user and following the same lifecycle:

- **`entries`** — OJT/NDT hours. Methods are the `NDTMethods` enum (ET, RFT, MT, PT, RT, UT_THK, UTSW, PMI, LSI, PAUT, VT, VWE, UT, …).
- **`ropeHours`** — rope-access work (skills, hours, date range).

Both carry three feature dimensions: **verification**, **cryptographic integrity**, and **import provenance**.

---

## 🚀 Getting started

### Prerequisites

- Node.js 18+
- A Neon (or compatible) Postgres database

### Setup

```bash
# Install dependencies
npm install

# Configure environment (see below), then sync the schema
npm run db:push

# Start the dev server (API + client on http://localhost:5000)
npm run dev
```

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | **Yes** | Neon Postgres connection string |
| `SESSION_SECRET` | Yes | Session encryption |
| `CRYPTO_SECRET` | Yes | Wrapping key for crypto identities (crypto ops throw without it) |
| `RESEND_API_KEY` | No | Transactional email; without it, verification falls back to direct links |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | No | AI extraction fallback for non-Sprat imports |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | No | Base URL for the AI extraction provider |

---

## 📜 Scripts

```bash
npm run dev      # dev server (tsx, port 5000)
npm run build    # vite build client + esbuild bundle server → dist/
npm run start    # run production build (dist/index.js)
npm run check    # tsc type-check (noEmit)
npm run db:push  # drizzle-kit push — sync shared/schema.ts to the DB
```

### Testing

```bash
npx vitest run                                       # all tests
npx vitest run tests/forms/sprat_log_v1.test.ts      # single file
npx vitest run -t "substring of test name"           # single test by name
```

Tests live in `tests/` (not co-located).

---

## 🔧 Extending

### Add a new PDF export form

1. Drop the blank AcroForm PDF in `server/forms/blanks/`.
2. Add a field schema in `server/forms/schemas/`.
3. Write an adapter in `server/forms/adapters/` — a pure function turning selected records + user profile into `{ fieldName: value }`.
4. Register it in `server/forms/registry.ts`.

The adapter is `kind: "ojt"` (consumes `entries`) or `kind: "rope"` (consumes `ropeHours`). Entry point: `POST /api/export-form`.

### Database migrations

Schema reaches the DB **two** ways, and you usually need both:

- `npm run db:push` for local dev, **and**
- an idempotent `runMigrations()` (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) that runs on every server boot.

When you add a column to `shared/schema.ts`, also add it to `runMigrations()` so production picks it up.

---

## 🛠️ Tech stack

**Frontend:** React 18, Vite, Wouter, TanStack Query, React Hook Form, Zod, shadcn/ui, Tailwind CSS, vite-plugin-pwa

**Backend:** Express, Drizzle ORM, Neon serverless Postgres, express-session, bcrypt, pdf-lib, Resend / nodemailer

**Tooling:** TypeScript (ES modules), esbuild, tsx, Vitest, drizzle-kit
