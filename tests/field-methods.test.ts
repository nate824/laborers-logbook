import { describe, it, expect } from "vitest";
import {
  FieldMethods,
  SIGNER_METHODS,
  fieldMethodLabel,
  signerMethodLabel,
  insertEntrySchema,
  FIELD_METHOD_DETAILS,
  cleanEntryDetails,
  entryDetailsSummary,
} from "@shared/schema";

const base = { userId: 1, date: new Date("2026-10-01"), location: "Site", hours: 8 };

describe("Field Hours methods", () => {
  it("accepts every FieldMethods key on a field-hours entry", () => {
    for (const method of Object.keys(FieldMethods)) {
      expect(() => insertEntrySchema.parse({ ...base, method })).not.toThrow();
    }
  });

  it("rejects old NDT methods and rope access on a field-hours entry", () => {
    for (const method of ["UT", "MT", "ROPE_ACCESS", "ROPE"]) {
      expect(() => insertEntrySchema.parse({ ...base, method })).toThrow();
    }
  });

  it("lets signers be qualified in field methods plus rope access", () => {
    expect(Object.keys(SIGNER_METHODS).sort()).toEqual(
      [...Object.keys(FieldMethods), "ROPE_ACCESS"].sort(),
    );
  });

  it("labels methods for display", () => {
    expect(fieldMethodLabel("ON_THE_JOB")).toBe("On the job");
    expect(fieldMethodLabel("CLASSROOM")).toBe("Class / training");
    expect(signerMethodLabel("ROPE_ACCESS")).toBe("Rope Access");
  });
});

describe("Field method logbook details", () => {
  it("keeps only the current kind's fields, trimmed, without blanks", () => {
    const draft = { employer: " Granite ", course: "OSHA 30", jobNumber: "  " };
    expect(cleanEntryDetails("ON_THE_JOB", draft)).toEqual({ employer: "Granite" });
    expect(cleanEntryDetails("CLASSROOM", draft)).toEqual({ course: "OSHA 30" });
    expect(cleanEntryDetails("CLASSROOM", null)).toEqual({});
  });

  it("summarizes details for cards and the verify page, hiding the default Union", () => {
    expect(entryDetailsSummary("ON_THE_JOB", { employer: "Granite", union: "Union", jobNumber: "2231", overtime: "2" })).toBe(
      "Granite · Job # 2231 · 2 OT",
    );
    expect(entryDetailsSummary("ON_THE_JOB", { employer: "Bob's Paving", union: "Non-union" })).toBe("Bob's Paving · Non-union");
  });

  it("accepts details on a work-hours entry", () => {
    expect(insertEntrySchema.parse({ ...base, method: "ON_THE_JOB", details: { employer: "Granite" } }).details).toEqual({
      employer: "Granite",
    });
  });

  it("has logbook fields for every method", () => {
    for (const method of Object.keys(FieldMethods)) {
      expect(FIELD_METHOD_DETAILS[method as keyof typeof FIELD_METHOD_DETAILS].length).toBeGreaterThan(0);
    }
  });
});
