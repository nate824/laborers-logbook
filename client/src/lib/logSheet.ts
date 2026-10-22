import { jsPDF } from "jspdf";

// Logbook-style PDF (landscape US Letter) laid out like the Access Limited
// paper logbook: a black title bar, bold column headers, bordered rows and a
// Page Total / Running Total footer. A logbook spread (left + right page) is
// one wide table here. Rows grow to fit wrapped text and the table ends at the
// last entry, so a sheet never has blank rows.

export interface SheetColumn {
  header: string; // "\n" splits a two-line header ("Hole Depth & Size\nTotal LF")
  width: number; // relative weight; columns are scaled to the page width
  align?: "left" | "right" | "center";
}

// A plain value, or the printed options of a "circle one" column
// (Dry / Wet, Vert. / Horz.) with the logged ones circled.
export type SheetCell = string | { choices: string[]; selected: string[] };

export interface SheetTotal {
  label: string; // "Hours", "LF", "Sq Ft"
  values: number[]; // one per row
}

export interface LogSheetSpec {
  title: string; // "Drilling Log"
  person: { name: string; employeeNumber?: string | null };
  columns: SheetColumn[];
  rows: SheetCell[][];
  totals: SheetTotal[]; // Page Total / Running Total boxes in the footer
  summary?: { label: string; value: string }; // e.g. Total Work Hours Since Previous Certification
  footnote?: string;
}

const PAGE_W = 279.4;
const PAGE_H = 215.9;
const MARGIN = 12;
const TABLE_W = PAGE_W - MARGIN * 2;
const PERSON_H = 7; // technician line above the title bar
const TITLE_H = 11;
const FONT_SIZE = 9;
const LINE_H = 4; // mm per wrapped line at FONT_SIZE
const CELL_PAD_X = 2;
const CELL_PAD_Y = 2.5;
const MIN_ROW_H = 10;
const FOOTER_ROW_H = 8;
const NOTE_H = 10; // space under the table for the footnote / page number

// Split row indexes into pages so each page's rows fit in `available` mm.
// A row taller than a whole page still gets its own page rather than looping.
export function paginateRows(heights: number[], available: number): number[][] {
  const pages: number[][] = [];
  let current: number[] = [];
  let used = 0;
  heights.forEach((h, i) => {
    if (current.length > 0 && used + h > available) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(i);
    used += h;
  });
  if (current.length > 0) pages.push(current);
  return pages;
}

export function fmtNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function cellText(cell: SheetCell) {
  return typeof cell === "string" ? cell : cell.choices.join("  ");
}

// Printed choices side by side, centered, with each selected one circled —
// the same as circling "Wet" in the paper log.
function drawChoices(doc: jsPDF, cell: { choices: string[]; selected: string[] }, x: number, w: number, y: number) {
  doc.setFont("helvetica", "bold");
  const gap = 3;
  const widths = cell.choices.map((c) => doc.getTextWidth(c));
  const total = widths.reduce((a, b) => a + b, 0) + gap * (cell.choices.length - 1);
  let cx = x + (w - total) / 2;
  cell.choices.forEach((choice, i) => {
    doc.text(choice, cx, y);
    if (cell.selected.includes(choice)) {
      doc.setLineWidth(0.35);
      doc.ellipse(cx + widths[i] / 2, y - 1.1, widths[i] / 2 + 1.3, 2.6);
      doc.setLineWidth(0.3);
    }
    cx += widths[i] + gap;
  });
  doc.setFont("helvetica", "normal");
}

