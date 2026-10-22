import { formatCalendarDate } from "@shared/dates";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Award,
  ChevronDown,
  ChevronRight,
  FileText,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { CERT_ISSUING_BODIES, type Certification } from "@shared/schema";

// Empty form state for a new certification.
type CertForm = {
  name: string;
  issuingBody: string;
  issuingBodyOther: string;
  method: string;
  level: string;
  certNumber: string;
  issueDate: string;
  expiryDate: string;
  documentKey: string | null;
  documentName: string | null;
};

const EMPTY_FORM: CertForm = {
  name: "",
  issuingBody: "",
  issuingBodyOther: "",
  method: "",
  level: "",
  certNumber: "",
  issueDate: "",
  expiryDate: "",
  documentKey: null,
  documentName: null,
};

// ISO timestamp -> yyyy-mm-dd for <input type="date">.
function toDateInput(value: string | Date | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// Expiry status used to color the badge and sort attention-worthy certs up.
function expiryStatus(expiry: string | Date | null): {
  label: string;
  className: string;
} | null {
  if (!expiry) return null;
  const d = new Date(expiry);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const days = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) {
    return { label: "Expired", className: "bg-red-100 text-red-700 border-red-200" };
  }
  if (days <= 90) {
    return {
      label: `Expires in ${days}d`,
      className: "bg-amber-100 text-amber-800 border-amber-200",
    };
  }
  return { label: "Valid", className: "bg-green-100 text-green-700 border-green-200" };
}

