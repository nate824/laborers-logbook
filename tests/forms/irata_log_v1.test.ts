import { describe, it, expect } from "vitest";
import path from "path";
import { PDFDocument } from "pdf-lib";
import type { RopeHours, Supervisor, User } from "@shared/schema";
import { irataAdapter } from "../../server/forms/adapters/irata_log_v1";
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

const IRATA_BLANK = path.resolve(
  __dirname, "..", "..", "server", "forms", "blanks", "IRATA_WorkExperience_Fillable.pdf",
);

describe("irataAdapter — core mapping", () => {
  it("writes row fields including max_height and task_details from workDetails", () => {
    const [out] = irataAdapter({
      ropeHours: [makeRope({
        employer: "Vendor Corp",
        workDetails: "Tower painting",
        location: "Houston, TX",
        maxHeight: "50m / 164ft",
        hours: 7,
      })],
      profile: makeProfile(),
      supervisors: [],
    });
    expect(out.row_1_employer).toBe("Vendor Corp");
    expect(out.row_1_task_details).toBe("Tower painting");
    expect(out.row_1_location).toBe("Houston, TX");
    expect(out.row_1_max_height).toBe("50m / 164ft");
    expect(out.row_1_hours_worked).toBe("7");
  });

  it("falls back to skills for task_details when workDetails is null", () => {
    const [out] = irataAdapter({
      ropeHours: [makeRope({ workDetails: null, skills: "rebelay, ascending" })],
      profile: makeProfile(),
      supervisors: [],
    });
    expect(out.row_1_task_details).toBe("rebelay, ascending");
  });

  it("appends IRATA number when supervisor lookup succeeds", () => {
    const [out] = irataAdapter({
      ropeHours: [makeRope({ verifiedBy: "Supervisor Sam" })],
      profile: makeProfile(),
      supervisors: [makeSupervisor({ name: "Supervisor Sam", irataNumber: "IR-12345" })],
    });
    expect(out.row_1_supervisor).toBe("Supervisor Sam #IR-12345");
  });

  it("uses verifiedBy alone when no supervisor matches", () => {
    const [out] = irataAdapter({
      ropeHours: [makeRope({ verifiedBy: "Unknown" })],
      profile: makeProfile(),
      supervisors: [],
    });
    expect(out.row_1_supervisor).toBe("Unknown");
  });

  it("does NOT emit hours_this_page or running_total fields (IRATA has neither)", () => {
    const [out] = irataAdapter({
      ropeHours: [makeRope({ hours: 4 })],
      profile: makeProfile(),
      supervisors: [],
    });
    expect(out.hours_this_page).toBeUndefined();
    expect(out.running_total).toBeUndefined();
  });

  it("accepts headerOverrides.running_total_hours", () => {
    const [out] = irataAdapter({
      ropeHours: [makeRope({})],
      profile: makeProfile(),
      supervisors: [],
      headerOverrides: { running_total_hours: "500" },
    });
    expect(out.running_total_hours).toBe("500");
  });
});

describe("irataAdapter — bounds", () => {
  it("throws EmptyExportError on zero rope hours", () => {
    expect(() => irataAdapter({ ropeHours: [], profile: makeProfile(), supervisors: [] }))
      .toThrow(EmptyExportError);
  });

  it("paginates more than 7 rope hours across pages (7 + remainder)", () => {
    const ropeHours = Array.from({ length: 8 }, (_, i) =>
      makeRope({ id: i + 1, startDate: new Date(Date.UTC(2026, 0, 1 + i)), endDate: new Date(Date.UTC(2026, 0, 1 + i)) }));
    const pages = irataAdapter({ ropeHours, profile: makeProfile(), supervisors: [] });
    expect(pages).toHaveLength(2); // 7 + 1
    expect(pages[0].row_7_date).toBeDefined();
    expect(pages[1].row_1_date).toBeDefined();
    expect(pages[1].row_2_date).toBeUndefined();
  });
});

describe("irataAdapter — round-trip", () => {
  it("every field the adapter writes reads back identical", async () => {
    const ropeHours: RopeHours[] = [
      makeRope({ id: 1, hours: 4, employer: "Vendor", workDetails: "Inspection", location: "Houston", maxHeight: "30m" }),
      makeRope({ id: 2, hours: 8, employer: "Vendor", workDetails: "Painting",   location: "Houston", maxHeight: "50m", startDate: new Date("2026-05-06T00:00:00Z"), endDate: new Date("2026-05-06T00:00:00Z") }),
    ];

    const [expected] = irataAdapter({
      ropeHours,
      profile: makeProfile(),
      supervisors: [],
      headerOverrides: { running_total_hours: "300" },
    });
    const bytes = await fillForm(IRATA_BLANK, expected);

    const reopened = await PDFDocument.load(bytes);
    const form = reopened.getForm();
    for (const [name, value] of Object.entries(expected)) {
      const got = form.getTextField(name).getText() ?? "";
      expect(got, `field ${name}`).toBe(value);
    }
  });

  it("renders 16 rope hours as 3 editable pages (7 + 7 + 2)", async () => {
    const ropeHours: RopeHours[] = Array.from({ length: 16 }, (_, i) =>
      makeRope({ id: i + 1, hours: 1, employer: `Emp ${i + 1}`, location: `Loc ${i + 1}`,
        startDate: new Date(Date.UTC(2026, 0, 1 + i)), endDate: new Date(Date.UTC(2026, 0, 1 + i)) }));

    const pages = irataAdapter({ ropeHours, profile: makeProfile(), supervisors: [] });
    expect(pages).toHaveLength(3);

    const bytes = await fillFormPages(IRATA_BLANK, pages);
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(3);

    const form = reopened.getForm();
    expect(form.getTextField("row_1_employer__pg0").getText()).toBe("Emp 1");
    expect(form.getTextField("row_7_employer__pg1").getText()).toBe("Emp 14");
    expect(form.getTextField("row_2_employer__pg2").getText()).toBe("Emp 16");
  });
});
