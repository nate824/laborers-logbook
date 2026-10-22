import { formatCalendarDate, todayLocalISODate } from "@shared/dates";
import { Certification, Entry, RopeHours, Supervisor, User, fieldMethodLabel } from "@shared/schema";
import { buildLogSheet, type LogSheetSpec, type SheetCell } from "@/lib/logSheet";

// Builds the export PDFs in the layout of the Access Limited paper logbook:
// one sheet per field method (Drilling Log, Nozzleman Log …) and the
// "Work Log - Rope Hours" page, plus SPRAT- and IRATA-style rope sheets for
// certification bodies. Only verified (signed-off or imported from a signed
// log) records are exported.

export type RopeSheetStyle = "acl" | "sprat" | "irata";

export interface ExportFile {
  key: string; // method code or rope style
  label: string; // "Drilling Log", "SPRAT-style log"
  fileName: string;
  count: number;
  hours: number;
  build: () => Blob;
}

const FOOTNOTE =
  "Signatures are digital sign-offs recorded in the Access Limited Logbook: each row was confirmed by the named signer through a unique verification link, or imported from a signed paper log.";

// Sheet title per method, as printed in the logbook.
const FIELD_LOG_TITLES: Record<string, string> = {
  DRILLING: "Drilling Log",
  SHOTCRETE: "Nozzleman Log",
  SCALING: "Scaling Log",
};

export function fieldLogTitle(method: string) {
  return FIELD_LOG_TITLES[method] ?? `${fieldMethodLabel(method)} Log`;
}

type Person = Pick<User, "name" | "email" | "employeeNumber">;

function personOf(user: Person) {
  return { name: user.name || user.email || "", employeeNumber: user.employeeNumber };
}

function safeName(s: string) {
  return s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "User";
}

function signedOn(d: Date | string | null | undefined) {
  if (!d) return "";
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US");
}

function signatureCell(
  record: { verifiedBy: string | null; verifiedAt: Date | string | null; importedAt?: Date | string | null; sourceDocumentName?: string | null },
  certNumber?: string | null,
) {
  if (record.importedAt) {
    return record.sourceDocumentName ? `Signed paper log: ${record.sourceDocumentName}` : "Signed paper log";
  }
  const who = record.verifiedBy ?? "";
  const withNo = certNumber ? `${who} #${certNumber}` : who;
  const when = signedOn(record.verifiedAt);
  return when ? `${withNo}\nVerified ${when}` : withNo;
}

function byDate<T>(get: (r: T) => Date | string) {
  return (a: T, b: T) => new Date(get(a)).getTime() - new Date(get(b)).getTime();
}

function toBlob(spec: LogSheetSpec) {
  return buildLogSheet(spec).output("blob");
}

function num(v: string | undefined) {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
}

function choice(options: string[], value: string | undefined): SheetCell {
  return { choices: options, selected: value ? value.split(",") : [] };
}

// Two logbook fields that share one column ("Hole Depth & Size / Total LF").
function stacked(...parts: (string | undefined)[]) {
  return parts.filter(Boolean).join("\n");
}

