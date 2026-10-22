import { describe, it, expect } from "vitest";
import {
  addMonths,
  apprenticeStatus,
  DEFAULT_UNION_PROFILE,
  fundCrossCheck,
  healthMonths,
  healthStatus,
  listStatus,
  monthKey,
  reminders,
  type WorkEntry,
} from "@shared/union";

const job = (date: string, hours: number, extra: Record<string, string> = {}): WorkEntry => ({
  date: `${date}T00:00:00.000Z`,
  method: "ON_THE_JOB",
  hours,
  details: { employer: "Access Limited", union: "Union", ...extra },
});
const months = (hours: Record<string, number>) =>
  Object.entries(hours).map(([month, h]) => ({ month, hours: h, nonUnion: false }));

describe("months", () => {
  it("reads stored calendar dates in UTC", () => {
    expect(monthKey(new Date("2026-03-01T00:00:00.000Z"))).toBe("2026-03");
    expect(monthKey("2026-03-01T00:00:00.000Z")).toBe("2026-03");
  });
  it("adds across year ends", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});

describe("healthMonths", () => {
  it("sums union on-the-job hours and flags non-union months, ignoring class hours", () => {
    const rows = healthMonths([
      job("2026-01-05", 10),
      job("2026-01-06", 8),
      { date: "2026-01-07T00:00:00.000Z", method: "CLASSROOM", hours: 8 },
      job("2026-02-02", 9, { union: "Non-union" }),
    ]);
    expect(rows).toEqual([
      { month: "2026-01", hours: 18, nonUnion: false },
      { month: "2026-02", hours: 0, nonUnion: true },
    ]);
  });
});

describe("healthStatus", () => {
  it("qualifies with 300 hrs in 3 months and covers the 5th month (packet example)", () => {
    const s = healthStatus(months({ "2026-01": 100, "2026-02": 100, "2026-03": 100 }), "2026-03");
    const mar = s.rows.find((r) => r.month === "2026-03")!;
    expect(mar.covers).toBe("2026-05");
    expect(s.qualifying).toBeNull();
    expect(s.bank).toBe(200);
    // 300 hrs buys at least 3 months: May, then June and July from the bank.
    expect(s.earnedThrough).toBe("2026-05");
    expect(s.projectedThrough).toBe("2026-07");
  });

  it("qualifies a month earlier when 300 hrs land in 2 months", () => {
    const s = healthStatus(months({ "2026-01": 150, "2026-02": 150 }), "2026-02");
    expect(s.rows[1].covers).toBe("2026-04");
  });

  it("does not qualify on 300 hrs spread over 4 months", () => {
    const s = healthStatus(months({ "2026-01": 75, "2026-02": 75, "2026-03": 75, "2026-04": 75 }), "2026-04");
    expect(s.qualifying).toEqual({ windowStart: "2026-02", hours: 225, needed: 75 });
    expect(s.earnedThrough).toBeNull();
  });

  it("caps the bank at 400 and deducts 100 a month", () => {
    const s = healthStatus(months({ "2026-01": 300, "2026-02": 200, "2026-03": 200 }), "2026-03");
    // Jan: min(400,300)-100 = 200. Feb: min(400,400)-100 = 300. Mar: min(400,500)-100 = 300.
    expect(s.rows.map((r) => r.bankAfter)).toEqual([200, 300, 300]);
    expect(s.earnedThrough).toBe("2026-05");
    expect(s.projectedThrough).toBe("2026-08");
  });

  it("lapses when the bank runs dry and makes the member re-qualify", () => {
    const s = healthStatus(months({ "2026-01": 300 }), "2026-06");
    // Jan → Mar, Feb → Apr (100 left), Mar → May (0 left), Apr: lapses.
    expect(s.rows.filter((r) => r.covers).map((r) => r.covers)).toEqual(["2026-03", "2026-04", "2026-05"]);
    expect(s.qualifying).not.toBeNull();
    expect(s.coveredNow).toBe(false);
  });

  it("zeroes the bank on non-union work in the jurisdiction", () => {
    const s = healthStatus(
      [...months({ "2026-01": 300, "2026-02": 100 }), { month: "2026-03", hours: 0, nonUnion: true }],
      "2026-03",
    );
    expect(s.bank).toBe(0);
    expect(s.qualifying).not.toBeNull();
    expect(s.warnings[0]).toMatch(/Non-union work/);
  });

  it("marks the current and previous month as not yet reported", () => {
    const s = healthStatus(months({ "2026-08": 100, "2026-09": 100, "2026-10": 100 }), "2026-10");
    expect(s.rows.map((r) => r.pendingReport)).toEqual([false, true, true]);
  });

  it("starts covered from a carried-over bank", () => {
    const s = healthStatus([], "2026-10", { startingBank: 250 });
    expect(s.rows[0].covers).toBe("2026-12");
    expect(s.bank).toBe(150);
  });
});

describe("apprenticeStatus", () => {
  const cls = (hours: number): WorkEntry => ({ date: "2026-01-01", method: "CLASSROOM", hours });

  it("needs both OJT and class hours to move up a period", () => {
    const s = apprenticeStatus([job("2026-01-01", 700)], { rsi: 40 });
    expect(s.period).toBe(1);
    expect(s.next).toMatchObject({ period: 2, ojtNeeded: 0, rsiNeeded: 10 });
    expect(apprenticeStatus([job("2026-01-01", 700), cls(10)], { rsi: 40 }).period).toBe(2);
  });

  it("counts prior hours and reaches journeyperson at 4,000 + 304", () => {
    const s = apprenticeStatus([cls(4)], { ojt: 4000, rsi: 300 });
    expect(s.journeyperson).toBe(true);
    expect(s.next).toBeNull();
  });

  it("reports the remaining hours to journeyperson from period 6", () => {
    const s = apprenticeStatus([], { ojt: 3500, rsi: 260 });
    expect(s.period).toBe(6);
    expect(s.wage).toBe(44.37);
    expect(s.next).toEqual({ period: 7, ojtNeeded: 500, rsiNeeded: 44, wage: null });
  });
});

describe("listStatus", () => {
  const today = new Date(2026, 9, 22);

  it("counts down 30 days from the last sign-in", () => {
    const s = listStatus([{ date: "2026-10-01T00:00:00.000Z", kind: "REGISTERED" }], today);
    expect(s.state).toBe("ON_LIST");
    expect(s.daysLeft).toBe(9);
  });

  it("restarts the clock on re-registration and stops it on dispatch", () => {
    const s = listStatus(
      [
        { date: "2026-09-01T00:00:00.000Z", kind: "REGISTERED" },
        { date: "2026-10-20T00:00:00.000Z", kind: "RE_REGISTERED" },
      ],
      today,
    );
    expect(s.daysLeft).toBe(28);
    expect(s.since).toEqual(new Date(2026, 8, 1));
    const working = listStatus(
      [
        { date: "2026-09-01T00:00:00.000Z", kind: "REGISTERED" },
        { date: "2026-10-05T00:00:00.000Z", kind: "DISPATCHED", employer: "Granite" },
      ],
      today,
    );
    expect(working).toMatchObject({ state: "WORKING", employer: "Granite", daysLeft: null });
  });

  it("goes negative when re-registration is overdue", () => {
    expect(listStatus([{ date: "2026-09-01T00:00:00.000Z", kind: "REGISTERED" }], today).daysLeft).toBe(-21);
  });
});

describe("fundCrossCheck", () => {
  const entries = [job("2026-06-02", 10), job("2026-06-03", 10), job("2026-07-01", 8), job("2026-07-02", 8, { union: "Non-union" })];

  it("compares logged and reported hours per month and employer", () => {
    const rows = fundCrossCheck(entries, [{ month: "2026-06", employer: " access  limited", hours: 12 }], "2026-10");
    expect(rows).toEqual([
      { month: "2026-07", employer: "Access Limited", logged: 8, reported: null, diff: null, status: "NOT_CHECKED" },
      { month: "2026-06", employer: "Access Limited", logged: 20, reported: 12, diff: -8, status: "SHORT" },
    ]);
  });

  it("treats the two most recent months as pending, not missing", () => {
    const rows = fundCrossCheck([job("2026-09-10", 8)], [], "2026-10");
    expect(rows[0].status).toBe("PENDING");
  });
});

describe("reminders", () => {
  const base = {
    today: new Date(2026, 9, 22),
    profile: { ...DEFAULT_UNION_PROFILE, duesPaidThrough: "2026-10" },
    health: healthStatus([], "2026-10"),
    list: listStatus([], new Date(2026, 9, 22)),
    certs: [],
    crossCheck: [],
    unverifiedOld: 0,
  };

  it("is quiet when nothing is due", () => {
    expect(reminders(base)).toEqual([]);
  });

  it("puts urgent items first", () => {
    const r = reminders({
      ...base,
      profile: { ...base.profile, duesPaidThrough: "2026-09" },
      certs: [{ id: 1, name: "First Aid / CPR", expiryDate: "2026-10-01T00:00:00.000Z" }],
      unverifiedOld: 2,
    });
    expect(r.map((x) => x.id)).toEqual(["cert-1", "dues", "unsigned"]);
    expect(r[0].level).toBe("urgent");
  });

  it("warns a week before re-registration is due", () => {
    const list = listStatus([{ date: "2026-09-27T00:00:00.000Z", kind: "REGISTERED" }], base.today);
    expect(reminders({ ...base, list })[0]).toMatchObject({ id: "rereg", level: "soon" });
  });
});
