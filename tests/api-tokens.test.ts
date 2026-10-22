import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// Default to a logged-in session; individual tests may flip via __unauth.
const sessionState = vi.hoisted(() => ({ unauth: false }));

vi.mock("express-session", () => {
  const middleware = (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { session: { userId?: number } }).session = sessionState.unauth
      ? {}
      : { userId: 1 };
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

const tokensTable = vi.hoisted(() => {
  return {
    rows: [] as Array<{
      id: number;
      userId: number;
      name: string;
      tokenHash: string;
      tokenPrefix: string;
      createdAt: Date;
      lastUsedAt: Date | null;
    }>,
    nextId: 1,
  };
});

const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(async (id: number) => ({
    id, email: "tech@example.com", password: null, name: "T", employeeNumber: "E",
    isAdmin: false, resetToken: null, resetTokenExpiry: null,
    createdAt: new Date("2025-01-01"),
  })),
  getEntries: vi.fn(async () => []),
  getRopeHours: vi.fn(async () => []),
  listApiTokens: vi.fn(),
  getApiTokenById: vi.fn(),
  getApiTokensByPrefix: vi.fn(),
  createApiToken: vi.fn(),
  touchApiToken: vi.fn(async () => {}),
  deleteApiToken: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

import { registerRoutes } from "../server/routes";

beforeEach(() => {
  tokensTable.rows = [];
  tokensTable.nextId = 1;
  sessionState.unauth = false;

  storageMock.listApiTokens.mockImplementation(async (userId: number) =>
    tokensTable.rows.filter((r) => r.userId === userId),
  );
  storageMock.getApiTokenById.mockImplementation(async (id: number) =>
    tokensTable.rows.find((r) => r.id === id),
  );
  storageMock.getApiTokensByPrefix.mockImplementation(async (prefix: string) =>
    tokensTable.rows.filter((r) => r.tokenPrefix === prefix),
  );
  storageMock.createApiToken.mockImplementation(async (input: {
    userId: number;
    name: string;
    tokenHash: string;
    tokenPrefix: string;
  }) => {
    const row = {
      id: tokensTable.nextId++,
      userId: input.userId,
      name: input.name,
      tokenHash: input.tokenHash,
      tokenPrefix: input.tokenPrefix,
      createdAt: new Date(),
      lastUsedAt: null,
    };
    tokensTable.rows.push(row);
    return row;
  });
  storageMock.deleteApiToken.mockImplementation(async (id: number) => {
    tokensTable.rows = tokensTable.rows.filter((r) => r.id !== id);
  });
});

async function makeApp(): Promise<Express> {
  const app = express();
  app.use(express.json());
  await registerRoutes(app);
  return app;
}

describe("POST /api/tokens", () => {
  it("creates a token, returns the raw value exactly once, and never returns the hash", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/tokens").send({ name: "claude-desktop" });
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token).toHaveLength(64);
    expect(res.body.name).toBe("claude-desktop");
    expect(res.body.tokenPrefix).toBe(res.body.token.slice(0, 8));
    expect(res.body).not.toHaveProperty("tokenHash");

    const list = await request(app).get("/api/tokens");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).not.toHaveProperty("tokenHash");
    expect(list.body[0]).not.toHaveProperty("token");
  });

  it("rejects empty names", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/tokens").send({ name: "  " });
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated requests", async () => {
    sessionState.unauth = true;
    const app = await makeApp();
    const res = await request(app).post("/api/tokens").send({ name: "x" });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/tokens/:id", () => {
  it("revokes a token", async () => {
    const app = await makeApp();
    const created = await request(app).post("/api/tokens").send({ name: "k" });
    const id = created.body.id;
    const del = await request(app).delete(`/api/tokens/${id}`);
    expect(del.status).toBe(200);
    const list = await request(app).get("/api/tokens");
    expect(list.body).toHaveLength(0);
  });

  it("won't let one user delete another user's token", async () => {
    const app = await makeApp();
    // Seed a token owned by user 999
    tokensTable.rows.push({
      id: 42, userId: 999, name: "other", tokenHash: "x", tokenPrefix: "abcdefgh",
      createdAt: new Date(), lastUsedAt: null,
    });
    const del = await request(app).delete("/api/tokens/42");
    expect(del.status).toBe(403);
  });
});

describe("Bearer-token auth on user data endpoints", () => {
  it("lets a valid bearer token reach /api/entries/totals without a session", async () => {
    const app = await makeApp();
    const created = await request(app).post("/api/tokens").send({ name: "bearer" });
    const raw = created.body.token;

    sessionState.unauth = true;
    const app2 = await makeApp();

    storageMock.getEntries.mockResolvedValueOnce([
      { id: 1, userId: 1, method: "ON_THE_JOB", hours: 4, verified: true } as never,
      { id: 2, userId: 1, method: "ON_THE_JOB", hours: 2, verified: false } as never,
      { id: 3, userId: 1, method: "CLASSROOM", hours: 1.5, verified: true } as never,
    ]);

    const res = await request(app2)
      .get("/api/entries/totals")
      .set("Authorization", `Bearer ${raw}`);

    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "ON_THE_JOB", totalHours: 6, verifiedHours: 4, count: 2 }),
        expect.objectContaining({ method: "CLASSROOM", totalHours: 1.5, verifiedHours: 1.5, count: 1 }),
      ]),
    );
  });

  it("rejects a malformed or unknown bearer token with 401", async () => {
    sessionState.unauth = true;
    const app = await makeApp();
    const res = await request(app)
      .get("/api/entries/totals")
      .set("Authorization", "Bearer not-a-real-token-aaaaaaaaaaaa");
    expect(res.status).toBe(401);
  });

  it("rejects requests with no auth at all", async () => {
    sessionState.unauth = true;
    const app = await makeApp();
    const res = await request(app).get("/api/entries/totals");
    expect(res.status).toBe(401);
  });
});

describe("POST /mcp", () => {
  it("requires a bearer token", async () => {
    const app = await makeApp();
    const res = await request(app).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
  });

  it("returns 405 on GET /mcp (stateless mode)", async () => {
    const app = await makeApp();
    const res = await request(app).get("/mcp");
    expect(res.status).toBe(405);
  });
});