export function fieldHoursSpec(entries: Entry[], method: string, user: Person): LogSheetSpec {
  const rows = entries
    .filter((e) => e.verified && e.method === method)
    .sort(byDate((e) => e.date));
  const d = (e: Entry) => e.details ?? {};
  const base = { title: fieldLogTitle(method), person: personOf(user), footnote: FOOTNOTE };

  if (method === "DRILLING") {
    // Logbook pages 110–111.
    return {
      ...base,
      columns: [
        { header: "Type", width: 14 },
        { header: "Drill", width: 14 },
        { header: "Hole Depth & Size\nTotal LF", width: 15 },
        { header: "Drilling Conditions &\nAngle", width: 18 },
        { header: "Supervisor Signature", width: 20 },
        { header: "Date", width: 10 },
        { header: "Job #", width: 9 },
      ],
      rows: rows.map((e) => [
        d(e).type ?? "",
        d(e).drill ?? "",
        stacked(d(e).holeDepthSize, d(e).totalLf && `${d(e).totalLf} LF`),
        stacked(d(e).conditions, d(e).angle),
        signatureCell(e),
        formatCalendarDate(e.date),
        d(e).jobNumber ?? "",
      ]),
      totals: [{ label: "LF", values: rows.map((e) => num(d(e).totalLf)) }],
    };
  }

  if (method === "SHOTCRETE") {
    // Logbook pages 127–128 ("Nozzelman Log").
    return {
      ...base,
      columns: [
        { header: "Job #", width: 8 },
        { header: "Employer", width: 13 },
        { header: "Dry Wet", width: 9 },
        { header: "Hours", width: 6, align: "right" },
        { header: "SQ FT", width: 7, align: "right" },
        { header: "Vert. Horz.", width: 10 },
        { header: "Start Date", width: 9 },
        { header: "End Date", width: 9 },
        { header: "Thickness", width: 8 },
        { header: "Supervisor Signature", width: 21 },
      ],
      rows: rows.map((e) => [
        d(e).jobNumber ?? "",
        d(e).employer ?? "",
        choice(["Dry", "Wet"], d(e).process),
        String(e.hours),
        d(e).sqft ?? "",
        choice(["Vert.", "Horz."], d(e).orientation),
        formatCalendarDate(e.date),
        formatCalendarDate(d(e).endDate || e.date),
        d(e).thickness ?? "",
        signatureCell(e),
      ]),
      totals: [
        { label: "Hours", values: rows.map((e) => e.hours) },
        { label: "SQ FT", values: rows.map((e) => num(d(e).sqft)) },
      ],
    };
  }

  // No logbook page yet: a simple daily sheet.
  return {
    ...base,
    columns: [
      { header: "Date", width: 12 },
      { header: "Job #", width: 10 },
      { header: "Location", width: 34 },
      { header: "Hours Worked", width: 10, align: "right" },
      { header: "Supervisor Signature", width: 30 },
    ],
    rows: rows.map((e) => [
      formatCalendarDate(e.date),
      d(e).jobNumber ?? "",
      e.location,
      String(e.hours),
      signatureCell(e),
    ]),
    totals: [{ label: "Hours", values: rows.map((e) => e.hours) }],
  };
}

function ropeDates(r: RopeHours) {
  const s = formatCalendarDate(r.startDate);
  const e = formatCalendarDate(r.endDate);
  return s === e ? s : `${s} – ${e}`;
}

// Issue date of the technician's most recent rope-access certification
// (SPRAT / IRATA), for "Total Work Hours Since Previous Certification".
export function lastRopeCertDate(certs: Pick<Certification, "name" | "method" | "issuingBody" | "issueDate">[]): Date | null {
  const dates = certs
    .filter((c) => c.issueDate && /sprat|irata|rope/i.test(`${c.issuingBody ?? ""} ${c.method ?? ""} ${c.name}`))
    .map((c) => new Date(c.issueDate!))
    .filter((d) => !Number.isNaN(d.getTime()));
  return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
}

