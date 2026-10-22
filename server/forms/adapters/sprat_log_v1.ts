import type { RopeAdapter, FieldValues } from "../types";
import { chunk, EmptyExportError } from "../types";
import type { Supervisor } from "@shared/schema";

const MAX_ROWS = 6;

function formatUtcDate(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

function formatDateRange(start: Date, end: Date): string {
  const s = formatUtcDate(start);
  const e = formatUtcDate(end);
  return s === e ? s : `${s} - ${e}`;
}

function findSupervisor(supervisors: Supervisor[], name: string | null): Supervisor | undefined {
  if (!name) return undefined;
  return supervisors.find((s) => s.name === name);
}

export const spratAdapter: RopeAdapter = ({ ropeHours, profile: _profile, supervisors, headerOverrides }) => {
  if (ropeHours.length === 0) throw new EmptyExportError();

  const sorted = [...ropeHours].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  // One page per chunk of MAX_ROWS; hours_this_page totals each page's own rows.
  return chunk(sorted, MAX_ROWS).map((pageRope) => {
    const out: FieldValues = {};
    let pageTotal = 0;

    pageRope.forEach((rope, i) => {
      const rowNum = i + 1;
      out[`row_${rowNum}_date`] = formatDateRange(rope.startDate, rope.endDate);
      out[`row_${rowNum}_employer`] = rope.employer ?? "";
      out[`row_${rowNum}_work_details`] = rope.workDetails ?? "";
      out[`row_${rowNum}_rope_access_details`] = rope.skills;
      out[`row_${rowNum}_hours_worked`] = String(rope.hours);

      const sup = findSupervisor(supervisors, rope.verifiedBy);
      out[`row_${rowNum}_signature_logid`] =
        sup && sup.spratNumber
          ? `${rope.verifiedBy} #${sup.spratNumber}`
          : rope.verifiedBy ?? "";

      pageTotal += rope.hours;
    });

    if (pageTotal > 0) out.hours_this_page = String(pageTotal);

    // Header overrides shallow-merged at the end.
    Object.assign(out, headerOverrides ?? {});
    return out;
  });
};
