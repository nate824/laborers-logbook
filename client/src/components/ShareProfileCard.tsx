import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Copy, Link2, RefreshCw, Share2 } from "lucide-react";
import { fieldMethodLabel, type Certification, type Entry, type ShareSettings } from "@shared/schema";

type ShareState = {
  shareToken: string | null;
  shareSettings: ShareSettings | null;
};

export function ShareProfileCard() {
  const { toast } = useToast();
  const initialized = useRef(false);

  const { data: share, isLoading } = useQuery<ShareState>({
    queryKey: ["/api/share"],
  });
  const { data: entries = [] } = useQuery<Entry[]>({ queryKey: ["/api/entries"] });
  const { data: certs = [] } = useQuery<Certification[]>({
    queryKey: ["/api/certifications"],
  });
  const { data: ropeTotals } = useQuery<{ count: number }>({
    queryKey: ["/api/rope-hours/totals"],
  });

  const availableMethods = Array.from(new Set(entries.map((e) => e.method))).sort();
  const hasRope = (ropeTotals?.count ?? 0) > 0;
  const enabled = !!share?.shareToken;

  const [methods, setMethods] = useState<Set<string>>(new Set());
  const [includeRope, setIncludeRope] = useState(false);
  const [certIds, setCertIds] = useState<Set<number>>(new Set());

  // Initialize selections once data is loaded: from saved settings if present,
  // otherwise default to sharing everything the user has.
  useEffect(() => {
    if (initialized.current || isLoading) return;
    initialized.current = true;
    const s = share?.shareSettings;
    if (s) {
      setMethods(new Set(s.ojtMethods));
      setIncludeRope(s.includeRope);
      setCertIds(new Set(s.certIds));
    } else {
      setMethods(new Set(availableMethods));
      setIncludeRope(hasRope);
      setCertIds(new Set(certs.map((c) => c.id)));
    }
  }, [isLoading, share, availableMethods, hasRope, certs]);

  const currentSettings = (): ShareSettings => ({
    ojtMethods: Array.from(methods),
    includeRope,
    certIds: Array.from(certIds),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/share", {
        settings: currentSettings(),
      });
      return (await res.json()) as ShareState;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/share"] });
      toast({ title: enabled ? "Share settings saved" : "Public profile enabled" });
    },
    onError: (err: Error) =>
      toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });

  const rotateMut = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/share/rotate");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/share"] });
      toast({ title: "New link generated", description: "The old link no longer works." });
    },
  });

  const disableMut = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/share");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/share"] });
      toast({ title: "Public profile disabled" });
    },
  });

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = share?.shareToken ? `${origin}/p/${share.shareToken}` : "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Copy failed — select and copy manually", variant: "destructive" });
    }
  };

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 mt-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-neutral-900 flex items-center gap-2">
          <Share2 className="h-5 w-5 text-primary" />
          Share profile
        </h2>
        <p className="text-sm text-neutral-600 mt-1">
          Generate a read-only link that shows a summary of your verified hours and
          chosen certifications. Pick exactly what to expose — nothing else is shared.
        </p>
      </div>

      {/* What to share */}
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-neutral-800 mb-2">Field hours methods</p>
          {availableMethods.length === 0 ? (
            <p className="text-xs text-neutral-500">No hours logged yet.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {availableMethods.map((m) => (
                <label key={m} className="inline-flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={methods.has(m)}
                    onChange={() => setMethods((s) => toggle(s, m))}
                  />
                  {fieldMethodLabel(m)}
                </label>
              ))}
            </div>
          )}
        </div>

        {hasRope && (
          <label className="inline-flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={includeRope}
              onChange={(e) => setIncludeRope(e.target.checked)}
            />
            Include rope-access hours summary
          </label>
        )}

        <div>
          <p className="text-sm font-medium text-neutral-800 mb-2">Certifications</p>
          {certs.length === 0 ? (
            <p className="text-xs text-neutral-500">No certifications added yet.</p>
          ) : (
            <div className="space-y-1.5">
              {certs.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-1.5 text-sm text-neutral-800"
                >
                  <input
                    type="checkbox"
                    checked={certIds.has(c.id)}
                    onChange={() => setCertIds((s) => toggle(s, c.id))}
                  />
                  {c.name}
                  {c.issuingBody ? (
                    <span className="text-neutral-400">· {c.issuingBody}</span>
                  ) : null}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Live link + actions */}
      {enabled && (
        <div className="mt-5 p-3 bg-neutral-50 border border-neutral-200 rounded-md">
          <div className="flex items-center gap-2 text-sm text-neutral-700 mb-2">
            <Link2 className="h-4 w-4 text-green-600" />
            <span className="font-medium">Public link active</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 text-sm font-mono bg-white border border-neutral-200 rounded px-2 py-1.5 truncate"
            />
            <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="h-4 w-4 mr-1.5" />
              Copy
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-5">
        <Button
          type="button"
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
        >
          {enabled
            ? saveMut.isPending
              ? "Saving…"
              : "Save changes"
            : saveMut.isPending
              ? "Enabling…"
              : "Enable & create link"}
        </Button>
        {enabled && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (
                  confirm("Generate a new link? The current link will stop working.")
                )
                  rotateMut.mutate();
              }}
              disabled={rotateMut.isPending}
            >
              <RefreshCw className="h-4 w-4 mr-1.5" />
              New link
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-red-600"
              onClick={() => {
                if (confirm("Disable your public profile? The link will stop working."))
                  disableMut.mutate();
              }}
              disabled={disableMut.isPending}
            >
              Disable
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
