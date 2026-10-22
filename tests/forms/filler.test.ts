import { describe, it, expect } from "vitest";
import path from "path";
import { promises as fs } from "fs";
import { PDFDocument } from "pdf-lib";
import { fillForm } from "../../server/forms/filler";

const FORMS_DIR = path.resolve(__dirname, "..", "..", "server", "forms");
const SPRAT_BLANK = path.join(FORMS_DIR, "blanks", "SPRAT_RopeAccessLog_Fillable.pdf");
const SPRAT_SCHEMA = path.join(FORMS_DIR, "schemas", "sprat_log_v1.schema.json");
const IRATA_BLANK = path.join(FORMS_DIR, "blanks", "IRATA_WorkExperience_Fillable.pdf");
const IRATA_SCHEMA = path.join(FORMS_DIR, "schemas", "irata_log_v1.schema.json");

describe("fillForm", () => {
  it("writes a value into a named field and the value reads back", async () => {
    const out = await fillForm(SPRAT_BLANK, {
      row_1_employer: "Round Trip",
      row_1_hours_worked: "12345",
    });

    const reopened = await PDFDocument.load(out);
    const form = reopened.getForm();
    expect(form.getTextField("row_1_employer").getText()).toBe("Round Trip");
    expect(form.getTextField("row_1_hours_worked").getText()).toBe("12345");
  });

  it("sets /NeedAppearances=true on the AcroForm dict", async () => {
    const out = await fillForm(SPRAT_BLANK, { row_1_employer: "x" });
    // Blanks may use compressed object streams (ObjStm), so a raw-byte textual
    // probe is unreliable. Reload the output and verify via pdf-lib's own API.
    const reopened = await PDFDocument.load(out);
    const { PDFName } = await import("pdf-lib");
    const acroFormRef = reopened.catalog.get(PDFName.of("AcroForm"));
    const acroFormObj = reopened.context.lookup(acroFormRef as import("pdf-lib").PDFRef);
    const needApp = (acroFormObj as import("pdf-lib").PDFDict).get(PDFName.of("NeedAppearances"));
    expect(needApp?.toString()).toBe("true");
  });
});

async function fieldNamesInBlank(blankPath: string): Promise<string[]> {
  const bytes = await fs.readFile(blankPath);
  const doc = await PDFDocument.load(bytes);
  return doc.getForm().getFields().map((f) => f.getName()).sort();
}

async function fieldNamesInSchema(schemaPath: string): Promise<string[]> {
  const json = JSON.parse(await fs.readFile(schemaPath, "utf8"));
  return [...json.all_pdf_field_names].sort();
}

describe("blank ↔ schema field-name parity", () => {
  it("SPRAT blank matches its schema", async () => {
    const inBlank = await fieldNamesInBlank(SPRAT_BLANK);
    const inSchema = await fieldNamesInSchema(SPRAT_SCHEMA);
    expect(inBlank).toEqual(inSchema);
  });

  it("IRATA blank matches its schema", async () => {
    const inBlank = await fieldNamesInBlank(IRATA_BLANK);
    const inSchema = await fieldNamesInSchema(IRATA_SCHEMA);
    expect(inBlank).toEqual(inSchema);
  });
});
