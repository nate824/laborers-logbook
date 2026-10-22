import { pgTable, text, serial, timestamp, integer, real, boolean, uuid, json } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Access Limited field-hours methods: one column each in the Field Hours
// daily log. Adding a key here (plus a label) adds a column to the log,
// totals, picker and API. What each method records beyond date/location/hours
// comes from FIELD_METHOD_DETAILS below (the ACL paper logbook pages).
// Rope access is NOT here: it has its own Rope Hours log (ropeHours table).
export const FieldMethods = {
  DRILLING: "DRILLING",
  SHOTCRETE: "SHOTCRETE",
  SCALING: "SCALING",
} as const;

export type FieldMethod = keyof typeof FieldMethods;

export const FIELD_METHOD_LABELS: Record<FieldMethod, string> = {
  DRILLING: "Drilling",
  SHOTCRETE: "Shotcrete",
  SCALING: "Scaling",
};

// Human-friendly label for a field method (UI display only).
export function fieldMethodLabel(method: string): string {
  return FIELD_METHOD_LABELS[method as FieldMethod] ?? method;
}

// Extra per-method fields, taken from the columns of the ACL paper logbook
// (Drilling Log, Nozzleman Log). Stored as strings in entries.details, all
// optional so a quick entry in the field still saves. A "choice" field is one
// the paper log has you circle (Dry / Wet); `multiple` allows circling both,
// stored comma-joined ("Vert.,Horz.").
export type FieldDetailSpec = {
  key: string;
  label: string;
  input?: "text" | "number" | "date" | "choice";
  options?: string[];
  multiple?: boolean;
  placeholder?: string;
};

export const FIELD_METHOD_DETAILS: Record<FieldMethod, FieldDetailSpec[]> = {
  DRILLING: [
    { key: "jobNumber", label: "Job #" },
    { key: "type", label: "Type", placeholder: "e.g. Soil nail, rock bolt" },
    { key: "drill", label: "Drill", placeholder: "Drill / rig used" },
    { key: "holeDepthSize", label: "Hole depth & size", placeholder: "e.g. 20' x 3.5\"" },
    { key: "totalLf", label: "Total LF", input: "number" },
    { key: "conditions", label: "Drilling conditions", placeholder: "e.g. Fractured rock, wet" },
    { key: "angle", label: "Angle", placeholder: "e.g. 15° down" },
  ],
  SHOTCRETE: [
    { key: "jobNumber", label: "Job #" },
    { key: "employer", label: "Employer" },
    { key: "process", label: "Dry / Wet", input: "choice", options: ["Dry", "Wet"] },
    { key: "sqft", label: "Sq ft", input: "number" },
    { key: "orientation", label: "Vert. / Horz.", input: "choice", options: ["Vert.", "Horz."], multiple: true },
    { key: "endDate", label: "End date", input: "date" },
    { key: "thickness", label: "Thickness", placeholder: "e.g. 4\"" },
  ],
  SCALING: [{ key: "jobNumber", label: "Job #" }],
};

export type EntryDetails = Record<string, string>;

export function fieldMethodDetails(method: string): FieldDetailSpec[] {
  return FIELD_METHOD_DETAILS[method as FieldMethod] ?? [];
}

// Keep only the detail fields this method has, trimmed, dropping blanks —
// switching a draft from Drilling to Scaling must not carry drill fields along.
export function cleanEntryDetails(method: string, details: EntryDetails | null | undefined): EntryDetails {
  const out: EntryDetails = {};
  for (const spec of fieldMethodDetails(method)) {
    const v = details?.[spec.key];
    if (typeof v === "string" && v.trim()) out[spec.key] = v.trim();
  }
  return out;
}

