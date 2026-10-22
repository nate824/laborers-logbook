import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ---- Module mocks (must be hoisted before importing routes) ----

vi.mock("express-session", () => {
  const middleware = (_req: Request, _res: Response, next: NextFunction) => next();
  type SessionFactory = (...args: unknown[]) => typeof middleware;
  const session: SessionFactory = () => middleware;
  return { default: session };
});

vi.mock("connect-pg-simple", () => {
  return {
    default: () => class {
      constructor(_opts: unknown) {}
    },
  };
});

vi.mock("../server/db", () => ({
  pool: {},
  db: {},
}));

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

vi.mock("../server/crypto", () => ({
  createTechnicianCryptoIdentity: vi.fn(),
}));

const mockStorage = {
  getEntry: vi.fn(),
  deleteEntry: vi.fn(),
  countEntriesBySourceDocumentKey: vi.fn(),
  getRopeHour: vi.fn(),
  deleteRopeHour: vi.fn(),
  countRopeHoursBySourceDocumentKey: vi.fn(),
};

vi.mock("../server/storage", () => ({
  storage: mockStorage,
}));

const mockDeleteObjectEntity = vi.fn();
vi.mock("../server/replit_integrations/object_storage/objectStorage", () => {
  class ObjectStorageService {
    deleteObjectEntity = mockDeleteObjectEntity;
    uploadBuffer = vi.fn();
    getSignedDownloadURL = vi.fn();
    getObjectEntityFile = vi.fn();
    readObjectEntity = vi.fn();
    downloadObject = vi.fn();
  }
  class ObjectNotFoundError extends Error {}
  return { ObjectStorageService, ObjectNotFoundError };
});

// Import after all mocks are registered.
const { registerRoutes } = await import("../server/routes");

const TEST_USER_ID = 42;
const OTHER_USER_ID = 99;
const SOURCE_KEY = "/objects/imports/42/abc-log.pdf";

let sessionUserId: number | undefined;

interface StubSession {
  id: string;
  userId: number | undefined;
  save: (cb?: () => void) => void;
}

interface RequestWithSession extends Request {
  session: StubSession;
}

async function buildApp(): Promise<Express> {
  const app = express();
  // Inject session BEFORE routes register their (mocked, no-op) session middleware.
  app.use((req, _res, next) => {
    (req as RequestWithSession).session = {
      id: "test",
      userId: sessionUserId,
      save: (cb?: () => void) => {
        if (cb) cb();
      },
    };
    next();
  });
  app.use(express.json());
  await registerRoutes(app);
  return app;
}

