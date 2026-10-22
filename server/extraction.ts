import OpenAI from "openai";
import ExcelJS from "exceljs";
import { FieldMethods, type FieldMethod } from "@shared/schema";

const VALID_METHODS = Object.keys(FieldMethods) as FieldMethod[];

export interface ExtractedOJTRow {
  date: string; // ISO YYYY-MM-DD
  location: string;
  method: FieldMethod;
  hours: number;
}

export interface ExtractedRopeRow {
  startDate: string; // ISO YYYY-MM-DD
  endDate: string; // ISO YYYY-MM-DD
  location: string;
  skills: string;
  hours: number;
}

export type ImportType = "ojt" | "rope";

const OJT_INSTRUCTIONS = `You are extracting daily work hours from a signed Access
Limited (geotechnical construction) field logbook page. Return STRICT JSON only.

Schema:
{
  "rows": [
    {
      "date": "YYYY-MM-DD",
      "location": "string (worksite/job location)",
      "method": "one of: ${VALID_METHODS.join(", ")}",
      "hours": number (decimal, e.g. 4 or 4.5)
    }
  ]
}

Methods: ON_THE_JOB (hours worked on a jobsite for an employer — a timecard,
pay stub or daily log), CLASSROOM (training school / class hours — OSHA,
confined space, apprenticeship classes). Map any equivalents to one of the
listed codes. If a day has both, return ONE row per method. Skip rows without a
clear method or hours value. If you cannot read the document, return {"rows": []}.`;

const ROPE_INSTRUCTIONS = `You are extracting Rope Access training hours from a
signed log book page. Return STRICT JSON only.

Schema:
{
  "rows": [
    {
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD (same as startDate if single-day)",
      "location": "string (worksite/job location)",
      "skills": "string (techniques used: rigging, rescue, ascending, etc.)",
      "hours": number
    }
  ]
}

Skip rows without clear dates, location, or hours. If you cannot read the
document, return {"rows": []}.`;

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey || !baseURL) {
    throw new Error(
      "OpenAI integration not configured. AI_INTEGRATIONS_OPENAI_API_KEY and " +
        "AI_INTEGRATIONS_OPENAI_BASE_URL env vars must be set.",
    );
  }
  return new OpenAI({ apiKey, baseURL });
}

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

function isPdfMime(mime: string): boolean {
  return mime === "application/pdf" || mime === "application/x-pdf";
}

function isXlsxMime(mime: string): boolean {
  return (
    mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel"
  );
}

async function callVisionExtraction(
  buffer: Buffer,
  contentType: string,
  instructions: string,
  filename: string,
): Promise<unknown> {
  const openai = getOpenAIClient();
  const dataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;

  const fileContent = isPdfMime(contentType)
    ? ({
        type: "file",
        file: { filename, file_data: dataUrl },
      } as const)
    : ({
        type: "image_url",
        image_url: { url: dataUrl, detail: "high" },
      } as const);

  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    response_format: { type: "json_object" },
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content:
          "You are a precise data extraction assistant. Output ONLY valid JSON " +
          "matching the requested schema. Never include commentary.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: instructions },
          fileContent,
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return { rows: [] };
  }
  try {
    return JSON.parse(content);
  } catch {
    return { rows: [] };
  }
}

