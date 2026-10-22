// End-to-end smoke test for the OAuth 2.0 + PKCE flow that lets claude.ai web
// and Cowork connect to the /mcp endpoint. Mocks the DB and storage so the
// test runs without a live Postgres.

import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { createHash, randomBytes } from "crypto";

// --- Mocks: session, db, storage, oauth store, email ------------------------
const sessionState = vi.hoisted(() => ({ userId: undefined as number | undefined }));

vi.mock("express-session", () => {
  const middleware = (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { session: { userId?: number } }).session = {
      userId: sessionState.userId,
    };
    next();
  };
  type SessionFactory = (...args: unknown[]) => typeof middleware;
  const session: SessionFactory = () => middleware;
  return { default: session };
});

vi.mock("connect-pg-simple", () => ({
  default: () => class { constructor(_opts: unknown) {} },
}));

vi.mock("../server/db", () => ({ pool: {}, db: { update: vi.fn() } }));

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

const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  getEntries: vi.fn(async () => []),
  getEntry: vi.fn(),
  getApiTokensByPrefix: vi.fn(async () => []),
  touchApiToken: vi.fn(),
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

// OAuth store: in-memory implementation of just the surface routes need.
const oauthState = vi.hoisted(() => ({
  clients: new Map<string, { clientId: string; clientName: string; redirectUris: string[]; createdAt: Date }>(),
  codes: new Map<string, { clientId: string; userId: number; redirectUri: string; codeChallenge: string; codeChallengeMethod: string; usedAt: Date | null; expiresAt: Date }>(),
  tokens: new Map<string, { id: number; userId: number; clientId: string; expiresAt: Date; revokedAt: Date | null }>(),
}));

vi.mock("../server/oauth/store", () => ({
  createClient: vi.fn(async (input: { clientName: string; redirectUris: string[] }) => {
    const clientId = `mcp_${randomBytes(8).toString("hex")}`;
    const row = { clientId, clientName: input.clientName, redirectUris: input.redirectUris, createdAt: new Date() };
    oauthState.clients.set(clientId, row);
    return row;
  }),
  getClientByClientId: vi.fn(async (clientId: string) => oauthState.clients.get(clientId)),
  createAuthorizationCode: vi.fn(async (input: { clientId: string; userId: number; redirectUri: string; codeChallenge: string; codeChallengeMethod: string }) => {
    const code = randomBytes(16).toString("base64url");
    oauthState.codes.set(code, { ...input, usedAt: null, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
    return { code, row: { code } as never };
  }),
  consumeAuthorizationCode: vi.fn(async (code: string) => {
    const row = oauthState.codes.get(code);
    if (!row || row.usedAt || row.expiresAt <= new Date()) return undefined;
    row.usedAt = new Date();
    return row as never;
  }),
  createAccessToken: vi.fn(async (input: { clientId: string; userId: number }) => {
    const accessToken = randomBytes(24).toString("base64url");
    const refreshToken = randomBytes(24).toString("base64url");
    const id = oauthState.tokens.size + 1;
    oauthState.tokens.set(accessToken, { id, userId: input.userId, clientId: input.clientId, expiresAt: new Date(Date.now() + 3600_000), revokedAt: null });
    return { accessToken, refreshToken, expiresInSec: 3600, refreshExpiresInSec: 86400 * 30, row: { id } as never };
  }),
  rotateRefreshToken: vi.fn(async () => undefined),
  revokeByRawToken: vi.fn(async () => {}),
  getValidAccessTokenByRaw: vi.fn(async (raw: string) => oauthState.tokens.get(raw)),
  touchAccessToken: vi.fn(async () => {}),
}));

import { registerRoutes } from "../server/routes";

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge };
}

async function makeApp(): Promise<Express> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  await registerRoutes(app);
  return app;
}

beforeEach(() => {
  oauthState.clients.clear();
  oauthState.codes.clear();
  oauthState.tokens.clear();
  sessionState.userId = undefined;
  storageMock.getUser.mockResolvedValue({
    id: 7, email: "u@example.com", name: "U", isAdmin: false,
    password: null, employeeNumber: null,
    resetToken: null, resetTokenExpiry: null, createdAt: new Date(),
  });
});

