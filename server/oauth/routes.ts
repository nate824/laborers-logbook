// OAuth 2.0 endpoints for MCP clients. Implements:
//  - RFC 9728 protected-resource metadata
//  - RFC 8414 authorization-server metadata
//  - RFC 7591 Dynamic Client Registration
//  - Authorization Code grant + PKCE (RFC 7636)
//  - Refresh Token grant
//  - RFC 7009 Token Revocation
//
// User auth comes from the existing session cookie. If the user isn't logged in
// when they hit /oauth/authorize, we bounce them through /auth?next=... and
// they come back here logged in.

import { createHash } from "crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { getBaseUrl } from "../email";
import {
  createClient,
  getClientByClientId,
  createAuthorizationCode,
  consumeAuthorizationCode,
  createAccessToken,
  rotateRefreshToken,
  revokeByRawToken,
} from "./store";

const SUPPORTED_CODE_CHALLENGE_METHODS = ["S256"] as const;

function metadataBase(req: Request) {
  // Prefer X-Forwarded-Host if Replit/proxy supplies it; fall back to our
  // configured base URL so we never advertise localhost in production.
  return getBaseUrl();
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// PKCE: verifier passes if BASE64URL(SHA256(verifier)) == challenge (S256).
function verifyPkce(
  verifier: string,
  challenge: string,
  method: string,
): boolean {
  if (method !== "S256") return false;
  const hash = createHash("sha256").update(verifier).digest();
  const computed = hash
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return computed === challenge;
}

const registerSchema = z.object({
  client_name: z.string().min(1).max(200),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  // Optional fields we just acknowledge; we don't act on them.
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
});

const authorizeQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(20),
  code_challenge_method: z.enum(SUPPORTED_CODE_CHALLENGE_METHODS),
  scope: z.string().optional(),
  state: z.string().optional(),
});

const consentBodySchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(20),
  code_challenge_method: z.enum(SUPPORTED_CODE_CHALLENGE_METHODS),
  scope: z.string().optional(),
  state: z.string().optional(),
  decision: z.enum(["allow", "deny"]),
});

const tokenBodySchema = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string().min(1),
    client_id: z.string().min(1),
    redirect_uri: z.string().url(),
    code_verifier: z.string().min(20),
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().min(1),
    client_id: z.string().min(1),
  }),
]);

