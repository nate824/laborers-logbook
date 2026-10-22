import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { pool } from "./db";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE entries
        ADD COLUMN IF NOT EXISTS technician_signature TEXT,
        ADD COLUMN IF NOT EXISTS supervisor_signature TEXT,
        ADD COLUMN IF NOT EXISTS data_hash TEXT,
        ADD COLUMN IF NOT EXISTS integrity_signature TEXT,
        ADD COLUMN IF NOT EXISTS verification_requested_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS verified_by_email TEXT,
        ADD COLUMN IF NOT EXISTS audit_trail JSON,
        ADD COLUMN IF NOT EXISTS supervisor_ip_address TEXT,
        ADD COLUMN IF NOT EXISTS supervisor_browser_info TEXT,
        ADD COLUMN IF NOT EXISTS employee_id_used TEXT,
        ADD COLUMN IF NOT EXISTS source_document_key TEXT,
        ADD COLUMN IF NOT EXISTS source_document_name TEXT,
        ADD COLUMN IF NOT EXISTS imported_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS details JSON;
    `);
    await client.query(`
      ALTER TABLE rope_hours
        ADD COLUMN IF NOT EXISTS technician_signature TEXT,
        ADD COLUMN IF NOT EXISTS supervisor_signature TEXT,
        ADD COLUMN IF NOT EXISTS data_hash TEXT,
        ADD COLUMN IF NOT EXISTS integrity_signature TEXT,
        ADD COLUMN IF NOT EXISTS verification_requested_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS verified_by_email TEXT,
        ADD COLUMN IF NOT EXISTS audit_trail JSON,
        ADD COLUMN IF NOT EXISTS supervisor_ip_address TEXT,
        ADD COLUMN IF NOT EXISTS supervisor_browser_info TEXT,
        ADD COLUMN IF NOT EXISTS employee_id_used TEXT,
        ADD COLUMN IF NOT EXISTS source_document_key TEXT,
        ADD COLUMN IF NOT EXISTS source_document_name TEXT,
        ADD COLUMN IF NOT EXISTS imported_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS employer TEXT,
        ADD COLUMN IF NOT EXISTS work_details TEXT,
        ADD COLUMN IF NOT EXISTS max_height TEXT,
        ADD COLUMN IF NOT EXISTS project_number TEXT,
        ADD COLUMN IF NOT EXISTS work_code TEXT;
    `);
    await client.query(`
      ALTER TABLE supervisors
        ADD COLUMN IF NOT EXISTS sprat_number TEXT,
        ADD COLUMN IF NOT EXISTS irata_number TEXT,
        ADD COLUMN IF NOT EXISTS ndt_method TEXT,
        ALTER COLUMN certification_level DROP NOT NULL,
        ALTER COLUMN company DROP NOT NULL;
    `);
    // api_tokens: bearer tokens for Claude MCP and other external clients.
    // tokenPrefix is the first 8 chars of the raw token, used for fast lookup;
    // tokenHash is sha256(rawToken). Raw tokens are 32-byte (64-hex) random.
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        token_prefix TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        last_used_at TIMESTAMP
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS api_tokens_prefix_idx ON api_tokens(token_prefix);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens(user_id);
    `);
    // users: public share profile (token-gated read-only summary).
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS share_token TEXT,
        ADD COLUMN IF NOT EXISTS share_token_created_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS share_settings JSON;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_share_token_idx
        ON users(share_token) WHERE share_token IS NOT NULL;
    `);
    // certifications: a technician's credentials (ASNT/IRATA/SPRAT/employer).
    // document_key points at the uploaded certificate in object storage.
    await client.query(`
      CREATE TABLE IF NOT EXISTS certifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        method TEXT,
        level TEXT,
        issuing_body TEXT,
        cert_number TEXT,
        issue_date TIMESTAMP,
        expiry_date TIMESTAMP,
        document_key TEXT,
        document_name TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS certifications_user_idx ON certifications(user_id);
    `);
    // Union: the member's profile, fund cross-check rows and out-of-work list
    // history (shared/union.ts holds the rules that read them).
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS union_profile JSON;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS fund_reports (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        month TEXT NOT NULL,
        employer TEXT NOT NULL,
        hours REAL NOT NULL,
        note TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS fund_reports_user_idx ON fund_reports(user_id);
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS dispatch_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        date TIMESTAMP NOT NULL,
        kind TEXT NOT NULL,
        employer TEXT,
        note TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS dispatch_events_user_idx ON dispatch_events(user_id);
    `);
    // OAuth 2.0 tables for MCP clients (claude.ai web, Cowork).
    await client.query(`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        id SERIAL PRIMARY KEY,
        client_id TEXT NOT NULL UNIQUE,
        client_name TEXT NOT NULL,
        redirect_uris TEXT[] NOT NULL DEFAULT '{}'::text[],
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        client_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id),
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        code_challenge_method TEXT NOT NULL,
        scope TEXT,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS oauth_auth_codes_code_idx ON oauth_authorization_codes(code);
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS oauth_access_tokens (
        id SERIAL PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        token_prefix TEXT NOT NULL,
        refresh_token_hash TEXT,
        refresh_token_prefix TEXT,
        client_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id),
        scope TEXT,
        expires_at TIMESTAMP NOT NULL,
        refresh_expires_at TIMESTAMP,
        revoked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        last_used_at TIMESTAMP
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS oauth_access_tokens_prefix_idx ON oauth_access_tokens(token_prefix);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS oauth_access_tokens_refresh_prefix_idx ON oauth_access_tokens(refresh_token_prefix);
    `);
    log("Database migrations applied successfully");
  } catch (err) {
    log(`Migration error: ${err}`);
    throw err;
  } finally {
    client.release();
  }
}

(async () => {
  await runMigrations();
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
