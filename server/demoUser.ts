import { hash } from "bcrypt";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "./storage";

// A shared demo account so anyone shown the app (e.g. the local's office) can
// sign in and click around. Created on boot; its password is reset on every
// boot so a visitor changing it can't lock the next one out. Email matching is
// case-insensitive (storage.getUserByEmail), so "User@email.com" works too.
export const DEMO_EMAIL = "user@email.com";
export const DEMO_PASSWORD = "password123";

// Calendar date `daysAgo` before today, at UTC midnight (how entry dates are stored).
function day(daysAgo: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo));
}

function monthKeyAgo(monthsAgo: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - monthsAgo, 1));
  return d.toISOString().slice(0, 7);
}

export async function ensureDemoUser() {
  try {
    const password = await hash(DEMO_PASSWORD, 10);
    let user = await storage.getUserByEmail(DEMO_EMAIL);
    if (!user) {
      [user] = await db.insert(users).values({ email: DEMO_EMAIL, password, name: "Demo Laborer" }).returning();
    } else {
      await db.update(users).set({ password }).where(eq(users.id, user.id));
    }

    // Seed sample data once, dated relative to today so the demo stays current.
    if ((await storage.getEntries(user.id)).length > 0) return;
    const userId = user.id;

    // ~5 months of weekday shifts: enough to qualify for coverage and build a bank.
    for (let daysAgo = 150; daysAgo >= 1; daysAgo--) {
      const d = day(daysAgo);
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6 || daysAgo % 11 === 0) continue;
      const employer = daysAgo > 60 ? "Granite Construction" : "Access Limited";
      const entry = await storage.createEntry({
        userId,
        date: d,
        location: daysAgo > 60 ? "Hwy 58 widening, Bakersfield" : "Hwy 46 slope repair, Wasco",
        method: "ON_THE_JOB",
        hours: daysAgo % 5 === 0 ? 10 : 8,
        details: { employer, union: "Union", county: "Kern", ...(daysAgo % 5 === 0 ? { overtime: "2" } : {}) },
      });
      // Older days are signed off; the last couple of weeks still need it.
      if (daysAgo > 14) await storage.verifyEntry(entry.id, "Dana Foreman");
    }
    await storage.createEntry({
      userId,
      date: day(20),
      location: "LTS Bakersfield",
      method: "CLASSROOM",
      hours: 8,
      details: { course: "Confined Space", school: "LTS Bakersfield" },
    });

    await storage.setUnionProfile(userId, {
      classification: "TEMP_JOURNEYMAN",
      localNumber: "220",
      priorOjtHours: 0,
      priorRsiHours: 0,
      startingBank: 0,
      duesPaidThrough: monthKeyAgo(1),
    });

    // What the "fund portal" showed: one month matches, one comes up short.
    const fundMonths = [3, 2].map(monthKeyAgo);
    const logged = (await storage.getEntries(userId)).filter((e) => e.method === "ON_THE_JOB");
    const hoursIn = (m: string) =>
      logged.filter((e) => new Date(e.date).toISOString().startsWith(m)).reduce((s, e) => s + e.hours, 0);
    await storage.createFundReport({ userId, month: fundMonths[0], employer: "Granite Construction", hours: hoursIn(fundMonths[0]), note: null });
    await storage.createFundReport({ userId, month: fundMonths[1], employer: "Granite Construction", hours: Math.max(0, hoursIn(fundMonths[1]) - 24), note: null });

    await storage.createDispatchEvent({ userId, date: day(155), kind: "REGISTERED", employer: null, note: "Signed at the hall" });
    await storage.createDispatchEvent({ userId, date: day(150), kind: "DISPATCHED", employer: "Granite Construction", note: null });
    await storage.createDispatchEvent({ userId, date: day(61), kind: "LAID_OFF", employer: "Granite Construction", note: null });
    await storage.createDispatchEvent({ userId, date: day(60), kind: "DISPATCHED", employer: "Access Limited", note: "Name request" });

    await storage.createCertification({ userId, name: "OSHA 10", issuingBody: "OSHA", issueDate: day(400) });
    await storage.createCertification({ userId, name: "First Aid / CPR", issuingBody: "American Red Cross", issueDate: day(690), expiryDate: day(-40) });
    await storage.createCertification({ userId, name: "Traffic Control / Flagging", issuingBody: "Laborers Training School", issueDate: day(300), expiryDate: day(-795) });

    console.log(`Demo user ready: ${DEMO_EMAIL}`);
  } catch (error) {
    console.error("Error setting up demo user:", error);
  }
}
