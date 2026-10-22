// OAuth 2.0 datastore helpers for MCP clients (claude.ai web, Cowork).
// Tokens are stored as sha256 hashes; raw tokens are only returned once at issuance.

import { createHash, randomBytes } from "crypto";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "../db";
import {
  oauthClients,
  oauthAuthorizationCodes,
  oauthAccessTokens,
  type OauthClient,
  type OauthAuthorizationCode,
  type OauthAccessToken,
} from "@shared/schema";

const ACCESS_TOKEN_TTL_SEC = 60 * 60; // 1 hour
const REFRESH_TOKEN_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
const AUTH_CODE_TTL_SEC = 5 * 60; // 5 minutes

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export async function createClient(input: {
  clientName: string;
  redirectUris: string[];
}): Promise<OauthClient> {
  const clientId = `mcp_${randomBytes(16).toString("hex")}`;
  const [created] = await db
    .insert(oauthClients)
    .values({
      clientId,
      clientName: input.clientName,
      redirectUris: input.redirectUris,
    })
    .returning();
  return created;
}

export async function getClientByClientId(
  clientId: string,
): Promise<OauthClient | undefined> {
  const [row] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId));
  return row;
}

export async function createAuthorizationCode(input: {
  clientId: string;
  userId: number;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope?: string;
}): Promise<{ code: string; row: OauthAuthorizationCode }> {
  const code = randomToken(32);
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SEC * 1000);
  const [row] = await db
    .insert(oauthAuthorizationCodes)
    .values({
      code,
      clientId: input.clientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      scope: input.scope,
      expiresAt,
    })
    .returning();
  return { code, row };
}

// Atomically consumes an authorization code (returns it only if it hasn't been
// used and isn't expired). Sets usedAt so a replay can't get a second token.
export async function consumeAuthorizationCode(
  code: string,
): Promise<OauthAuthorizationCode | undefined> {
  const now = new Date();
  const [row] = await db
    .update(oauthAuthorizationCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(oauthAuthorizationCodes.code, code),
        isNull(oauthAuthorizationCodes.usedAt),
        gt(oauthAuthorizationCodes.expiresAt, now),
      ),
    )
    .returning();
  return row;
}

export async function createAccessToken(input: {
  clientId: string;
  userId: number;
  scope?: string;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  refreshExpiresInSec: number;
  row: OauthAccessToken;
}> {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000);
  const [row] = await db
    .insert(oauthAccessTokens)
    .values({
      tokenHash: hashToken(accessToken),
      tokenPrefix: accessToken.slice(0, 8),
      refreshTokenHash: hashToken(refreshToken),
      refreshTokenPrefix: refreshToken.slice(0, 8),
      clientId: input.clientId,
      userId: input.userId,
      scope: input.scope,
      expiresAt,
      refreshExpiresAt,
    })
    .returning();
  return {
    accessToken,
    refreshToken,
    expiresInSec: ACCESS_TOKEN_TTL_SEC,
    refreshExpiresInSec: REFRESH_TOKEN_TTL_SEC,
    row,
  };
}

// Look up by hash; caller passes the raw access token.
export async function getValidAccessTokenByRaw(
  raw: string,
): Promise<OauthAccessToken | undefined> {
  const tokenHash = hashToken(raw);
  const now = new Date();
  const [row] = await db
    .select()
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.tokenHash, tokenHash));
  if (!row) return undefined;
  if (row.revokedAt) return undefined;
  if (row.expiresAt <= now) return undefined;
  return row;
}

export async function touchAccessToken(id: number): Promise<void> {
  await db
    .update(oauthAccessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(oauthAccessTokens.id, id));
}

// Refresh-token grant: validate the raw refresh token, mark the old row revoked,
// and issue a fresh access+refresh pair (rotation).
export async function rotateRefreshToken(
  rawRefresh: string,
  clientId: string,
): Promise<
  | {
      accessToken: string;
      refreshToken: string;
      expiresInSec: number;
      refreshExpiresInSec: number;
      row: OauthAccessToken;
    }
  | undefined
> {
  const refreshHash = hashToken(rawRefresh);
  const [existing] = await db
    .select()
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.refreshTokenHash, refreshHash));
  if (!existing) return undefined;
  if (existing.revokedAt) return undefined;
  if (existing.clientId !== clientId) return undefined;
  if (!existing.refreshExpiresAt || existing.refreshExpiresAt <= new Date()) {
    return undefined;
  }
  await db
    .update(oauthAccessTokens)
    .set({ revokedAt: new Date() })
    .where(eq(oauthAccessTokens.id, existing.id));
  return createAccessToken({
    clientId: existing.clientId,
    userId: existing.userId,
    scope: existing.scope ?? undefined,
  });
}

export async function revokeByRawToken(raw: string): Promise<void> {
  const tokenHash = hashToken(raw);
  await db
    .update(oauthAccessTokens)
    .set({ revokedAt: new Date() })
    .where(eq(oauthAccessTokens.tokenHash, tokenHash));
  // Also try refresh token
  await db
    .update(oauthAccessTokens)
    .set({ revokedAt: new Date() })
    .where(eq(oauthAccessTokens.refreshTokenHash, tokenHash));
}
