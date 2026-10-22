import { describe, it, expect } from "vitest";
import { paginateRows, buildLogSheet } from "@/lib/logSheet";
import { fieldHoursSpec, fieldHoursExports, lastRopeCertDate, ropeHoursExports, ropeHoursSpec } from "@/lib/exportSheets";
import type { Entry, RopeHours, Supervisor } from "@shared/schema";

const user = { name: "Sam Tech", email: "sam@acl.test", employeeNumber: "E-42" };

function entry(id: number, method: string, verified: boolean, date = `2026-10-${String(id).padStart(2, "0")}`): Entry {
  return {
    id, userId: 1, date: new Date(date), location: `Site ${id}`, method, hours: 8 + (id % 3),
    verified, verifiedBy: verified ? "Riley Super" : null, verifiedAt: verified ? new Date("2026-10-20T15:00:00Z") : null,
  } as unknown as Entry;
}

function rope(id: number, verified: boolean, extra: Partial<RopeHours> = {}): RopeHours {
  return {
    id, userId: 1, startDate: new Date(`2026-09-${String(id).padStart(2, "0")}`),
    endDate: new Date(`2026-09-${String(id).padStart(2, "0")}`), location: "Glenwood", skills: "Rescue, rope transfer",
    hours: 6, employer: "Access Limited", workDetails: "Rockfall mesh install", maxHeight: "40m",
    verified, verifiedBy: verified ? "Dana Foreman" : null, verifiedAt: verified ? new Date("2026-09-30") : null,
    ...extra,
  } as unknown as RopeHours;
}

describe("paginateRows", () => {
  it("fills pages greedily and never leaves a row behind", () => {
    const pages = paginateRows([10, 10, 10, 10, 10], 25);
    expect(pages).toEqual([[0, 1], [2, 3], [4]]);
  });
  it("puts an oversized row on its own page", () => {
    expect(paginateRows([5, 100, 5], 50)).toEqual([[0], [1], [2]]);
  });
});

