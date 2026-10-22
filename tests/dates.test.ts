import { describe, it, expect } from "vitest";
import { formatCalendarDate, todayLocalISODate } from "@shared/dates";

// Run with TZ=America/Los_Angeles
// or any zone west of UTC to exercise the original bug; the assertions hold
// in every zone.
describe("formatCalendarDate", () => {
  const stored = new Date("2026-10-16"); // how a picked day is stored: UTC midnight

  it("shows the picked day, not the previous evening", () => {
    expect(formatCalendarDate(stored, "medium")).toMatch(/Oct 16, 2026/);
    expect(formatCalendarDate("2026-10-16T00:00:00.000Z")).toContain("16");
    expect(formatCalendarDate("2026-10-16T00:00:00.000Z")).not.toContain("15");
  });

  it("forces UTC for custom Intl options too", () => {
    expect(
      formatCalendarDate(stored, { weekday: "short", month: "short", day: "numeric" }),
    ).toMatch(/Fri.*Oct 16/);
  });

  it("returns empty string for missing or invalid input", () => {
    expect(formatCalendarDate(null)).toBe("");
    expect(formatCalendarDate(undefined)).toBe("");
    expect(formatCalendarDate("not a date")).toBe("");
  });
});

describe("todayLocalISODate", () => {
  it("uses the local calendar day, not the UTC one", () => {
    // 6pm on Oct 16 local time is already Oct 17 in UTC for zones west of it.
    const evening = new Date(2026, 9, 16, 18, 0, 0);
    expect(todayLocalISODate(evening)).toBe("2026-10-16");
  });
});
