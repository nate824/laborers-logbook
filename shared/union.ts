// Union-side rules for the Laborers Logbook: health-plan eligibility and hour
// bank, apprenticeship periods, the out-of-work list, the fund cross-check and
// the reminders shown on the Status page.
//
// Every number here comes from public documents (see union play/RESEARCH.md)
// and several are UNVERIFIED as current — the 2013 Health & Welfare SPD, the
// CCL apprenticeship page, Local 220's packet. They live in UNION_RULES so a
// confirmed number is a one-line change. The app presents all of this as the
// member's own estimate, never as the trust fund's or the JAC's official record.

export const UNION_RULES = {
  health: {
    initialHours: 300, // hours needed to first qualify…
    windowMonths: 3, // …within this many consecutive months
    lagMonths: 1, // employer reports a month late, so work month M covers M + lag + 1
    monthlyDeduction: 100, // hours taken from the bank for each month of coverage
    bankCap: 400, // bank maximum, including the current month
  },
  outOfWork: { reRegisterDays: 30 },
  dues: { monthly: 49, dueDay: 1 },
  apprentice: {
    // Construction Craft Laborer: OJT hours to START each period, RSI (class)
    // hours to start each period, hourly wage in the period (2026 rates).
    periods: [
      { period: 1, ojtStart: 0, rsiStart: 0, wage: 26.1 },
      { period: 2, ojtStart: 601, rsiStart: 50, wage: 28.71 },
      { period: 3, ojtStart: 1201, rsiStart: 100, wage: 31.32 },
      { period: 4, ojtStart: 1901, rsiStart: 150, wage: 36.54 },
      { period: 5, ojtStart: 2601, rsiStart: 200, wage: 41.76 },
      { period: 6, ojtStart: 3301, rsiStart: 250, wage: 44.37 },
    ],
    journeyOjt: 4000,
    journeyRsi: 304,
    coordinatorCheckIn: { fromDay: 11, toDay: 20 },
  },
  certWarningDays: 60,
} as const;

export type HealthRules = typeof UNION_RULES.health;

// ---------------------------------------------------------------- months ----
// Months are "YYYY-MM" strings: sortable, timezone-free, and what members see
// on a fund statement.

export type MonthKey = string;