describe("OAuth 2.0 + PKCE for MCP", () => {
  it("advertises protected-resource metadata at the RFC 9728 path", async () => {
    const app = await makeApp();
    const res = await request(app).get("/.well-known/oauth-protected-resource");
    expect(res.status).toBe(200);
    expect(res.body.resource).toBe("http://localhost:5000/mcp");
    expect(res.body.authorization_servers).toEqual(["http://localhost:5000"]);
  });

  it("advertises authorization-server metadata with PKCE S256", async () => {
    const app = await makeApp();
    const res = await request(app).get("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(res.body.code_challenge_methods_supported).toContain("S256");
    expect(res.body.grant_types_supported).toContain("authorization_code");
    expect(res.body.token_endpoint).toBe("http://localhost:5000/oauth/token");
    expect(res.body.registration_endpoint).toBe("http://localhost:5000/oauth/register");
  });

  it("registers a client via DCR and walks authorize → token → /mcp", async () => {
    const app = await makeApp();

    // 1) DCR
    const reg = await request(app)
      .post("/oauth/register")
      .send({
        client_name: "Test MCP Client",
        redirect_uris: ["https://client.example/cb"],
      });
    expect(reg.status).toBe(201);
    const clientId = reg.body.client_id as string;
    expect(clientId).toMatch(/^mcp_/);

    // 2) Authorize without session → redirect to /auth?next=
    const { verifier, challenge } = pkcePair();
    const authParams = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: "https://client.example/cb",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
    }).toString();
    const noSession = await request(app).get(`/oauth/authorize?${authParams}`);
    expect(noSession.status).toBe(302);
    expect(noSession.headers.location).toContain("/auth?next=");

    // 3) Authorize with session → renders consent form
    sessionState.userId = 7;
    const consent = await request(app).get(`/oauth/authorize?${authParams}`);
    expect(consent.status).toBe(200);
    expect(consent.text).toContain("Test MCP Client");
    expect(consent.text).toContain('action="/oauth/authorize/consent"');

    // 4) POST consent allow → 302 with code on redirect_uri
    const consentRes = await request(app)
      .post("/oauth/authorize/consent")
      .type("form")
      .send({
        client_id: clientId,
        redirect_uri: "https://client.example/cb",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "xyz",
        decision: "allow",
      });
    expect(consentRes.status).toBe(302);
    const loc = new URL(consentRes.headers.location);
    expect(loc.origin + loc.pathname).toBe("https://client.example/cb");
    expect(loc.searchParams.get("state")).toBe("xyz");
    const code = loc.searchParams.get("code");
    expect(code).toBeTruthy();

    // 5) Exchange code for token (PKCE verifier must match)
    const tok = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code: code!,
        client_id: clientId,
        redirect_uri: "https://client.example/cb",
        code_verifier: verifier,
      });
    expect(tok.status).toBe(200);
    expect(tok.body.token_type).toBe("Bearer");
    expect(tok.body.expires_in).toBe(3600);
    const accessToken = tok.body.access_token as string;
    expect(accessToken).toBeTruthy();

    // 6) Hit /mcp with the OAuth token — gets past auth (200 from JSON-RPC).
    const mcp = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(mcp.status).toBe(200);
  });

  it("rejects code-exchange with the wrong PKCE verifier", async () => {
    const app = await makeApp();
    const reg = await request(app)
      .post("/oauth/register")
      .send({ client_name: "X", redirect_uris: ["https://x.example/cb"] });
    const clientId = reg.body.client_id;
    const { challenge } = pkcePair();
    sessionState.userId = 7;
    const consent = await request(app)
      .post("/oauth/authorize/consent")
      .type("form")
      .send({
        client_id: clientId,
        redirect_uri: "https://x.example/cb",
        code_challenge: challenge,
        code_challenge_method: "S256",
        decision: "allow",
      });
    const code = new URL(consent.headers.location).searchParams.get("code")!;
    const tok = await request(app).post("/oauth/token").type("form").send({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: "https://x.example/cb",
      code_verifier: "wrong-verifier-that-doesnt-match-the-challenge-at-all-padding",
    });
    expect(tok.status).toBe(400);
    expect(tok.body.error).toBe("invalid_grant");
  });

  it("/mcp returns 401 with WWW-Authenticate pointing at resource metadata", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
    const www = res.headers["www-authenticate"];
    expect(www).toContain('resource_metadata="http://localhost:5000/.well-known/oauth-protected-resource"');
    expect(www).toContain('error="invalid_token"');
  });

  it("rejects authorize with an unregistered redirect_uri", async () => {
    const app = await makeApp();
    const reg = await request(app)
      .post("/oauth/register")
      .send({ client_name: "X", redirect_uris: ["https://allowed.example/cb"] });
    const clientId = reg.body.client_id;
    sessionState.userId = 7;
    const { challenge } = pkcePair();
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: "https://evil.example/cb",
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    const res = await request(app).get(`/oauth/authorize?${params}`);
    expect(res.status).toBe(400);
  });
});