describe("DELETE /api/entries/:id (imported entry cleanup)", () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    sessionUserId = TEST_USER_ID;
    app = await buildApp();
  });

  it("returns 401 when unauthenticated", async () => {
    sessionUserId = undefined;
    const noAuthApp = await buildApp();
    const res = await request(noAuthApp).delete("/api/entries/1");
    expect(res.status).toBe(401);
    expect(mockStorage.deleteEntry).not.toHaveBeenCalled();
  });

  it("returns 403 when the entry belongs to another user", async () => {
    mockStorage.getEntry.mockResolvedValue({
      id: 1,
      userId: OTHER_USER_ID,
      importedAt: new Date(),
      sourceDocumentKey: SOURCE_KEY,
    });
    const res = await request(app).delete("/api/entries/1");
    expect(res.status).toBe(403);
    expect(mockStorage.deleteEntry).not.toHaveBeenCalled();
    expect(mockDeleteObjectEntity).not.toHaveBeenCalled();
  });

  it("deletes a non-imported (manual) entry without touching object storage", async () => {
    mockStorage.getEntry.mockResolvedValue({
      id: 2,
      userId: TEST_USER_ID,
      importedAt: null,
      sourceDocumentKey: null,
      verified: true,
      verifiedBy: "Real Supervisor",
    });
    mockStorage.deleteEntry.mockResolvedValue(undefined);
    const res = await request(app).delete("/api/entries/2");
    expect(res.status).toBe(200);
    expect(mockStorage.deleteEntry).toHaveBeenCalledWith(2);
    expect(mockStorage.countEntriesBySourceDocumentKey).not.toHaveBeenCalled();
    expect(mockDeleteObjectEntity).not.toHaveBeenCalled();
  });

  it("returns 404 when the entry does not exist", async () => {
    mockStorage.getEntry.mockResolvedValue(undefined);
    const res = await request(app).delete("/api/entries/999");
    expect(res.status).toBe(404);
    expect(mockStorage.deleteEntry).not.toHaveBeenCalled();
  });

  it("deletes the entry but keeps the source object when siblings remain", async () => {
    mockStorage.getEntry.mockResolvedValue({
      id: 3,
      userId: TEST_USER_ID,
      importedAt: new Date(),
      sourceDocumentKey: SOURCE_KEY,
    });
    mockStorage.deleteEntry.mockResolvedValue(undefined);
    mockStorage.countEntriesBySourceDocumentKey.mockResolvedValue(2);
    mockStorage.countRopeHoursBySourceDocumentKey.mockResolvedValue(0);

    const res = await request(app).delete("/api/entries/3");
    expect(res.status).toBe(200);
    expect(mockStorage.deleteEntry).toHaveBeenCalledWith(3);
    expect(mockDeleteObjectEntity).not.toHaveBeenCalled();
  });

  it("removes the source object once the last reference goes away (no rope-hour siblings either)", async () => {
    mockStorage.getEntry.mockResolvedValue({
      id: 4,
      userId: TEST_USER_ID,
      importedAt: new Date(),
      sourceDocumentKey: SOURCE_KEY,
    });
    mockStorage.deleteEntry.mockResolvedValue(undefined);
    mockStorage.countEntriesBySourceDocumentKey.mockResolvedValue(0);
    mockStorage.countRopeHoursBySourceDocumentKey.mockResolvedValue(0);

    const res = await request(app).delete("/api/entries/4");
    expect(res.status).toBe(200);
    expect(mockStorage.deleteEntry).toHaveBeenCalledWith(4);
    expect(mockDeleteObjectEntity).toHaveBeenCalledTimes(1);
    expect(mockDeleteObjectEntity).toHaveBeenCalledWith(SOURCE_KEY);
  });

  it("does NOT remove the source object when a rope-hour sibling still references it", async () => {
    mockStorage.getEntry.mockResolvedValue({
      id: 5,
      userId: TEST_USER_ID,
      importedAt: new Date(),
      sourceDocumentKey: SOURCE_KEY,
    });
    mockStorage.deleteEntry.mockResolvedValue(undefined);
    mockStorage.countEntriesBySourceDocumentKey.mockResolvedValue(0);
    mockStorage.countRopeHoursBySourceDocumentKey.mockResolvedValue(1);

    const res = await request(app).delete("/api/entries/5");
    expect(res.status).toBe(200);
    expect(mockDeleteObjectEntity).not.toHaveBeenCalled();
  });

  it("still returns 200 when object cleanup throws (best-effort)", async () => {
    mockStorage.getEntry.mockResolvedValue({
      id: 6,
      userId: TEST_USER_ID,
      importedAt: new Date(),
      sourceDocumentKey: SOURCE_KEY,
    });
    mockStorage.deleteEntry.mockResolvedValue(undefined);
    mockStorage.countEntriesBySourceDocumentKey.mockResolvedValue(0);
    mockStorage.countRopeHoursBySourceDocumentKey.mockResolvedValue(0);
    mockDeleteObjectEntity.mockRejectedValueOnce(new Error("storage offline"));

    const res = await request(app).delete("/api/entries/6");
    expect(res.status).toBe(200);
    expect(mockDeleteObjectEntity).toHaveBeenCalledWith(SOURCE_KEY);
  });
});

