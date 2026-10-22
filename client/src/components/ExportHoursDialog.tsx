import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Certification, Entry, FieldMethods, RopeHours, Supervisor, User } from "@shared/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Check, Download, FileSpreadsheet, Share2 } from "lucide-react";
import {
  canShareFiles,
  downloadBlob,
  fieldHoursExports,
  lastRopeCertDate,
  ropeHoursExports,
  shareFiles,
  type ExportFile,
} from "@/lib/exportSheets";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: Partial<User>;
} & ({ kind: "field"; entries: Entry[] } | { kind: "rope"; ropeHours: RopeHours[] });

// Export verified hours: pick which sheets (one logbook page per field method,
// or the ACL rope work log / SPRAT / IRATA style for rope), then download the PDFs or hand them to the phone's
// share sheet. PDFs are built on the device, so this works offline too.
export function ExportHoursDialog(props: Props) {
  const { open, onOpenChange, user } = props;
  const { toast } = useToast();
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const shareable = useMemo(() => canShareFiles(), []);

  const { data: supervisors = [] } = useQuery<Supervisor[]>({
    queryKey: ["/api/supervisors"],
    enabled: open && props.kind === "rope",
  });

  const { data: certifications = [] } = useQuery<Certification[]>({
    queryKey: ["/api/certifications"],
    enabled: open && props.kind === "rope",
  });

  const person = { name: user.name ?? "", email: user.email ?? "", employeeNumber: user.employeeNumber ?? null };
  const files: ExportFile[] =
    props.kind === "field"
      ? fieldHoursExports(props.entries, person, Object.keys(FieldMethods))
      : ropeHoursExports(props.ropeHours, person, supervisors, lastRopeCertDate(certifications));
  const available = files.filter((f) => f.count > 0);

  // Default selection each time it opens: every method with hours (field) or
  // just the ACL work log (rope).
  useEffect(() => {
    if (!open) return;
    setPicked(
      new Set(props.kind === "field" ? available.map((f) => f.key) : available.slice(0, 1).map((f) => f.key)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen = available.filter((f) => picked.has(f.key));
  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const build = () => chosen.map((f) => ({ blob: f.build(), fileName: f.fileName }));

  const handleDownload = async () => {
    setBusy("download");
    try {
      for (const f of build()) {
        downloadBlob(f.blob, f.fileName);
        // Some browsers drop back-to-back downloads; space them out.
        await new Promise((r) => setTimeout(r, 300));
      }
      toast({
        title: chosen.length === 1 ? "PDF downloaded" : `${chosen.length} PDFs downloaded`,
        description: chosen.map((f) => f.fileName).join(", "),
      });
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast({ title: "Export failed", description: "Couldn't build the PDF. Please try again.", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const handleShare = async () => {
    setBusy("share");
    try {
      await shareFiles(build(), props.kind === "field" ? "Field hours" : "Rope access hours");
      onOpenChange(false);
    } catch (error: any) {
      // AbortError = the user closed the share sheet; not a failure.
      if (error?.name !== "AbortError") {
        console.error(error);
        toast({ title: "Couldn't share", description: "Try Download PDF instead.", variant: "destructive" });
      }
    } finally {
      setBusy(null);
    }
  };

  const noun = props.kind === "field" ? "field hours" : "rope hours";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export {noun}</DialogTitle>
          <DialogDescription>
            {props.kind === "field"
              ? "Each method gets its own logbook sheet. Only verified hours are included."
              : "The ACL logbook's rope work log, or SPRAT / IRATA layout. Only verified hours are included."}
          </DialogDescription>
        </DialogHeader>

        {available.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            <FileSpreadsheet className="mx-auto mb-2 h-8 w-8 opacity-50" />
            No verified {noun} yet. Once a signer verifies your hours, you can export them here.
          </div>
        ) : (
          <div className="space-y-2" role="group" aria-label="Sheets to export">
            {files.map((f) => {
              const disabled = f.count === 0;
              const active = picked.has(f.key) && !disabled;
              return (
                <button
                  key={f.key}
                  type="button"
                  role="checkbox"
                  aria-checked={active}
                  disabled={disabled}
                  onClick={() => toggle(f.key)}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
                    active ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${
                      active ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                    }`}
                  >
                    {active && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-foreground">{f.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {disabled
                        ? "No verified hours"
                        : `${f.count} ${f.count === 1 ? "entry" : "entries"} · ${f.hours.toFixed(1)} h`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <DialogFooter className="mt-2 flex-col gap-2 sm:flex-row">
          {shareable && (
            <Button
              type="button"
              variant="outline"
              className="h-12 sm:h-10"
              disabled={chosen.length === 0 || !!busy}
              onClick={handleShare}
            >
              <Share2 className="mr-2 h-4 w-4" />
              {busy === "share" ? "Preparing…" : "Share hours"}
            </Button>
          )}
          <Button
            type="button"
            className="h-12 sm:h-10"
            disabled={chosen.length === 0 || !!busy}
            onClick={handleDownload}
          >
            <Download className="mr-2 h-4 w-4" />
            {busy === "download"
              ? "Preparing…"
              : chosen.length > 1
              ? `Download ${chosen.length} PDFs`
              : "Download PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
