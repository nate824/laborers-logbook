// Calendar dates — entries.date, ropeHours.startDate/endDate, certification
// issue/expiry — are picked as a day ("2026-10-16") and stored as midnight UTC
// of that day. Always format them in UTC: formatting in the viewer's local
// zone shows the previous day for anyone west of Greenwich.
//
// Real timestamps (createdAt, verifiedAt, importedAt, "now") are NOT calendar
// dates; keep formatting those in local time.

type DateInput = Date | string | number | null | undefined;

const SHORT: Intl.DateTimeFormatOptions = { timeZone: "UTC" };
const MEDIUM: Intl.DateTimeFormatOptions = {
  timeZone: "UTC",
  month: "short",
  day: "2-digit",
  year: "numeric",
};

/**
 * Format a stored calendar date. "short" → 10/16/2026, "medium" → Oct 16, 2026,
 * or pass Intl options (timeZone is always forced to UTC).
 * Returns "" for missing/invalid input.
 */
export function formatCalendarDate(
  value: DateInput,
  style: "short" | "medium" | Intl.DateTimeFormatOptions = "short",
): string {
  if (value === null || value === undefined || value === "") return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const options =
    style === "medium" ? MEDIUM : style === "short" ? SHORT : { ...style, timeZone: "UTC" };
  return d.toLocaleDateString(undefined, options);
}

/** Today's date in the user's local zone as YYYY-MM-DD (for date inputs). */
export function todayLocalISODate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
