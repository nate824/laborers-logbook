import { formatCalendarDate } from "@shared/dates";
import { Entry, FieldMethods, entryDetailsSummary, fieldMethodLabel } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Pencil,
  FileText,
  Trash2,
  CloudOff,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { SourceDocumentLink } from "@/components/SourceDocumentLink";
import { VerificationProofModal } from "@/components/VerificationProofModal";
import { Fragment, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/lib/offline/online";
import {
  isPendingSync,
  getSyncFailure,
  retryFailedEntry,
  discardFailedEntry,
} from "@/lib/offline/mutations";

export function DeleteEntryButton({
  entry,
  isPending,
  onConfirm,
  warnVerified,
}: {
  entry: Entry;
  isPending: boolean;
  onConfirm: () => void;
  warnVerified?: boolean;
}) {
  const formatDate = (date: Date | string) => formatCalendarDate(date);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="text-xs px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
          aria-label="Delete entry"
          title="Delete entry"
          disabled={isPending}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
          <AlertDialogDescription>
            {warnVerified ? "This entry has already been verified. " : ""}
            This will permanently delete the work-hours entry from{" "}
            {formatDate(entry.date)} at {entry.location}. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-red-600 hover:bg-red-700"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Shared behavior for a field-hours record, used by the desktop table row
// (EntryRow) and the mobile card (EntryCard) so both stay in lockstep.
export function useEntryActions(
  entry: Entry,
  onVerifyRequest: (entry: Entry) => void,
) {
  const isImported = !!entry.importedAt;
  const { toast } = useToast();
  const online = useOnlineStatus();
  const e = entry as Entry & {
    _pendingSync?: boolean;
    _syncFailed?: string | null;
  };
  const pendingSync = isPendingSync(e);
  const syncFailed = getSyncFailure(e);

  const deleteMutation = useMutation<unknown, Error, number>({
    mutationKey: ["entries.delete"],
    onError: (error) => {
      toast({
        title: "Could not remove entry",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDelete = () => {
    deleteMutation.mutate(entry.id);
    toast({
      title:
        entry.id < 0
          ? "Removed pending entry"
          : online
          ? "Entry removed"
          : "Removed offline",
      description:
        entry.id < 0
          ? "The unsynced entry was discarded."
          : online
          ? "The work-hours entry has been deleted."
          : "We'll sync this deletion when you reconnect.",
    });
  };

  const handleVerifyClick = () => {
    if (!online) {
      toast({
        title: "Requires internet",
        description: "Connect to the internet to request verification.",
        variant: "destructive",
      });
      return;
    }
    if (pendingSync) {
      toast({
        title: "Wait for sync",
        description:
          "This entry hasn't synced yet. It will be available for verification once it syncs.",
      });
      return;
    }
    onVerifyRequest(entry);
  };

  const handleRetry = () => {
    retryFailedEntry(entry);
    toast({
      title: "Retrying…",
      description: "Sending this entry again.",
    });
  };

  const handleDiscard = () => {
    discardFailedEntry(entry);
    toast({
      title: "Entry discarded",
      description: "The failed entry has been removed.",
    });
  };

  return {
    isImported,
    online,
    pendingSync,
    syncFailed,
    deleteMutation,
    handleDelete,
    handleVerifyClick,
    handleRetry,
    handleDiscard,
  };
}

interface EntryRowProps {
  entry: Entry;
  onVerifyRequest: (entry: Entry) => void;
  isSelected?: boolean;
  onToggleSelect?: (id: number) => void;
  onEdit?: (entry: Entry) => void;
}

export function EntryRow({
  entry,
  onVerifyRequest,
  isSelected,
  onToggleSelect,
  onEdit,
}: EntryRowProps) {
  const {
    isImported,
    online,
    pendingSync,
    syncFailed,
    deleteMutation,
    handleDelete,
    handleVerifyClick,
    handleRetry,
    handleDiscard,
  } = useEntryActions(entry, onVerifyRequest);
  const [proofOpen, setProofOpen] = useState(false);

  const formatDate = (date: Date | string) => formatCalendarDate(date);

  const cellTextClass = isImported ? "text-neutral-500" : "text-neutral-900";

  const createHourCell = (method: string) => {
    if (entry.method === method) {
      return (
        <td
          className={`px-4 py-3 whitespace-nowrap text-sm ${cellTextClass}`}
        >
          {entry.hours.toFixed(1)}
        </td>
      );
    }
    return (
      <td
        className={`px-4 py-3 whitespace-nowrap text-sm ${cellTextClass}`}
      ></td>
    );
  };

  const rowClass = syncFailed
    ? "bg-red-50/60"
    : pendingSync
    ? "bg-amber-50/60"
    : isImported
    ? "bg-neutral-50 text-neutral-500"
    : entry.verified
    ? "bg-green-50"
    : isSelected
    ? "bg-primary/5"
    : "";

  // Pending (unsynced) and failed rows are always editable/deletable.
  // Verified and imported rows have their own action sets below.
  const showPendingControls = (pendingSync || !!syncFailed) && !isImported;

  return (
    <tr className={rowClass}>
      <td className="px-3 py-3 whitespace-nowrap">
        {!isImported &&
          !pendingSync &&
          !syncFailed &&
          onToggleSelect && (
            <Checkbox
              checked={isSelected ?? false}
              onCheckedChange={() => onToggleSelect(entry.id)}
              aria-label="Select entry"
            />
          )}
      </td>
      <td className={`px-4 py-3 whitespace-nowrap text-sm ${cellTextClass}`}>
        {formatDate(entry.date)}
      </td>
      <td className={`px-4 py-3 text-sm ${cellTextClass}`}>
        <div className="whitespace-nowrap">{entry.location}</div>
        {entryDetailsSummary(entry.method, entry.details) && (
          <div className="max-w-xs truncate text-xs text-muted-foreground" title={entryDetailsSummary(entry.method, entry.details)}>
            {entryDetailsSummary(entry.method, entry.details)}
          </div>
        )}
      </td>
      {Object.keys(FieldMethods).map((m) => (
        <Fragment key={m}>{createHourCell(m)}</Fragment>
      ))}
      <td className="px-4 py-3 whitespace-nowrap text-sm">
        {showPendingControls ? (
          <div className="flex items-center gap-2 flex-wrap">
            {syncFailed ? (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-xs"
                title={syncFailed}
              >
                <AlertTriangle className="h-3 w-3" />
                Sync failed
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs">
                <CloudOff className="h-3 w-3" />
                Pending sync
              </span>
            )}
            {syncFailed && (
              <Button
                onClick={handleRetry}
                size="sm"
                variant="outline"
                className="text-xs h-7 px-2"
                disabled={!online}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Retry
              </Button>
            )}
            {onEdit && (
              <Button
                onClick={() => onEdit(entry)}
                size="sm"
                variant="ghost"
                className="text-xs px-2"
                aria-label="Edit entry"
                title="Edit entry"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {syncFailed ? (
              <Button
                onClick={handleDiscard}
                size="sm"
                variant="ghost"
                className="text-xs px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                aria-label="Discard failed entry"
                title="Discard"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <DeleteEntryButton
                entry={entry}
                isPending={deleteMutation.isPending}
                onConfirm={handleDelete}
              />
            )}
          </div>
        ) : isImported ? (
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="h-3.5 w-3.5 text-neutral-500" />
            <span className="text-neutral-600">Imported from signed log</span>
            <SourceDocumentLink recordType="entry" recordId={entry.id} />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                  aria-label="Remove imported entry"
                  title="Remove imported entry"
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Remove
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Remove this imported entry?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This will delete the imported work-hours entry from{" "}
                    {formatDate(entry.date)} at {entry.location}. If no other
                    entries reference the uploaded log, the original file will
                    also be removed from storage. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : entry.verified ? (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setProofOpen(true)}
              className="inline-flex items-center text-green-700 hover:text-green-800 hover:underline"
              title="View verification record"
            >
              <svg
                className="mr-1.5 h-2 w-2 text-green-500"
                fill="currentColor"
                viewBox="0 0 8 8"
              >
                <circle cx="4" cy="4" r="3" />
              </svg>
              Verified by {entry.verifiedBy}
            </button>
            <DeleteEntryButton
              entry={entry}
              isPending={deleteMutation.isPending}
              onConfirm={handleDelete}
              warnVerified
            />
            <VerificationProofModal
              open={proofOpen}
              onOpenChange={setProofOpen}
              title="Field hours verification"
              record={entry}
              summaryRows={[
                { label: "Date", value: formatDate(entry.date) },
                { label: "Location", value: entry.location },
                { label: "Method", value: fieldMethodLabel(entry.method) },
                { label: "Hours", value: entry.hours.toFixed(1) },
              ]}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {onEdit && !entry.verificationRequestedAt && (
              <Button
                onClick={() => onEdit(entry)}
                size="sm"
                variant="ghost"
                className="text-xs px-2"
                aria-label="Edit entry"
                title="Edit entry"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              onClick={handleVerifyClick}
              size="sm"
              variant="outline"
              className="text-xs"
              disabled={!online}
              title={
                online
                  ? "Request verification"
                  : "Requires internet to request verification"
              }
            >
              Request Verification
            </Button>
            <DeleteEntryButton
              entry={entry}
              isPending={deleteMutation.isPending}
              onConfirm={handleDelete}
            />
          </div>
        )}
      </td>
    </tr>
  );
}