export function registerOauthRoutes(app: Express) {
  // ---- Discovery: protected-resource metadata (RFC 9728) -----------------
  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    const base = metadataBase(req);
    res.json({
      resource: `${base}/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp"],
    });
  });

  // ---- Discovery: authorization-server metadata (RFC 8414) ---------------
  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    const base = metadataBase(req);
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp"],
    });
  });

  // ---- Dynamic Client Registration (RFC 7591) ----------------------------
  app.post("/oauth/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_client_metadata",
        error_description: parsed.error.message,
      });
    }
    try {
      const client = await createClient({
        clientName: parsed.data.client_name,
        redirectUris: parsed.data.redirect_uris,
      });
      return res.status(201).json({
        client_id: client.clientId,
        client_id_issued_at: Math.floor(
          (client.createdAt?.getTime() ?? Date.now()) / 1000,
        ),
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      });
    } catch (e) {
      console.error("oauth/register error:", e);
      return res
        .status(500)
        .json({ error: "server_error", error_description: "registration failed" });
    }
  });

  // ---- Authorize: render consent page (or auto-redirect to login) --------
  app.get("/oauth/authorize", async (req, res) => {
    const parsed = authorizeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).type("text/plain").send(
        `invalid_request: ${parsed.error.message}`,
      );
    }
    const q = parsed.data;
    const client = await getClientByClientId(q.client_id);
    if (!client) {
      return res.status(400).type("text/plain").send("invalid_client");
    }
    if (!client.redirectUris.includes(q.redirect_uri)) {
      return res
        .status(400)
        .type("text/plain")
        .send("invalid redirect_uri (not registered for this client)");
    }
    // Not logged in → bounce through /auth, return here after.
    if (!req.session.userId) {
      const here = `/oauth/authorize?${new URLSearchParams(
        req.query as Record<string, string>,
      ).toString()}`;
      return res.redirect(`/auth?next=${encodeURIComponent(here)}`);
    }

    // Render the consent page. The form posts back to /oauth/authorize/consent
    // with all the original params so we don't keep state on the server.
    const params = {
      client_id: q.client_id,
      redirect_uri: q.redirect_uri,
      code_challenge: q.code_challenge,
      code_challenge_method: q.code_challenge_method,
      scope: q.scope ?? "",
      state: q.state ?? "",
    };
    res.type("text/html").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Authorize ${htmlEscape(client.clientName)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 4rem auto; padding: 0 1rem; }
  h1 { font-size: 1.4rem; }
  .client { background: #f5f5f5; padding: 1rem; border-radius: 8px; margin: 1rem 0; }
  .scopes { color: #555; }
  button { padding: 0.6rem 1.2rem; font-size: 1rem; border-radius: 6px; cursor: pointer; }
  .allow { background: #2563eb; color: white; border: none; }
  .deny { background: white; border: 1px solid #ccc; margin-left: 0.5rem; }
</style></head>
<body>
  <h1>Authorize access</h1>
  <div class="client">
    <strong>${htmlEscape(client.clientName)}</strong> is requesting access to your Laborers Logbook account.
  </div>
  <p class="scopes">It will be able to read and modify your field-hours entries, rope hours, supervisors, and request verifications — the same actions you can perform yourself.</p>
  <form method="POST" action="/oauth/authorize/consent">
    ${Object.entries(params)
      .map(
        ([k, v]) =>
          `<input type="hidden" name="${htmlEscape(k)}" value="${htmlEscape(v)}">`,
      )
      .join("\n    ")}
    <button class="allow" type="submit" name="decision" value="allow">Allow</button>
    <button class="deny" type="submit" name="decision" value="deny">Deny</button>
  </form>
</body></html>`);
  });

  // ---- Authorize: handle consent decision --------------------------------
  app.post("/oauth/authorize/consent", async (req, res) => {
    const parsed = consentBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).type("text/plain").send("invalid_request");
    }
    const body = parsed.data;
    if (!req.session.userId) {
      return res.status(401).type("text/plain").send("not_authenticated");
    }
    const client = await getClientByClientId(body.client_id);
    if (!client || !client.redirectUris.includes(body.redirect_uri)) {
      return res.status(400).type("text/plain").send("invalid_client_or_redirect");
    }

    const redirectUrl = new URL(body.redirect_uri);
    if (body.state) redirectUrl.searchParams.set("state", body.state);

    if (body.decision === "deny") {
      redirectUrl.searchParams.set("error", "access_denied");
      return res.redirect(redirectUrl.toString());
    }

    const { code } = await createAuthorizationCode({
      clientId: body.client_id,
      userId: req.session.userId,
      redirectUri: body.redirect_uri,
      codeChallenge: body.code_challenge,
      codeChallengeMethod: body.code_challenge_method,
      scope: body.scope,
    });
    redirectUrl.searchParams.set("code", code);
    res.redirect(redirectUrl.toString());
  });

  // ---- Token endpoint ----------------------------------------------------
  app.post("/oauth/token", async (req, res) => {
    const parsed = tokenBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "invalid_request", error_description: parsed.error.message });
    }
    const body = parsed.data;
    const client = await getClientByClientId(body.client_id);
    if (!client) {
      return res.status(401).json({ error: "invalid_client" });
    }

    if (body.grant_type === "authorization_code") {
      const codeRow = await consumeAuthorizationCode(body.code);
      if (!codeRow) {
        return res.status(400).json({ error: "invalid_grant" });
      }
      if (codeRow.clientId !== body.client_id) {
        return res.status(400).json({ error: "invalid_grant" });
      }
      if (codeRow.redirectUri !== body.redirect_uri) {
        return res.status(400).json({ error: "invalid_grant" });
      }
      if (
        !verifyPkce(
          body.code_verifier,
          codeRow.codeChallenge,
          codeRow.codeChallengeMethod,
        )
      ) {
        return res.status(400).json({ error: "invalid_grant" });
      }
      const issued = await createAccessToken({
        clientId: codeRow.clientId,
        userId: codeRow.userId,
        scope: codeRow.scope ?? undefined,
      });
      return res.json({
        access_token: issued.accessToken,
        token_type: "Bearer",
        expires_in: issued.expiresInSec,
        refresh_token: issued.refreshToken,
        scope: codeRow.scope ?? undefined,
      });
    }

    // refresh_token grant
    const rotated = await rotateRefreshToken(body.refresh_token, body.client_id);
    if (!rotated) {
      return res.status(400).json({ error: "invalid_grant" });
    }
    return res.json({
      access_token: rotated.accessToken,
      token_type: "Bearer",
      expires_in: rotated.expiresInSec,
      refresh_token: rotated.refreshToken,
    });
  });

  // ---- Revocation (RFC 7009) --------------------------------------------
  app.post("/oauth/revoke", async (req, res) => {
    const token = (req.body?.token as string | undefined) ?? "";
    if (token) await revokeByRawToken(token);
    // Per RFC 7009 we always return 200.
    res.status(200).end();
  });
}
