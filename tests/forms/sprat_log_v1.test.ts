import { describe, it, expect } from "vitest";
import path from "path";
import { PDFDocument } from "pdf-lib";
import type { RopeHours, Supervisor, User } from "@shared/schema";
import { spratAdapter } from "../../server/forms/adapters/sprat_log_v1";
import { EmptyExportError } from "../../server/forms/types";
import { fillForm, fillFormPages } from "../../server/forms/filler";

function makeProfile(overrides: Partial<User> = {}): User {
  return {
    id: 1, email: "tech@example.com", password: null,
    name: "Jane Tech", employeeNumber: "EMP-001", isAdmin: false,
    resetToken: null, resetTokenExpiry: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  } as User;
}

function makeRope(overrides: Partial<RopeHours>): RopeHours {
  return {
    id: 1, userId: 1,
    startDate: new Date("2026-05-04T00:00:00Z"),
    endDate: new Date("2026-05-04T00:00:00Z"),
    location: "Site A",
    skills: "ascending, rigging",
    hours: 8,
    employer: null, workDetails: null, maxHeight: null,
    verified: false, verifiedBy: null, verificationToken: null, verifiedAt: null,
    createdAt: new Date("2026-05-04T00:00:00Z"),
    technicianSignature: null, supervisorSignature: null, dataHash: null,
    integritySignature: null, verificationRequestedAt: null, auditTrail: null,
    supervisorIpAddress: null, supervisorBrowserInfo: null, employeeIdUsed: null,
    sourceDocumentKey: null, sourceDocumentName: null, importedAt: null,
    ...overrides,
  } as RopeHours;
}

function makeSupervisor(overrides: Partial<Supervisor> = {}): Supervisor {
  return {
    id: 1, userId: 1, name: "Supervisor Sam",
    email: "sam@example.com", phone: "555-0100",
    certificationLevel: null, company: null,
    spratNumber: "SP-12345", irataNumber: "IR-67890", ndtMethod: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  } as Supervisor;
}

const SPRAT_BLANK = path.resolve(
  __dirname, "..", "..", "server", "forms", "blanks", "SPRAT_RopeAccessLog_Fillable.pdf",
);

describe("spratAdapter — core mapping", () => {
  it("writes row fields including the three new schema fields", () => {
    const [out] = spratAdapter({
      ropeHours: [makeRope({
        employer: "Acme Inc",
        workDetails: "Tank inspection",
        skills: "rebelay, ascending",
        hours: 6.5,
      })],
      profile: makeProfile(),
      supervisors: [],
    });
    expect(out.row_1_employer).toBe("Acme Inc");
    expect(out.row_1_work_details).toBe("Tank inspection");
    expect(out.row_1_rope_access_details).toBe("rebelay, ascending");
    expect(out.row_1_hours_worked).toBe("6.5");
  });

  it("formats single-day date as M/D/YYYY", () => {
    const [out] = spratAdapter({
      ropeHours: [makeRope({
        startDate: new Date("2026-05-04T00:00:00Z"),
        endDate: new Date("2026-05-04T00:00:00Z"),
      })],
      profile: makeProfile(),
      supervisors: [],
    });
    expect(out.row_1_date).toBe("5/4/2026");
  });

  it("formats multi-day date as M/D/YYYY - M/D/YYYY", () => {
    const [out] = spratAdapter({
      ropeHours: [makeRope({
        startDate: new Date("2026-05-04T00:00:00Z"),
        endDate: new Date("2026-05-06T00:00:00Z"),
      })],
      profile: makeProfile(),
      supervisors: [],
    });
    expect(out.row_1_date).toBe("5/4/2026 - 5/6/2026");
  });

  it("appends SPRAT number when supervisor lookup succeeds", () => {
    const [out] = spratAdapter({
      ropeHours: [makeRope({ verifiedBy: "Supervisor Sam" })],
      profile: makeProfile(),
      supervisors: [makeSupervisor({ name: "Supervisor Sam", spratNumber: "SP-12345" })],
    });
    expect(out.row_1_signature_logid).toBe("Supervisor Sam #SP-12345");
  });

  it("uses verifiedBy alone when no supervisor matches", () => {
    const [out] = spratAdapter({
      ropeHours: [makeRope({ verifiedBy: "Unknown Sup" })],
      profile: makeProfile(),
      supervisors: [],
    });
    expect(out.row_1_signature_logid).toBe("Unknown Sup");
  });

  it("uses verifiedBy alone when supervisor lacks a SPRAT number", () => {
    const [out] = spratAdapter({
      ropeHours: [makeRope({ verifiedBy: "Supervisor Sam" })],
      profile: makeProfile(),
      supervisors: [makeSupervisor({ name: "Supervisor Sam", spratNumber: null })],
    });
    expect(out.row_1_signature_logid).toBe("Supervisor Sam");
  });

  it("computes hours_this_page as sum of selected rope hours", () => {
    const [out] = spratAdapter({
      ropeHours: [
        makeRope({ id: 1, hours: 4 }),
        makeRope({ id: 2, hours: 6, startDate: new Date("2026-05-05T00:00:00Z"), endDate: new Date("2026-05-05T00:00:00Z") }),
        makeRope({ id: 3, hours: 2.5, startDate: new Date("2026-05-06T00:00:00Z"), endDate: new Date("2026-05-06T00:00:00Z") }),
      ],
      profile: makeProfile(),
      supervisors: [],
    });
    expect(out.hours_this_page).toBe("12.5");
  });

  it("accepts headerOverrides for running_total and total_hours_since_cert", () => {
    const [out] = spratAdapter({
      ropeHours: [makeRope({})],
      profile: makeProfile(),
      supervisors: [],
      headerOverrides: { running_total: "150", total_hours_since_cert: "75" },
    });
    expect(out.running_total).toBe("150");
    expect(out.total_hours_since_cert).toBe("75");
  });
});

