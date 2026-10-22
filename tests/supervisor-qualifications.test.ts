import { describe, it, expect } from "vitest";
import {
  canonicalizeSupervisorWrite,
  supervisorQualificationSchema,
} from "../shared/schema";

describe("canonicalizeSupervisorWrite", () => {
  it("mirrors the first qualification into the legacy fields", () => {
    const result = canonicalizeSupervisorWrite({
      name: "Jane",
      qualifications: [
        { method: "ON_THE_JOB", level: "Level III" },
        { method: "CLASSROOM", level: "Level II" },
      ],
    });
    expect(result.ndtMethod).toBe("ON_THE_JOB");
    expect(result.certificationLevel).toBe("Level III");
  });

  it("clears legacy fields when qualifications is an empty array", () => {
    const result = canonicalizeSupervisorWrite({
      ndtMethod: "ON_THE_JOB",
      certificationLevel: "Level III",
      qualifications: [],
    });
    expect(result.ndtMethod).toBeNull();
    expect(result.certificationLevel).toBeNull();
  });

  it("leaves legacy fields untouched on partial writes without qualifications", () => {
    const result = canonicalizeSupervisorWrite({
      ndtMethod: "ON_THE_JOB",
      certificationLevel: "Level III",
    });
    expect(result.ndtMethod).toBe("ON_THE_JOB");
    expect(result.certificationLevel).toBe("Level III");
  });
});

describe("supervisorQualificationSchema", () => {
  it("accepts a valid method + level", () => {
    expect(() =>
      supervisorQualificationSchema.parse({ method: "ROPE_ACCESS", level: "Level III" }),
    ).not.toThrow();
  });

  it("rejects an unknown method", () => {
    expect(() =>
      supervisorQualificationSchema.parse({ method: "NOPE", level: "Level I" }),
    ).toThrow();
  });

  it("rejects an unknown level", () => {
    expect(() =>
      supervisorQualificationSchema.parse({ method: "ON_THE_JOB", level: "Level IV" }),
    ).toThrow();
  });
});