export function CertificationsCard() {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CertForm>(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);
  // Collapsed by default to keep the profile page short.
  const [expanded, setExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: certs = [], isLoading } = useQuery<Certification[]>({
    queryKey: ["/api/certifications"],
  });

  const now = Date.now();
  const expiredCount = certs.filter(
    (c) => c.expiryDate && new Date(c.expiryDate).getTime() < now,
  ).length;
  const soonCount = certs.filter((c) => {
    if (!c.expiryDate) return false;
    const days = (new Date(c.expiryDate).getTime() - now) / 86400000;
    return days >= 0 && days <= 90;
  }).length;

  const resetAndClose = () => {
    setIsOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const issuingBody =
        form.issuingBody === "Other"
          ? form.issuingBodyOther.trim() || null
          : form.issuingBody || null;
      const payload = {
        name: form.name.trim(),
        method: form.method.trim() || null,
        level: form.level.trim() || null,
        issuingBody,
        certNumber: form.certNumber.trim() || null,
        issueDate: form.issueDate || null,
        expiryDate: form.expiryDate || null,
        documentKey: form.documentKey,
        documentName: form.documentName,
      };
      if (editingId) {
        await apiRequest("PATCH", `/api/certifications/${editingId}`, payload);
      } else {
        await apiRequest("POST", "/api/certifications", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/certifications"] });
      toast({ title: editingId ? "Certification updated" : "Certification added" });
      resetAndClose();
    },
    onError: (err: Error) => {
      toast({
        title: "Could not save certification",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/certifications/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/certifications"] });
      toast({ title: "Certification removed" });
    },
  });

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setIsOpen(true);
  };

  const openEdit = (c: Certification) => {
    const known = (CERT_ISSUING_BODIES as readonly string[]).includes(
      c.issuingBody ?? "",
    );
    setEditingId(c.id);
    setForm({
      name: c.name,
      issuingBody: c.issuingBody ? (known ? c.issuingBody : "Other") : "",
      issuingBodyOther: c.issuingBody && !known ? c.issuingBody : "",
      method: c.method ?? "",
      level: c.level ?? "",
      certNumber: c.certNumber ?? "",
      issueDate: toDateInput(c.issueDate),
      expiryDate: toDateInput(c.expiryDate),
      documentKey: c.documentKey,
      documentName: c.documentName,
    });
    setIsOpen(true);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/certifications/upload", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message || "Upload failed");
      }
      const data = (await res.json()) as {
        documentKey: string;
        documentName: string;
      };
      setForm((f) => ({
        ...f,
        documentKey: data.documentKey,
        documentName: data.documentName,
      }));
      toast({ title: "Certificate attached" });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const viewDocument = async (id: number) => {
    try {
      const res = await fetch(`/api/certifications/${id}/document`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Could not open certificate");
      const data = (await res.json()) as { url: string };
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch {
      toast({ title: "Could not open certificate", variant: "destructive" });
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 mt-6">
      <div className="flex items-start justify-between mb-4">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => setExpanded((o) => !o)}
            className="flex items-center gap-2 text-lg font-semibold text-neutral-900"
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronDown className="h-5 w-5 text-neutral-500" />
            ) : (
              <ChevronRight className="h-5 w-5 text-neutral-500" />
            )}
            <Award className="h-5 w-5 text-primary" />
            Certifications
            <span className="text-sm font-normal text-neutral-500">
              ({certs.length})
            </span>
          </button>
          {expanded ? (
            <p className="text-sm text-neutral-600 mt-1">
              Store every credential in one place — ASNT, IRATA, SPRAT, employer
              cards. Attach the certificate and track expiry dates.
            </p>
          ) : (
            (expiredCount > 0 || soonCount > 0) && (
              <div className="flex flex-wrap gap-2 mt-1.5">
                {expiredCount > 0 && (
                  <span className="inline-flex items-center rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                    {expiredCount} expired
                  </span>
                )}
                {soonCount > 0 && (
                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    {soonCount} expiring soon
                  </span>
                )}
              </div>
            )
          )}
        </div>
        <Button type="button" onClick={openNew} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Add
        </Button>
      </div>

      {!expanded ? null : isLoading ? (
        <p className="text-sm text-neutral-500">Loading certifications…</p>
      ) : certs.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No certifications yet. Add your first credential.
        </p>
      ) : (
        <div className="border border-neutral-200 rounded-md divide-y">
          {certs.map((c) => {
            const status = expiryStatus(c.expiryDate);
            return (
              <div key={c.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-neutral-900 truncate">{c.name}</p>
                    {status && (
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${status.className}`}
                      >
                        {status.label}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {[
                      c.issuingBody,
                      [c.method, c.level].filter(Boolean).join(" "),
                      c.certNumber ? `#${c.certNumber}` : null,
                      c.expiryDate
                        ? `expires ${formatCalendarDate(c.expiryDate)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No details"}
                  </p>
                  {c.documentKey && (
                    <button
                      type="button"
                      onClick={() => viewDocument(c.id)}
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-1"
                    >
                      <FileText className="h-3 w-3" />
                      View certificate
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(c)}
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4 text-neutral-600" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm(`Remove "${c.name}"?`)) deleteMut.mutate(c.id);
                    }}
                    disabled={deleteMut.isPending}
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={(open) => (open ? setIsOpen(true) : resetAndClose())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit certification" : "Add certification"}
            </DialogTitle>
          </DialogHeader>

          <form
            id="cert-form"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.name.trim()) return;
              saveMut.mutate();
            }}
          >
            <div>
              <Label htmlFor="cert-name">Name *</Label>
              <Input
                id="cert-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. SPRAT Level 2"
                maxLength={200}
                required
              />
            </div>

            <div>
              <Label htmlFor="cert-body">Issuing body</Label>
              <Select
                value={form.issuingBody}
                onValueChange={(v) => setForm({ ...form, issuingBody: v })}
              >
                <SelectTrigger id="cert-body">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {CERT_ISSUING_BODIES.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.issuingBody === "Other" && (
                <Input
                  className="mt-2"
                  value={form.issuingBodyOther}
                  onChange={(e) =>
                    setForm({ ...form, issuingBodyOther: e.target.value })
                  }
                  placeholder="Issuing body name"
                  maxLength={200}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cert-method">Method / discipline</Label>
                <Input
                  id="cert-method"
                  value={form.method}
                  onChange={(e) => setForm({ ...form, method: e.target.value })}
                  placeholder="e.g. UT, Rope Access"
                  maxLength={100}
                />
              </div>
              <div>
                <Label htmlFor="cert-level">Level</Label>
                <Input
                  id="cert-level"
                  value={form.level}
                  onChange={(e) => setForm({ ...form, level: e.target.value })}
                  placeholder="e.g. Level II"
                  maxLength={100}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="cert-number">Certificate number</Label>
              <Input
                id="cert-number"
                value={form.certNumber}
                onChange={(e) => setForm({ ...form, certNumber: e.target.value })}
                maxLength={200}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cert-issue">Issue date</Label>
                <Input
                  id="cert-issue"
                  type="date"
                  value={form.issueDate}
                  onChange={(e) => setForm({ ...form, issueDate: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="cert-expiry">Expiry date</Label>
                <Input
                  id="cert-expiry"
                  type="date"
                  value={form.expiryDate}
                  onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label>Certificate file</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={handleFile}
              />
              <div className="flex items-center gap-3 mt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {uploading ? "Uploading…" : "Upload"}
                </Button>
                {form.documentName && (
                  <span className="text-xs text-neutral-600 truncate inline-flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    {form.documentName}
                  </span>
                )}
              </div>
            </div>
          </form>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetAndClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="cert-form"
              disabled={!form.name.trim() || saveMut.isPending || uploading}
            >
              {saveMut.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
