import {
  users, entries, supervisors, ropeHours, userCryptoIdentities, apiTokens,
  certifications, fundReports, dispatchEvents,
  type FundReport, type DispatchEvent,
  type User, type InsertUser,
  type Entry, type InsertEntry,
  type Supervisor, type InsertSupervisor, type SupervisorWithCreator,
  type RopeHours, type InsertRopeHours,
  type UserCryptoIdentity, type InsertUserCryptoIdentity,
  type ApiToken, type InsertApiToken,
  type Certification, type InsertCertification,
  type VerificationAuditEvent, type VerificationAuditTrail
} from "@shared/schema";
import type { UnionProfile } from "@shared/union";

import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

// Evidence captured at the moment a supervisor confirms hours. All optional so
// the verify flow degrades gracefully when, e.g., an IP can't be determined.
export type VerificationEvidence = {
  ipAddress?: string;
  browserInfo?: string;
  attestation?: boolean;
  email?: string;
};

// Append a "verified" event onto an existing audit trail (created at request
// time). Returns the new trail; never mutates the input.
function appendVerifiedEvent(
  existing: VerificationAuditTrail | null | undefined,
  verifiedBy: string,
  at: Date,
  evidence?: VerificationEvidence,
): VerificationAuditTrail {
  const event: VerificationAuditEvent = {
    action: "verified",
    timestamp: at.toISOString(),
    actor: verifiedBy,
    email: evidence?.email,
    ipAddress: evidence?.ipAddress,
    browserInfo: evidence?.browserInfo,
    attestation: evidence?.attestation,
  };
  return [...(existing ?? []), event];
}

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByShareToken(token: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Entry methods
  getEntries(userId: number): Promise<Entry[]>;
  getEntry(id: number): Promise<Entry | undefined>;
  getEntryByVerificationToken(token: string): Promise<Entry | undefined>;
  getEntriesByBatchToken(token: string): Promise<Entry[]>;
  createEntry(entry: InsertEntry): Promise<Entry>;
  createImportedEntry(
    entry: InsertEntry,
    sourceDocumentKey: string,
    sourceDocumentName: string,
  ): Promise<Entry>;
  bulkCreateImportedEntries(
    entries: InsertEntry[],
    sourceDocumentKey: string,
    sourceDocumentName: string,
  ): Promise<Entry[]>;
  updateEntry(id: number, updates: Partial<InsertEntry>): Promise<Entry>;
  verifyEntry(id: number, verifiedBy: string, evidence?: VerificationEvidence): Promise<Entry>;
  deleteEntry(id: number): Promise<void>;
  deleteImportedEntriesBySourceDocumentKey(
    userId: number,
    sourceDocumentKey: string,
  ): Promise<number>;
  countEntriesBySourceDocumentKey(sourceDocumentKey: string): Promise<number>;

  // Rope Hours methods
  getRopeHours(userId: number): Promise<RopeHours[]>;
  getRopeHour(id: number): Promise<RopeHours | undefined>;
  getRopeHourByVerificationToken(token: string): Promise<RopeHours | undefined>;
  createRopeHour(ropeHour: InsertRopeHours): Promise<RopeHours>;
  createImportedRopeHour(
    ropeHour: InsertRopeHours,
    sourceDocumentKey: string,
    sourceDocumentName: string,
  ): Promise<RopeHours>;
  bulkCreateImportedRopeHours(
    ropeHours: InsertRopeHours[],
    sourceDocumentKey: string,
    sourceDocumentName: string,
  ): Promise<RopeHours[]>;
  updateRopeHour(id: number, updates: Partial<InsertRopeHours>): Promise<RopeHours>;
  verifyRopeHour(id: number, verifiedBy: string, evidence?: VerificationEvidence): Promise<RopeHours>;
  deleteRopeHour(id: number): Promise<void>;
  deleteImportedRopeHoursBySourceDocumentKey(
    userId: number,
    sourceDocumentKey: string,
  ): Promise<number>;
  countRopeHoursBySourceDocumentKey(sourceDocumentKey: string): Promise<number>;

  // Supervisor methods
  getSupervisors(): Promise<SupervisorWithCreator[]>;
  findSupervisorByEmail(email: string): Promise<Supervisor | undefined>;
  getSupervisor(id: number): Promise<Supervisor | undefined>;
  createSupervisor(supervisor: InsertSupervisor): Promise<Supervisor>;
  updateSupervisor(id: number, updates: Partial<InsertSupervisor>): Promise<Supervisor>;
  deleteSupervisor(id: number): Promise<void>;

  // Certification methods
  getCertifications(userId: number): Promise<Certification[]>;
  getCertification(id: number): Promise<Certification | undefined>;
  createCertification(cert: InsertCertification): Promise<Certification>;
  updateCertification(id: number, updates: Partial<InsertCertification>): Promise<Certification>;
  deleteCertification(id: number): Promise<void>;

  // Crypto Identity methods
  getUserCryptoIdentity(userId: number): Promise<UserCryptoIdentity | undefined>;
  createUserCryptoIdentity(cryptoIdentity: InsertUserCryptoIdentity): Promise<UserCryptoIdentity>;

  // API Token methods (for external integrations like Claude MCP)
  listApiTokens(userId: number): Promise<ApiToken[]>;
  getApiTokenById(id: number): Promise<ApiToken | undefined>;
  getApiTokensByPrefix(prefix: string): Promise<ApiToken[]>;
  createApiToken(token: InsertApiToken): Promise<ApiToken>;
  touchApiToken(id: number): Promise<void>;
  deleteApiToken(id: number): Promise<void>;

  // Union: profile, fund cross-check rows, out-of-work list history. Deletes
  // take the owner so one member can never remove another's rows.
  setUnionProfile(userId: number, profile: UnionProfile): Promise<User>;
  getFundReports(userId: number): Promise<FundReport[]>;
  createFundReport(row: Omit<FundReport, "id" | "createdAt">): Promise<FundReport>;
  deleteFundReport(userId: number, id: number): Promise<boolean>;
  getDispatchEvents(userId: number): Promise<DispatchEvent[]>;
  createDispatchEvent(row: Omit<DispatchEvent, "id" | "createdAt">): Promise<DispatchEvent>;
  deleteDispatchEvent(userId: number, id: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByShareToken(token: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.shareToken, token));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    // Case-insensitive: "User@email.com" and "user@email.com" are one account.
    const [user] = await db.select().from(users).where(sql`lower(${users.email}) = lower(${email})`);
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  // Entry methods
  async getEntries(userId: number): Promise<Entry[]> {
    return await db
      .select()
      .from(entries)
      .where(eq(entries.userId, userId))
      .orderBy(desc(entries.date));
  }

  async getEntry(id: number): Promise<Entry | undefined> {
    const [entry] = await db.select().from(entries).where(eq(entries.id, id));
    return entry;
  }

  async getEntryByVerificationToken(token: string): Promise<Entry | undefined> {
    const [entry] = await db
      .select()
      .from(entries)
      .where(eq(entries.verificationToken, token));
    return entry;
  }

  async getEntriesByBatchToken(token: string): Promise<Entry[]> {
    return await db
      .select()
      .from(entries)
      .where(eq(entries.verificationToken, token));
  }

  async createEntry(entry: InsertEntry): Promise<Entry> {
    const verificationToken = uuidv4();
    const [newEntry] = await db
      .insert(entries)
      .values({ ...entry, verificationToken })
      .returning();
    return newEntry;
  }

  async createImportedEntry(
    entry: InsertEntry,
    sourceDocumentKey: string,
    sourceDocumentName: string,
  ): Promise<Entry> {
    const [created] = await this.bulkCreateImportedEntries(
      [entry],
      sourceDocumentKey,
      sourceDocumentName,
    );
    return created;
  }

  async bulkCreateImportedEntries(
    items: InsertEntry[],
    sourceDocumentKey: string,
    sourceDocumentName: string,
  ): Promise<Entry[]> {
    if (items.length === 0) return [];
    const now = new Date();
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(entries)
        .values(
          items.map((entry) => ({
            ...entry,
            verified: true,
            verifiedBy: "Imported from signed log",
            verifiedAt: now,
            importedAt: now,
            sourceDocumentKey,
            sourceDocumentName,
          })),
        )
        .returning();
      return inserted;
    });
  }

  async updateEntry(id: number, updates: Partial<InsertEntry>): Promise<Entry> {
    const [updated] = await db
      .update(entries)
      .set(updates)
      .where(eq(entries.id, id))
      .returning();
    return updated;
  }

  async verifyEntry(id: number, verifiedBy: string, evidence?: VerificationEvidence): Promise<Entry> {
    const existing = await this.getEntry(id);
    const verifiedAt = new Date();
    const auditTrail = appendVerifiedEvent(
      existing?.auditTrail,
      verifiedBy,
      verifiedAt,
      evidence,
    );
    const [entry] = await db
      .update(entries)
      .set({
        verified: true,
        verifiedBy,
        verifiedAt,
        verifiedByEmail: evidence?.email ?? existing?.verifiedByEmail ?? null,
        supervisorIpAddress: evidence?.ipAddress ?? null,
        supervisorBrowserInfo: evidence?.browserInfo ?? null,
        auditTrail,
      })
      .where(eq(entries.id, id))
      .returning();
    return entry;
  }

  async deleteEntry(id: number): Promise<void> {
    await db.delete(entries).where(eq(entries.id, id));
  }

  async deleteImportedEntriesBySourceDocumentKey(
    userId: number,
    sourceDocumentKey: string,
  ): Promise<number> {
    const deleted = await db
      .delete(entries)
      .where(
        and(
          eq(entries.userId, userId),
          eq(entries.sourceDocumentKey, sourceDocumentKey),
          sql`${entries.importedAt} is not null`,
        ),
      )
      .returning({ id: entries.id });
    return deleted.length;
  }

  async countEntriesBySourceDocumentKey(
    sourceDocumentKey: string,
  ): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(entries)
      .where(eq(entries.sourceDocumentKey, sourceDocumentKey));
    return row?.count ?? 0;
  }

  // Rope Hours methods
  async getRopeHours(userId: number): Promise<RopeHours[]> {
    return await db
      .select()
      .from(ropeHours)
      .where(eq(ropeHours.userId, userId))
      .orderBy(desc(ropeHours.startDate));
  }

  async getRopeHour(id: number): Promise<RopeHours | undefined> {
    const [ropeHour] = await db.select().from(ropeHours).where(eq(ropeHours.id, id));
    return ropeHour;
  }

  async getRopeHourByVerificationToken(token: string): Promise<RopeHours | undefined> {
    const [ropeHour] = await db
      .select()
      .from(ropeHours)
      .where(eq(ropeHours.verificationToken, token));
    return ropeHour;
  }

  async createRopeHour(ropeHour: InsertRopeHours): Promise<RopeHours> {
    const verificationToken = uuidv4();
    const [newRopeHour] = await db
      .insert(ropeHours)
      .values({ ...ropeHour, verificationToken })
      .returning();
    return newRopeHour;
  }

  async createImportedRopeHour(
    ropeHour: InsertRopeHours,
    sourceDocumentKey: string,
    sourceDocumentName: string,
  ): Promise<RopeHours> {
    const [created] = await this.bulkCreateImportedRopeHours(
      [ropeHour],
      sourceDocumentKey,
      sourceDocumentName,
    );
    return created;
  }

  async bulkCreateImportedRopeHours(
    items: InsertRopeHours[],
    sourceDocumentKey: string,
    sourceDocumentName: string,
  ): Promise<RopeHours[]> {
    if (items.length === 0) return [];
    const now = new Date();
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(ropeHours)
        .values(
          items.map((ropeHour) => ({
            ...ropeHour,
            verified: true,
            verifiedBy: "Imported from signed log",
            verifiedAt: now,
            importedAt: now,
            sourceDocumentKey,
            sourceDocumentName,
          })),
        )
        .returning();
      return inserted;
    });
  }

  async updateRopeHour(id: number, updates: Partial<InsertRopeHours>): Promise<RopeHours> {
    const [updated] = await db
      .update(ropeHours)
      .set(updates)
      .where(eq(ropeHours.id, id))
      .returning();
    return updated;
  }

  async verifyRopeHour(id: number, verifiedBy: string, evidence?: VerificationEvidence): Promise<RopeHours> {
    const existing = await this.getRopeHour(id);
    const verifiedAt = new Date();
    const auditTrail = appendVerifiedEvent(
      existing?.auditTrail,
      verifiedBy,
      verifiedAt,
      evidence,
    );
    const [ropeHour] = await db
      .update(ropeHours)
      .set({
        verified: true,
        verifiedBy,
        verifiedAt,
        verifiedByEmail: evidence?.email ?? existing?.verifiedByEmail ?? null,
        supervisorIpAddress: evidence?.ipAddress ?? null,
        supervisorBrowserInfo: evidence?.browserInfo ?? null,
        auditTrail,
      })
      .where(eq(ropeHours.id, id))
      .returning();
    return ropeHour;
  }

  async deleteRopeHour(id: number): Promise<void> {
    await db.delete(ropeHours).where(eq(ropeHours.id, id));
  }

  async deleteImportedRopeHoursBySourceDocumentKey(
    userId: number,
    sourceDocumentKey: string,
  ): Promise<number> {
    const deleted = await db
      .delete(ropeHours)
      .where(
        and(
          eq(ropeHours.userId, userId),
          eq(ropeHours.sourceDocumentKey, sourceDocumentKey),
          sql`${ropeHours.importedAt} is not null`,
        ),
      )
      .returning({ id: ropeHours.id });
    return deleted.length;
  }

  async countRopeHoursBySourceDocumentKey(
    sourceDocumentKey: string,
  ): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ropeHours)
      .where(eq(ropeHours.sourceDocumentKey, sourceDocumentKey));
    return row?.count ?? 0;
  }

  // Supervisor methods
  // The signer list is shared by every user (single-company app).
  async getSupervisors(): Promise<SupervisorWithCreator[]> {
    const rows = await db
      .select({ supervisor: supervisors, addedByName: users.name, addedByEmail: users.email })
      .from(supervisors)
      .leftJoin(users, eq(users.id, supervisors.userId))
      .orderBy(supervisors.name);
    return rows.map((r) => ({
      ...r.supervisor,
      addedByName: r.addedByName ?? r.addedByEmail ?? null,
    }));
  }

  async findSupervisorByEmail(email: string): Promise<Supervisor | undefined> {
    const [supervisor] = await db
      .select()
      .from(supervisors)
      .where(sql`lower(${supervisors.email}) = lower(${email.trim()})`);
    return supervisor;
  }

  async getSupervisor(id: number): Promise<Supervisor | undefined> {
    const [supervisor] = await db
      .select()
      .from(supervisors)
      .where(eq(supervisors.id, id));
    return supervisor;
  }

  async createSupervisor(supervisor: InsertSupervisor): Promise<Supervisor> {
    const [newSupervisor] = await db
      .insert(supervisors)
      .values(supervisor)
      .returning();
    return newSupervisor;
  }

  async updateSupervisor(id: number, updates: Partial<InsertSupervisor>): Promise<Supervisor> {
    const [updated] = await db
      .update(supervisors)
      .set(updates)
      .where(eq(supervisors.id, id))
      .returning();
    return updated;
  }

  async deleteSupervisor(id: number): Promise<void> {
    await db.delete(supervisors).where(eq(supervisors.id, id));
  }

  // Certification methods
  async getCertifications(userId: number): Promise<Certification[]> {
    return await db
      .select()
      .from(certifications)
      .where(eq(certifications.userId, userId))
      .orderBy(desc(certifications.createdAt));
  }

  async getCertification(id: number): Promise<Certification | undefined> {
    const [cert] = await db
      .select()
      .from(certifications)
      .where(eq(certifications.id, id));
    return cert;
  }

  async createCertification(cert: InsertCertification): Promise<Certification> {
    const [created] = await db.insert(certifications).values(cert).returning();
    return created;
  }

  async updateCertification(
    id: number,
    updates: Partial<InsertCertification>,
  ): Promise<Certification> {
    const [updated] = await db
      .update(certifications)
      .set(updates)
      .where(eq(certifications.id, id))
      .returning();
    return updated;
  }

  async deleteCertification(id: number): Promise<void> {
    await db.delete(certifications).where(eq(certifications.id, id));
  }

  // Crypto Identity methods
  async getUserCryptoIdentity(userId: number): Promise<UserCryptoIdentity | undefined> {
    const [cryptoIdentity] = await db
      .select()
      .from(userCryptoIdentities)
      .where(eq(userCryptoIdentities.userId, userId));
    return cryptoIdentity;
  }

  async createUserCryptoIdentity(cryptoIdentity: InsertUserCryptoIdentity): Promise<UserCryptoIdentity> {
    const [newCryptoIdentity] = await db
      .insert(userCryptoIdentities)
      .values(cryptoIdentity)
      .returning();
    return newCryptoIdentity;
  }

  // API Token methods
  async listApiTokens(userId: number): Promise<ApiToken[]> {
    return await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, userId))
      .orderBy(desc(apiTokens.createdAt));
  }

  async getApiTokenById(id: number): Promise<ApiToken | undefined> {
    const [tok] = await db.select().from(apiTokens).where(eq(apiTokens.id, id));
    return tok;
  }

  async getApiTokensByPrefix(prefix: string): Promise<ApiToken[]> {
    return await db.select().from(apiTokens).where(eq(apiTokens.tokenPrefix, prefix));
  }

  async createApiToken(token: InsertApiToken): Promise<ApiToken> {
    const [created] = await db.insert(apiTokens).values(token).returning();
    return created;
  }

  async touchApiToken(id: number): Promise<void> {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.id, id));
  }

  async deleteApiToken(id: number): Promise<void> {
    await db.delete(apiTokens).where(eq(apiTokens.id, id));
  }

  // Union methods
  async setUnionProfile(userId: number, profile: UnionProfile): Promise<User> {
    const [updated] = await db.update(users).set({ unionProfile: profile }).where(eq(users.id, userId)).returning();
    return updated;
  }

  async getFundReports(userId: number): Promise<FundReport[]> {
    return await db.select().from(fundReports).where(eq(fundReports.userId, userId)).orderBy(desc(fundReports.month));
  }

  async createFundReport(row: Omit<FundReport, "id" | "createdAt">): Promise<FundReport> {
    const [created] = await db.insert(fundReports).values(row).returning();
    return created;
  }

  async deleteFundReport(userId: number, id: number): Promise<boolean> {
    const gone = await db
      .delete(fundReports)
      .where(and(eq(fundReports.id, id), eq(fundReports.userId, userId)))
      .returning({ id: fundReports.id });
    return gone.length > 0;
  }

  async getDispatchEvents(userId: number): Promise<DispatchEvent[]> {
    return await db
      .select()
      .from(dispatchEvents)
      .where(eq(dispatchEvents.userId, userId))
      .orderBy(desc(dispatchEvents.date), desc(dispatchEvents.createdAt));
  }

  async createDispatchEvent(row: Omit<DispatchEvent, "id" | "createdAt">): Promise<DispatchEvent> {
    const [created] = await db.insert(dispatchEvents).values(row).returning();
    return created;
  }

  async deleteDispatchEvent(userId: number, id: number): Promise<boolean> {
    const gone = await db
      .delete(dispatchEvents)
      .where(and(eq(dispatchEvents.id, id), eq(dispatchEvents.userId, userId)))
      .returning({ id: dispatchEvents.id });
    return gone.length > 0;
  }
}

export const storage = new DatabaseStorage();