describe("DELETE /api/rope-hours/:id (imported rope-hour cleanup)", () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    sessionUserId = TEST_USER_ID;
    app = await buildApp();
  });

  it("returns 401 when unauthenticated", async () => {
    sessionUserId = undefined;
    const noAuthApp = await buildApp();
    const res = await request(noAuthApp).delete("/api/rope-hours/1");
    expect(res.status).toBe(401);
    expect(mockStorage.deleteRopeHour).not.toHaveBeenCalled();
  });

  it("returns 403 when the rope hour belongs to another user", async () => {
    mockStorage.getRopeHour.mockResolvedValue({
      id: 1,
      userId: OTHER_USER_ID,
      importedAt: new Date(),
      sourceDocumentKey: SOURCE_KEY,
    });
    const res = await request(app).delete("/api/rope-hours/1");
    expect(res.status).toBe(403);
    expect(mockStorage.deleteRopeHour).not.toHaveBeenCalled();
    expect(mockDeleteObjectEntity).not.toHaveBeenCalled();
  });

  it("deletes a non-imported (manual) rope hour without touching object storage", async () => {
    mockStorage.getRopeHour.mockResolvedValue({
      id: 2,
      userId: TEST_USER_ID,
      importedAt: null,
      sourceDocumentKey: null,
      verified: true,
    });
    mockStorage.deleteRopeHour.mockResolvedValue(undefined);
    const res = await request(app).delete("/api/rope-hours/2");
    expect(res.status).toBe(200);
    expect(mockStorage.deleteRopeHour).toHaveBeenCalledWith(2);
    expect(mockStorage.countRopeHoursBySourceDocumentKey).not.toHaveBeenCalled();
    expect(mockDeleteObjectEntity).not.toHaveBeenCalled();
  });

  it("returns 404 when the rope hour does not exist", async () => {
    mockStorage.getRopeHour.mockResolvedValue(undefined);
    const res = await request(app).delete("/api/rope-hours/999");
    expect(res.status).toBe(404);
    expect(mockStorage.deleteRopeHour).not.toHaveBeenCalled();
  });

  it("deletes the rope hour but keeps the source object when siblings remain", async () => {
    mockStorage.getRopeHour.mockResolvedValue({
      id: 3,
      userId: TEST_USER_ID,
      importedAt: new Date(),
      sourceDocumentKey: SOURCE_KEY,
    });
    mockStorage.deleteRopeHour.mockResolvedValue(undefined);
    mockStorage.countEntriesBySourceDocumentKey.mockResolvedValue(0);
    mockStorage.countRopeHoursBySourceDocumentKey.mockResolvedValue(2);

    const res = await request(app).delete("/api/rope-hours/3");
    expect(res.status).toBe(200);
    expect(mockStorage.deleteRopeHour).toHaveBeenCalledWith(3);
    expect(mockDeleteObjectEntity).not.toHaveBeenCalled();
  });

  it("removes the source object once the last reference goes away", async () => {
    mockStorage.getRopeHour.mockResolvedValue({
      id: 4,
      userId: TEST_USER_ID,
      importedAt: new Date(),
      sourceDocumentKey: SOURCE_KEY,
    });
    mockStorage.deleteRopeHour.mockResolvedValue(undefined);
    mockStorage.countEntriesBySourceDocumentKey.mockResolvedValue(0);
    mockStorage.countRopeHoursBySourceDocumentKey.mockResolvedValue(0);

    const res = await request(app).delete("/api/rope-hours/4");
    expect(res.status).toBe(200);
    expect(mockDeleteObjectEntity).toHaveBeenCalledTimes(1);
    expect(mockDeleteObjectEntity).toHaveBeenCalledWith(SOURCE_KEY);
  });

  it("does NOT remove the source object when an OJT entry sibling still references it", async () => {
    mockStorage.getRopeHour.mockResolvedValue({
      id: 5,
      userId: TEST_USER_ID,
      importedAt: new Date(),
      sourceDocumentKey: SOURCE_KEY,
    });
    mockStorage.deleteRopeHour.mockResolvedValue(undefined);
    mockStorage.countEntriesBySourceDocumentKey.mockResolvedValue(1);
    mockStorage.countRopeHoursBySourceDocumentKey.mockResolvedValue(0);

    const res = await request(app).delete("/api/rope-hours/5");
    expect(res.status).toBe(200);
    expect(mockDeleteObjectEntity).not.toHaveBeenCalled();
  });
});