export function buildLogSheet(spec: LogSheetSpec): jsPDF {
  if (spec.rows.length === 0) throw new Error("Nothing to export");

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT_SIZE);

  const weight = spec.columns.reduce((s, c) => s + c.width, 0);
  const widths = spec.columns.map((c) => (c.width / weight) * TABLE_W);

  // Header height fits the tallest (wrapped, multi-line) header.
  doc.setFont("helvetica", "bold");
  const headerLines = spec.columns.map(
    (c, ci) => c.header.split("\n").flatMap((part) => doc.splitTextToSize(part, widths[ci] - CELL_PAD_X * 2) as string[]),
  );
  const headerH = Math.max(...headerLines.map((l) => l.length)) * LINE_H + CELL_PAD_Y * 2 + 1;
  doc.setFont("helvetica", "normal");

  // Wrap every cell and size each row to its tallest cell.
  const wrapped = spec.rows.map((row) =>
    row.map((cell, ci) =>
      typeof cell === "string" ? (doc.splitTextToSize(cell ?? "", widths[ci] - CELL_PAD_X * 2) as string[]) : [cellText(cell)],
    ),
  );
  const heights = wrapped.map((cells) =>
    Math.max(MIN_ROW_H, Math.max(...cells.map((l) => l.length)) * LINE_H + CELL_PAD_Y * 2),
  );

  const footerRows = (spec.totals.length > 0 ? 1 : 0) + (spec.summary ? 1 : 0);
  const titleTop = MARGIN + PERSON_H;
  const headerTop = titleTop + TITLE_H;
  const bodyTop = headerTop + headerH;
  const available = PAGE_H - MARGIN - NOTE_H - footerRows * FOOTER_ROW_H - bodyTop;
  const pages = paginateRows(heights, available);

  const running = spec.totals.map(() => 0);
  pages.forEach((rowIdx, pageNo) => {
    if (pageNo > 0) doc.addPage("letter", "landscape");
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.setTextColor(0);

    // Technician line.
    doc.setFontSize(FONT_SIZE);
    doc.setFont("helvetica", "bold");
    doc.text("Name:", MARGIN, MARGIN + 4);
    doc.setFont("helvetica", "normal");
    doc.text(spec.person.name || "", MARGIN + 11, MARGIN + 4);
    if (spec.person.employeeNumber) {
      doc.setFont("helvetica", "bold");
      doc.text("Employee #:", MARGIN + 80, MARGIN + 4);
      doc.setFont("helvetica", "normal");
      doc.text(spec.person.employeeNumber, MARGIN + 100, MARGIN + 4);
    }
    doc.setFont("helvetica", "bold");
    doc.text("Laborers Logbook", MARGIN + TABLE_W, MARGIN + 4, { align: "right" });

    // Black title bar, white title — like the logbook page heading.
    doc.setFillColor(0, 0, 0);
    doc.rect(MARGIN, titleTop, TABLE_W, TITLE_H, "F");
    doc.setFontSize(15);
    doc.setTextColor(255);
    doc.text(spec.title, MARGIN + TABLE_W / 2, titleTop + 7.6, { align: "center" });
    doc.setTextColor(0);
    doc.setFontSize(FONT_SIZE);

    // Column headers: white cells, bold, centered.
    doc.rect(MARGIN, headerTop, TABLE_W, headerH);
    let x = MARGIN;
    spec.columns.forEach((_, ci) => {
      const lines = headerLines[ci];
      const y = headerTop + headerH / 2 - ((lines.length - 1) * LINE_H) / 2 + 1.2;
      doc.text(lines, x + widths[ci] / 2, y, { align: "center" });
      x += widths[ci];
    });
    doc.setFont("helvetica", "normal");

    // Rows: exactly the entries on this page, no filler.
    let y = bodyTop;
    const pageTotals = spec.totals.map(() => 0);
    rowIdx.forEach((ri) => {
      const h = heights[ri];
      doc.rect(MARGIN, y, TABLE_W, h);
      let cx = MARGIN;
      spec.rows[ri].forEach((cell, ci) => {
        const col = spec.columns[ci];
        const ty = y + CELL_PAD_Y + 3;
        if (typeof cell !== "string") {
          drawChoices(doc, cell, cx, widths[ci], ty);
        } else {
          const align = col.align ?? "left";
          const tx =
            align === "right" ? cx + widths[ci] - CELL_PAD_X : align === "center" ? cx + widths[ci] / 2 : cx + CELL_PAD_X;
          doc.text(wrapped[ri][ci], tx, ty, { align });
        }
        cx += widths[ci];
      });
      spec.totals.forEach((t, ti) => (pageTotals[ti] += t.values[ri] ?? 0));
      y += h;
    });

    // Column rules from the header down through the rows.
    let vx = MARGIN;
    widths.slice(0, -1).forEach((w) => {
      vx += w;
      doc.line(vx, headerTop, vx, y);
    });

    // Footer: "Page Total [ ]  Running Total [ ]" per tracked total.
    spec.totals.forEach((_, ti) => (running[ti] += pageTotals[ti]));
    const boxes: { label: string; value: string }[] = [];
    spec.totals.forEach((t, ti) => {
      boxes.push({ label: `Page Total${spec.totals.length > 1 ? ` ${t.label}` : ""}`, value: fmtNumber(pageTotals[ti]) });
      boxes.push({ label: `Running Total${spec.totals.length > 1 ? ` ${t.label}` : ""}`, value: fmtNumber(running[ti]) });
    });
    const drawFooterRow = (cells: { label: string; value: string }[]) => {
      const cellW = TABLE_W / cells.length;
      const labelW = cellW * 0.68;
      doc.rect(MARGIN, y, TABLE_W, FOOTER_ROW_H);
      cells.forEach((c, i) => {
        const cx = MARGIN + i * cellW;
        if (i > 0) doc.line(cx, y, cx, y + FOOTER_ROW_H);
        doc.line(cx + labelW, y, cx + labelW, y + FOOTER_ROW_H);
        doc.setFont("helvetica", "bold");
        doc.text(c.label, cx + labelW / 2, y + 5.3, { align: "center" });
        doc.setFont("helvetica", "normal");
        doc.text(c.value, cx + labelW + (cellW - labelW) / 2, y + 5.3, { align: "center" });
      });
      y += FOOTER_ROW_H;
    };
    if (boxes.length > 0) drawFooterRow(boxes);
    if (spec.summary) drawFooterRow([spec.summary]);

    // Footnote + page number.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(90);
    if (spec.footnote) {
      doc.text(doc.splitTextToSize(spec.footnote, TABLE_W - 40) as string[], MARGIN, y + 5);
    }
    doc.text(`Page ${pageNo + 1} of ${pages.length}`, MARGIN + TABLE_W, y + 5, { align: "right" });
    doc.setTextColor(0);
    doc.setFontSize(FONT_SIZE);
  });

  return doc;
}