function isValidDateString(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

function sanitizeOJTRows(parsed: unknown): ExtractedOJTRow[] {
  const obj = parsed as { rows?: unknown };
  if (!obj || !Array.isArray(obj.rows)) return [];
  const out: ExtractedOJTRow[] = [];
  for (const raw of obj.rows) {
    const r = raw as Partial<ExtractedOJTRow>;
    if (
      !isValidDateString(r.date) ||
      typeof r.location !== "string" ||
      typeof r.method !== "string" ||
      !VALID_METHODS.includes(r.method as FieldMethod) ||
      typeof r.hours !== "number" ||
      !Number.isFinite(r.hours) ||
      r.hours <= 0
    ) {
      continue;
    }
    out.push({
      date: r.date,
      location: r.location.trim(),
      method: r.method as FieldMethod,
      hours: Math.round(r.hours * 10) / 10,
    });
  }
  return out;
}

function sanitizeRopeRows(parsed: unknown): ExtractedRopeRow[] {
  const obj = parsed as { rows?: unknown };
  if (!obj || !Array.isArray(obj.rows)) return [];
  const out: ExtractedRopeRow[] = [];
  for (const raw of obj.rows) {
    const r = raw as Partial<ExtractedRopeRow>;
    if (
      !isValidDateString(r.startDate) ||
      !isValidDateString(r.endDate) ||
      typeof r.location !== "string" ||
      typeof r.skills !== "string" ||
      typeof r.hours !== "number" ||
      !Number.isFinite(r.hours) ||
      r.hours <= 0
    ) {
      continue;
    }
    out.push({
      startDate: r.startDate,
      endDate: r.endDate,
      location: r.location.trim(),
      skills: r.skills.trim(),
      hours: Math.round(r.hours * 10) / 10,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sprat logbook detection and parsing
// ---------------------------------------------------------------------------

type SpratRow = Record<string, unknown>;

/**
 * Normalise a US-style date string (M/D/YYYY) to ISO YYYY-MM-DD.
 * Also handles ISO format directly.
 */
function normalizeSpratDate(val: unknown): string {
  if (!val) return "";
  const str = String(val).trim();
  if (!str) return "";

  // Try ISO / unambiguous first (new Date handles these well)
  const iso = new Date(str);
  if (!Number.isNaN(iso.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }

  // M/D/YYYY or MM/DD/YYYY
  const mdyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    const d2 = new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
    if (!Number.isNaN(d2.getTime())) {
      return d2.toISOString().slice(0, 10);
    }
  }

  // Fallback: let JS parse it and hope for the best
  const fallback = new Date(str);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback.toISOString().slice(0, 10);
  }
  return "";
}

// ---- Xlsx-based Sprat parser -----------------------------------------------

const SPRAT_REQUIRED_COLUMNS = new Set([
  "start_date",
  "finish_date",
  "hours_worked",
  "minutes_worked",
]);

/**
 * Try to parse an xlsx buffer as a Sprat export.
 * Returns null if the file does not look like a Sprat export.
 */
async function parseSpratXlsx(buffer: Buffer): Promise<SpratRow[] | null> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    return null;
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) return null;

  const rows: SpratRow[] = [];
  let headers: string[] = [];

  sheet.eachRow((row, rowNumber) => {
    const values = (row.values as (ExcelJS.CellValue | null | undefined)[]).slice(1);
    if (rowNumber === 1) {
      headers = values.map((v) => (v !== null && v !== undefined ? String(v) : ""));
    } else {
      if (values.every((v) => v === null || v === undefined || String(v).trim() === "")) return;
      const obj: SpratRow = {};
      headers.forEach((h, i) => {
        const val = values[i];
        if (val instanceof Date) {
          obj[h] = val.toISOString().slice(0, 10);
        } else {
          obj[h] = val !== null && val !== undefined ? String(val) : "";
        }
      });
      rows.push(obj);
    }
  });

  if (rows.length === 0) return null;

  const firstKeys = new Set(
    Object.keys(rows[0]).map((k) => k.toLowerCase().trim()),
  );
  for (const col of SPRAT_REQUIRED_COLUMNS) {
    if (!firstKeys.has(col)) return null;
  }

  return rows;
}

function getSpratField(row: SpratRow, ...keys: string[]): string {
  for (const key of keys) {
    for (const rowKey of Object.keys(row)) {
      if (rowKey.toLowerCase().trim() === key.toLowerCase()) {
        const v = row[rowKey];
        if (v !== undefined && v !== null && String(v).trim() !== "") {
          return String(v).trim();
        }
      }
    }
  }
  return "";
}

function spratRowsToRopeRows(spratRows: SpratRow[]): ExtractedRopeRow[] {
  const out: ExtractedRopeRow[] = [];
  for (const row of spratRows) {
    const startDate = normalizeSpratDate(getSpratField(row, "start_date"));
    const endDate = normalizeSpratDate(getSpratField(row, "finish_date"));
    const hoursStr = getSpratField(row, "hours_worked");
    const minutesStr = getSpratField(row, "minutes_worked");
    const location =
      getSpratField(row, "location") || getSpratField(row, "company_client");
    const skills = getSpratField(row, "work_codes");

    if (!startDate || !endDate) continue;

    const hoursWorked = parseFloat(hoursStr) || 0;
    const minutesWorked = parseFloat(minutesStr) || 0;
    const totalHours =
      Math.round((hoursWorked + minutesWorked / 60) * 10) / 10;

    if (totalHours <= 0) continue;

    out.push({
      startDate,
      endDate,
      location: location || "Unknown",
      skills: skills || "",
      hours: totalHours,
    });
  }
  return out;
}

// ---- PDF-based Sprat parser ------------------------------------------------

/**
 * Extract plain text from a PDF buffer using pdf-parse.
 * Returns an empty string on failure.
 */
async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    // pdf-parse v2 uses a class-based API with LoadParameters
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    return result.text ?? "";
  } catch {
    return "";
  }
}

/**
 * Check whether extracted PDF text looks like a Sprat logbook export.
 * Sprat PDFs always contain "hours_worked" and "minutes_worked" as column
 * header tokens, and section markers of the form "-- N of M --".
 */
function isSpratPdfText(text: string): boolean {
  return text.includes("hours_worked") && text.includes("minutes_worked");
}

/**
 * The Sprat PDF renders each column as a vertical strip on its own "page".
 * Pages are separated by "-- N of M --" markers.
 *
 * Expected section order (0-indexed):
 *   0 — "start_date finish_date company_client" header + data rows
 *   1 — "location" header + data rows
 *   2 — "work_codes" header + data rows
 *   3 — "Name" header + data rows          (skipped)
 *   4 — "details" header + data rows       (skipped)
 *   5 — "supervisor hours_worked minutes_worked status" header + data rows
 *   6 — trailing empty section
 */