export function ropeHoursSpec(
  ropeHours: RopeHours[],
  style: RopeSheetStyle,
  user: Person,
  supervisors: Supervisor[],
  lastCertification: Date | null = null,
): LogSheetSpec {
  const rows = ropeHours.filter((r) => r.verified).sort(byDate((r) => r.startDate));
  const signer = (r: RopeHours) => supervisors.find((s) => s.name === r.verifiedBy);
  const totals = [{ label: "Hours", values: rows.map((r) => r.hours) }];

  if (style === "acl") {
    // Logbook pages 60–61, "Work Log - Rope Hours".
    const since = lastCertification
      ? rows.filter((r) => new Date(r.startDate) >= lastCertification).reduce((s, r) => s + r.hours, 0)
      : null;
    return {
      title: "Work Log - Rope Hours",
      person: personOf(user),
      columns: [
        { header: "Date(s) of Work", width: 14 },
        { header: "Project Number", width: 12 },
        { header: "Work Code", width: 10 },
        { header: "Work Details", width: 30 },
        { header: "Supervisor Signature &\nLog Line", width: 21 },
        { header: "Hours Worked", width: 9, align: "right" },
      ],
      rows: rows.map((r) => [
        ropeDates(r),
        r.projectNumber ?? "",
        r.workCode ?? "",
        [r.workDetails, r.skills].filter(Boolean).join(" — "),
        signatureCell(r, signer(r)?.spratNumber ?? signer(r)?.irataNumber),
        String(r.hours),
      ]),
      totals,
      summary: {
        label: "Total Work Hours Since Previous Certification",
        value: since === null ? "" : `${Number.isInteger(since) ? since : since.toFixed(1)}`,
      },
      footnote:
        FOOTNOTE +
        (lastCertification ? ` Previous certification: ${formatCalendarDate(lastCertification)}.` : ""),
    };
  }

  if (style === "sprat") {
    return {
      title: "Rope Access Experience Log (SPRAT)",
      person: personOf(user),
      columns: [
        { header: "Date(s) of Work", width: 15 },
        { header: "Employer", width: 15 },
        { header: "Work Details", width: 24 },
        { header: "Rope Access Details", width: 24 },
        { header: "Signature and Log #", width: 21 },
        { header: "Hours Worked", width: 9, align: "right" },
      ],
      rows: rows.map((r) => [
        ropeDates(r),
        r.employer ?? "",
        r.workDetails ?? "",
        r.skills,
        signatureCell(r, signer(r)?.spratNumber),
        String(r.hours),
      ]),
      totals,
      footnote: FOOTNOTE,
    };
  }

  return {
    title: "Work Experience (IRATA)",
    person: personOf(user),
    columns: [
      { header: "Date", width: 14 },
      { header: "Employing Company", width: 15 },
      { header: "Details of task being undertaken", width: 27 },
      { header: "Location", width: 17 },
      { header: "Hours worked", width: 9, align: "right" },
      { header: "Max Height Worked", width: 10 },
      { header: "Supervisor's Signature", width: 20 },
    ],
    rows: rows.map((r) => [
      ropeDates(r),
      r.employer ?? "",
      r.workDetails ?? r.skills,
      r.location,
      String(r.hours),
      r.maxHeight ?? "",
      signatureCell(r, signer(r)?.irataNumber),
    ]),
    totals,
    footnote: FOOTNOTE,
  };
}

// One file per field method that has verified hours.
export function fieldHoursExports(entries: Entry[], user: Person, methods: string[]): ExportFile[] {
  const stamp = todayLocalISODate();
  return methods.map((method) => {
    const verified = entries.filter((e) => e.verified && e.method === method);
    return {
      key: method,
      label: fieldLogTitle(method),
      fileName: `ACL_${safeName(fieldLogTitle(method))}_${safeName(user.name || "")}_${stamp}.pdf`,
      count: verified.length,
      hours: verified.reduce((s, e) => s + e.hours, 0),
      build: () => toBlob(fieldHoursSpec(entries, method, user)),
    };
  });
}

const ROPE_STYLES: { style: RopeSheetStyle; label: string; file: string }[] = [
  { style: "acl", label: "ACL Work Log - Rope Hours", file: "ACL_Rope_Work_Log" },
  { style: "sprat", label: "SPRAT-style log", file: "SPRAT_Rope_Log" },
  { style: "irata", label: "IRATA-style log", file: "IRATA_Rope_Log" },
];

export function ropeHoursExports(
  ropeHours: RopeHours[],
  user: Person,
  supervisors: Supervisor[],
  lastCertification: Date | null = null,
): ExportFile[] {
  const stamp = todayLocalISODate();
  const verified = ropeHours.filter((r) => r.verified);
  const hours = verified.reduce((s, r) => s + r.hours, 0);
  return ROPE_STYLES.map(({ style, label, file }) => ({
    key: style,
    label,
    fileName: `${file}_${safeName(user.name || "")}_${stamp}.pdf`,
    count: verified.length,
    hours,
    build: () => toBlob(ropeHoursSpec(ropeHours, style, user, supervisors, lastCertification)),
  }));
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Web Share with files: phones' share sheet (text, email, AirDrop…). Needs a
// secure context (https or localhost).
export function canShareFiles() {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([""], "x.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}

export async function shareFiles(files: { blob: Blob; fileName: string }[], title: string) {
  const list = files.map((f) => new File([f.blob], f.fileName, { type: "application/pdf" }));
  await navigator.share({ files: list, title });
}
