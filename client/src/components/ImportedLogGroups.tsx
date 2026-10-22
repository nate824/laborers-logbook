import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { FileText, Trash2 } from "lucide-react";
import { SourceDocumentLink } from "@/components/SourceDocumentLink";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ImportedRecord {
  id: number;
  importedAt?: Date | string | null;
  sourceDocumentKey?: string | null;
  sourceDocumentName?: string | null;
}

interface ImportGroup {
  sourceDocumentKey: string;
  sourceDocumentName: string | null;
  count: number;
  importedAt: Date | string | null;
  firstRecordId: number;
}

interface ImportedLogGroupsProps {
  records: ImportedRecord[];
  recordType: "entry" | "rope";
}

export function ImportedLogGroups({
  records,
  recordType,
}: ImportedLogGroupsProps) {
  const { toast } = useToast();

  const groups = useMemo<ImportGroup[]>(() => {
    const map = new Map<string, ImportGroup>();
    for (const r of records) {
      if (!r.importedAt || !r.sourceDocumentKey) continue;
      const key = r.sourceDocumentKey;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, {
          sourceDocumentKey: key,
          sourceDocumentName: r.sourceDocumentName ?? null,
          count: 1,
          importedAt: r.importedAt,
          firstRecordId: r.id,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const at = a.importedAt ? new Date(a.importedAt).getTime() : 0;
      const bt = b.importedAt ? new Date(b.importedAt).getTime() : 0;
      return bt - at;
    });
  }, [records]);

  const deleteImport = useMutation({
    mutationFn: async (sourceDocumentKey: string) => {
      const params = new URLSearchParams({ sourceDocumentKey });
      await apiRequest("DELETE", `/api/imports?${params.toString()}`);
    },
    onSuccess: () => {
      toast({
        title: "Import removed",
        description:
          "All field-hour and rope-hour entries from that signed log were deleted.",
      });
      // The endpoint deletes both field-hours entries and rope hours that share the
      // same sourceDocumentKey, so refresh both caches regardless of which
      // page triggered the action.
      queryClient.invalidateQueries({ queryKey: ["/api/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rope-hours"] });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Please try again.";
      toast({
        title: "Could not remove import",
        description: message,
        variant: "destructive",
      });
    },
  });

  if (groups.length === 0) return null;

  const labelSingular =
    recordType === "entry" ? "field-hour entry" : "rope-hour entry";
  const labelPlural =
    recordType === "entry" ? "field-hour entries" : "rope-hour entries";

  return (
    <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
      <h3 className="text-sm font-semibold text-neutral-900 mb-3">
        Imported signed logs
      </h3>
      <ul className="divide-y divide-neutral-200">
        {groups.map((group) => (
          <li
            key={group.sourceDocumentKey}
            className="py-2 flex items-center justify-between gap-3 flex-wrap"
          >
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <FileText className="h-4 w-4 text-neutral-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm text-neutral-800 truncate">
                  {group.sourceDocumentName || "Signed log"}
                </div>
                <div className="text-xs text-neutral-500">
                  {group.count}{" "}
                  {group.count === 1 ? labelSingular : labelPlural}
                  {group.importedAt
                    ? ` · imported ${new Date(group.importedAt).toLocaleDateString()}`
                    : ""}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <SourceDocumentLink
                recordType={recordType}
                recordId={group.firstRecordId}
              />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    disabled={deleteImport.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Remove this import
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Remove all entries from this signed log?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This will delete {group.count}{" "}
                      {group.count === 1 ? "entry" : "entries"} imported from{" "}
                      {group.sourceDocumentName || "this signed log"}. If no
                      other records reference the file, it will also be removed
                      from storage. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        deleteImport.mutate(group.sourceDocumentKey)
                      }
                      className="bg-red-600 hover:bg-red-700"
                    >
                      Remove all
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
