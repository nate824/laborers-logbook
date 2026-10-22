import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In dev (tsx), this file lives at server/forms/paths.ts, so __dirname is
// server/forms and the blanks/schemas dirs are right next to it.
// In prod, esbuild bundles to dist/index.js so __dirname is dist; the build
// script copies server/forms/{blanks,schemas} → dist/forms/{blanks,schemas},
// so the correct root is dist/forms (NOT one level up).
const isProd = process.env.NODE_ENV === "production";

const FORMS_ROOT = isProd
  ? path.resolve(__dirname, "forms") // dist/index.js → dist/forms/
  : __dirname;                       // server/forms/paths.ts → server/forms/

export const BLANKS_DIR = path.join(FORMS_ROOT, "blanks");
export const SCHEMAS_DIR = path.join(FORMS_ROOT, "schemas");