// One-line summary of an entry's details for cards and the verify page,
// e.g. "Job # 2231 · Soil nail · 120 LF".
export function entryDetailsSummary(method: string, details: EntryDetails | null | undefined): string {
  return fieldMethodDetails(method)
    .filter((s) => details?.[s.key])
    .map((s) => {
      const v = details![s.key];
      if (s.key === "jobNumber") return `Job # ${v}`;
      if (s.key === "totalLf") return `${v} LF`;
      if (s.key === "sqft") return `${v} sq ft`;
      if (s.input === "date") return `${s.label} ${v}`;
      return v.split(",").join(" / ");
    })
    .join(" · ");
}

export const entryDetailsSchema = z.record(z.string().max(60), z.string().max(500));

// Methods a signer can be qualified in: every field method plus rope access.
// Kept SEPARATE from FieldMethods on purpose — FieldMethods drives the Field
// Hours entry picker and columns, which must not include rope access.
export const SIGNER_METHODS = {
  ...FieldMethods,
  ROPE_ACCESS: "ROPE_ACCESS",
} as const;

export type SignerMethod = keyof typeof SIGNER_METHODS;

// Human-friendly label for a signer method (UI display only).
export function signerMethodLabel(method: string): string {
  if (method === "ROPE_ACCESS") return "Rope Access";
  return fieldMethodLabel(method);
}

// Certification levels a signer can hold
export const CERTIFICATION_LEVELS = ["Level I", "Level II", "Level III"] as const;

// A single method+level qualification a signer holds (e.g. Rope Access Level III)
export const supervisorQualificationSchema = z.object({
  method: z.enum(Object.keys(SIGNER_METHODS) as [string, ...string[]]),
  level: z.enum(CERTIFICATION_LEVELS),
});

export type SupervisorQualification = z.infer<typeof supervisorQualificationSchema>;

// Keep the legacy single ndtMethod/certificationLevel columns in sync with the
// qualifications list so older readers (emails, PDF adapters) keep working.
// Only touches legacy fields when `qualifications` is present in the write;
// an empty array clears them. Partial writes without qualifications are left
// untouched.
export function canonicalizeSupervisorWrite<
  T extends {
    qualifications?: SupervisorQualification[] | null;
    ndtMethod?: string | null;
    certificationLevel?: string | null;
  },
>(data: T): T {
  if (data.qualifications === undefined) return data;
  const first = data.qualifications?.[0];
  return {
    ...data,
    ndtMethod: first?.method ?? null,
    certificationLevel: first?.level ?? null,
  };
}

// What a user has chosen to expose on their public share profile. Arrays are
// explicit allowlists: ojtMethods lists which field methods to show, certIds lists
// which certifications to show. includeRope toggles the rope-access summary.
export type ShareSettings = {
  ojtMethods: string[];
  includeRope: boolean;
  certIds: number[];
};

export const shareSettingsSchema = z.object({
  ojtMethods: z.array(z.string()).max(50).default([]),
  includeRope: z.boolean().default(false),
  certIds: z.array(z.number().int()).max(200).default([]),
});

// User model with password auth
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password"),
  name: text("name"),
  employeeNumber: text("employee_number"),
  isAdmin: boolean("is_admin").default(false),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  createdAt: timestamp("created_at").defaultNow(),
  // Public share profile: an unguessable token gates a read-only summary page.
  // Null token = sharing disabled. shareSettings controls what's exposed.
  shareToken: text("share_token").unique(),
  shareTokenCreatedAt: timestamp("share_token_created_at"),
  shareSettings: json("share_settings").$type<ShareSettings>(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
  name: true,
  employeeNumber: true,
});

// One event in a record's verification audit trail (stored as JSON on the
// record). The trail is an ordered timeline: the request, the supervisor
// opening the emailed link, and the final confirmation — each stamped with
// whatever evidence we captured at that moment.
export type VerificationAuditEvent = {
  action: "verification_requested" | "link_opened" | "verified";
  timestamp: string; // ISO 8601
  actor?: string; // technician or supervisor name, depending on the action
  email?: string; // address the link was sent to / supervisor's address
  phone?: string; // number the link was texted to (verification_requested)
  channels?: ("email" | "sms")[]; // how the link was delivered (verification_requested)
  ipAddress?: string;
  browserInfo?: string; // user-agent string
  attestation?: boolean; // supervisor explicitly attested at confirm time
  note?: string;
};

