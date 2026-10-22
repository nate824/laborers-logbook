import type { Entry, RopeHours, Supervisor, User } from "@shared/schema";

// Rope-access logbook forms. The "ojt" adapter kind (work-hours entries) is
// kept in the registry types for a future Access Limited field-hours form.
export type FormId =
  | "sprat_log_v1"
  | "irata_log_v1";

export type FieldValues = Record<string, string>;

export type AdapterInput = {
  entries: Entry[];
  profile: User;
  headerOverrides?: Record<string, string>;
};

// Adapters return one FieldValues object per output page. A short export is a
// single-element array; a long one is chunked across as many pages as needed.
// The filler stamps the blank template once per element (see fillFormPages).
export type Adapter = (input: AdapterInput) => FieldValues[];

export type RopeAdapterInput = {
  ropeHours: RopeHours[];
  profile: User;
  supervisors: Supervisor[];
  headerOverrides?: Record<string, string>;
};

export type RopeAdapter = (input: RopeAdapterInput) => FieldValues[];

/** Split an array into consecutive chunks of at most `size` items. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

// Retained for back-compat: adapters no longer throw this (forms now paginate
// instead of capping), but the route/MCP error mapping still references it.
export class FormCapacityError extends Error {
  constructor(
    public readonly max: number,
    public readonly got: number,
    public readonly unit: "rows" | "weeks",
  ) {
    super(`Form capacity exceeded: max ${max} ${unit}, got ${got}`);
    this.name = "FormCapacityError";
    Object.setPrototypeOf(this, FormCapacityError.prototype);
  }
}

export class EmptyExportError extends Error {
  constructor() {
    super("No entries to export");
    this.name = "EmptyExportError";
    Object.setPrototypeOf(this, EmptyExportError.prototype);
  }
}

export class NothingToExportError extends Error {
  constructor() {
    super("All selected entries use methods this form doesn't support");
    this.name = "NothingToExportError";
    Object.setPrototypeOf(this, NothingToExportError.prototype);
  }
}
