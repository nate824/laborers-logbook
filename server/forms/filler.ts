import { promises as fs } from "fs";
import { PDFBool, PDFDocument, PDFName, PDFString, type PDFRef } from "pdf-lib";
import type { FieldValues } from "./types";

/** Set /NeedAppearances=true so viewers render field values themselves. */
function setNeedAppearances(doc: PDFDocument): void {
  const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (acroForm && "set" in acroForm && typeof acroForm.set === "function") {
    (acroForm as { set: (key: PDFName, value: PDFBool) => void }).set(
      PDFName.of("NeedAppearances"),
      PDFBool.True,
    );
  }
}

/**
 * Load a blank AcroForm PDF, set named text-field values, and return the
 * updated bytes. Fields stay editable in the resulting PDF.
 *
 * Sets /NeedAppearances=true on the AcroForm dict so values render in viewers
 * that don't compute appearances themselves. Skips pdf-lib's own appearance
 * generation (which would embed a font and bloat the output).
 */
export async function fillForm(
  blankPath: string,
  values: FieldValues,
): Promise<Uint8Array> {
  const bytes = await fs.readFile(blankPath);
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();

  for (const [name, value] of Object.entries(values)) {
    const field = form.getTextField(name);
    field.setText(value);
  }

  setNeedAppearances(doc);

  return doc.save({ updateFieldAppearances: false });
}

/**
 * Fill a blank single-page AcroForm once per page of values, producing a
 * multi-page PDF whose fields stay editable. An export of 40 rows against a
 * 16-row form becomes 3 pages (16 + 16 + 8) — there is no row cap.
 *
 * One page is the common case and routes straight through `fillForm` (identical
 * output to before). For 2+ pages we build a fresh document and, for each page,
 * load the blank, fill that page's values, give every field a page-unique name
 * (`<name>__pg<N>`) so the merged AcroForm has no colliding fields, then copy
 * the stamped page across. Field names are terminal widgets on these blanks, so
 * renaming the /T entry and re-registering the widget refs in the output
 * AcroForm is sufficient. NeedAppearances drives rendering, same as fillForm.
 */
export async function fillFormPages(
  blankPath: string,
  pages: FieldValues[],
): Promise<Uint8Array> {
  if (pages.length <= 1) {
    return fillForm(blankPath, pages[0] ?? {});
  }

  const blankBytes = await fs.readFile(blankPath);
  const outDoc = await PDFDocument.create();
  const fieldRefs: PDFRef[] = [];

  for (let p = 0; p < pages.length; p++) {
    const src = await PDFDocument.load(blankBytes);
    const form = src.getForm();

    for (const [name, value] of Object.entries(pages[p])) {
      form.getTextField(name).setText(value);
    }

    // Rename every field so page 2+ don't collide with page 1's field names.
    for (const field of form.getFields()) {
      const dict = field.acroField.dict;
      const t = dict.lookup(PDFName.of("T"), PDFString);
      dict.set(PDFName.of("T"), PDFString.of(`${t.asString()}__pg${p}`));
    }

    const [page] = await outDoc.copyPages(src, [0]);
    outDoc.addPage(page);

    // The copied widgets are now annotations on the new page but aren't yet
    // registered as form fields in outDoc — collect their refs.
    const annots = page.node.Annots();
    if (annots) {
      for (let i = 0; i < annots.size(); i++) {
        fieldRefs.push(annots.get(i) as PDFRef);
      }
    }
  }

  const acroDict = outDoc.context.obj({
    Fields: fieldRefs,
    NeedAppearances: true,
  });
  outDoc.catalog.set(PDFName.of("AcroForm"), outDoc.context.register(acroDict));

  return outDoc.save({ updateFieldAppearances: false });
}