export type VerificationAuditTrail = VerificationAuditEvent[];

// Field Hours log entry (one day, one method — see FieldMethods)
export const entries = pgTable("entries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  date: timestamp("date").notNull(),
  location: text("location").notNull(),
  method: text("method").notNull(), // a FieldMethods key, e.g. DRILLING
  hours: real("hours").notNull(),
  details: json("details").$type<EntryDetails>(), // FIELD_METHOD_DETAILS values for this method
  verified: boolean("verified").default(false),
  verifiedBy: text("verified_by"),
  // Not unique: a batch verification request stamps one shared token across
  // multiple entries so the supervisor can sign off on them with one link.
  verificationToken: uuid("verification_token"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  // Digital signature fields
  technicianSignature: text("technician_signature"), // Technician's digital signature
  supervisorSignature: text("supervisor_signature"), // Supervisor's digital signature
  dataHash: text("data_hash"), // Hash of all entry data
  integritySignature: text("integrity_signature"), // Server-generated integrity signature
  verificationRequestedAt: timestamp("verification_requested_at"), // When verification was requested
  verifiedByEmail: text("verified_by_email"), // Email address the verification link was sent to
  auditTrail: json("audit_trail").$type<VerificationAuditTrail>(), // Complete audit trail as JSON
  supervisorIpAddress: text("supervisor_ip_address"), // Supervisor's IP address during verification
  supervisorBrowserInfo: text("supervisor_browser_info"), // Supervisor's browser info
  employeeIdUsed: text("employee_id_used"), // Which employee ID was used for this entry
  // Imported from signed log fields
  sourceDocumentKey: text("source_document_key"), // Object storage path like "/objects/imports/<userId>/<uuid>"
  sourceDocumentName: text("source_document_name"), // Original uploaded filename
  importedAt: timestamp("imported_at"), // When this entry was imported from a signed log
});

export const insertEntrySchema = createInsertSchema(entries)
  .pick({
    userId: true,
    date: true,
    location: true,
    method: true,
    hours: true,
  })
  .extend({
    method: z.enum(Object.keys(FieldMethods) as [FieldMethod, ...FieldMethod[]]),
    details: entryDetailsSchema.nullish(),
  });

