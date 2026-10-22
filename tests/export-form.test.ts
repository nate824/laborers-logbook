import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ---- Module mocks (hoisted) ----

// Inject a fake authed session so requireAuth passes.
vi.mock("express-session", () => {
  const middleware = (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { session: { userId?: number } }).session = { userId: 1 };
    next();
  };
  type SessionFactory = (...args: unknown[]) => typeof middleware;
  const session: SessionFactory = () => middleware;
  return { default: session };
});

vi.mock("connect-pg-simple", () => ({
  default: () => class { constructor(_opts: unknown) {} },
}));

vi.mock("../server/db", () => ({ pool: {}, db: {} }));

vi.mock("../server/email", () => ({
  getBaseUrl: () => "http://localhost:5000",
  sendEmail: vi.fn(),
  sendVerificationConfirmation: vi.fn(),
  sendVerificationRequest: vi.fn(),
  sendRopeHoursVerificationRequest: vi.fn(),
  sendBatchVerificationRequest: vi.fn(),
}));

vi.mock("../server/extraction", () => ({
  extractOJTRows: vi.fn(),
  extractRopeRows: vi.fn(),
}));

// Mock storage so we can return specific entries / profile per test.
// Use vi.hoisted so the object is available when vi.mock factories run.
const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  getEntries: vi.fn(),
  getRopeHours: vi.fn(),
  getSupervisors: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

import { registerRoutes } from "../server/routes";

function makeProfile() {
  return {
    id: 1, email: "tech@example.com", password: null,
    name: "Test Tech", employeeNumber: "EMP-1", isAdmin: false,
    resetToken: null, resetTokenExpiry: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
  };
}

describe("POST /api/export-form", () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    await registerRoutes(app);
    storageMock.getUser.mockResolvedValue(makeProfile());
  });

  it("returns 422 for an unknown form_id", async () => {
    storageMock.getEntries.mockResolvedValue([]);
    const res = await request(app)
      .post("/api/export-form")
      .send({ form_id: "not_a_form", entry_ids: [1] });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("unknown_form");
  });

  it("returns 422 for empty entry_ids", async () => {
    const res = await request(app)
      .post("/api/export-form")
      .send({ form_id: "sprat_log_v1", entry_ids: [] });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("empty_export");
  });

  it("returns 422 for a removed NDT form id", async () => {
    const res = await request(app)
      .post("/api/export-form")
      .send({ form_id: "mistras_ojt_v1", entry_ids: [1] });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("unknown_form");
  });
});

describe("POST /api/export-form — rope hours forms", () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    await registerRoutes(app);
    storageMock.getUser.mockResolvedValue(makeProfile());
  });

  function makeRope(id: number, startDate: string, method: string = "SHOTCRETE", hours: number = 4) {
    return {
      id, userId: 1,
      startDate: new Date(startDate), endDate: new Date(startDate),
      location: "Site", skills: "rigging", hours,
      employer: null, workDetails: null, maxHeight: null,
      verified: false, verifiedBy: null, verificationToken: null, verifiedAt: null,
      createdAt: new Date(startDate),
      technicianSignature: null, supervisorSignature: null, dataHash: null,
      integritySignature: null, verificationRequestedAt: null, auditTrail: null,
      supervisorIpAddress: null, supervisorBrowserInfo: null, employeeIdUsed: null,
      sourceDocumentKey: null, sourceDocumentName: null, importedAt: null,
    };
  }

  it("returns a PDF for sprat_log_v1 with valid rope hours", async () => {
    storageMock.getRopeHours.mockResolvedValue([
      makeRope(1, "2026-05-04T00:00:00Z"),
      makeRope(2, "2026-05-05T00:00:00Z"),
    ]);
    storageMock.getSupervisors.mockResolvedValue([]);

    const res = await request(app)
      .post("/api/export-form")
      .send({ form_id: "sprat_log_v1", entry_ids: [1, 2] })
      .buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.body.slice(0, 4).toString()).toBe("%PDF");
  });

  it("returns 403 when rope hours are not owned by the user", async () => {
    storageMock.getRopeHours.mockResolvedValue([makeRope(1, "2026-05-04T00:00:00Z")]);
    storageMock.getSupervisors.mockResolvedValue([]);

    const res = await request(app)
      .post("/api/export-form")
      .send({ form_id: "sprat_log_v1", entry_ids: [1, 999] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("entry_not_found");
  });

  it("returns a multi-page PDF for SPRAT with more than 6 rope hours (no row cap)", async () => {
    const rope = Array.from({ length: 14 }, (_, i) =>
      makeRope(i + 1, new Date(Date.UTC(2026, 0, 1 + i)).toISOString()));
    storageMock.getRopeHours.mockResolvedValue(rope);
    storageMock.getSupervisors.mockResolvedValue([]);

    const res = await request(app)
      .post("/api/export-form")
      .send({ form_id: "sprat_log_v1", entry_ids: rope.map((r) => r.id) })
      .buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.body.slice(0, 4).toString()).toBe("%PDF");
  });
});