describe("field hours sheets", () => {
  const job = (id: number, verified: boolean, details: Record<string, string> = {}) =>
    ({ ...entry(id, "ON_THE_JOB", verified), details: { employer: "Granite", union: "Union", ...details } }) as Entry;
  const entries = [job(3, true), job(1, true, { overtime: "2" }), job(2, false), entry(4, "CLASSROOM", true)];

  it("work hours use the Work Hours Log columns, oldest first, verified only", () => {
    const spec = fieldHoursSpec(entries, "ON_THE_JOB", user);
    expect(spec.title).toBe("Work Hours Log");
    expect(spec.columns.map((c) => c.header)).toEqual([
      "Date", "Employer", "Union /\nNon-union", "Job #\nCounty", "Work Process", "Hours", "OT / DT", "Foreman Signature",
    ]);
    expect(spec.rows).toHaveLength(2);
    expect(spec.rows[0].slice(1, 3)).toEqual(["Granite", "Union"]);
    expect(spec.rows[0][6]).toBe("2 / 0");
    expect(spec.rows[0][7]).toMatch(/^Riley Super\nVerified /);
    expect(spec.totals.map((t) => t.label)).toEqual(["Hours", "OT"]);
    expect(() => buildLogSheet(spec)).not.toThrow();
  });

  it("class hours use the Class / Training Log", () => {
    const cls = { ...entry(4, "CLASSROOM", true), details: { course: "OSHA 30", school: "LTS Bakersfield" } } as Entry;
    const spec = fieldHoursSpec([cls], "CLASSROOM", user);
    expect(spec.title).toBe("Class / Training Log");
    expect(spec.rows[0].slice(1, 3)).toEqual(["OSHA 30", "LTS Bakersfield"]);
  });

  it("makes one file per kind and counts only verified hours", () => {
    const files = fieldHoursExports(entries, user, ["ON_THE_JOB", "CLASSROOM"]);
    expect(files.map((f) => [f.key, f.count])).toEqual([["ON_THE_JOB", 2], ["CLASSROOM", 1]]);
    expect(files[0].fileName).toMatch(/^Laborers_Work_Hours_Log_Sam_Tech_\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("falls back to a simple daily sheet for an unknown kind", () => {
    const spec = fieldHoursSpec([entry(1, "OTHER", true)], "OTHER", user);
    expect(spec.columns.map((c) => c.header)).toEqual(["Date", "Job #", "Location", "Hours Worked", "Supervisor Signature"]);
  });

  it("labels imported rows with the signed paper log", () => {
    const imported = { ...job(5, true), importedAt: new Date(), sourceDocumentName: "log.pdf" } as Entry;
    expect(fieldHoursSpec([imported], "ON_THE_JOB", user).rows[0][7]).toBe("Signed paper log: log.pdf");
  });
});

describe("rope sheets", () => {
  const supervisors = [{ name: "Dana Foreman", spratNumber: "S-1234", irataNumber: "I-99" } as Supervisor];
  const ropes = [rope(2, true, { projectNumber: "P-17", workCode: "RA2" }), rope(1, true), rope(3, false)];

  it("ACL style matches the logbook's Work Log - Rope Hours page", () => {
    const spec = ropeHoursSpec(ropes, "acl", user, supervisors, new Date("2026-09-02"));
    expect(spec.title).toBe("Work Log - Rope Hours");
    expect(spec.columns.map((c) => c.header)).toEqual([
      "Date(s) of Work", "Project Number", "Work Code", "Work Details", "Supervisor Signature &\nLog Line", "Hours Worked",
    ]);
    expect(spec.rows[1].slice(1, 4)).toEqual(["P-17", "RA2", "Rockfall mesh install — Rescue, rope transfer"]);
    expect(spec.rows[0][4]).toMatch(/^Dana Foreman #S-1234/);
    // Only the 9/2 entry is on or after the last certification.
    expect(spec.summary).toEqual({ label: "Total Work Hours Since Previous Certification", value: "6" });
  });

  it("leaves the since-certification box blank without a rope cert", () => {
    expect(ropeHoursSpec(ropes, "acl", user, supervisors).summary?.value).toBe("");
    expect(lastRopeCertDate([
      { name: "First Aid", method: null, issuingBody: "Red Cross", issueDate: new Date("2026-01-01") },
      { name: "Level 2", method: null, issuingBody: "SPRAT", issueDate: new Date("2025-05-01") },
    ])).toEqual(new Date("2025-05-01"));
  });

  it("SPRAT style uses SPRAT columns and the signer's SPRAT number", () => {
    const spec = ropeHoursSpec(ropes, "sprat", user, supervisors);
    expect(spec.columns.map((c) => c.header)).toEqual([
      "Date(s) of Work", "Employer", "Work Details", "Rope Access Details", "Signature and Log #", "Hours Worked",
    ]);
    expect(spec.rows).toHaveLength(2);
    expect(spec.rows[0][4]).toMatch(/^Dana Foreman #S-1234/);
  });

  it("IRATA style uses IRATA columns and number", () => {
    const spec = ropeHoursSpec(ropes, "irata", user, supervisors);
    expect(spec.columns).toHaveLength(7);
    expect(spec.rows[0][6]).toMatch(/^Dana Foreman #I-99/);
    expect(spec.rows[0][5]).toBe("40m");
  });

  it("offers the ACL work log first", () => {
    expect(ropeHoursExports(ropes, user, supervisors).map((f) => f.key)).toEqual(["acl", "sprat", "irata"]);
  });
});

describe("buildLogSheet", () => {
  it("renders exactly the logged rows across pages, with page and running totals", () => {
    const many = Array.from({ length: 30 }, (_, i) => entry(i + 1, "OTHER", true, `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, "0")}`));
    const spec = fieldHoursSpec(many, "OTHER", user);
    const doc = buildLogSheet(spec);
    const pages = doc.getNumberOfPages();
    expect(pages).toBeGreaterThan(1);
    const total = spec.totals[0].values.reduce((a, b) => a + b, 0);
    // Every location appears once; nothing else pads the table.
    const text = new TextDecoder("latin1").decode(doc.output("arraybuffer"));
    for (let i = 1; i <= 30; i++) expect(text.split(`(Site ${i})`).length - 1).toBe(1);
    expect(text).toContain("(Running Total)");
    expect(text).toContain(`(${total})`);
    expect(text).toContain(`Page ${pages} of ${pages}`);
  });

  it("refuses an empty sheet", () => {
    expect(() => buildLogSheet({ ...fieldHoursSpec([], "ON_THE_JOB", user) })).toThrow();
  });
});