// Supervisor / Signer model
export const supervisors = pgTable("supervisors", {
  id: serial("id").primaryKey(),
  // The user who added this signer. Every user can see and use every signer
  // (one company); only this user or an admin can edit/delete it.
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  certificationLevel: text("certification_level"),
  company: text("company"),
  spratNumber: text("sprat_number"),
  irataNumber: text("irata_number"),
  ndtMethod: text("ndt_method"),
  // A signer can hold multiple method+level qualifications (e.g. UT III, PT II).
  // Legacy ndtMethod/certificationLevel are kept for backward compatibility.
  qualifications: json("qualifications").$type<SupervisorQualification[]>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSupervisorSchema = createInsertSchema(supervisors)
  .pick({
    userId: true,
    name: true,
    email: true,
    phone: true,
    certificationLevel: true,
    company: true,
    spratNumber: true,
    irataNumber: true,
    ndtMethod: true,
  })
  .extend({
    qualifications: z.array(supervisorQualificationSchema).optional(),
  });

// Certification / qualification a technician holds (ASNT, IRATA, SPRAT,
// employer cards, etc.). One row per credential; the uploaded certificate file
// lives in object storage under certifications/<userId>/... and is referenced
// by documentKey (same storage pattern as imported signed logs).
export const certifications = pgTable("certifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(), // e.g. "ASNT NDT Level II"
  method: text("method"), // discipline, e.g. "UT", "Rope Access" (free text)
  level: text("level"), // e.g. "Level II", "Level 3" (free text)
  issuingBody: text("issuing_body"), // ASNT / IRATA / SPRAT / employer name
  certNumber: text("cert_number"), // credential / certificate number
  issueDate: timestamp("issue_date"),
  expiryDate: timestamp("expiry_date"),
  documentKey: text("document_key"), // "/objects/certifications/<userId>/<uuid>-<name>"
  documentName: text("document_name"), // original uploaded filename
  createdAt: timestamp("created_at").defaultNow(),
});

// Common issuing bodies. The form still accepts free text via "Other".
export const CERT_ISSUING_BODIES = [
  "ASNT",
  "IRATA",
  "SPRAT",
  "API",
  "AWS",
  "Employer",
  "Other",
] as const;

// Validated shape for creating/updating a certification. Dates arrive as
// strings from the client so they're coerced; userId is taken from the session,
// never the request body.
export const certificationWriteSchema = z.object({
  name: z.string().min(1).max(200),
  method: z.string().max(100).nullish(),
  level: z.string().max(100).nullish(),
  issuingBody: z.string().max(200).nullish(),
  certNumber: z.string().max(200).nullish(),
  issueDate: z.coerce.date().nullish(),
  expiryDate: z.coerce.date().nullish(),
  documentKey: z
    .string()
    .max(500)
    .regex(/^\/objects\/certifications\//)
    .nullish(),
  documentName: z.string().max(500).nullish(),
});

export type CertificationWrite = z.infer<typeof certificationWriteSchema>;
export type Certification = typeof certifications.$inferSelect;
export type InsertCertification = typeof certifications.$inferInsert;

// Rope Hours model
export const ropeHours = pgTable("rope_hours", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  location: text("location").notNull(),
  skills: text("skills").notNull(), // Text input for skills used
  hours: real("hours").notNull(),
  employer: text("employer"),
  workDetails: text("work_details"),
  maxHeight: text("max_height"),
  // ACL "Work Log - Rope Hours" columns
  projectNumber: text("project_number"),
  workCode: text("work_code"),
  verified: boolean("verified").default(false),
  verifiedBy: text("verified_by"),
  verificationToken: uuid("verification_token").unique(),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  // Digital signature fields
  technicianSignature: text("technician_signature"), // Technician's digital signature
  supervisorSignature: text("supervisor_signature"), // Supervisor's digital signature
  dataHash: text("data_hash"), // Hash of all entry data
  integritySignature: text("integrity_signature"), // Server-generated integrity signature
  verificationRequestedAt: timestamp("verification_requested_at"), // When verification was requested
  verifiedByEmail: text("verified_by_email"), // Email address the verification link was sent to
  auditTrail: json("audit_trail").$type<VerificationAuditTrail>(), // Complete audit trail as JSON
  supervisorIpAddress: text("supervisor_ip_address"), // Supervisor's IP address during verification
  supervisorBrowserInfo: text("supervisor_browser_info"), // Supervisor's browser info
  employeeIdUsed: text("employee_id_used"), // Which employee ID was used for this entry
  // Imported from signed log fields
  sourceDocumentKey: text("source_document_key"),
  sourceDocumentName: text("source_document_name"),
  importedAt: timestamp("imported_at"),
});

export const insertRopeHoursSchema = createInsertSchema(ropeHours).pick({
  userId: true,
  startDate: true,
  endDate: true,
  location: true,
  skills: true,
  hours: true,
  employer: true,
  workDetails: true,
  maxHeight: true,
  projectNumber: true,
  workCode: true,
});

// API Tokens for external integrations (e.g. Claude MCP)
export const apiTokens = pgTable("api_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
});

export const insertApiTokenSchema = createInsertSchema(apiTokens).pick({
  userId: true,
  name: true,
  tokenHash: true,
  tokenPrefix: true,
});

export type ApiToken = typeof apiTokens.$inferSelect;
export type InsertApiToken = z.infer<typeof insertApiTokenSchema>;

