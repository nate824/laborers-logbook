import path from "path";
import { spratAdapter } from "./adapters/sprat_log_v1";
import { irataAdapter } from "./adapters/irata_log_v1";
import { BLANKS_DIR, SCHEMAS_DIR } from "./paths";
import type { Adapter, FormId, RopeAdapter } from "./types";

export type RegistryEntry =
  | { kind: "ojt";  blankPath: string; schemaPath: string; adapter: Adapter }
  | { kind: "rope"; blankPath: string; schemaPath: string; adapter: RopeAdapter };

export const registry: Record<FormId, RegistryEntry> = {
  sprat_log_v1: {
    kind: "rope",
    blankPath: path.join(BLANKS_DIR, "SPRAT_RopeAccessLog_Fillable.pdf"),
    schemaPath: path.join(SCHEMAS_DIR, "sprat_log_v1.schema.json"),
    adapter: spratAdapter,
  },
  irata_log_v1: {
    kind: "rope",
    blankPath: path.join(BLANKS_DIR, "IRATA_WorkExperience_Fillable.pdf"),
    schemaPath: path.join(SCHEMAS_DIR, "irata_log_v1.schema.json"),
    adapter: irataAdapter,
  },
};

export function isFormId(value: unknown): value is FormId {
  return (
    value === "sprat_log_v1" ||
    value === "irata_log_v1"
  );
}
