import express, {
  type Express,
  Request,
  Response,
  NextFunction,
} from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { randomBytes, randomUUID } from "crypto";
import session from "express-session";
import PgStore from "connect-pg-simple";
import { add } from "date-fns";
import { pool } from "./db";
import { db } from "./db";
import { users, entries, supervisors, ropeHours, certifications, type User, type VerificationAuditTrail } from "@shared/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import {
  getBaseUrl,
  sendEmail,
  sendVerificationConfirmation,
  sendVerificationRequest,
  sendRopeHoursVerificationRequest,
  sendBatchVerificationRequest,
  sendInviteEmail,
} from "./email";
import {
  buildSignatureSms,
  deliverSignatureRequest,
  notificationStatus,
  parseChannels,
  type DeliveryResult,
} from "./notify";
import { formatCalendarDate } from "@shared/dates";
import {
  insertEntrySchema,
  cleanEntryDetails,
  insertSupervisorSchema,
  insertUserSchema,
  insertRopeHoursSchema,
  canonicalizeSupervisorWrite,
  certificationWriteSchema,
  shareSettingsSchema,
  FieldMethods,
  type FieldMethod,
} from "@shared/schema";
import { z } from "zod";
import { compare, hash } from "bcrypt";
import { createTechnicianCryptoIdentity } from "./crypto";
import multer from "multer";
import { randomUUID as cryptoRandomUUID } from "crypto";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "./replit_integrations/object_storage/objectStorage";
import { extractOJTRows, extractRopeRows } from "./extraction";
import { canEditSigner, findDuplicateSigner, duplicateSignerMessage } from "./signers";
import { fillFormPages } from "./forms/filler";
import { isFormId, registry } from "./forms/registry";
import {
  EmptyExportError,
  FormCapacityError,
  NothingToExportError,
} from "./forms/types";
import { handleMcpRequest, takeExport } from "./mcp/server";
import { registerOauthRoutes } from "./oauth/routes";
import { registerUnionRoutes } from "./unionRoutes";
import {
  getValidAccessTokenByRaw as getOauthAccessTokenByRaw,
  touchAccessToken as touchOauthAccessToken,
} from "./oauth/store";
import { createHash } from "crypto";

// Extend express-session types
declare module "express-session" {
  interface SessionData {
    userId?: number;
    // When an admin is impersonating ("view as user"), userId holds the target
    // user's id and adminUserId holds the real admin's id so they can exit.
    adminUserId?: number;
    magicLinkToken?: string;
    magicLinkEmail?: string;
  }
}

// Pull the evidence we can observe at verification-confirm time off the request:
// the supervisor's IP (honoring a proxy's X-Forwarded-For), their user-agent,
// and whether they ticked the attestation box. Used to build the audit trail.
function buildVerificationEvidence(
  req: Request,
  attestation: unknown,
): { ipAddress?: string; browserInfo?: string; attestation?: boolean } {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === "string"
      ? forwarded.split(",")[0].trim()
      : undefined;
  const ipAddress =
    forwardedIp || req.ip || req.socket?.remoteAddress || undefined;
  const browserInfo = req.get("user-agent") || undefined;
  return { ipAddress, browserInfo, attestation: attestation === true };
}

// Note on the request event how the signature link went out (email / text),
// so the audit trail shows which address or number the signer was reached at.
async function recordDelivery(
  table: typeof entries | typeof ropeHours,
  ids: number[],
  trail: VerificationAuditTrail | null | undefined,
  delivery: DeliveryResult,
  phone: string | null | undefined,
) {
  const channels: ("email" | "sms")[] = [];
  if (delivery.email === "sent") channels.push("email");
  if (delivery.sms === "sent") channels.push("sms");
  const events = [...(trail ?? [])];
  const last = events.length - 1;
  if (last < 0 || events[last].action !== "verification_requested") return;
  events[last] = {
    ...events[last],
    channels,
    ...(delivery.sms === "sent" && phone ? { phone } : {}),
    note: channels.length
      ? `Link sent by ${channels.map((c) => (c === "sms" ? "text" : "email")).join(" and ")}`
      : "Link shared directly by the technician",
  };
  await Promise.all(ids.map((id) => db.update(table).set({ auditTrail: events }).where(eq(table.id, id))));
}