// ---------------- OAuth 2.0 (for MCP clients like claude.ai web / Cowork) ----
// Public clients registered via Dynamic Client Registration (RFC 7591).
// No client_secret — MCP clients use Authorization Code + PKCE.
export const oauthClients = pgTable("oauth_clients", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientName: text("client_name").notNull(),
  redirectUris: text("redirect_uris").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at").defaultNow(),
});

// Short-lived authorization codes (single-use, ~5min TTL). Stores the PKCE
// code_challenge so the token endpoint can verify the code_verifier.
export const oauthAuthorizationCodes = pgTable("oauth_authorization_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  clientId: text("client_id").notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  codeChallengeMethod: text("code_challenge_method").notNull(),
  scope: text("scope"),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Access + refresh tokens. Hashed at rest (sha256 of the raw token).
export const oauthAccessTokens = pgTable("oauth_access_tokens", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  refreshTokenHash: text("refresh_token_hash"),
  refreshTokenPrefix: text("refresh_token_prefix"),
  clientId: text("client_id").notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
  scope: text("scope"),
  expiresAt: timestamp("expires_at").notNull(),
  refreshExpiresAt: timestamp("refresh_expires_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
});

export type OauthClient = typeof oauthClients.$inferSelect;
export type OauthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect;
export type OauthAccessToken = typeof oauthAccessTokens.$inferSelect;

// User Crypto Identities - for technicians
export const userCryptoIdentities = pgTable("user_crypto_identities", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  publicKey: text("public_key").notNull(), // RSA public key (safe to store)
  encryptedPrivateKey: text("encrypted_private_key").notNull(), // RSA private key encrypted with server secret
  personalInfo: json("personal_info").notNull(), // {fullName, dateOfBirth, phoneNumber}
  employeeIds: text("employee_ids").array().notNull().default(sql`'{}'::text[]`), // Array of employee IDs
  isEmailVerified: boolean("is_email_verified").default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationExpiry: timestamp("email_verification_expiry"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserCryptoIdentitySchema = createInsertSchema(userCryptoIdentities).pick({
  userId: true,
  publicKey: true,
  encryptedPrivateKey: true,
  personalInfo: true,
  employeeIds: true,
});

// Supervisor Crypto Identities - for supervisors
export const supervisorCryptoIdentities = pgTable("supervisor_crypto_identities", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(), // Unique identifier for supervisors
  publicKey: text("public_key").notNull(), // RSA public key (safe to store)
  encryptedPrivateKey: text("encrypted_private_key").notNull(), // RSA private key encrypted with server secret
  professionalInfo: json("professional_info").notNull(), // {fullName, dateOfBirth, phoneNumber, certifications, company}
  isEmailVerified: boolean("is_email_verified").default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationExpiry: timestamp("email_verification_expiry"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSupervisorCryptoIdentitySchema = createInsertSchema(supervisorCryptoIdentities).pick({
  email: true,
  publicKey: true,
  encryptedPrivateKey: true,
  professionalInfo: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Entry = typeof entries.$inferSelect;
export type InsertEntry = z.infer<typeof insertEntrySchema>;

export type Supervisor = typeof supervisors.$inferSelect;
// Signers are shared company-wide; the list carries who added each one.
export type SupervisorWithCreator = Supervisor & { addedByName: string | null };
export type InsertSupervisor = z.infer<typeof insertSupervisorSchema>;

export type RopeHours = typeof ropeHours.$inferSelect;
export type InsertRopeHours = z.infer<typeof insertRopeHoursSchema>;

export type UserCryptoIdentity = typeof userCryptoIdentities.$inferSelect;
export type InsertUserCryptoIdentity = z.infer<typeof insertUserCryptoIdentitySchema>;

export type SupervisorCryptoIdentity = typeof supervisorCryptoIdentities.$inferSelect;
export type InsertSupervisorCryptoIdentity = z.infer<typeof insertSupervisorCryptoIdentitySchema>;
