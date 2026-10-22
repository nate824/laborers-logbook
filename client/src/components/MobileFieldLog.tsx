import { useMemo, useState } from "react";
import { Entry, fieldMethodLabel } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { EntryCard } from "@/components/EntryCard";
import { isPendingSync, getSyncFailure } from "@/lib/offline/mutations";
import { ClipboardList, Send, X } from "lucide-react";

interface MobileFieldLogProps {
  entries: Entry[];
  onVerifyRequest: (entry: Entry) => void;
  selectedEntryIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onClearSelection: () => void;
  onBatchVerifyRequest: () => void;
  onEditEntry?: (entry: Entry) => void;
}

// An entry can go into a verification request only if it's a real, synced,
// unverified, hand-logged row.
function isRequestable(entry: Entry) {
  const e = entry as Entry & { _pendingSync?: boolean; _syncFailed?: string | null };
  return !entry.verified && !entry.importedAt && !isPendingSync(e) && !getSyncFailure(e);
}

export function FieldHoursSummary({ entries }: { entries: Entry[] }) {
  const { total, verified, awaiting, byMethod } = useMemo(() => {
    const map = new Map<string, number>();
    let total = 0;
    let verified = 0;
    let awaiting = 0;
    for (const e of entries) {
      total += e.hours;
      if (e.verified) verified += e.hours;
      else if (e.verificationRequestedAt) awaiting += 1;
      map.set(e.method, (map.get(e.method) ?? 0) + e.hours);
    }
    return {
      total,
      verified,
      awaiting,
      byMethod: Array.from(map.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [entries]);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Total field hours
          </div>
          <div className="text-4xl font-bold tabular-nums text-foreground">
            {total.toFixed(1)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Verified
          </div>
          <div className="text-2xl font-semibold tabular-nums text-green-600">
            {verified.toFixed(1)}
          </div>
        </div>
      </div>
      {byMethod.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {byMethod.map(([m, h]) => (
            <span
              key={m}
              className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
            >
              {fieldMethodLabel(m)} · {h.toFixed(1)}h
            </span>
          ))}
        </div>
      )}
      {awaiting > 0 && (
        <p className="mt-3 text-sm text-amber-700">
          {awaiting} {awaiting === 1 ? "day is" : "days are"} awaiting a signature
        </p>
      )}
    </div>
  );
}

export function MobileFieldLog({
  entries,
  onVerifyRequest,
  selectedEntryIds,
  onToggleSelect,
  onClearSelection,
  onBatchVerifyRequest,
  onEditEntry,
}: MobileFieldLogProps) {
  const [selectMode, setSelectMode] = useState(false);
  const requestableCount = entries.filter(isRequestable).length;
  const selected = entries.filter((e) => selectedEntryIds.has(e.id));

  const exitSelect = () => {
    setSelectMode(false);
    onClearSelection();
  };

  const sendSelected = () => {
    if (selected.length === 1) {
      onVerifyRequest(selected[0]);
      exitSelect();
    } else if (selected.length > 1) {
      // Leave the selection for the batch modal; the page clears it on send.
      setSelectMode(false);
      onBatchVerifyRequest();
    }
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">
          Log <span className="text-sm font-normal text-muted-foreground">({entries.length})</span>
        </h2>
        {requestableCount > 1 &&
          (selectMode ? (
            <Button variant="ghost" className="h-10" onClick={exitSelect}>
              <X className="mr-1 h-4 w-4" /> Cancel
            </Button>
          ) : (
            <Button variant="ghost" className="h-10 text-primary" onClick={() => setSelectMode(true)}>
              Select to send
            </Button>
          ))}
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border p-8 text-center text-muted-foreground">
          <ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-50" />
          No field hours yet. Tap <span className="font-medium">Log Field Hours</span> to add your first day.
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onVerifyRequest={onVerifyRequest}
              onEdit={onEditEntry}
              selectMode={selectMode}
              selectable={isRequestable(entry)}
              isSelected={selectedEntryIds.has(entry.id)}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}

      {selectMode && (
        <div className="fixed inset-x-0 z-20 border-t border-border bg-card/95 p-3 backdrop-blur bottom-[calc(4rem+env(safe-area-inset-bottom))]">
          <Button
            className="h-12 w-full text-base"
            disabled={selected.length === 0}
            onClick={sendSelected}
          >
            <Send className="mr-2 h-4 w-4" />
            {selected.length === 0
              ? "Tap days to select"
              : `Request verification for ${selected.length} ${selected.length === 1 ? "day" : "days"}`}
          </Button>
        </div>
      )}
    </section>
  );
}