// In server/routes.ts, replace the session configuration with this:

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup session
  const PgSession = PgStore(session);
  const isProduction = process.env.NODE_ENV === "production";

  // Detect if we're running on the custom domain
  const isCustomDomain = process.env.REPLIT_DOMAINS?.includes('trackerloger.online') || false;

  app.use(
    session({
      store: new PgSession({
        pool,
        tableName: "session",
        createTableIfMissing: true,
      }),
      secret: process.env.SESSION_SECRET || "dev-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        // Use secure cookies for HTTPS domains (your custom domain)
        secure: isCustomDomain || isProduction,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        domain: undefined, // No domain restriction
        httpOnly: true,
      },
      proxy: true, // trust the reverse proxy
    }),
  );

  // Enhanced logging
  console.log(`Session configured:
    - Custom domain detected: ${isCustomDomain}
    - Secure cookies: ${isCustomDomain || isProduction}
    - Production mode: ${isProduction}
    - Available domains: ${process.env.REPLIT_DOMAINS || 'none'}
  `);

  // Secure CORS setup with proper origin allowlist
  app.use((req, res, next) => {
    const origin = req.headers.origin || "";
    const host = req.headers.host || "";

    console.log(`Request from host: ${host}, origin: ${origin}`);

    // Create allowlist of trusted origins
    const allowedOrigins: string[] = [];
    
    // Add production domain
    if (process.env.REPLIT_DOMAINS) {
      const domains = process.env.REPLIT_DOMAINS.split(',');
      domains.forEach(domain => {
        allowedOrigins.push(`https://${domain.trim()}`);
        // Also allow HTTP for development on Replit preview URLs
        if (domain.includes('replit.dev') || domain.includes('repl.co')) {
          allowedOrigins.push(`http://${domain.trim()}`);
        }
      });
    }
    
    // Add localhost for development (both localhost and 127.0.0.1 for Replit)
    allowedOrigins.push('http://localhost:5000');
    allowedOrigins.push('https://localhost:5000');
    allowedOrigins.push('http://127.0.0.1:5000');
    allowedOrigins.push('https://127.0.0.1:5000');
    
    // Check if origin is in allowlist
    // A page served by this host posting back to it isn't cross-origin at all
    // (e.g. a phone hitting the dev box by its tailnet name).
    let sameHost = false;
    try {
      sameHost = !!origin && new URL(origin).host === host;
    } catch {
      /* malformed Origin header */
    }

    const isAllowedOrigin = sameHost || allowedOrigins.includes(origin) ||
                           (process.env.NODE_ENV === 'development' && origin.startsWith('http://localhost:'));

    if (isAllowedOrigin) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Credentials", "true");
    } else {
      // Log rejected origins for debugging
      console.warn(`CORS: Rejected origin ${origin}. Allowed origins: ${allowedOrigins.join(', ')}`);
    }
    
    res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
    res.header(
      "Access-Control-Allow-Headers", 
      "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept, Authorization"
    );
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    
    next();
  });

  // Shared object storage service (used for imported source-document
  // upload, download, and cleanup on delete).
  const objectStorageService = new ObjectStorageService();

  // Shared multer instance + allowed upload types (signed-log imports and
  // certificate uploads, including admin-on-behalf uploads).
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  });
  const ALLOWED_IMPORT_MIMES = new Set([
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ]);

  // Authentication middleware
  const requireAuth = (req: Request, res: Response, next: Function) => {
    console.log(
      `Authentication check: session ID ${req.session.id}, user ID: ${req.session.userId || "not set"}`,
    );

    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  };

  // Hash an API token using SHA-256. Tokens are 32-byte hex (64 chars), so
  // we don't need bcrypt — a fast hash is sufficient because the token
  // itself has 256 bits of entropy and brute-forcing the hash is hopeless.
  const hashApiToken = (raw: string) =>
    createHash("sha256").update(raw).digest("hex");

  // Accepts either a logged-in session OR a valid bearer token. When a
  // bearer authenticates, sets req.session.userId so all downstream
  // handlers (which read req.session.userId!) just work.
  const requireAuthOrToken = async (
    req: Request,
    res: Response,
    next: Function,
  ) => {
    if (req.session.userId) {
      return next();
    }
    const authHeader = req.headers.authorization || "";
    const match = /^Bearer\s+([A-Za-z0-9_-]+)$/.exec(authHeader);
    if (!match) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const raw = match[1];
    if (raw.length < 16) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const prefix = raw.slice(0, 8);
      const tokenHash = hashApiToken(raw);
      const candidates = await storage.getApiTokensByPrefix(prefix);
      const matched = candidates.find((t) => t.tokenHash === tokenHash);
      if (!matched) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      // Surface user ID via a per-request session shim so the existing
      // handlers (which read `req.session.userId!`) keep working WITHOUT
      // mutating or persisting the real express-session record. This keeps
      // bearer auth fully stateless: no Set-Cookie is issued and no
      // cookie-session is bootstrapped from an API call.
      const realSession = req.session;
      (req as Request & { session: { userId?: number } }).session = {
        ...(realSession as object),
        userId: matched.userId,
        // No-op save/destroy so handlers that call them on the shim don't blow up.
        save: (cb?: (err?: unknown) => void) => cb && cb(),
        destroy: (cb?: (err?: unknown) => void) => cb && cb(),
      } as never;
      // Fire-and-forget bookkeeping
      storage.touchApiToken(matched.id).catch((e) =>
        console.warn("touchApiToken failed:", e),
      );
      next();
    } catch (error) {
      console.error("Bearer auth error:", error);
      return res.status(500).json({ message: "Auth error" });
    }
  };

  // Admin middleware
  const requireAdmin = async (req: Request, res: Response, next: Function) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !user.isAdmin) {
        return res
          .status(403)
          .json({ message: "Access denied: Admin privileges required" });
      }
      next();
    } catch (error) {
      console.error("Error checking admin status:", error);
      return res.status(500).json({ message: "Error checking admin status" });
    }
  };

  // Authentication routes
  // Register new user
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, name, employeeNumber } = req.body;

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      // Hash password
      const hashedPassword = await hash(password, 10);

      // Create new user
      const userData = insertUserSchema.parse({
        email,
        password: hashedPassword,
        name,
        employeeNumber,
      });

      const user = await storage.createUser(userData);

      // Log user in
      req.session.userId = user.id;

      // Send user data (excluding password)
      const { password: _, ...userWithoutPassword } = user;
      res.status(201).json(userWithoutPassword);
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Error during registration" });
    }
  });

  // Login with email/password
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      // Validate input
      if (!email || !password) {
        return res
          .status(400)
          .json({ message: "Email and password are required" });
      }

      // Get user
      const user = await storage.getUserByEmail(email);
      if (!user || !user.password) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Verify password
      const passwordMatches = await compare(password, user.password);
      if (!passwordMatches) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Login successful
      req.session.userId = user.id;
      console.log(
        `Login successful for user ${user.id}, setting session ID: ${req.session.id}`,
      );

      // Save session explicitly before responding
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ message: "Error saving session" });
        }

        // Send user data (excluding password) after session is saved
        const { password: _, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Error during login" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Error logging out" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  // Password reset request
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Find user by email
      const user = await storage.getUserByEmail(email);

      // Even if user not found, return success to prevent email enumeration
      if (!user) {
        return res.json({
          message:
            "If your email exists in our system, you will receive a password reset link",
        });
      }

      // Generate reset token and set expiry (1 hour from now)
      const resetToken = randomUUID();
      const resetTokenExpiry = add(new Date(), { hours: 1 });

      // Save token to user record
      await db
        .update(users)
        .set({
          resetToken,
          resetTokenExpiry,
        })
        .where(eq(users.id, user.id));

      // Create reset URL
      const baseUrl = getBaseUrl(req);
      const resetUrl = `${baseUrl}/reset-password/${resetToken}`;

      // Create email HTML
      const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Laborers Logbook - Password Reset</h2>
          <p>You recently requested to reset your password. Click the button below to reset it:</p>
          
          <p>
            <a 
              href="${resetUrl}" 
              style="display: inline-block; padding: 10px 20px; background-color: #42be65; color: white; text-decoration: none; border-radius: 4px;"
            >
              Reset Password
            </a>
          </p>
          <p>Or copy and paste this URL into your browser:</p>
          <p>${resetUrl}</p>
          
          <p>This link will expire in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
        </div>
      `;

      // Send email
      const emailSent = await sendEmail(
        user.email,
        "Reset your Laborers Logbook password",
        html,
      );

      // Log reset token for debugging
      console.log(
        `Password reset requested for ${user.email}. Reset URL: ${resetUrl}`,
      );

      if (!emailSent) {
        console.log("Failed to send password reset email, but token is valid");
      }

      res.json({
        message:
          "If your email exists in our system, you will receive a password reset link",
      });
    } catch (error) {
      console.error("Password reset request error:", error);
      res
        .status(500)
        .json({ message: "Error processing password reset request" });
    }
  });

  // Validate reset token and set new password
  app.post("/api/auth/reset-password/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const { password } = req.body;

      if (!token || !password) {
        return res
          .status(400)
          .json({ message: "Token and password are required" });
      }

      // Find user by token and check if token is still valid
      const [user] = await db
        .select()
        .from(users)
        .where(
          and(eq(users.resetToken, token), isNotNull(users.resetTokenExpiry)),
        );

      if (!user || new Date(user.resetTokenExpiry!) < new Date()) {
        return res.status(400).json({ message: "Invalid or expired token" });
      }

      // Hash new password
      const hashedPassword = await hash(password, 10);

      // Update user with new password and clear reset token
      await db
        .update(users)
        .set({
          password: hashedPassword,
          resetToken: null,
          resetTokenExpiry: null,
        })
        .where(eq(users.id, user.id));

      res.json({ message: "Password reset successful" });
    } catch (error) {
      console.error("Password reset error:", error);
      res.status(500).json({ message: "Error resetting password" });
    }
  });

  // User routes
  app.get("/api/user", requireAuthOrToken, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Send user data without password. Flag impersonation so the client can
      // show the "viewing as" banner and an exit control.
      const { password, ...userWithoutPassword } = user;
      res.json({
        ...userWithoutPassword,
        impersonating: !!req.session.adminUserId,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching user" });
    }
  });

  app.patch("/api/user", requireAuthOrToken, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Update name and employeeNumber if provided
      const updateSchema = z.object({
        name: z.string().optional(),
        employeeNumber: z.string().optional(),
      });

      const { name, employeeNumber } = updateSchema.parse(req.body);

      // Update user in database
      const updatedUser = await db
        .update(users)
        .set({
          name: name || user.name,
          employeeNumber: employeeNumber || user.employeeNumber,
        })
        .where(eq(users.id, user.id))
        .returning();

      // Send user data without password
      const { password, ...userWithoutPassword } = updatedUser[0];
      res.json(userWithoutPassword);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error updating user" });
    }
  });

  // Entry routes
  app.get("/api/entries", requireAuthOrToken, async (req, res) => {
    try {
      const entries = await storage.getEntries(req.session.userId!);
      res.json(entries);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching entries" });
    }
  });

  app.post("/api/entries", requireAuthOrToken, async (req, res) => {
    try {
      const userId = req.session.userId!;

      // Handle single entry or array of entries
      if (Array.isArray(req.body)) {
        const entriesData = req.body.map((entry) => ({
          ...entry,
          userId,
        }));

        const createdEntries = [];
        for (const entryData of entriesData) {
          // Ensure date is parsed properly
          const parsedData = insertEntrySchema.parse({
            ...entryData,
            date: new Date(entryData.date),
          });
          parsedData.details = cleanEntryDetails(parsedData.method, parsedData.details);
          const newEntry = await storage.createEntry(parsedData);
          createdEntries.push(newEntry);
        }

        res.status(201).json(createdEntries);
      } else {
        const entryData = {
          ...req.body,
          userId,
        };

        // Ensure date is parsed properly
        const parsedData = insertEntrySchema.parse({
          ...entryData,
          date: new Date(entryData.date),
        });
        parsedData.details = cleanEntryDetails(parsedData.method, parsedData.details);
        const newEntry = await storage.createEntry(parsedData);

        res.status(201).json(newEntry);
      }
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid entry data",
          errors: error.errors,
        });
      }
      res.status(500).json({ message: "Error creating entry" });
    }
  });

  app.patch("/api/entries/:id", requireAuthOrToken, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const id = parseInt(req.params.id);

      const existing = await storage.getEntry(id);
      if (!existing) return res.status(404).json({ message: "Entry not found" });
      if (existing.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized: Entry does not belong to you" });
      }
      if (existing.verified) {
        return res.status(400).json({ message: "Cannot edit a verified entry" });
      }
      if (existing.verificationRequestedAt) {
        return res.status(400).json({
          message: "Cannot edit an entry that has been sent for verification",
        });
      }

      const updateSchema = insertEntrySchema.omit({ userId: true }).partial();
      const body = { ...req.body };
      if (body.date) body.date = new Date(body.date);
      const parsedData = updateSchema.parse(body);
      // Details belong to a method: re-clean them whenever either changes.
      if (parsedData.details !== undefined || parsedData.method) {
        parsedData.details = cleanEntryDetails(
          parsedData.method ?? existing.method,
          parsedData.details ?? existing.details,
        );
      }

      const updated = await storage.updateEntry(id, parsedData);
      res.json(updated);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid entry data", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating entry" });
    }
  });

  // Delete an field-hours entry. Only the owner can delete their own entries.
  // For imported entries, when no other entry or rope-hour record references
  // the same source document, the underlying object-storage file is deleted
  // as well.
  app.delete("/api/entries/:id", requireAuthOrToken, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: "Invalid entry id" });
      }

      const existing = await storage.getEntry(id);
      if (!existing) {
        return res.status(404).json({ message: "Entry not found" });
      }
      if (existing.userId !== userId) {
        return res
          .status(403)
          .json({ message: "Unauthorized: Entry does not belong to you" });
      }

      const sourceKey = existing.sourceDocumentKey;
      await storage.deleteEntry(id);

      if (sourceKey) {
        const remainingEntries =
          await storage.countEntriesBySourceDocumentKey(sourceKey);
        const remainingRopeHours =
          await storage.countRopeHoursBySourceDocumentKey(sourceKey);
        if (remainingEntries === 0 && remainingRopeHours === 0) {
          try {
            await objectStorageService.deleteObjectEntity(sourceKey);
          } catch (err) {
            console.error(
              "Failed to delete orphaned source document",
              sourceKey,
              err,
            );
          }
        }
      }

      res.json({ message: "Entry removed" });
    } catch (error) {
      console.error("Error deleting entry:", error);
      res.status(500).json({ message: "Error deleting entry" });
    }
  });

  // Export rope-hours entries into a vendor PDF form
  app.post("/api/export-form", requireAuthOrToken, async (req, res) => {
    const userId = req.session.userId!;
    const { form_id, entry_ids, header_overrides } = req.body ?? {};

    if (!isFormId(form_id)) {
      return res.status(422).json({
        message: "Unknown form_id",
        code: "unknown_form",
        details: { supported: Object.keys(registry) },
      });
    }

    if (!Array.isArray(entry_ids) || entry_ids.length === 0
        || !entry_ids.every((id) => Number.isInteger(id) && id > 0)) {
      return res.status(422).json({
        message: "entry_ids must be a non-empty array of positive integers",
        code: "empty_export",
      });
    }

    const requestedIds = new Set<number>(entry_ids);
    const profile = await storage.getUser(userId);
    if (!profile) {
      return res.status(401).json({ message: "Profile not found", code: "unauthorized" });
    }

    const entryDef = registry[form_id];

    let pages;
    let earliestMs: number, latestMs: number;
    try {
      if (entryDef.kind === "ojt") {
        const userEntries = await storage.getEntries(userId);
        const selected = userEntries.filter((e) => requestedIds.has(e.id));
        if (selected.length !== requestedIds.size) {
          return res.status(403).json({
            message: "One or more entry_ids are not accessible",
            code: "entry_not_found",
          });
        }
        pages = entryDef.adapter({
          entries: selected,
          profile,
          headerOverrides: header_overrides,
        });
        const dates = selected.map((e) => e.date.getTime()).sort();
        earliestMs = dates[0];
        latestMs = dates[dates.length - 1];
      } else {
        const userRope = await storage.getRopeHours(userId);
        const selected = userRope.filter((r) => requestedIds.has(r.id));
        if (selected.length !== requestedIds.size) {
          return res.status(403).json({
            message: "One or more entry_ids are not accessible",
            code: "entry_not_found",
          });
        }
        const supervisors = await storage.getSupervisors();
        pages = entryDef.adapter({
          ropeHours: selected,
          profile,
          supervisors,
          headerOverrides: header_overrides,
        });
        const dates = selected.map((r) => r.startDate.getTime()).sort();
        earliestMs = dates[0];
        latestMs = dates[dates.length - 1];
      }
    } catch (err) {
      if (err instanceof FormCapacityError) {
        return res.status(422).json({
          message: err.message,
          code: "form_capacity",
          details: { max: err.max, got: err.got, unit: err.unit },
        });
      }
      if (err instanceof EmptyExportError) {
        return res.status(422).json({ message: err.message, code: "empty_export" });
      }
      if (err instanceof NothingToExportError) {
        return res.status(422).json({ message: err.message, code: "nothing_to_export" });
      }
      console.error("Adapter error:", err);
      return res.status(500).json({ message: "Adapter failed", code: "internal_error" });
    }

    let bytes;
    try {
      bytes = await fillFormPages(entryDef.blankPath, pages);
    } catch (err) {
      console.error(`fillForm failed for ${form_id}:`, err);
      return res.status(500).json({ message: "Form fill failed", code: "internal_error" });
    }

    const earliest = new Date(earliestMs).toISOString().slice(0, 10);
    const latest = new Date(latestMs).toISOString().slice(0, 10);
    const filename = `${form_id}_${earliest}_to_${latest}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(bytes));
  });

  // Supervisor routes
  app.get("/api/supervisors", requireAuthOrToken, async (req, res) => {
    try {
      const supervisors = await storage.getSupervisors();
      res.json(supervisors);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching supervisors" });
    }
  });

  app.post("/api/supervisors", requireAuthOrToken, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const supervisorData = {
        ...req.body,
        userId,
      };

      const parsedData = canonicalizeSupervisorWrite(
        insertSupervisorSchema.parse(supervisorData),
      );

      const duplicate = await findDuplicateSigner(parsedData.email);
      if (duplicate) {
        return res.status(409).json({ message: duplicateSignerMessage(duplicate) });
      }

      const newSupervisor = await storage.createSupervisor(parsedData);

      res.status(201).json(newSupervisor);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid supervisor data",
          errors: error.errors,
        });
      }
      res.status(500).json({ message: "Error creating supervisor" });
    }
  });

  app.patch("/api/supervisors/:id", requireAuthOrToken, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const id = parseInt(req.params.id);

      const existing = await storage.getSupervisor(id);
      if (!existing) return res.status(404).json({ message: "Signer not found" });
      if (!(await canEditSigner(existing, userId))) {
        return res.status(403).json({
          message: "Only the person who added this signer (or an admin) can change it.",
        });
      }

      const updateSchema = insertSupervisorSchema.omit({ userId: true }).partial();
      const parsedData = canonicalizeSupervisorWrite(updateSchema.parse(req.body));

      const duplicate = await findDuplicateSigner(parsedData.email, id);
      if (duplicate) {
        return res.status(409).json({ message: duplicateSignerMessage(duplicate) });
      }

      const updated = await storage.updateSupervisor(id, parsedData);
      res.json(updated);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid signer data", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating signer" });
    }
  });

  app.delete("/api/supervisors/:id", requireAuthOrToken, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const id = parseInt(req.params.id);

      const existing = await storage.getSupervisor(id);
      if (!existing) return res.status(404).json({ message: "Signer not found" });
      if (!(await canEditSigner(existing, userId))) {
        return res.status(403).json({
          message: "Only the person who added this signer (or an admin) can change it.",
        });
      }

      await storage.deleteSupervisor(id);
      res.json({ message: "Signer deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error deleting signer" });
    }
  });

  // Rope Hours routes
  app.get("/api/rope-hours", requireAuthOrToken, async (req, res) => {
    try {
      const ropeHours = await storage.getRopeHours(req.session.userId!);
      res.json(ropeHours);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching rope hours" });
    }
  });

  app.post("/api/rope-hours", requireAuthOrToken, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const ropeHourData = {
        ...req.body,
        userId,
      };

      // Ensure dates are parsed properly
      const parsedData = insertRopeHoursSchema.parse({
        ...ropeHourData,
        startDate: new Date(ropeHourData.startDate),
        endDate: new Date(ropeHourData.endDate),
      });
      const newRopeHour = await storage.createRopeHour(parsedData);

      res.status(201).json(newRopeHour);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid rope hour data",
          errors: error.errors,
        });
      }
      res.status(500).json({ message: "Error creating rope hour" });
    }
  });

  app.patch("/api/rope-hours/:id", requireAuthOrToken, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const id = parseInt(req.params.id);

      const existing = await storage.getRopeHour(id);
      if (!existing) return res.status(404).json({ message: "Rope hour entry not found" });
      if (existing.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized: Entry does not belong to you" });
      }
      if (existing.verified) {
        return res.status(400).json({ message: "Cannot edit a verified entry" });
      }
      if (existing.verificationRequestedAt) {
        return res.status(400).json({
          message: "Cannot edit an entry that has been sent for verification",
        });
      }

      const updateSchema = insertRopeHoursSchema.omit({ userId: true }).partial();
      const body = { ...req.body };
      if (body.startDate) body.startDate = new Date(body.startDate);
      if (body.endDate) body.endDate = new Date(body.endDate);
      const parsedData = updateSchema.parse(body);

      const updated = await storage.updateRopeHour(id, parsedData);
      res.json(updated);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid rope hour data", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating rope hour" });
    }
  });

  // Delete a rope-hours record. Owner-only. For imported records, the
  // underlying source document is removed when no other record references
  // it.
  app.delete("/api/rope-hours/:id", requireAuthOrToken, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: "Invalid rope hour id" });
      }

      const existing = await storage.getRopeHour(id);
      if (!existing) {
        return res.status(404).json({ message: "Rope hour not found" });
      }
      if (existing.userId !== userId) {
        return res
          .status(403)
          .json({ message: "Unauthorized: Entry does not belong to you" });
      }

      const sourceKey = existing.sourceDocumentKey;
      await storage.deleteRopeHour(id);

      if (sourceKey) {
        const remainingEntries =
          await storage.countEntriesBySourceDocumentKey(sourceKey);
        const remainingRopeHours =
          await storage.countRopeHoursBySourceDocumentKey(sourceKey);
        if (remainingEntries === 0 && remainingRopeHours === 0) {
          try {
            await objectStorageService.deleteObjectEntity(sourceKey);
          } catch (err) {
            console.error(
              "Failed to delete orphaned source document",
              sourceKey,
              err,
            );
          }
        }
      }

      res.json({ message: "Rope hour removed" });
    } catch (error) {
      console.error("Error deleting rope hour:", error);
      res.status(500).json({ message: "Error deleting rope hour" });
    }
  });

  // Bulk-remove every imported entry (field-hours and rope hours) that came from the
  // same signed-log upload. Owner-only, imported-only. The underlying object
  // is deleted once the last reference goes away.
  app.delete("/api/imports", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const sourceDocumentKey = req.query.sourceDocumentKey;
      if (
        typeof sourceDocumentKey !== "string" ||
        !sourceDocumentKey.startsWith("/objects/imports/")
      ) {
        return res
          .status(400)
          .json({ message: "Invalid sourceDocumentKey" });
      }

      const deletedEntries =
        await storage.deleteImportedEntriesBySourceDocumentKey(
          userId,
          sourceDocumentKey,
        );
      const deletedRopeHours =
        await storage.deleteImportedRopeHoursBySourceDocumentKey(
          userId,
          sourceDocumentKey,
        );

      if (deletedEntries === 0 && deletedRopeHours === 0) {
        return res.status(404).json({
          message: "No imported entries found for that signed log",
        });
      }

      const remainingEntries =
        await storage.countEntriesBySourceDocumentKey(sourceDocumentKey);
      const remainingRopeHours =
        await storage.countRopeHoursBySourceDocumentKey(sourceDocumentKey);
      if (remainingEntries === 0 && remainingRopeHours === 0) {
        try {
          await objectStorageService.deleteObjectEntity(sourceDocumentKey);
        } catch (err) {
          console.error(
            "Failed to delete orphaned source document",
            sourceDocumentKey,
            err,
          );
        }
      }

      res.json({
        message: "Imported entries removed",
        deletedEntries,
        deletedRopeHours,
      });
    } catch (error) {
      console.error("Error bulk-deleting imported entries:", error);
      res.status(500).json({ message: "Error removing imported entries" });
    }
  });

  // Which delivery channels have keys configured (Resend email, Twilio SMS).
  // The client uses it to label "Send by" options and pick a fallback.
  app.get("/api/notifications/status", requireAuth, (_req, res) => {
    res.json(notificationStatus());
  });

  // Verification routes for rope hours
  app.post("/api/verify-request-rope/:ropeHourId", requireAuthOrToken, async (req, res) => {
    try {
      const { ropeHourId } = req.params;
      const userId = req.session.userId!;

      // Get rope hour
      const ropeHour = await storage.getRopeHour(parseInt(ropeHourId));
      if (!ropeHour) {
        return res.status(404).json({ message: "Rope hour not found" });
      }

      // Check if rope hour belongs to user
      if (ropeHour.userId !== userId) {
        return res
          .status(403)
          .json({ message: "Unauthorized: Rope hour does not belong to you" });
      }

      // Check if rope hour is already verified
      if (ropeHour.verified) {
        return res.status(400).json({ message: "Rope hour already verified" });
      }

      // Get supervisor
      const { supervisorId } = req.body;
      if (!supervisorId) {
        return res.status(400).json({ message: "Supervisor ID is required" });
      }

      const supervisor = await storage.getSupervisor(parseInt(supervisorId));
      if (!supervisor) {
        return res.status(404).json({ message: "Supervisor not found" });
      }


      // Generate verification token
      const verificationToken = randomUUID();

      // Get user data
      const user = await storage.getUser(userId);

      // Update rope hour with verification token and seed the audit trail.
      const requestedAt = new Date();
      const [updatedRopeHour] = await db
        .update(ropeHours)
        .set({
          verificationToken,
          verificationRequestedAt: requestedAt,
          verifiedByEmail: supervisor.email,
          auditTrail: [
            {
              action: "verification_requested",
              timestamp: requestedAt.toISOString(),
              actor: user?.name ?? undefined,
              email: supervisor.email,
            },
          ],
        })
        .where(eq(ropeHours.id, ropeHour.id))
        .returning();

      const baseUrl = getBaseUrl(req);
      const verificationUrl = `${baseUrl}/verify/${verificationToken}`;
      const smsBody = buildSignatureSms({
        requester: user?.name || user?.email || "A technician",
        summary: `${updatedRopeHour.hours}h of rope access at ${updatedRopeHour.location}`,
        url: verificationUrl,
      });
      const delivery = await deliverSignatureRequest({
        channels: parseChannels(req.body.channels),
        phone: supervisor.phone,
        smsBody,
        sendEmail: () => sendRopeHoursVerificationRequest(supervisor, user!, updatedRopeHour, baseUrl),
      });
      await recordDelivery(ropeHours, [updatedRopeHour.id], updatedRopeHour.auditTrail, delivery, supervisor.phone);

      res.json({
        message: "Verification request sent",
        supervisor,
        verificationUrl,
        smsBody,
        delivery,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error sending verification request" });
    }
  });

  // Verification routes
  app.post("/api/verify-request/:entryId", requireAuthOrToken, async (req, res) => {
    try {
      const { entryId } = req.params;
      const userId = req.session.userId!;

      // Get entry
      const entry = await storage.getEntry(parseInt(entryId));
      if (!entry) {
        return res.status(404).json({ message: "Entry not found" });
      }

      // Check if entry belongs to user
      if (entry.userId !== userId) {
        return res
          .status(403)
          .json({ message: "Unauthorized: Entry does not belong to you" });
      }

      // Check if entry is already verified
      if (entry.verified) {
        return res.status(400).json({ message: "Entry already verified" });
      }

      // Get supervisor
      const { supervisorId } = req.body;
      if (!supervisorId) {
        return res.status(400).json({ message: "Supervisor ID is required" });
      }

      const supervisor = await storage.getSupervisor(parseInt(supervisorId));
      if (!supervisor) {
        return res.status(404).json({ message: "Supervisor not found" });
      }


      // Generate verification token
      const verificationToken = randomUUID();

      // Get user data
      const user = await storage.getUser(userId);

      // Update entry with verification token and seed the audit trail with the
      // request event (records who asked, which address the link went to, when).
      const requestedAt = new Date();
      const [updatedEntry] = await db
        .update(entries)
        .set({
          verificationToken,
          verificationRequestedAt: requestedAt,
          verifiedByEmail: supervisor.email,
          auditTrail: [
            {
              action: "verification_requested",
              timestamp: requestedAt.toISOString(),
              actor: user?.name ?? undefined,
              email: supervisor.email,
            },
          ],
        })
        .where(eq(entries.id, entry.id))
        .returning();

      const baseUrl = getBaseUrl(req);
      const verificationUrl = `${baseUrl}/verify/${verificationToken}`;
      const smsBody = buildSignatureSms({
        requester: user?.name || user?.email || "A technician",
        summary: `${updatedEntry.hours}h on ${formatCalendarDate(updatedEntry.date)} at ${updatedEntry.location}`,
        url: verificationUrl,
      });
      const delivery = await deliverSignatureRequest({
        channels: parseChannels(req.body.channels),
        phone: supervisor.phone,
        smsBody,
        sendEmail: () => sendVerificationRequest(supervisor, user!, updatedEntry, baseUrl),
      });
      await recordDelivery(entries, [updatedEntry.id], updatedEntry.auditTrail, delivery, supervisor.phone);

      res.json({
        message: "Verification request sent",
        supervisor,
        verificationUrl,
        smsBody,
        delivery,
        entry: updatedEntry,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error sending verification request" });
    }
  });

  // API route for getting verification data
  app.get("/api/verify/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const opened = buildVerificationEvidence(req, false);

      // Try to get entry by verification token first
      const entry = await storage.getEntryByVerificationToken(token);
      if (entry) {
        // Check if entry is already verified
        if (entry.verified) {
          return res.status(400).json({ message: "Entry already verified" });
        }

        // Record that the emailed link was opened (once — skip on refresh).
        const trail = entry.auditTrail ?? [];
        if (trail[trail.length - 1]?.action !== "link_opened") {
          await db
            .update(entries)
            .set({
              auditTrail: [
                ...trail,
                {
                  action: "link_opened",
                  timestamp: new Date().toISOString(),
                  ipAddress: opened.ipAddress,
                  browserInfo: opened.browserInfo,
                },
              ],
            })
            .where(eq(entries.id, entry.id));
        }

        // Get user and supervisors
        const user = await storage.getUser(entry.userId);
        const supervisors = await storage.getSupervisors();

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        return res.json({ entry, user, supervisors, type: "entry" });
      }

      // Try to get rope hour by verification token
      const ropeHour = await storage.getRopeHourByVerificationToken(token);
      if (ropeHour) {
        // Check if rope hour is already verified
        if (ropeHour.verified) {
          return res.status(400).json({ message: "Rope hour already verified" });
        }

        // Record that the emailed link was opened (once — skip on refresh).
        const trail = ropeHour.auditTrail ?? [];
        if (trail[trail.length - 1]?.action !== "link_opened") {
          await db
            .update(ropeHours)
            .set({
              auditTrail: [
                ...trail,
                {
                  action: "link_opened",
                  timestamp: new Date().toISOString(),
                  ipAddress: opened.ipAddress,
                  browserInfo: opened.browserInfo,
                },
              ],
            })
            .where(eq(ropeHours.id, ropeHour.id));
        }

        // Get user and supervisors
        const user = await storage.getUser(ropeHour.userId);
        const supervisors = await storage.getSupervisors();

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        return res.json({ ropeHour, user, supervisors, type: "rope_hour" });
      }

      // If neither found, return error
      return res.status(404).json({ message: "Invalid verification token" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error processing verification" });
    }
  });



  app.post("/api/verify/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const { supervisorName, attestation } = req.body;

      if (!supervisorName) {
        return res.status(400).json({ message: "Supervisor name is required" });
      }

      const evidence = buildVerificationEvidence(req, attestation);

      // Try to get entry by verification token first
      const entry = await storage.getEntryByVerificationToken(token);
      if (entry) {
        // Check if entry is already verified
        if (entry.verified) {
          return res.status(400).json({ message: "Entry already verified" });
        }

        // Verify entry
        const verifiedEntry = await storage.verifyEntry(entry.id, supervisorName, {
          ...evidence,
          email: entry.verifiedByEmail ?? undefined,
        });

        // Send confirmation email to user
        const user = await storage.getUser(entry.userId);
        if (user) {
          await sendVerificationConfirmation(user, verifiedEntry, supervisorName);
        }

        return res.json({
          message: "Entry verified successfully",
          entry: verifiedEntry,
        });
      }

      // Try to get rope hour by verification token
      const ropeHour = await storage.getRopeHourByVerificationToken(token);
      if (ropeHour) {
        // Check if rope hour is already verified
        if (ropeHour.verified) {
          return res.status(400).json({ message: "Rope hour already verified" });
        }

        // Verify rope hour
        const verifiedRopeHour = await storage.verifyRopeHour(ropeHour.id, supervisorName, {
          ...evidence,
          email: ropeHour.verifiedByEmail ?? undefined,
        });

        // Send confirmation email to user
        const user = await storage.getUser(ropeHour.userId);
        if (user) {
          await sendVerificationConfirmation(user, verifiedRopeHour, supervisorName);
        }

        return res.json({
          message: "Rope hour verified successfully",
          ropeHour: verifiedRopeHour,
        });
      }

      // If neither found, return error
      return res.status(404).json({ message: "Invalid verification token" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error verifying entry" });
    }
  });

  // Batch verification request — one email, one link, multiple entries
  app.post("/api/batch-verify-request", requireAuthOrToken, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { entryIds, supervisorId } = req.body;

      if (!Array.isArray(entryIds) || entryIds.length < 2) {
        return res.status(400).json({ message: "At least 2 entry IDs are required for a batch request" });
      }
      if (!supervisorId) {
        return res.status(400).json({ message: "Supervisor ID is required" });
      }

      const supervisor = await storage.getSupervisor(parseInt(supervisorId));
      if (!supervisor) {
        return res.status(404).json({ message: "Supervisor not found" });
      }

      // Validate every entry belongs to the user and is unverified
      const resolvedEntries: any[] = [];
      for (const id of entryIds) {
        const entry = await storage.getEntry(parseInt(id));
        if (!entry) return res.status(404).json({ message: `Entry ${id} not found` });
        if (entry.userId !== userId) return res.status(403).json({ message: `Entry ${id} does not belong to you` });
        if (entry.verified) return res.status(400).json({ message: `Entry ${id} is already verified` });
        resolvedEntries.push(entry);
      }

      // Generate one shared batch token
      const batchToken = randomUUID();

      const user = await storage.getUser(userId);

      // Stamp every entry with the same token and seed each audit trail.
      const requestedAt = new Date();
      await Promise.all(
        resolvedEntries.map((entry) =>
          db.update(entries).set({
            verificationToken: batchToken,
            verificationRequestedAt: requestedAt,
            verifiedByEmail: supervisor.email,
            auditTrail: [
              {
                action: "verification_requested",
                timestamp: requestedAt.toISOString(),
                actor: user?.name ?? undefined,
                email: supervisor.email,
              },
            ],
          }).where(eq(entries.id, entry.id))
        )
      );

      const baseUrl = getBaseUrl(req);
      const verificationUrl = `${baseUrl}/batch-verify/${batchToken}`;
      const totalHours = resolvedEntries.reduce((sum, e) => sum + e.hours, 0);
      const smsBody = buildSignatureSms({
        requester: user?.name || user?.email || "A technician",
        summary: `${resolvedEntries.length} days of field hours (${totalHours.toFixed(1)}h)`,
        url: verificationUrl,
      });
      const delivery = await deliverSignatureRequest({
        channels: parseChannels(req.body.channels),
        phone: supervisor.phone,
        smsBody,
        sendEmail: () => sendBatchVerificationRequest(supervisor, user!, resolvedEntries, batchToken, baseUrl),
      });
      await recordDelivery(
        entries,
        resolvedEntries.map((e) => e.id),
        [
          {
            action: "verification_requested",
            timestamp: requestedAt.toISOString(),
            actor: user?.name ?? undefined,
            email: supervisor.email,
          },
        ],
        delivery,
        supervisor.phone,
      );

      return res.json({
        message: "Batch verification request sent",
        supervisor,
        verificationUrl,
        batchToken,
        smsBody,
        delivery,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error sending batch verification request" });
    }
  });

  // GET — return all entries for a batch token (supervisor-facing)
  app.get("/api/batch-verify/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const batchEntries = await storage.getEntriesByBatchToken(token);

      if (!batchEntries.length) {
        return res.status(404).json({ message: "Invalid batch verification token" });
      }

      const allVerified = batchEntries.every((e) => e.verified);
      if (allVerified) {
        return res.status(400).json({ message: "All entries in this batch are already verified" });
      }

      const user = await storage.getUser(batchEntries[0].userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      return res.json({ entries: batchEntries, user, type: "batch" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching batch verification data" });
    }
  });

  // POST — supervisor signs off on all entries in the batch
  app.post("/api/batch-verify/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const { supervisorName, attestation } = req.body;

      if (!supervisorName) {
        return res.status(400).json({ message: "Supervisor name is required" });
      }

      const evidence = buildVerificationEvidence(req, attestation);

      const batchEntries = await storage.getEntriesByBatchToken(token);
      if (!batchEntries.length) {
        return res.status(404).json({ message: "Invalid batch verification token" });
      }

      const unverified = batchEntries.filter((e) => !e.verified);
      if (!unverified.length) {
        return res.status(400).json({ message: "All entries in this batch are already verified" });
      }

      const verifiedEntries = await Promise.all(
        unverified.map((entry) => storage.verifyEntry(entry.id, supervisorName, {
          ...evidence,
          email: entry.verifiedByEmail ?? undefined,
        }))
      );

      // Send one confirmation email to the technician
      const user = await storage.getUser(batchEntries[0].userId);
      if (user) {
        for (const entry of verifiedEntries) {
          await sendVerificationConfirmation(user, entry, supervisorName);
        }
      }

      return res.json({ message: "All entries verified successfully", entries: verifiedEntries });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error verifying batch entries" });
    }
  });

  // Admin routes
  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const allUsers = await db.select().from(users);
      // Remove sensitive information
      const sanitizedUsers = allUsers.map((user) => {
        const { password, resetToken, resetTokenExpiry, ...safeUser } = user;
        return safeUser;
      });
      res.json(sanitizedUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Error fetching users" });
    }
  });

  app.get("/api/admin/entries", requireAdmin, async (req, res) => {
    try {
      const allEntries = await db.select().from(entries);
      res.json(allEntries);
    } catch (error) {
      console.error("Error fetching entries:", error);
      res.status(500).json({ message: "Error fetching entries" });
    }
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);

      // Check if trying to delete self
      if (userId === req.session.userId) {
        return res
          .status(400)
          .json({ message: "Cannot delete your own account" });
      }

      // Delete user's entries first (cascade delete not automatic)
      await db.delete(entries).where(eq(entries.userId, userId));

      // Delete user's supervisors
      await db.delete(supervisors).where(eq(supervisors.userId, userId));

      // Delete user
      const deletedUser = await db
        .delete(users)
        .where(eq(users.id, userId))
        .returning();

      if (deletedUser.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Error deleting user" });
    }
  });

  app.delete("/api/admin/entries/:id", requireAdmin, async (req, res) => {
    try {
      const entryId = parseInt(req.params.id);

      // Delete entry
      const deletedEntry = await db
        .delete(entries)
        .where(eq(entries.id, entryId))
        .returning();

      if (deletedEntry.length === 0) {
        return res.status(404).json({ message: "Entry not found" });
      }

      res.json({ message: "Entry deleted successfully" });
    } catch (error) {
      console.error("Error deleting entry:", error);
      res.status(500).json({ message: "Error deleting entry" });
    }
  });

  // ---------- Admin: per-user detail & management (master-detail panel) ----------
  const sanitizeUser = (u: typeof users.$inferSelect) => {
    const { password, resetToken, resetTokenExpiry, ...safe } = u;
    return safe;
  };

  // A short, url-safe temporary password for admin-created accounts.
  const genTempPassword = () => randomBytes(9).toString("base64url").slice(0, 12);

  // Create a new (non-admin) user with an admin-generated password. Optionally
  // emails the invite immediately. Always returns the temp password once so the
  // admin can share it manually if email isn't configured.
  app.post("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const schema = z.object({
        email: z.string().email().max(255),
        name: z.string().max(200).nullish(),
        employeeNumber: z.string().max(100).nullish(),
        sendInvite: z.boolean().optional(),
      });
      const body = schema.parse(req.body);
      const email = body.email.trim().toLowerCase();

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res
          .status(409)
          .json({ message: "A user with that email already exists" });
      }

      const tempPassword = genTempPassword();
      const hashed = await hash(tempPassword, 10);
      const [created] = await db
        .insert(users)
        .values({
          email,
          password: hashed,
          name: body.name ?? null,
          employeeNumber: body.employeeNumber ?? null,
          isAdmin: false,
        })
        .returning();

      let invited = false;
      let inviteError: string | null = null;
      if (body.sendInvite) {
        invited = await sendInviteEmail(email, tempPassword, created.name);
        if (!invited) {
          inviteError =
            "Couldn't send the email (is email configured?). Share the password manually.";
        }
      }

      res.status(201).json({
        user: sanitizeUser(created),
        tempPassword,
        invited,
        inviteError,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid user data", errors: error.errors });
      }
      console.error("Admin create user error:", error);
      res.status(500).json({ message: "Error creating user" });
    }
  });

  // Re-send an invite: set a fresh temp password and email it. Returns the
  // password so the admin can copy it if email delivery isn't available.
  app.post("/api/admin/users/:id/invite", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const target = await storage.getUser(id);
      if (!target) return res.status(404).json({ message: "User not found" });

      const tempPassword = genTempPassword();
      const hashed = await hash(tempPassword, 10);
      await db.update(users).set({ password: hashed }).where(eq(users.id, id));

      const sent = await sendInviteEmail(target.email, tempPassword, target.name);
      res.json({
        tempPassword,
        sent,
        error: sent
          ? null
          : "Couldn't send the email (is email configured?). Share the password manually.",
      });
    } catch (error) {
      console.error("Admin invite error:", error);
      res.status(500).json({ message: "Error sending invite" });
    }
  });

  // Full profile for one user, with quick counts/totals for the detail header.
  app.get("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
      const u = await storage.getUser(id);
      if (!u) return res.status(404).json({ message: "User not found" });

      const [entries, rope, certs] = await Promise.all([
        storage.getEntries(id),
        storage.getRopeHours(id),
        storage.getCertifications(id),
      ]);
      const sum = (arr: { hours: number }[]) =>
        Math.round(arr.reduce((s, r) => s + r.hours, 0) * 10) / 10;
      res.json({
        user: sanitizeUser(u),
        counts: {
          entries: entries.length,
          ropeHours: rope.length,
          certifications: certs.length,
        },
        totals: {
          ojtHours: sum(entries),
          ojtVerifiedHours: sum(entries.filter((e) => e.verified)),
          ropeHours: sum(rope),
          ropeVerifiedHours: sum(rope.filter((r) => r.verified)),
        },
      });
    } catch (error) {
      console.error("Admin user detail error:", error);
      res.status(500).json({ message: "Error fetching user" });
    }
  });

  app.get("/api/admin/users/:id/entries", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      res.json(await storage.getEntries(id));
    } catch (error) {
      console.error("Admin user entries error:", error);
      res.status(500).json({ message: "Error fetching entries" });
    }
  });

  app.get("/api/admin/users/:id/rope-hours", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      res.json(await storage.getRopeHours(id));
    } catch (error) {
      console.error("Admin user rope error:", error);
      res.status(500).json({ message: "Error fetching rope hours" });
    }
  });

  app.get("/api/admin/users/:id/certifications", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      res.json(await storage.getCertifications(id));
    } catch (error) {
      console.error("Admin user certs error:", error);
      res.status(500).json({ message: "Error fetching certifications" });
    }
  });

  // Signed URL for any user's imported source document (admin override of the
  // owner check in /api/source-document).
  app.get("/api/admin/source-document", requireAdmin, async (req, res) => {
    try {
      const recordType = (req.query.type ?? "").toString();
      const recordId = parseInt((req.query.id ?? "").toString(), 10);
      if (recordType !== "entry" && recordType !== "rope") {
        return res.status(400).json({ message: "Invalid type" });
      }
      if (!Number.isFinite(recordId)) {
        return res.status(400).json({ message: "Invalid id" });
      }
      const rec =
        recordType === "entry"
          ? await storage.getEntry(recordId)
          : await storage.getRopeHour(recordId);
      if (!rec || !rec.sourceDocumentKey) {
        return res.status(404).json({ message: "Source document not found" });
      }
      const url = await objectStorageService.getSignedDownloadURL(
        rec.sourceDocumentKey,
        600,
      );
      res.json({ url, name: rec.sourceDocumentName });
    } catch (error) {
      console.error("Admin source document error:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ message: "Source document not found" });
      }
      res.status(500).json({ message: "Error fetching source document" });
    }
  });

  // Signed URL for any user's certificate file.
  app.get("/api/admin/certifications/:id/document", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const cert = await storage.getCertification(id);
      if (!cert || !cert.documentKey) {
        return res.status(404).json({ message: "Certificate file not found" });
      }
      const url = await objectStorageService.getSignedDownloadURL(
        cert.documentKey,
        600,
      );
      res.json({ url, name: cert.documentName });
    } catch (error) {
      console.error("Admin cert document error:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ message: "Certificate file not found" });
      }
      res.status(500).json({ message: "Error fetching certificate file" });
    }
  });

  // Upload a certificate file on a user's behalf (stored under their folder).
  app.post(
    "/api/admin/users/:id/certifications/upload",
    requireAdmin,
    upload.single("file"),
    async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const target = await storage.getUser(id);
        if (!target) return res.status(404).json({ message: "User not found" });
        const file = req.file;
        if (!file) return res.status(400).json({ message: "No file uploaded" });
        if (!ALLOWED_IMPORT_MIMES.has(file.mimetype)) {
          return res.status(400).json({
            message:
              "Unsupported file type. Please upload a PDF or image (JPG, PNG, WEBP).",
          });
        }
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const objectId = cryptoRandomUUID();
        const documentKey = await objectStorageService.uploadBuffer(
          `certifications/${id}/${objectId}-${safeName}`,
          file.buffer,
          file.mimetype,
        );
        res.json({ documentKey, documentName: file.originalname });
      } catch (error) {
        console.error("Admin cert upload error:", error);
        res.status(500).json({ message: "Error uploading certificate" });
      }
    },
  );

  // Create a certification for a user.
  app.post("/api/admin/users/:id/certifications", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const target = await storage.getUser(id);
      if (!target) return res.status(404).json({ message: "User not found" });
      const data = certificationWriteSchema.parse(req.body);
      const created = await storage.createCertification({ ...data, userId: id });
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid certification data", errors: error.errors });
      }
      console.error("Admin create cert error:", error);
      res.status(500).json({ message: "Error creating certification" });
    }
  });

  app.patch("/api/admin/certifications/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const existing = await storage.getCertification(id);
      if (!existing) return res.status(404).json({ message: "Certification not found" });
      const updates = certificationWriteSchema.partial().parse(req.body);
      res.json(await storage.updateCertification(id, updates));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid certification data", errors: error.errors });
      }
      console.error("Admin update cert error:", error);
      res.status(500).json({ message: "Error updating certification" });
    }
  });

  app.delete("/api/admin/certifications/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const existing = await storage.getCertification(id);
      if (!existing) return res.status(404).json({ message: "Certification not found" });
      await storage.deleteCertification(id);
      res.json({ message: "Certification deleted" });
    } catch (error) {
      console.error("Admin delete cert error:", error);
      res.status(500).json({ message: "Error deleting certification" });
    }
  });

  // Update a user's account fields (role / profile). Admins can't demote
  // themselves to avoid locking everyone out.
  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const target = await storage.getUser(id);
      if (!target) return res.status(404).json({ message: "User not found" });

      const schema = z.object({
        isAdmin: z.boolean().optional(),
        name: z.string().max(200).nullish(),
        employeeNumber: z.string().max(100).nullish(),
      });
      const updates = schema.parse(req.body);

      if (
        updates.isAdmin === false &&
        id === req.session.userId
      ) {
        return res
          .status(400)
          .json({ message: "You can't remove your own admin access" });
      }

      const [updated] = await db
        .update(users)
        .set(updates)
        .where(eq(users.id, id))
        .returning();
      res.json(sanitizeUser(updated));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      console.error("Admin update user error:", error);
      res.status(500).json({ message: "Error updating user" });
    }
  });

  // Generate a password-reset link for a user (admin hands it to them).
  app.post("/api/admin/users/:id/reset-password", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const target = await storage.getUser(id);
      if (!target) return res.status(404).json({ message: "User not found" });

      const resetToken = randomUUID();
      const resetTokenExpiry = add(new Date(), { hours: 24 });
      await db
        .update(users)
        .set({ resetToken, resetTokenExpiry })
        .where(eq(users.id, id));
      const resetUrl = `${getBaseUrl(req)}/reset-password/${resetToken}`;
      res.json({ resetUrl, expiresInHours: 24 });
    } catch (error) {
      console.error("Admin reset password error:", error);
      res.status(500).json({ message: "Error generating reset link" });
    }
  });

  // ---- Impersonation ("view as user") ----
  app.post("/api/admin/impersonate/:userId", requireAdmin, async (req, res) => {
    try {
      const targetId = parseInt(req.params.userId, 10);
      if (!Number.isFinite(targetId)) {
        return res.status(400).json({ message: "Invalid id" });
      }
      if (targetId === req.session.userId) {
        return res.status(400).json({ message: "You're already this user" });
      }
      const target = await storage.getUser(targetId);
      if (!target) return res.status(404).json({ message: "User not found" });

      // Stash the real admin id, then become the target for all userId-scoped
      // routes. Admin-only routes self-lock because requireAdmin re-checks.
      req.session.adminUserId = req.session.userId;
      req.session.userId = targetId;
      req.session.save((err) => {
        if (err) {
          console.error("Impersonate save error:", err);
          return res.status(500).json({ message: "Error starting impersonation" });
        }
        res.json({ ok: true, userId: targetId });
      });
    } catch (error) {
      console.error("Impersonate error:", error);
      res.status(500).json({ message: "Error starting impersonation" });
    }
  });

  app.post("/api/admin/stop-impersonate", async (req, res) => {
    try {
      const adminId = req.session.adminUserId;
      if (!adminId) {
        return res.status(400).json({ message: "Not impersonating" });
      }
      req.session.userId = adminId;
      delete req.session.adminUserId;
      req.session.save((err) => {
        if (err) {
          console.error("Stop impersonate save error:", err);
          return res.status(500).json({ message: "Error exiting impersonation" });
        }
        res.json({ ok: true, userId: adminId });
      });
    } catch (error) {
      console.error("Stop impersonate error:", error);
      res.status(500).json({ message: "Error exiting impersonation" });
    }
  });

  // Create an admin user if none exists
  // This is mainly for development purposes
  const setupAdmin = async () => {
    try {
      // Check if any admin exists
      const [existingAdmin] = await db
        .select()
        .from(users)
        .where(eq(users.isAdmin, true));

      if (!existingAdmin) {
        // Create admin user
        const adminPassword = await hash("admin123", 10);
        await db.insert(users).values({
          email: "admin@ojt.tracker",
          password: adminPassword,
          name: "System Administrator",
          isAdmin: true,
        });
        console.log(
          "Admin user created with email: admin@ojt.tracker and password: admin123",
        );
      }
    } catch (error) {
      console.error("Error setting up admin:", error);
    }
  };

  // Crypto Identity endpoint
  app.post("/api/crypto/identity", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      
      // Check if user already has a crypto identity
      const existingIdentity = await storage.getUserCryptoIdentity(userId);
      if (existingIdentity) {
        return res.status(400).json({ 
          message: "User already has a crypto identity" 
        });
      }

      // Validate request data
      const identitySchema = z.object({
        personalInfo: z.object({
          fullName: z.string().min(2, "Full name required"),
          dateOfBirth: z.string().min(1, "Date of birth required"), 
          phoneNumber: z.string().min(10, "Phone number required"),
        }),
        employeeIds: z.array(z.object({
          employeeId: z.string().min(1, "Employee ID required"),
          company: z.string().min(1, "Company required"),
        })).min(1, "At least one employee ID required"),
      });

      const { personalInfo, employeeIds } = identitySchema.parse(req.body);

      // Create crypto identity using the crypto function
      const cryptoIdentityData = createTechnicianCryptoIdentity(
        userId,
        personalInfo,
        employeeIds.map(emp => emp.employeeId) // Extract just the employeeId strings
      );

      // Save to database
      const newCryptoIdentity = await storage.createUserCryptoIdentity({
        userId: cryptoIdentityData.userId,
        publicKey: cryptoIdentityData.publicKey,
        encryptedPrivateKey: cryptoIdentityData.encryptedPrivateKey,
        personalInfo: cryptoIdentityData.personalInfo,
        employeeIds: cryptoIdentityData.employeeIds,
      });

      // Return success (don't expose private key)
      res.status(201).json({
        message: "Crypto identity created successfully",
        publicKey: newCryptoIdentity.publicKey,
        personalInfo: newCryptoIdentity.personalInfo,
        employeeIds: newCryptoIdentity.employeeIds,
      });
    } catch (error) {
      console.error("Crypto identity creation error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid identity data",
          errors: error.errors,
        });
      }
      res.status(500).json({ message: "Error creating crypto identity" });
    }
  });

  // ----- Import from signed log routes -----
  // Upload a signed-log file, run AI extraction, return parsed rows + key.
  app.post(
    "/api/imports/extract",
    requireAuth,
    upload.single("file"),
    async (req, res) => {
      try {
        const userId = req.session.userId!;
        const file = req.file;
        const type = (req.body?.type ?? "").toString();

        if (!file) {
          return res.status(400).json({ message: "No file uploaded" });
        }
        if (type !== "ojt" && type !== "rope") {
          return res
            .status(400)
            .json({ message: "Invalid type, must be 'ojt' or 'rope'" });
        }
        if (!ALLOWED_IMPORT_MIMES.has(file.mimetype)) {
          return res.status(400).json({
            message:
              "Unsupported file type. Please upload a PDF or image (JPG, PNG, WEBP).",
          });
        }

        // Save to object storage under imports/<userId>/<uuid>-<safeName>
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const objectId = cryptoRandomUUID();
        const relativePath = `imports/${userId}/${objectId}-${safeName}`;
        const sourceDocumentKey = await objectStorageService.uploadBuffer(
          relativePath,
          file.buffer,
          file.mimetype,
        );

        // Run AI extraction
        let rows: unknown[] = [];
        let extractionError: string | null = null;
        try {
          if (type === "ojt") {
            rows = await extractOJTRows(file.buffer, file.mimetype, file.originalname);
          } else {
            rows = await extractRopeRows(file.buffer, file.mimetype, file.originalname);
          }
        } catch (err) {
          console.error("Extraction error:", err);
          extractionError =
            err instanceof Error
              ? err.message
              : "Failed to read the document with AI";
        }

        return res.json({
          sourceDocumentKey,
          sourceDocumentName: file.originalname,
          rows,
          extractionError,
        });
      } catch (error) {
        console.error("Import extract error:", error);
        return res
          .status(500)
          .json({ message: "Error processing uploaded log" });
      }
    },
  );

  // Validation schemas for the commit endpoint
  const validMethods = Object.keys(FieldMethods) as Array<
    keyof typeof FieldMethods
  >;
  const ojtCommitRowSchema = z.object({
    date: z.coerce.date(),
    location: z.string().min(1).max(500),
    method: z.enum(validMethods as [FieldMethod, ...FieldMethod[]]),
    hours: z.number().positive().max(24),
  });
  const ropeCommitRowSchema = z.object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    location: z.string().min(1).max(500),
    skills: z.string().min(1).max(2000),
    hours: z.number().positive(),
  });
  const commitBodySchema = z.object({
    type: z.enum(["ojt", "rope"]),
    sourceDocumentKey: z.string().regex(/^\/objects\/imports\//),
    sourceDocumentName: z.string().min(1).max(500),
    rows: z.array(z.unknown()).min(1).max(200),
  });

  // Commit reviewed rows from an extracted log as imported entries.
  app.post("/api/imports/commit", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const body = commitBodySchema.parse(req.body);

      // Verify the user actually uploaded that source document.
      if (!body.sourceDocumentKey.startsWith(`/objects/imports/${userId}/`)) {
        return res
          .status(403)
          .json({ message: "Source document does not belong to you" });
      }

      // Confirm the object exists before committing.
      try {
        await objectStorageService.getObjectEntityFile(body.sourceDocumentKey);
      } catch {
        return res
          .status(400)
          .json({ message: "Source document not found in storage" });
      }

      if (body.type === "ojt") {
        // Validate every row up front so a bad row aborts the whole import
        // before any DB writes happen.
        const validated = body.rows.map((raw) => ojtCommitRowSchema.parse(raw));
        const toInsert = validated.map((row) => ({
          userId,
          date: row.date,
          location: row.location,
          method: row.method,
          hours: row.hours,
        }));
        const created = await storage.bulkCreateImportedEntries(
          toInsert,
          body.sourceDocumentKey,
          body.sourceDocumentName,
        );
        return res.status(201).json({ created });
      } else {
        const validated = body.rows.map((raw) => ropeCommitRowSchema.parse(raw));
        for (const row of validated) {
          if (row.endDate < row.startDate) {
            return res.status(400).json({
              message: "End date must be on or after start date",
            });
          }
        }
        const toInsert = validated.map((row) => ({
          userId,
          startDate: row.startDate,
          endDate: row.endDate,
          location: row.location,
          skills: row.skills,
          hours: row.hours,
        }));
        const created = await storage.bulkCreateImportedRopeHours(
          toInsert,
          body.sourceDocumentKey,
          body.sourceDocumentName,
        );
        return res.status(201).json({ created });
      }
    } catch (error) {
      console.error("Import commit error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid import data",
          errors: error.errors,
        });
      }
      return res.status(500).json({ message: "Error committing import" });
    }
  });

  // Get a short-lived signed URL for an imported source document, scoped
  // by ownership (logged-in user) or by a valid verification token from a
  // sibling entry/rope hour pointing to the same source.
  app.get("/api/source-document", async (req, res) => {
    try {
      const recordType = (req.query.type ?? "").toString();
      const recordId = parseInt((req.query.id ?? "").toString(), 10);
      const token = (req.query.token ?? "").toString();

      if (recordType !== "entry" && recordType !== "rope") {
        return res.status(400).json({ message: "Invalid type" });
      }
      if (!Number.isFinite(recordId)) {
        return res.status(400).json({ message: "Invalid id" });
      }

      const sessionUserId = req.session.userId;

      let sourceKey: string | null = null;
      let sourceName: string | null = null;
      let allowed = false;

      let recordOwnerId: number | null = null;

      if (recordType === "entry") {
        const entry = await storage.getEntry(recordId);
        if (!entry || !entry.sourceDocumentKey) {
          return res
            .status(404)
            .json({ message: "Source document not found" });
        }
        sourceKey = entry.sourceDocumentKey;
        sourceName = entry.sourceDocumentName;
        recordOwnerId = entry.userId;
        if (sessionUserId && entry.userId === sessionUserId) {
          allowed = true;
        } else if (token && entry.verificationToken === token) {
          allowed = true;
        }
      } else {
        const ropeHour = await storage.getRopeHour(recordId);
        if (!ropeHour || !ropeHour.sourceDocumentKey) {
          return res
            .status(404)
            .json({ message: "Source document not found" });
        }
        sourceKey = ropeHour.sourceDocumentKey;
        sourceName = ropeHour.sourceDocumentName;
        recordOwnerId = ropeHour.userId;
        if (sessionUserId && ropeHour.userId === sessionUserId) {
          allowed = true;
        } else if (token && ropeHour.verificationToken === token) {
          allowed = true;
        }
      }

      // Sibling-token access: a supervisor verifying a batch should be able
      // to view any imported source document referenced by another record in
      // the same batch (same verification token, same owning user).
      if (!allowed && token && sourceKey && recordOwnerId !== null) {
        const tokenEntry =
          await storage.getEntryByVerificationToken(token);
        if (
          tokenEntry &&
          tokenEntry.userId === recordOwnerId &&
          tokenEntry.sourceDocumentKey === sourceKey
        ) {
          allowed = true;
        }
        if (!allowed) {
          const tokenRope =
            await storage.getRopeHourByVerificationToken(token);
          if (
            tokenRope &&
            tokenRope.userId === recordOwnerId &&
            tokenRope.sourceDocumentKey === sourceKey
          ) {
            allowed = true;
          }
        }
      }

      if (!allowed || !sourceKey) {
        return res.status(403).json({ message: "Access denied" });
      }

      const url = await objectStorageService.getSignedDownloadURL(
        sourceKey,
        600,
      );
      return res.json({ url, name: sourceName });
    } catch (error) {
      console.error("Source document error:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ message: "Source document not found" });
      }
      return res
        .status(500)
        .json({ message: "Error fetching source document" });
    }
  });

  // ---------- Certifications (technician credentials vault) ----------
  registerUnionRoutes(app, requireAuth as any);

  app.get("/api/certifications", requireAuthOrToken, async (req, res) => {
    try {
      const certs = await storage.getCertifications(req.session.userId!);
      res.json(certs);
    } catch (error) {
      console.error("List certifications error:", error);
      res.status(500).json({ message: "Error fetching certifications" });
    }
  });

  app.post("/api/certifications", requireAuthOrToken, async (req, res) => {
    try {
      const data = certificationWriteSchema.parse(req.body);
      const created = await storage.createCertification({
        ...data,
        userId: req.session.userId!,
      });
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid certification data", errors: error.errors });
      }
      console.error("Create certification error:", error);
      res.status(500).json({ message: "Error creating certification" });
    }
  });

  app.patch("/api/certifications/:id", requireAuthOrToken, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });

      const existing = await storage.getCertification(id);
      if (!existing) return res.status(404).json({ message: "Certification not found" });
      if (existing.userId !== userId) return res.status(403).json({ message: "Unauthorized" });

      const updates = certificationWriteSchema.partial().parse(req.body);
      const updated = await storage.updateCertification(id, updates);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid certification data", errors: error.errors });
      }
      console.error("Update certification error:", error);
      res.status(500).json({ message: "Error updating certification" });
    }
  });

  app.delete("/api/certifications/:id", requireAuthOrToken, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });

      const existing = await storage.getCertification(id);
      if (!existing) return res.status(404).json({ message: "Certification not found" });
      if (existing.userId !== userId) return res.status(403).json({ message: "Unauthorized" });

      await storage.deleteCertification(id);
      res.json({ message: "Certification deleted" });
    } catch (error) {
      console.error("Delete certification error:", error);
      res.status(500).json({ message: "Error deleting certification" });
    }
  });

  // Upload a certificate file (PDF/image) to object storage and return its key.
  // The client then includes that key when creating/updating the certification.
  app.post(
    "/api/certifications/upload",
    requireAuth,
    upload.single("file"),
    async (req, res) => {
      try {
        const userId = req.session.userId!;
        const file = req.file;
        if (!file) {
          return res.status(400).json({ message: "No file uploaded" });
        }
        if (!ALLOWED_IMPORT_MIMES.has(file.mimetype)) {
          return res.status(400).json({
            message:
              "Unsupported file type. Please upload a PDF or image (JPG, PNG, WEBP).",
          });
        }
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const objectId = cryptoRandomUUID();
        const relativePath = `certifications/${userId}/${objectId}-${safeName}`;
        const documentKey = await objectStorageService.uploadBuffer(
          relativePath,
          file.buffer,
          file.mimetype,
        );
        return res.json({ documentKey, documentName: file.originalname });
      } catch (error) {
        console.error("Certification upload error:", error);
        return res.status(500).json({ message: "Error uploading certificate" });
      }
    },
  );

  // Return a short-lived signed URL to view a certification's uploaded file.
  app.get(
    "/api/certifications/:id/document",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.session.userId!;
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });

        const cert = await storage.getCertification(id);
        if (!cert || !cert.documentKey) {
          return res.status(404).json({ message: "Certificate file not found" });
        }
        if (cert.userId !== userId) {
          return res.status(403).json({ message: "Access denied" });
        }

        const url = await objectStorageService.getSignedDownloadURL(
          cert.documentKey,
          600,
        );
        return res.json({ url, name: cert.documentName });
      } catch (error) {
        console.error("Certification document error:", error);
        if (error instanceof ObjectNotFoundError) {
          return res.status(404).json({ message: "Certificate file not found" });
        }
        return res.status(500).json({ message: "Error fetching certificate file" });
      }
    },
  );

  // ---------- Shareable public profile ----------
  // Current share state for the signed-in user (token may be null = disabled).
  app.get("/api/share", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json({
        shareToken: user.shareToken ?? null,
        shareSettings: user.shareSettings ?? null,
      });
    } catch (error) {
      console.error("Get share error:", error);
      res.status(500).json({ message: "Error fetching share settings" });
    }
  });

  // Enable sharing and/or save what's exposed. Generates a token on first enable.
  app.put("/api/share", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const settings = shareSettingsSchema.parse(req.body?.settings ?? req.body);
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const updates: {
        shareSettings: typeof settings;
        shareToken?: string;
        shareTokenCreatedAt?: Date;
      } = { shareSettings: settings };
      let token = user.shareToken;
      if (!token) {
        token = randomUUID();
        updates.shareToken = token;
        updates.shareTokenCreatedAt = new Date();
      }
      await db.update(users).set(updates).where(eq(users.id, userId));
      res.json({ shareToken: token, shareSettings: settings });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid share settings", errors: error.errors });
      }
      console.error("Save share error:", error);
      res.status(500).json({ message: "Error saving share settings" });
    }
  });

  // Rotate the token, invalidating any previously shared links.
  app.post("/api/share/rotate", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const token = randomUUID();
      await db
        .update(users)
        .set({ shareToken: token, shareTokenCreatedAt: new Date() })
        .where(eq(users.id, userId));
      res.json({ shareToken: token });
    } catch (error) {
      console.error("Rotate share error:", error);
      res.status(500).json({ message: "Error rotating share link" });
    }
  });

  // Disable sharing — any existing link stops working immediately.
  app.delete("/api/share", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await db
        .update(users)
        .set({ shareToken: null, shareTokenCreatedAt: null })
        .where(eq(users.id, userId));
      res.json({ message: "Sharing disabled" });
    } catch (error) {
      console.error("Disable share error:", error);
      res.status(500).json({ message: "Error disabling sharing" });
    }
  });

  // Public, no-auth read-only summary gated by the unguessable share token.
  // Exposes only what the owner selected in shareSettings.
  app.get("/api/public-profile/:token", async (req, res) => {
    try {
      const token = (req.params.token ?? "").toString();
      const user = token ? await storage.getUserByShareToken(token) : undefined;
      if (!user || !user.shareToken) {
        return res.status(404).json({ message: "Profile not found" });
      }
      const settings = user.shareSettings ?? {
        ojtMethods: [],
        includeRope: false,
        certIds: [],
      };

      // field hours, restricted to the methods the owner chose to share.
      const allowMethods = new Set(settings.ojtMethods);
      const entries = await storage.getEntries(user.id);
      const byMethod = new Map<
        string,
        { totalHours: number; verifiedHours: number; count: number }
      >();
      for (const e of entries) {
        if (!allowMethods.has(e.method)) continue;
        const m = byMethod.get(e.method) ?? {
          totalHours: 0,
          verifiedHours: 0,
          count: 0,
        };
        m.totalHours += e.hours;
        if (e.verified) m.verifiedHours += e.hours;
        m.count += 1;
        byMethod.set(e.method, m);
      }
      const ojtByMethod = Array.from(byMethod.entries())
        .map(([method, v]) => ({
          method,
          totalHours: Math.round(v.totalHours * 10) / 10,
          verifiedHours: Math.round(v.verifiedHours * 10) / 10,
          count: v.count,
        }))
        .sort((a, b) => b.totalHours - a.totalHours);
      const ojtTotalVerified =
        Math.round(
          ojtByMethod.reduce((s, m) => s + m.verifiedHours, 0) * 10,
        ) / 10;

      // Rope-access summary, only if the owner opted in.
      let rope: { totalHours: number; verifiedHours: number; count: number } | null =
        null;
      if (settings.includeRope) {
        const rows = await storage.getRopeHours(user.id);
        let total = 0;
        let verified = 0;
        for (const r of rows) {
          total += r.hours;
          if (r.verified) verified += r.hours;
        }
        rope = {
          totalHours: Math.round(total * 10) / 10,
          verifiedHours: Math.round(verified * 10) / 10,
          count: rows.length,
        };
      }

      // Selected certifications. We expose the cert id and whether a document
      // exists so the public page can request a short-lived signed URL for it
      // via the token-gated document endpoint below (no document key leaks here).
      const allowCerts = new Set(settings.certIds);
      const allCerts = await storage.getCertifications(user.id);
      const certifications = allCerts
        .filter((c) => allowCerts.has(c.id))
        .map((c) => ({
          id: c.id,
          name: c.name,
          issuingBody: c.issuingBody,
          method: c.method,
          level: c.level,
          issueDate: c.issueDate,
          expiryDate: c.expiryDate,
          hasDocument: Boolean(c.documentKey),
        }));

      res.json({
        name: user.name ?? null,
        ojt: { byMethod: ojtByMethod, totalVerifiedHours: ojtTotalVerified },
        rope,
        certifications,
      });
    } catch (error) {
      console.error("Public profile error:", error);
      res.status(500).json({ message: "Error fetching public profile" });
    }
  });

  // Public, no-auth signed URL for a certification document, gated by the share
  // token. Only certs the owner explicitly added to shareSettings.certIds are
  // viewable; everything else 404s so we never confirm a cert's existence.
  app.get("/api/public-profile/:token/certifications/:certId/document", async (req, res) => {
    try {
      const token = (req.params.token ?? "").toString();
      const certId = parseInt(req.params.certId, 10);
      if (!Number.isFinite(certId)) {
        return res.status(400).json({ message: "Invalid id" });
      }

      const user = token ? await storage.getUserByShareToken(token) : undefined;
      if (!user || !user.shareToken) {
        return res.status(404).json({ message: "Profile not found" });
      }

      const sharedCertIds = new Set(user.shareSettings?.certIds ?? []);
      const cert = await storage.getCertification(certId);
      if (
        !cert ||
        cert.userId !== user.id ||
        !sharedCertIds.has(cert.id) ||
        !cert.documentKey
      ) {
        return res.status(404).json({ message: "Certificate file not found" });
      }

      const url = await objectStorageService.getSignedDownloadURL(
        cert.documentKey,
        600,
      );
      return res.json({ url, name: cert.documentName });
    } catch (error) {
      console.error("Public certification document error:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ message: "Certificate file not found" });
      }
      return res.status(500).json({ message: "Error fetching certificate file" });
    }
  });

  // ---------- API tokens (for Claude MCP and other external clients) ----------
  app.get("/api/tokens", requireAuth, async (req, res) => {
    try {
      const tokens = await storage.listApiTokens(req.session.userId!);
      // Never return the hash itself
      res.json(
        tokens.map(({ tokenHash: _h, ...rest }) => rest),
      );
    } catch (error) {
      console.error("List tokens error:", error);
      res.status(500).json({ message: "Error listing tokens" });
    }
  });

  app.post("/api/tokens", requireAuth, async (req, res) => {
    try {
      const name = (req.body?.name ?? "").toString().trim();
      if (!name || name.length > 100) {
        return res.status(400).json({ message: "Name is required (1–100 chars)" });
      }
      const raw = randomBytes(32).toString("hex"); // 64-char hex
      const tokenHash = hashApiToken(raw);
      const tokenPrefix = raw.slice(0, 8);
      const created = await storage.createApiToken({
        userId: req.session.userId!,
        name,
        tokenHash,
        tokenPrefix,
      });
      // Return raw token EXACTLY ONCE.
      const { tokenHash: _h, ...meta } = created;
      res.status(201).json({ ...meta, token: raw });
    } catch (error) {
      console.error("Create token error:", error);
      res.status(500).json({ message: "Error creating token" });
    }
  });

  app.delete("/api/tokens/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
      const existing = await storage.getApiTokenById(id);
      if (!existing) return res.status(404).json({ message: "Token not found" });
      if (existing.userId !== req.session.userId!) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      await storage.deleteApiToken(id);
      res.json({ message: "Token revoked" });
    } catch (error) {
      console.error("Delete token error:", error);
      res.status(500).json({ message: "Error deleting token" });
    }
  });

  // ---------- Aggregate totals (useful for MCP and dashboards) ----------
  app.get("/api/entries/totals", requireAuthOrToken, async (req, res) => {
    try {
      const all = await storage.getEntries(req.session.userId!);
      const byMethod = new Map<string, { totalHours: number; verifiedHours: number; count: number }>();
      for (const e of all) {
        const m = byMethod.get(e.method) ?? { totalHours: 0, verifiedHours: 0, count: 0 };
        m.totalHours += e.hours;
        if (e.verified) m.verifiedHours += e.hours;
        m.count += 1;
        byMethod.set(e.method, m);
      }
      const totals = Array.from(byMethod.entries())
        .map(([method, v]) => ({
          method,
          totalHours: Math.round(v.totalHours * 10) / 10,
          verifiedHours: Math.round(v.verifiedHours * 10) / 10,
          count: v.count,
        }))
        .sort((a, b) => b.totalHours - a.totalHours);
      res.json({ totals });
    } catch (error) {
      console.error("Totals error:", error);
      res.status(500).json({ message: "Error computing totals" });
    }
  });

  app.get("/api/rope-hours/totals", requireAuthOrToken, async (req, res) => {
    try {
      const rows = await storage.getRopeHours(req.session.userId!);
      let total = 0;
      let verified = 0;
      for (const r of rows) {
        total += r.hours;
        if (r.verified) verified += r.hours;
      }
      res.json({
        totalHours: Math.round(total * 10) / 10,
        verifiedHours: Math.round(verified * 10) / 10,
        count: rows.length,
      });
    } catch (error) {
      console.error("Rope totals error:", error);
      res.status(500).json({ message: "Error computing rope-hour totals" });
    }
  });

  // ---------- MCP one-shot export downloads ----------
  // GET /api/mcp-exports/:id — returns the generated PDF once and deletes it.
  // Unauthenticated by design because the UUID is unguessable and short-lived
  // (15 minutes). Same trust model as object-storage signed URLs.
  app.get("/api/mcp-exports/:id", (req, res) => {
    const rec = takeExport(req.params.id);
    if (!rec) {
      return res.status(404).json({ message: "Export not found or expired" });
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${rec.filename}"`);
    res.send(rec.bytes);
  });

  // ---------- OAuth 2.0 for MCP clients (claude.ai web, Cowork) ----------
  registerOauthRoutes(app);

  // ---------- MCP endpoint ----------
  // Streamable HTTP transport. Accepts EITHER:
  //   (a) a legacy API token (Claude Code path) — sha256-hashed in api_tokens
  //   (b) an OAuth 2.0 access token (claude.ai web / Cowork path) — issued via
  //       the /oauth/* flow and stored hashed in oauth_access_tokens.
  // On 401, advertises the OAuth resource-metadata URL so MCP-compliant
  // clients can discover OAuth and initiate the auth-code+PKCE flow.
  const send401 = (res: Response, error: string, description?: string) => {
    const base = getBaseUrl();
    const wwwAuth = [
      'Bearer realm="mcp"',
      `resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      `error="${error}"`,
      description ? `error_description="${description}"` : null,
    ]
      .filter(Boolean)
      .join(", ");
    res.setHeader("WWW-Authenticate", wwwAuth);
    res.status(401).json({ error, error_description: description });
  };

  app.post("/mcp", async (req, res) => {
    const authHeader = req.headers.authorization || "";
    const match = /^Bearer\s+([A-Za-z0-9_-]+)$/.exec(authHeader);
    if (!match || match[1].length < 16) {
      return send401(res, "invalid_token", "missing or malformed bearer token");
    }
    const raw = match[1];
    try {
      // Try legacy API token first (Claude Code path; existing tests cover it).
      const prefix = raw.slice(0, 8);
      const tokenHash = hashApiToken(raw);
      const candidates = await storage.getApiTokensByPrefix(prefix);
      const matched = candidates.find((t) => t.tokenHash === tokenHash);
      if (matched) {
        storage.touchApiToken(matched.id).catch(() => {});
        await handleMcpRequest(
          Object.assign(req, { userId: matched.userId }),
          res,
        );
        return;
      }
      // Fall back to OAuth access token (claude.ai web / Cowork path).
      const oauthRow = await getOauthAccessTokenByRaw(raw);
      if (!oauthRow) {
        return send401(res, "invalid_token", "bearer token not recognized");
      }
      touchOauthAccessToken(oauthRow.id).catch(() => {});
      await handleMcpRequest(
        Object.assign(req, { userId: oauthRow.userId }),
        res,
      );
    } catch (error) {
      console.error("/mcp auth error:", error);
      if (!res.headersSent) res.status(500).json({ error: "internal" });
    }
  });

  // MCP clients sometimes probe with GET/DELETE for SSE/session ops.
  // Stateless mode rejects them; reply with a clear error.
  app.get("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method Not Allowed (stateless transport, use POST)" });
  });
  app.delete("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method Not Allowed (stateless transport)" });
  });

  // Call setup admin function
  await setupAdmin();

  const httpServer = createServer(app);

  return httpServer;
}
