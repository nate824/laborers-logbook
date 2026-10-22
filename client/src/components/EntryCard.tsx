import { useState } from "react";
import { formatCalendarDate } from "@shared/dates";
import { Entry, entryDetailsSummary, fieldMethodLabel } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CloudOff,
  FileText,
  MapPin,
  MoreVertical,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { SourceDocumentLink } from "@/components/SourceDocumentLink";
import { VerificationProofModal } from "@/components/VerificationProofModal";
import { useEntryActions } from "@/components/EntryRow";

interface EntryCardProps {
  entry: Entry;
  onVerifyRequest: (entry: Entry) => void;
  onEdit?: (entry: Entry) => void;
  selectMode?: boolean;
  selectable?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: number) => void;
}

// Mobile presentation of one field-hours day: everything fits in the width of
// a phone, the main action is a full-width button, secondary actions live in
// the ⋮ menu. Desktop keeps the tabular EntryRow.
export function EntryCard({
  entry,
  onVerifyRequest,
  onEdit,
  selectMode,
  selectable,
  isSelected,
  onToggleSelect,
}: EntryCardProps) {
  const {
    isImported,
    online,
    pendingSync,
    syncFailed,
    handleDelete,
    handleVerifyClick,
    handleRetry,
    handleDiscard,
  } = useEntryActions(entry, onVerifyRequest);
  const [proofOpen, setProofOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const requested = !!entry.verificationRequestedAt;
  const canEdit =
    !!onEdit && !isImported && (pendingSync || !!syncFailed || (!entry.verified && !requested));
  const showVerifyButton =
    !selectMode && !isImported && !entry.verified && !pendingSync && !syncFailed;

  const tone = syncFailed
    ? "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30"
    : pendingSync
    ? "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30"
    : entry.verified
    ? "border-green-200 bg-green-50/60 dark:border-green-900 dark:bg-green-950/30"
    : isSelected
    ? "border-primary bg-primary/5"
    : "border-border bg-card";

  const status = syncFailed ? (
    <span className="inline-flex items-center gap-1.5 text-sm text-red-700" title={syncFailed}>
      <AlertTriangle className="h-4 w-4" /> Sync failed
    </span>
  ) : pendingSync ? (
    <span className="inline-flex items-center gap-1.5 text-sm text-amber-700">
      <CloudOff className="h-4 w-4" /> Waiting to sync
    </span>
  ) : isImported ? (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <FileText className="h-4 w-4" /> Imported from signed log
    </span>
  ) : entry.verified ? (
    <button
      type="button"
      onClick={() => setProofOpen(true)}
      className="inline-flex min-w-0 items-center gap-1.5 text-left text-sm text-green-700 underline-offset-2 active:underline"
    >
      <CheckCircle2 className="h-4 w-4 shrink-0" />
      <span className="truncate">Verified by {entry.verifiedBy}</span>
    </button>
  ) : requested ? (
    <span className="inline-flex items-center gap-1.5 text-sm text-amber-700">
      <Clock className="h-4 w-4" /> Awaiting signature
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Clock className="h-4 w-4" /> Not yet verified
    </span>
  );

  const toggle = () => {
    if (selectMode && selectable) onToggleSelect?.(entry.id);
  };

  return (
    <div
      className={`rounded-xl border p-4 shadow-sm transition-colors ${tone} ${
        selectMode && !selectable ? "opacity-50" : ""
      }`}
      onClick={selectMode ? toggle : undefined}
      role={selectMode && selectable ? "checkbox" : undefined}
      aria-checked={selectMode && selectable ? !!isSelected : undefined}
    >
      <div className="flex items-start gap-3">
        {selectMode && (
          <Checkbox
            checked={!!isSelected}
            disabled={!selectable}
            onCheckedChange={toggle}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 h-5 w-5"
            aria-label="Select entry"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-foreground">
            {formatCalendarDate(entry.date, {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{entry.location}</span>
          </div>
          {entryDetailsSummary(entry.method, entry.details) && (
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {entryDetailsSummary(entry.method, entry.details)}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-bold leading-none tabular-nums text-foreground">
            {entry.hours.toFixed(1)}
            <span className="ml-0.5 text-sm font-medium text-muted-foreground">h</span>
          </div>
          <span className="mt-1.5 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {fieldMethodLabel(entry.method)}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">{status}</div>
        {isImported && !selectMode && (
          <SourceDocumentLink recordType="entry" recordId={entry.id} />
        )}
        {!selectMode && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0"
                aria-label="Entry actions"
              >
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {syncFailed && (
                <DropdownMenuItem className="py-3" disabled={!online} onSelect={handleRetry}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Retry sync
                </DropdownMenuItem>
              )}
              {canEdit && (
                <DropdownMenuItem className="py-3" onSelect={() => onEdit!(entry)}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit
                </DropdownMenuItem>
              )}
              {entry.verified && (
                <DropdownMenuItem className="py-3" onSelect={() => setProofOpen(true)}>
                  <CheckCircle2 className="mr-2 h-4 w-4" /> View verification
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="py-3 text-red-600 focus:text-red-700"
                onSelect={() => (syncFailed ? handleDiscard() : setConfirmDelete(true))}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {syncFailed ? "Discard" : isImported ? "Remove" : "Delete"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {showVerifyButton && (
        <Button
          type="button"
          variant="outline"
          className={`mt-3 h-11 w-full text-base ${
            requested ? "" : "border-primary/40 text-primary hover:bg-primary/5 hover:text-primary"
          }`}
          disabled={!online}
          onClick={handleVerifyClick}
        >
          <Send className="mr-2 h-4 w-4" />
          {!online
            ? "Verification needs internet"
            : requested
            ? "Resend verification request"
            : "Request verification"}
        </Button>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isImported ? "Remove this imported entry?" : "Delete this entry?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {entry.verified ? "This entry has already been verified. " : ""}
              This will permanently delete the work-hours entry from{" "}
              {formatCalendarDate(entry.date)} at {entry.location}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="h-11 bg-red-600 hover:bg-red-700">
              {isImported ? "Remove" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {entry.verified && (
        <VerificationProofModal
          open={proofOpen}
          onOpenChange={setProofOpen}
          title="Field hours verification"
          record={entry}
          summaryRows={[
            { label: "Date", value: formatCalendarDate(entry.date) },
            { label: "Location", value: entry.location },
            { label: "Method", value: fieldMethodLabel(entry.method) },
            { label: "Hours", value: entry.hours.toFixed(1) },
          ]}
        />
      )}
    </div>
  );
}
