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
    expect(fieldMethodLabel("DRILLING")).toBe("Drilling");
    expect(fieldMethodLabel("SHOTCRETE")).toBe("Shotcrete");
    expect(fieldMethodLabel("SCALING")).toBe("Scaling");
    expect(signerMethodLabel("ROPE_ACCESS")).toBe("Rope Access");
  });
});

describe("Field method logbook details", () => {
  it("keeps only the current method's fields, trimmed, without blanks", () => {
    const draft = { jobNumber: " 2231 ", totalLf: "120", sqft: "400", angle: "  " };
    expect(cleanEntryDetails("DRILLING", draft)).toEqual({ jobNumber: "2231", totalLf: "120" });
    expect(cleanEntryDetails("SHOTCRETE", draft)).toEqual({ jobNumber: "2231", sqft: "400" });
    expect(cleanEntryDetails("SCALING", null)).toEqual({});
  });

  it("summarizes details for cards and the verify page", () => {
    expect(entryDetailsSummary("DRILLING", { jobNumber: "2231", type: "Soil nail", totalLf: "120" })).toBe(
      "Job # 2231 · Soil nail · 120 LF",
    );
    expect(entryDetailsSummary("SHOTCRETE", { process: "Wet", orientation: "Vert.,Horz." })).toBe("Wet · Vert. / Horz.");
  });

  it("accepts details on a field-hours entry", () => {
    expect(insertEntrySchema.parse({ ...base, method: "DRILLING", details: { totalLf: "120" } }).details).toEqual({
      totalLf: "120",
    });
  });

  it("has logbook fields for every method", () => {
    for (const method of Object.keys(FieldMethods)) {
      expect(FIELD_METHOD_DETAILS[method as keyof typeof FIELD_METHOD_DETAILS].length).toBeGreaterThan(0);
    }
  });
});