function parseSpratPdfText(text: string): ExtractedRopeRow[] | null {
  // Split on "-- N of M --" section markers
  const sections = text
    .split(/--\s*\d+\s*of\s*\d+\s*--/i)
    .map((s) => s.trim());

  // Must have at least the dates section + hours section
  if (sections.length < 6) return null;

  // --- Section 0: dates + company -----------------------------------------
  const dateLines = sections[0]
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Skip the header row (contains "start_date" literally)
  const dateDataLines = dateLines.filter(
    (l) => !/^\s*start_date/i.test(l),
  );

  // Each date line: "M/D/YYYY M/D/YYYY CompanyName"
  const DATE_RE = /^(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*(.*)/;
  const parsedDates = dateDataLines.map((line) => {
    const m = line.match(DATE_RE);
    if (!m) return null;
    return {
      startDate: normalizeSpratDate(m[1]),
      endDate: normalizeSpratDate(m[2]),
      company: m[3].trim(),
    };
  });

  // --- Section 1: location ------------------------------------------------
  const locationLines = sectionDataLines(sections[1]);

  // --- Section 2: work_codes ----------------------------------------------
  const workCodeLines = sectionDataLines(sections[2]);

  // --- Section 5: supervisor, hours, minutes, status ----------------------
  const hoursSection = sections[5] ?? "";
  const hoursDataLines = sectionDataLines(hoursSection);

  // Parse "SupervisorName hours minutes status"
  // The last token is status, before that minutes, before that hours, rest is supervisor
  const HOURS_RE =
    /^(.*?)\s+(\d+)\s+(\d+)\s+(\S+)\s*$/;
  const parsedHours = hoursDataLines.map((line) => {
    const m = line.match(HOURS_RE);
    if (!m) return null;
    return {
      hoursWorked: parseInt(m[2], 10),
      minutesWorked: parseInt(m[3], 10),
      status: m[4],
    };
  });

  // Zip all sections together (use date row count as authoritative length)
  const rowCount = parsedDates.length;
  if (rowCount === 0) return null;

  const out: ExtractedRopeRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const dateRow = parsedDates[i];
    if (!dateRow || !dateRow.startDate || !dateRow.endDate) continue;

    const location =
      (locationLines[i] ?? "").trim() || dateRow.company || "Unknown";
    const skills = (workCodeLines[i] ?? "").trim();
    const hoursRow = parsedHours[i];

    const hoursWorked = hoursRow?.hoursWorked ?? 0;
    const minutesWorked = hoursRow?.minutesWorked ?? 0;
    const totalHours =
      Math.round((hoursWorked + minutesWorked / 60) * 10) / 10;

    if (totalHours <= 0) continue;

    out.push({
      startDate: dateRow.startDate,
      endDate: dateRow.endDate,
      location,
      skills,
      hours: totalHours,
    });
  }

  return out.length > 0 ? out : null;
}

/** Return the data lines from a section (stripping the first header line). */
function sectionDataLines(section: string): string[] {
  const lines = section
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // Drop the first line (column header)
  return lines.slice(1);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function extractOJTRows(
  buffer: Buffer,
  contentType: string,
  filename = "upload.pdf",
): Promise<ExtractedOJTRow[]> {
  if (!isImageMime(contentType) && !isPdfMime(contentType)) {
    throw new Error(
      "Unsupported file type. Please upload a PDF or image (JPG, PNG, WEBP).",
    );
  }
  const parsed = await callVisionExtraction(
    buffer,
    contentType,
    OJT_INSTRUCTIONS,
    filename,
  );
  return sanitizeOJTRows(parsed);
}

export async function extractRopeRows(
  buffer: Buffer,
  contentType: string,
  filename = "upload.pdf",
): Promise<ExtractedRopeRow[]> {
  // --- xlsx Sprat exports ---
  if (isXlsxMime(contentType)) {
    const spratRows = await parseSpratXlsx(buffer);
    if (!spratRows) {
      throw new Error(
        "Could not read this spreadsheet as a Sprat export. " +
          "Make sure you upload a Sprat .xlsx logbook export.",
      );
    }
    return spratRowsToRopeRows(spratRows);
  }

  if (!isImageMime(contentType) && !isPdfMime(contentType)) {
    throw new Error(
      "Unsupported file type. Please upload a PDF, image (JPG, PNG, WEBP), or Sprat .xlsx export.",
    );
  }

  // --- PDF: try Sprat deterministic path first ---
  if (isPdfMime(contentType)) {
    const text = await extractPdfText(buffer);
    if (text && isSpratPdfText(text)) {
      const rows = parseSpratPdfText(text);
      if (rows && rows.length > 0) {
        return rows;
      }
      // Detected as Sprat but parsing produced nothing — surface a clear
      // error rather than silently calling the AI vision path.
      throw new Error(
        "This looks like a Sprat logbook PDF, but no rows could be parsed. " +
          "Please export a fresh copy from Sprat and try again.",
      );
    }
  }

  // --- Fall back to AI vision extraction for non-Sprat PDFs / images ---
  const parsed = await callVisionExtraction(
    buffer,
    contentType,
    ROPE_INSTRUCTIONS,
    filename,
  );
  return sanitizeRopeRows(parsed);
}