describe("spratAdapter — bounds", () => {
  it("throws EmptyExportError on zero rope hours", () => {
    expect(() => spratAdapter({ ropeHours: [], profile: makeProfile(), supervisors: [] }))
      .toThrow(EmptyExportError);
  });

  it("paginates more than 6 rope hours across pages (6 + remainder)", () => {
    const ropeHours = Array.from({ length: 7 }, (_, i) =>
      makeRope({ id: i + 1, startDate: new Date(Date.UTC(2026, 0, 1 + i)), endDate: new Date(Date.UTC(2026, 0, 1 + i)) }));
    const pages = spratAdapter({ ropeHours, profile: makeProfile(), supervisors: [] });
    expect(pages).toHaveLength(2); // 6 + 1
    expect(pages[0].row_6_date).toBeDefined();
    expect(pages[1].row_1_date).toBeDefined();
    expect(pages[1].row_2_date).toBeUndefined();
  });
});

describe("spratAdapter — round-trip through filler", () => {
  it("every field the adapter writes reads back identical", async () => {
    const ropeHours: RopeHours[] = [
      makeRope({ id: 1, hours: 4, employer: "Acme",   workDetails: "Inspection",        skills: "rigging",     verifiedBy: "Sam" }),
      makeRope({ id: 2, hours: 8, employer: "Acme",   workDetails: "Rope rescue drill", skills: "rescue",      startDate: new Date("2026-05-06T00:00:00Z"), endDate: new Date("2026-05-06T00:00:00Z") }),
      makeRope({ id: 3, hours: 6, employer: "Vendor", workDetails: "Cable pull",        skills: "ascending",   startDate: new Date("2026-05-08T00:00:00Z"), endDate: new Date("2026-05-09T00:00:00Z") }),
    ];
    const supervisors = [makeSupervisor({ name: "Sam", spratNumber: "SP-9999" })];

    const [expected] = spratAdapter({
      ropeHours,
      profile: makeProfile(),
      supervisors,
      headerOverrides: { running_total: "200" },
    });
    const bytes = await fillForm(SPRAT_BLANK, expected);

    const reopened = await PDFDocument.load(bytes);
    const form = reopened.getForm();
    for (const [name, value] of Object.entries(expected)) {
      const got = form.getTextField(name).getText() ?? "";
      expect(got, `field ${name}`).toBe(value);
    }
  });

  it("renders 14 rope hours as 3 editable pages (6 + 6 + 2)", async () => {
    const ropeHours: RopeHours[] = Array.from({ length: 14 }, (_, i) =>
      makeRope({ id: i + 1, hours: 1, employer: `Emp ${i + 1}`,
        startDate: new Date(Date.UTC(2026, 0, 1 + i)), endDate: new Date(Date.UTC(2026, 0, 1 + i)) }));

    const pages = spratAdapter({ ropeHours, profile: makeProfile(), supervisors: [] });
    expect(pages).toHaveLength(3);

    const bytes = await fillFormPages(SPRAT_BLANK, pages);
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(3);

    const form = reopened.getForm();
    expect(form.getTextField("row_1_employer__pg0").getText()).toBe("Emp 1");
    expect(form.getTextField("row_6_employer__pg1").getText()).toBe("Emp 12");
    expect(form.getTextField("row_2_employer__pg2").getText()).toBe("Emp 14");
  });
});