// Month of a stored calendar date (UTC midnight of the picked day, see
// shared/dates.ts), so read it in UTC or the 1st lands in the previous month
// west of Greenwich.
export function monthKey(d: Date | string): MonthKey {
  if (typeof d === "string" && /^\d{4}-\d{2}/.test(d)) return d.slice(0, 7);
  const date = new Date(d);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Month of a real local moment, e.g. today.
export function localMonthKey(d: Date): MonthKey {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function addMonths(m: MonthKey, n: number): MonthKey {
  const [y, mo] = m.split("-").map(Number);
  const idx = y * 12 + (mo - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function monthLabel(m: MonthKey): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// ------------------------------------------------------- work hours input ----

// The two kinds of row in the Work Hours log (FieldMethods in schema.ts).
export const ON_THE_JOB = "ON_THE_JOB";
export const CLASSROOM = "CLASSROOM";

// Minimal entry shape the rules need — Entry rows from the API satisfy it.
export type WorkEntry = {
  date: Date | string;
  method: string;
  hours: number;
  verified?: boolean | null;
  details?: Record<string, string> | null;
};

export function isNonUnion(e: WorkEntry): boolean {
  return e.details?.union === "Non-union";
}

export type MonthHours = { month: MonthKey; hours: number; nonUnion: boolean };

// Union on-the-job hours per month, plus whether any non-union work happened
// that month (which zeroes the hour bank). Class hours don't count: no
// employer contributions are paid on them.
export function healthMonths(entries: WorkEntry[]): MonthHours[] {
  const map = new Map<MonthKey, MonthHours>();
  for (const e of entries) {
    if (e.method !== ON_THE_JOB) continue;
    const m = monthKey(e.date);
    const row = map.get(m) ?? { month: m, hours: 0, nonUnion: false };
    if (isNonUnion(e)) row.nonUnion = true;
    else row.hours += e.hours;
    map.set(m, row);
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}

// ------------------------------------------------------------ health plan ----

export type HealthRow = {
  month: MonthKey; // work month
  hours: number; // union hours worked that month
  nonUnion: boolean;
  bankAfter: number; // bank balance after this month's credit and deduction
  covers: MonthKey | null; // coverage month these hours paid for
  pendingReport: boolean; // employer probably hasn't reported this month yet
  note?: string;
};

export type HealthStatus = {
  rows: HealthRow[];
  coveredNow: boolean;
  // Last month of coverage already earned by reported (or logged) hours.
  earnedThrough: MonthKey | null;
  // earnedThrough plus what the remaining bank would buy with no more work.
  projectedThrough: MonthKey | null;
  bank: number;
  qualifying: null | {
    windowStart: MonthKey;
    hours: number; // hours in the current window (up to windowMonths months)
    needed: number; // hours still needed to qualify
  };
  warnings: string[];
};

export function healthStatus(
  months: MonthHours[],
  asOf: MonthKey,
  opts: { startingBank?: number; rules?: HealthRules } = {},
): HealthStatus {
  const rules = opts.rules ?? UNION_RULES.health;
  const coverLag = rules.lagMonths + 1;
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const first = months.length ? months[0].month : asOf;

  const rows: HealthRow[] = [];
  const warnings: string[] = [];
  const covered = new Set<MonthKey>();
  let bank = Math.min(rules.bankCap, opts.startingBank ?? 0);
  let inCoverage = bank >= rules.monthlyDeduction;
  let window: { month: MonthKey; hours: number }[] = [];

  const tryQualify = (row: HealthRow) => {
    window.push({ month: row.month, hours: row.hours });
    if (window.length > rules.windowMonths) window.shift();
    const sum = window.reduce((s, w) => s + w.hours, 0);
    if (sum >= rules.initialHours) {
      inCoverage = true;
      bank = Math.min(rules.bankCap, sum) - rules.monthlyDeduction;
      row.covers = addMonths(row.month, coverLag);
      row.note = `Qualified: ${sum} hrs in ${window.length} month${window.length > 1 ? "s" : ""}`;
      window = [];
    }
  };

  for (const m of monthsBetween(first <= asOf ? first : asOf, asOf)) {
    const src = byMonth.get(m);
    const row: HealthRow = {
      month: m,
      hours: src?.hours ?? 0,
      nonUnion: src?.nonUnion ?? false,
      bankAfter: 0,
      covers: null,
      // The fund sees a month's hours only after the employer's report, due
      // the following month: the current and previous month are still pending.
      pendingReport: m > addMonths(asOf, -2),
    };

    if (row.nonUnion) {
      if (bank > 0 || inCoverage) {
        warnings.push(`Non-union work in ${monthLabel(m)} zeroes the hour bank.`);
        row.note = "Non-union work: bank reset to 0";
      }
      bank = 0;
      inCoverage = false;
      window = [];
    }

    if (inCoverage) {
      bank = Math.min(rules.bankCap, bank + row.hours);
      if (bank >= rules.monthlyDeduction) {
        bank -= rules.monthlyDeduction;
        row.covers = addMonths(m, coverLag);
      } else {
        row.note = "Bank under 100 hrs: coverage lapses, re-qualify";
        bank = 0;
        inCoverage = false;
        tryQualify(row);
      }
    } else {
      tryQualify(row);
    }

    row.bankAfter = bank;
    if (row.covers) covered.add(row.covers);
    rows.push(row);
  }

  const earnedThrough = rows.reduce<MonthKey | null>((max, r) => (r.covers && (!max || r.covers > max) ? r.covers : max), null);
  const extraMonths = inCoverage ? Math.floor(bank / rules.monthlyDeduction) : 0;
  const projectedThrough = earnedThrough ? addMonths(earnedThrough, extraMonths) : null;

  return {
    rows,
    coveredNow: covered.has(asOf),
    earnedThrough,
    projectedThrough,
    bank,
    qualifying: inCoverage
      ? null
      : {
          windowStart: window[0]?.month ?? asOf,
          hours: window.reduce((s, w) => s + w.hours, 0),
          needed: Math.max(0, rules.initialHours - window.reduce((s, w) => s + w.hours, 0)),
        },
    warnings,
  };
}

// --------------------------------------------------------- apprenticeship ----

export type ApprenticeStatus = {
  ojt: number;
  rsi: number;
  period: number; // 1–6, or 7 = journeyperson
  journeyperson: boolean;
  wage: number | null;
  next: null | { period: number; ojtNeeded: number; rsiNeeded: number; wage: number | null };
  ojtPct: number; // progress toward journeyperson
  rsiPct: number;
};

export function apprenticeStatus(
  entries: WorkEntry[],
  prior: { ojt?: number; rsi?: number } = {},
): ApprenticeStatus {
  const cfg = UNION_RULES.apprentice;
  let ojt = prior.ojt ?? 0;
  let rsi = prior.rsi ?? 0;
  for (const e of entries) {
    if (e.method === ON_THE_JOB) ojt += e.hours;
    else if (e.method === CLASSROOM) rsi += e.hours;
  }
  // Advancing needs BOTH the OJT and the class hours for the period.
  let period = 1;
  for (const p of cfg.periods) if (ojt >= p.ojtStart && rsi >= p.rsiStart) period = p.period;
  const journeyperson = ojt >= cfg.journeyOjt && rsi >= cfg.journeyRsi;
  if (journeyperson) period = cfg.periods.length + 1;

  const nextP = cfg.periods.find((p) => p.period === period + 1);
  const next = journeyperson
    ? null
    : nextP
      ? { period: nextP.period, ojtNeeded: Math.max(0, nextP.ojtStart - ojt), rsiNeeded: Math.max(0, nextP.rsiStart - rsi), wage: nextP.wage }
      : { period: period + 1, ojtNeeded: Math.max(0, cfg.journeyOjt - ojt), rsiNeeded: Math.max(0, cfg.journeyRsi - rsi), wage: null };

  return {
    ojt,
    rsi,
    period,
    journeyperson,
    wage: journeyperson ? null : (cfg.periods.find((p) => p.period === period)?.wage ?? null),
    next,
    ojtPct: Math.min(100, (ojt / cfg.journeyOjt) * 100),
    rsiPct: Math.min(100, (rsi / cfg.journeyRsi) * 100),
  };
}

// ---------------------------------------------------- out-of-work list ----

export const DISPATCH_KINDS = {
  REGISTERED: "Signed the out-of-work list",
  RE_REGISTERED: "Re-registered",
  DISPATCHED: "Dispatched to a job",
  LAID_OFF: "Laid off / job ended",
  REFUSED: "Refused a dispatch",
} as const;

export type DispatchKind = keyof typeof DISPATCH_KINDS;

export type DispatchEventLike = { date: Date | string; kind: string; employer?: string | null };

export type ListStatus = {
  state: "ON_LIST" | "WORKING" | "OFF_LIST";
  since: Date | null;
  reRegisterBy: Date | null; // only while on the list
  daysLeft: number | null; // negative = overdue
  employer: string | null;
};

export function listStatus(
  events: DispatchEventLike[],
  today: Date,
  reRegisterDays: number = UNION_RULES.outOfWork.reRegisterDays,
): ListStatus {
  const sorted = [...events].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let state: ListStatus["state"] = "OFF_LIST";
  let since: Date | null = null;
  let lastSignIn: Date | null = null;
  let employer: string | null = null;
  for (const e of sorted) {
    const d = calendarDay(e.date);
    if (e.kind === "REGISTERED" || e.kind === "RE_REGISTERED") {
      if (state !== "ON_LIST") since = d;
      state = "ON_LIST";
      lastSignIn = d;
      employer = null;
    } else if (e.kind === "DISPATCHED") {
      state = "WORKING";
      since = d;
      employer = e.employer ?? null;
      lastSignIn = null;
    } else if (e.kind === "LAID_OFF") {
      state = "OFF_LIST";
      since = d;
      employer = null;
      lastSignIn = null;
    }
    // REFUSED is history only; whether it drops you off the list is a hall rule.
  }
  if (state !== "ON_LIST" || !lastSignIn) return { state, since, reRegisterBy: null, daysLeft: null, employer };
  const due = new Date(lastSignIn);
  due.setDate(due.getDate() + reRegisterDays);
  return { state, since, reRegisterBy: due, daysLeft: daysUntil(due, today), employer };
}

// A stored calendar date (UTC midnight) as local midnight of the same day, so
// day counts against a local "today" aren't off by one west of Greenwich.
export function calendarDay(d: Date | string): Date {
  const u = new Date(d);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function daysUntil(target: Date, today: Date): number {
  return Math.round((startOfDay(target).getTime() - startOfDay(today).getTime()) / 86_400_000);
}

// --------------------------------------------------- fund cross-check ----

// What the member copied from the trust fund's portal or statement.
export type FundReportLike = { month: MonthKey; employer: string; hours: number };

export type CrossCheckRow = {
  month: MonthKey;
  employer: string;
  logged: number;
  reported: number | null;
  diff: number | null; // reported − logged
  status: "MATCH" | "SHORT" | "OVER" | "NOT_CHECKED" | "PENDING";
};

const employerKey = (s: string | undefined | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function fundCrossCheck(entries: WorkEntry[], reports: FundReportLike[], asOf: MonthKey, tolerance = 0.5): CrossCheckRow[] {
  const rows = new Map<string, CrossCheckRow>();
  const get = (month: MonthKey, employer: string) => {
    const k = `${month}|${employerKey(employer)}`;
    let row = rows.get(k);
    if (!row) {
      row = { month, employer: employer.trim() || "(no employer)", logged: 0, reported: null, diff: null, status: "NOT_CHECKED" };
      rows.set(k, row);
    }
    return row;
  };
  for (const e of entries) {
    if (e.method !== ON_THE_JOB || isNonUnion(e)) continue;
    get(monthKey(e.date), e.details?.employer ?? "").logged += e.hours;
  }
  for (const r of reports) {
    const row = get(r.month, r.employer);
    row.reported = (row.reported ?? 0) + r.hours;
  }
  const pendingAfter = addMonths(asOf, -2);
  for (const row of Array.from(rows.values())) {
    if (row.reported === null) {
      row.status = row.month > pendingAfter ? "PENDING" : "NOT_CHECKED";
      continue;
    }
    row.diff = row.reported - row.logged;
    row.status = Math.abs(row.diff) <= tolerance ? "MATCH" : row.diff < 0 ? "SHORT" : "OVER";
  }
  return Array.from(rows.values()).sort((a, b) => b.month.localeCompare(a.month) || a.employer.localeCompare(b.employer));
}

// ------------------------------------------------------------- profile ----

export const CLASSIFICATIONS = {
  TEMP_JOURNEYMAN: "Temporary journeyman",
  JOURNEYMAN: "Journeyman",
  APPRENTICE: "Apprentice",
} as const;

export type Classification = keyof typeof CLASSIFICATIONS;

export type UnionProfile = {
  classification: Classification;
  localNumber: string;
  priorOjtHours: number; // apprentice hours logged before using the app
  priorRsiHours: number;
  startingBank: number; // health hour bank when tracking started
  duesPaidThrough: MonthKey | null;
};

export const DEFAULT_UNION_PROFILE: UnionProfile = {
  classification: "TEMP_JOURNEYMAN",
  localNumber: "220",
  priorOjtHours: 0,
  priorRsiHours: 0,
  startingBank: 0,
  duesPaidThrough: null,
};

// ----------------------------------------------------------- reminders ----

export type Reminder = {
  id: string;
  level: "urgent" | "soon" | "info";
  title: string;
  detail?: string;
  href?: string;
};

export type CertLike = { id: number; name: string; expiryDate: Date | string | null };

export function reminders(input: {
  today: Date;
  profile: UnionProfile;
  health: HealthStatus;
  list: ListStatus;
  certs: CertLike[];
  crossCheck: CrossCheckRow[];
  unverifiedOld: number; // work rows still unsigned after 14 days
}): Reminder[] {
  const { today, profile, health, list, certs, crossCheck } = input;
  const out: Reminder[] = [];
  const thisMonth = localMonthKey(today);
  const day = today.getDate();

  if (list.state === "ON_LIST" && list.daysLeft !== null && list.reRegisterBy) {
    const when = list.reRegisterBy.toLocaleDateString("en-US");
    if (list.daysLeft < 0) out.push({ id: "rereg", level: "urgent", title: "Re-register on the out-of-work list", detail: `It was due ${when}. Check with the hall that you're still on it.`, href: "/list" });
    else if (list.daysLeft <= 7) out.push({ id: "rereg", level: list.daysLeft <= 2 ? "urgent" : "soon", title: `Re-register on the out-of-work list in ${list.daysLeft} day${list.daysLeft === 1 ? "" : "s"}`, detail: `Due ${when}.`, href: "/list" });
  }

  if (!profile.duesPaidThrough || profile.duesPaidThrough < thisMonth) {
    out.push({
      id: "dues",
      level: profile.duesPaidThrough && profile.duesPaidThrough < addMonths(thisMonth, -1) ? "urgent" : "soon",
      title: `Dues: ${"$" + UNION_RULES.dues.monthly} for ${monthLabel(thisMonth)}`,
      detail: profile.duesPaidThrough ? `Paid through ${monthLabel(profile.duesPaidThrough)}. Pay in MTPweb, then update it here.` : "Set the month you're paid through in My union info.",
      href: "/status#profile",
    });
  }

  for (const c of certs) {
    if (!c.expiryDate) continue;
    const left = daysUntil(calendarDay(c.expiryDate), today);
    if (left < 0) out.push({ id: `cert-${c.id}`, level: "urgent", title: `${c.name} expired`, detail: `Expired ${calendarDay(c.expiryDate).toLocaleDateString("en-US")}. Contractors can require it for dispatch.`, href: "/certs" });
    else if (left <= UNION_RULES.certWarningDays) out.push({ id: `cert-${c.id}`, level: left <= 14 ? "urgent" : "soon", title: `${c.name} expires in ${left} day${left === 1 ? "" : "s"}`, href: "/certs" });
  }

  if (health.projectedThrough && !health.qualifying) {
    const monthsLeft = monthsBetween(thisMonth, health.projectedThrough).length - 1;
    if (monthsLeft <= 1) out.push({ id: "bank", level: "urgent", title: "Health coverage is about to run out", detail: `Your logged hours cover you through ${monthLabel(health.projectedThrough)}.`, href: "/benefits" });
  }
  for (const w of health.warnings) out.push({ id: `hw-${w}`, level: "soon", title: w, href: "/benefits" });

  const short = crossCheck.filter((r) => r.status === "SHORT");
  if (short.length) out.push({ id: "short", level: "urgent", title: `Fund shows fewer hours than you logged (${short.length} month${short.length > 1 ? "s" : ""})`, detail: "Call the Trust Fund Office or the hall with your signed hours.", href: "/benefits" });
  const unchecked = crossCheck.filter((r) => r.status === "NOT_CHECKED").length;
  if (unchecked) out.push({ id: "check", level: "info", title: `Check ${unchecked} month${unchecked > 1 ? "s" : ""} of hours against the fund portal`, href: "/benefits" });

  if (input.unverifiedOld) out.push({ id: "unsigned", level: "info", title: `${input.unverifiedOld} work day${input.unverifiedOld > 1 ? "s" : ""} still need a foreman's sign-off`, href: "/hours" });

  if (profile.classification === "APPRENTICE") {
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    if (day >= lastDay - 4 || day === 1) out.push({ id: "wp", level: "soon", title: "Send your monthly Work Processes report", detail: "Due to the JAC by the 1st.", href: "/hours" });
    const ci = UNION_RULES.apprentice.coordinatorCheckIn;
    if (day >= ci.fromDay && day <= ci.toDay) out.push({ id: "coord", level: "info", title: "Check in with your apprenticeship coordinator", detail: `Between the ${ci.fromDay}th and ${ci.toDay}th.` });
  }

  const order = { urgent: 0, soon: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// -------------------------------------------------------- cert presets ----
// Common laborer credentials (Laborers Training School catalog). Renewal
// intervals are typical regulatory ones, NOT confirmed for LTS — the member
// should copy the real expiry date from the card.
export const CERT_PRESETS: { name: string; renewMonths: number | null }[] = [
  { name: "OSHA 10", renewMonths: null },
  { name: "OSHA 30", renewMonths: null },
  { name: "First Aid / CPR", renewMonths: 24 },
  { name: "HAZWOPER 40-hr (8-hr refresher)", renewMonths: 12 },
  { name: "Confined Space", renewMonths: 12 },
  { name: "Traffic Control / Flagging", renewMonths: 36 },
  { name: "Forklift", renewMonths: 36 },
  { name: "Scaffold", renewMonths: 36 },
  { name: "Fall Protection", renewMonths: 12 },
  { name: "Asbestos Worker", renewMonths: 12 },
  { name: "Lead Worker (CDPH)", renewMonths: 12 },
  { name: "Silica", renewMonths: null },
];
