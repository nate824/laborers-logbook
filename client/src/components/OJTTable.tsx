import { useMemo, useState } from "react";
import { Entry, FieldMethods, fieldMethodLabel } from "@shared/schema";
import { EntryRow } from "@/components/EntryRow";
import { ImportedLogGroups } from "@/components/ImportedLogGroups";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronRight, ListChecks } from "lucide-react";

const FIELD_METHOD_KEYS = Object.keys(FieldMethods);

interface OJTTableProps {
  entries: Entry[];
  onVerifyRequest: (entry: Entry) => void;
  selectedEntryIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onBatchVerifyRequest: () => void;
  onEditEntry?: (entry: Entry) => void;
}

export function OJTTable({
  entries,
  onVerifyRequest,
  selectedEntryIds,
  onToggleSelect,
  onBatchVerifyRequest,
  onEditEntry,
}: OJTTableProps) {
  const totals = useMemo(() => {
    return entries.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.method] = (acc[entry.method] ?? 0) + entry.hours;
      return acc;
    }, {});
  }, [entries]);

  // Collapsed by default — the list can get very long, so show only totals
  // until the user expands it.
  const [open, setOpen] = useState(false);

  // Per-method totals across every method present, plus a grand total, for
  // the collapsed summary.
  const methodTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) map.set(e.method, (map.get(e.method) ?? 0) + e.hours);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [entries]);
  const grandTotal = useMemo(
    () => entries.reduce((s, e) => s + e.hours, 0),
    [entries],
  );

  const unverifiedEntries = entries.filter((e) => !e.verified);
  // Selectable rows are anything not imported (imported rows show their own
  // group controls).
  const selectableEntries = entries.filter((e) => !(e as Entry & { imported?: boolean }).imported);
  const allSelectableSelected =
    selectableEntries.length > 0 &&
    selectableEntries.every((e) => selectedEntryIds.has(e.id));

  const handleSelectAll = () => {
    if (allSelectableSelected) {
      selectableEntries.forEach((e) => onToggleSelect(e.id));
    } else {
      selectableEntries
        .filter((e) => !selectedEntryIds.has(e.id))
        .forEach((e) => onToggleSelect(e.id));
    }
  };

  // Batch-verify only makes sense when every selected entry is unverified.
  const selectedUnverifiedCount = entries.filter(
    (e) => selectedEntryIds.has(e.id) && !e.verified,
  ).length;
  const canBatchVerify =
    selectedUnverifiedCount >= 2 &&
    selectedUnverifiedCount === selectedEntryIds.size;

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-lg font-semibold text-neutral-900"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-5 w-5 text-neutral-500" />
          ) : (
            <ChevronRight className="h-5 w-5 text-neutral-500" />
          )}
          Work Hours Log
        </button>
        <div className="flex flex-wrap gap-2">
          {canBatchVerify && (
            <Button
              onClick={onBatchVerifyRequest}
              size="sm"
              className="flex items-center gap-2"
            >
              <ListChecks className="h-4 w-4" />
              Request Batch Verification ({selectedUnverifiedCount} entries)
            </Button>
          )}
        </div>
      </div>

      {!open && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-sm font-semibold text-neutral-900">
            {grandTotal.toFixed(1)} total hours
          </span>
          <span className="text-sm text-neutral-500">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </span>
          {methodTotals.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {methodTotals.map(([m, h]) => (
                <span
                  key={m}
                  className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700"
                >
                  {fieldMethodLabel(m)} {h.toFixed(1)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {open && (
      <>
      <ImportedLogGroups records={entries} recordType="entry" />
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-neutral-200 ojt-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-3 text-left w-8">
                {selectableEntries.length > 0 && (
                  <Checkbox
                    checked={allSelectableSelected}
                    onCheckedChange={handleSelectAll}
                    aria-label="Select all entries"
                  />
                )}
              </th>
              <th scope="col" className="px-4 py-3 text-left">Job Date</th>
              <th scope="col" className="px-4 py-3 text-left">Job Location</th>
              {FIELD_METHOD_KEYS.map((m) => (
                <th key={m} scope="col" className="px-4 py-3 text-left">
                  {fieldMethodLabel(m)}
                </th>
              ))}
              <th scope="col" className="px-4 py-3 text-left">Supervisor Signature</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-neutral-200">
            {entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                onVerifyRequest={onVerifyRequest}
                isSelected={selectedEntryIds.has(entry.id)}
                onToggleSelect={onToggleSelect}
                onEdit={onEditEntry}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-neutral-100">
              <td className="px-3 py-3"></td>
              <td colSpan={2} className="px-4 py-3 text-sm font-medium text-neutral-900">Total Hours:</td>
              {FIELD_METHOD_KEYS.map((m) => (
                <td key={m} className="px-4 py-3 text-sm font-medium text-neutral-900">
                  {(totals[m] ?? 0).toFixed(1)}
                </td>
              ))}
              <td className="px-4 py-3 text-sm font-medium text-neutral-900"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
        {unverifiedEntries.length > 0 && (
          <span>
            Select 2+ unverified entries to request batch verification.
          </span>
        )}
        <div className="flex items-center space-x-1 ml-auto">
          <span className="inline-block w-3 h-3 rounded-full bg-green-100"></span>
          <span>Verified Entry</span>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
