import { formatCalendarDate } from "@shared/dates";
import { fieldMethodLabel } from "@shared/schema";
import { ReactNode, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  Copy,
  Eye,
  FileText,
  KeyRound,
  Loader2,
  Mail,
  Plus,
  Shield,
  ShieldOff,
  Trash2,
  Upload,
} from "lucide-react";
import {
  CERT_ISSUING_BODIES,
  type Certification,
  type Entry,
  type RopeHours,
} from "@shared/schema";

type AdminUserDetail = {
  user: {
    id: number;
    email: string;
    name: string | null;
    employeeNumber: string | null;
    isAdmin: boolean | null;
    createdAt: string | null;
  };
  counts: { entries: number; ropeHours: number; certifications: number };
  totals: {
    ojtHours: number;
    ojtVerifiedHours: number;
    ropeHours: number;
    ropeVerifiedHours: number;
  };
};

// Timestamps (e.g. createdAt), shown in local time.
function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

// Calendar dates (entry/rope dates, cert expiry), stored as UTC midnight.
function fmtDay(v: string | Date | null | undefined): string {
  return formatCalendarDate(v) || "—";
}

// Generic collapsible section used for each data group.
function Section({
  title,
  count,
  action,
  children,
  defaultOpen = false,
}: {
  title: string;
  count: number;
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-neutral-200 rounded-md">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 font-medium text-neutral-900"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-neutral-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-neutral-500" />
          )}
          {title}
          <span className="text-sm font-normal text-neutral-500">({count})</span>
        </button>
        {action}
      </div>
      {open && <div className="border-t border-neutral-200 p-3">{children}</div>}
    </div>
  );
}

async function openSignedUrl(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("Could not open file");
  const data = (await res.json()) as { url: string };
  window.open(data.url, "_blank", "noopener,noreferrer");
}

export function UserDetailPanel({
  userId,
  currentAdminId,
  onDeleted,
}: {
  userId: number;
  currentAdminId: number;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<
    { tempPassword: string; sent: boolean; error: string | null } | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isSelf = userId === currentAdminId;

  const { data: detail, isLoading } = useQuery<AdminUserDetail>({
    queryKey: [`/api/admin/users/${userId}`],
  });
  const { data: entries = [] } = useQuery<Entry[]>({
    queryKey: [`/api/admin/users/${userId}/entries`],
  });
  const { data: rope = [] } = useQuery<RopeHours[]>({
    queryKey: [`/api/admin/users/${userId}/rope-hours`],
  });
  const { data: certs = [] } = useQuery<Certification[]>({
    queryKey: [`/api/admin/users/${userId}/certifications`],
  });

  const invalidateUser = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/admin/users/${userId}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
  };

  const impersonateMut = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/admin/impersonate/${userId}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.clear();
      setLocation("/field-hours");
    },
    onError: (err: Error) =>
      toast({ title: "Could not start", description: err.message, variant: "destructive" }),
  });

  const roleMut = useMutation({
    mutationFn: async (makeAdmin: boolean) => {
      await apiRequest("PATCH", `/api/admin/users/${userId}`, { isAdmin: makeAdmin });
    },
    onSuccess: () => {
      invalidateUser();
      toast({ title: "Role updated" });
    },
    onError: (err: Error) =>
      toast({ title: "Could not update role", description: err.message, variant: "destructive" }),
  });

  const resetMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/users/${userId}/reset-password`);
      return (await res.json()) as { resetUrl: string };
    },
    onSuccess: (data) => setResetUrl(data.resetUrl),
    onError: (err: Error) =>
      toast({ title: "Could not generate link", description: err.message, variant: "destructive" }),
  });

  const inviteMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/users/${userId}/invite`);
      return (await res.json()) as { tempPassword: string; sent: boolean; error: string | null };
    },
    onSuccess: (data) => setInviteResult(data),
    onError: (err: Error) =>
      toast({ title: "Could not send invite", description: err.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/admin/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User deleted" });
      setConfirmDelete(false);
      onDeleted();
    },
    onError: (err: Error) =>
      toast({ title: "Could not delete", description: err.message, variant: "destructive" }),
  });

  const deleteCertMut = useMutation({
    mutationFn: async (certId: number) => {
      await apiRequest("DELETE", `/api/admin/certifications/${certId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/admin/users/${userId}/certifications`],
      });
      invalidateUser();
      toast({ title: "Certification removed" });
    },
  });

  const [certDialogOpen, setCertDialogOpen] = useState(false);

  if (isLoading || !detail) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const u = detail.user;
  // Aggregate every uploaded file: imported source docs + certificate files.
  const sourceDocs = new Map<string, { name: string | null; type: "entry" | "rope"; id: number }>();
  for (const e of entries)
    if (e.sourceDocumentKey)
      sourceDocs.set(e.sourceDocumentKey, { name: e.sourceDocumentName, type: "entry", id: e.id });
  for (const r of rope)
    if (r.sourceDocumentKey)
      sourceDocs.set(r.sourceDocumentKey, { name: r.sourceDocumentName, type: "rope", id: r.id });
  const certDocs = certs.filter((c) => c.documentKey);
  const totalDocs = sourceDocs.size + certDocs.length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-xl font-bold text-neutral-900">{u.name || "Unnamed user"}</h2>
          {u.isAdmin && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              <Shield className="h-3 w-3" /> Admin
            </span>
          )}
          {isSelf && (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600">
              You
            </span>
          )}
        </div>
        <p className="text-sm text-neutral-500 mt-0.5">
          {u.email}
          {u.employeeNumber ? ` · Emp #${u.employeeNumber}` : ""}
          {` · joined ${fmtDate(u.createdAt)}`}
        </p>
        <div className="flex flex-wrap gap-4 mt-3 text-sm">
          <span className="text-neutral-700">
            <strong>{detail.totals.ojtVerifiedHours}</strong> verified field hrs
            <span className="text-neutral-400"> / {detail.totals.ojtHours}</span>
          </span>
          <span className="text-neutral-700">
            <strong>{detail.totals.ropeVerifiedHours}</strong> verified rope hrs
            <span className="text-neutral-400"> / {detail.totals.ropeHours}</span>
          </span>
          <span className="text-neutral-700">
            <strong>{detail.counts.certifications}</strong> certs
          </span>
        </div>
      </div>

      {/* Account actions */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => impersonateMut.mutate()}
          disabled={isSelf || impersonateMut.isPending}
          title={isSelf ? "You can't view as yourself" : "View the app as this user"}
        >
          <Eye className="h-4 w-4 mr-1.5" />
          View as user
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => inviteMut.mutate()}
          disabled={inviteMut.isPending}
          title="Set a fresh password and email login details to this user"
        >
          <Mail className="h-4 w-4 mr-1.5" />
          {inviteMut.isPending ? "…" : "Send invite"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => resetMut.mutate()}
          disabled={resetMut.isPending}
        >
          <KeyRound className="h-4 w-4 mr-1.5" />
          {resetMut.isPending ? "…" : "Reset password"}
        </Button>
        {u.isAdmin ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => roleMut.mutate(false)}
            disabled={isSelf || roleMut.isPending}
            title={isSelf ? "You can't remove your own admin access" : ""}
          >
            <ShieldOff className="h-4 w-4 mr-1.5" />
            Revoke admin
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => roleMut.mutate(true)}
            disabled={roleMut.isPending}
          >
            <Shield className="h-4 w-4 mr-1.5" />
            Make admin
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-red-600"
          onClick={() => setConfirmDelete(true)}
          disabled={isSelf}
          title={isSelf ? "You can't delete your own account" : ""}
        >
          <Trash2 className="h-4 w-4 mr-1.5" />
          Delete
        </Button>
      </div>

      {/* Certifications */}
      <Section
        title="Certifications"
        count={certs.length}
        action={
          <Button size="sm" variant="outline" onClick={() => setCertDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add
          </Button>
        }
      >
        {certs.length === 0 ? (
          <p className="text-sm text-neutral-500">No certifications.</p>
        ) : (
          <div className="divide-y">
            {certs.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-2">
                <div className="min-w-0">
                  <p className="font-medium text-neutral-900 truncate">{c.name}</p>
                  <p className="text-xs text-neutral-500">
                    {[c.issuingBody, [c.method, c.level].filter(Boolean).join(" "),
                      c.expiryDate ? `expires ${fmtDay(c.expiryDate)}` : null]
                      .filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {c.documentKey && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        openSignedUrl(`/api/admin/certifications/${c.id}/document`).catch(() =>
                          toast({ title: "Could not open file", variant: "destructive" }),
                        )
                      }
                      title="View certificate"
                    >
                      <FileText className="h-4 w-4 text-primary" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`Remove "${c.name}"?`)) deleteCertMut.mutate(c.id);
                    }}
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* work hours log */}
      <Section title="Field hours log" count={entries.length}>
        {entries.length === 0 ? (
          <p className="text-sm text-neutral-500">No entries.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-500">
                  <th className="py-1 pr-3">Date</th>
                  <th className="py-1 pr-3">Location</th>
                  <th className="py-1 pr-3">Method</th>
                  <th className="py-1 pr-3">Hours</th>
                  <th className="py-1 pr-3">Verified</th>
                  <th className="py-1">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="py-1 pr-3 whitespace-nowrap">{fmtDay(e.date)}</td>
                    <td className="py-1 pr-3">{e.location}</td>
                    <td className="py-1 pr-3">{fieldMethodLabel(e.method)}</td>
                    <td className="py-1 pr-3">{e.hours}</td>
                    <td className="py-1 pr-3">{e.verified ? "✓" : "—"}</td>
                    <td className="py-1">
                      {e.sourceDocumentKey && (
                        <button
                          className="text-primary hover:underline text-xs"
                          onClick={() =>
                            openSignedUrl(`/api/admin/source-document?type=entry&id=${e.id}`).catch(
                              () => toast({ title: "Could not open file", variant: "destructive" }),
                            )
                          }
                        >
                          view
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Rope hours */}
      <Section title="Rope access hours" count={rope.length}>
        {rope.length === 0 ? (
          <p className="text-sm text-neutral-500">No rope hours.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-500">
                  <th className="py-1 pr-3">Dates</th>
                  <th className="py-1 pr-3">Location</th>
                  <th className="py-1 pr-3">Hours</th>
                  <th className="py-1 pr-3">Verified</th>
                  <th className="py-1">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rope.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1 pr-3 whitespace-nowrap">
                      {fmtDay(r.startDate)}–{fmtDay(r.endDate)}
                    </td>
                    <td className="py-1 pr-3">{r.location}</td>
                    <td className="py-1 pr-3">{r.hours}</td>
                    <td className="py-1 pr-3">{r.verified ? "✓" : "—"}</td>
                    <td className="py-1">
                      {r.sourceDocumentKey && (
                        <button
                          className="text-primary hover:underline text-xs"
                          onClick={() =>
                            openSignedUrl(`/api/admin/source-document?type=rope&id=${r.id}`).catch(
                              () => toast({ title: "Could not open file", variant: "destructive" }),
                            )
                          }
                        >
                          view
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Documents */}
      <Section title="Documents" count={totalDocs}>
        {totalDocs === 0 ? (
          <p className="text-sm text-neutral-500">No uploaded documents.</p>
        ) : (
          <div className="divide-y">
            {certDocs.map((c) => (
              <div key={`cert-${c.id}`} className="flex items-center justify-between py-2">
                <span className="text-sm text-neutral-700 inline-flex items-center gap-2 min-w-0">
                  <Award className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate">{c.documentName || c.name}</span>
                  <span className="text-xs text-neutral-400">certificate</span>
                </span>
                <button
                  className="text-primary hover:underline text-xs"
                  onClick={() =>
                    openSignedUrl(`/api/admin/certifications/${c.id}/document`).catch(() =>
                      toast({ title: "Could not open file", variant: "destructive" }),
                    )
                  }
                >
                  view
                </button>
              </div>
            ))}
            {Array.from(sourceDocs.entries()).map(([key, d]) => (
              <div key={key} className="flex items-center justify-between py-2">
                <span className="text-sm text-neutral-700 inline-flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 text-neutral-500 shrink-0" />
                  <span className="truncate">{d.name || "Imported log"}</span>
                  <span className="text-xs text-neutral-400">{d.type} import</span>
                </span>
                <button
                  className="text-primary hover:underline text-xs"
                  onClick={() =>
                    openSignedUrl(`/api/admin/source-document?type=${d.type}&id=${d.id}`).catch(
                      () => toast({ title: "Could not open file", variant: "destructive" }),
                    )
                  }
                >
                  view
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Add certification dialog */}
      <AdminCertDialog
        userId={userId}
        open={certDialogOpen}
        onClose={() => setCertDialogOpen(false)}
      />

      {/* Invite result dialog */}
      <Dialog open={!!inviteResult} onOpenChange={(o) => !o && setInviteResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite sent</DialogTitle>
            <DialogDescription>
              {inviteResult?.sent
                ? `Login details emailed to ${u.email}. A fresh password was set.`
                : inviteResult?.error ||
                  "Email couldn't be sent — share the password below manually."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between bg-neutral-100 rounded p-2 text-sm">
            <span>
              <span className="text-neutral-500">Temp password: </span>
              <span className="font-mono">{inviteResult?.tempPassword}</span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (inviteResult?.tempPassword) {
                  await navigator.clipboard.writeText(inviteResult.tempPassword).catch(() => {});
                  toast({ title: "Copied" });
                }
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setInviteResult(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset link dialog */}
      <Dialog open={!!resetUrl} onOpenChange={(o) => !o && setResetUrl(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password reset link</DialogTitle>
            <DialogDescription>
              Send this link to {u.name || u.email}. It expires in 24 hours.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-neutral-100 rounded p-3 font-mono text-xs break-all">
            {resetUrl}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                if (resetUrl) {
                  await navigator.clipboard.writeText(resetUrl).catch(() => {});
                  toast({ title: "Copied" });
                }
              }}
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </Button>
            <Button onClick={() => setResetUrl(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user</DialogTitle>
            <DialogDescription>
              Permanently delete {u.name || u.email} and all their entries and signers?
              This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMut.mutate()}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? "Deleting…" : "Delete user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Dialog to add a certification on a user's behalf (with optional file upload).
function AdminCertDialog({
  userId,
  open,
  onClose,
}: {
  userId: number;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    issuingBody: "",
    issuingBodyOther: "",
    method: "",
    level: "",
    certNumber: "",
    issueDate: "",
    expiryDate: "",
    documentKey: null as string | null,
    documentName: null as string | null,
  });

  const reset = () => {
    setForm({
      name: "", issuingBody: "", issuingBodyOther: "", method: "", level: "",
      certNumber: "", issueDate: "", expiryDate: "", documentKey: null, documentName: null,
    });
    onClose();
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const issuingBody =
        form.issuingBody === "Other"
          ? form.issuingBodyOther.trim() || null
          : form.issuingBody || null;
      await apiRequest("POST", `/api/admin/users/${userId}/certifications`, {
        name: form.name.trim(),
        method: form.method.trim() || null,
        level: form.level.trim() || null,
        issuingBody,
        certNumber: form.certNumber.trim() || null,
        issueDate: form.issueDate || null,
        expiryDate: form.expiryDate || null,
        documentKey: form.documentKey,
        documentName: form.documentName,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/admin/users/${userId}/certifications`],
      });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/users/${userId}`] });
      toast({ title: "Certification added" });
      reset();
    },
    onError: (err: Error) =>
      toast({ title: "Could not add", description: err.message, variant: "destructive" }),
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/users/${userId}/certifications/upload`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = (await res.json()) as { documentKey: string; documentName: string };
      setForm((f) => ({ ...f, documentKey: data.documentKey, documentName: data.documentName }));
      toast({ title: "Certificate attached" });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : reset())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add certification</DialogTitle>
        </DialogHeader>
        <form
          id="admin-cert-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) return;
            saveMut.mutate();
          }}
        >
          <div>
            <Label htmlFor="ac-name">Name *</Label>
            <Input
              id="ac-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. SPRAT Level 2"
              maxLength={200}
              required
            />
          </div>
          <div>
            <Label htmlFor="ac-body">Issuing body</Label>
            <Select
              value={form.issuingBody}
              onValueChange={(v) => setForm({ ...form, issuingBody: v })}
            >
              <SelectTrigger id="ac-body">
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
                onChange={(e) => setForm({ ...form, issuingBodyOther: e.target.value })}
                placeholder="Issuing body name"
                maxLength={200}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ac-method">Method / discipline</Label>
              <Input
                id="ac-method"
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value })}
                placeholder="e.g. UT"
                maxLength={100}
              />
            </div>
            <div>
              <Label htmlFor="ac-level">Level</Label>
              <Input
                id="ac-level"
                value={form.level}
                onChange={(e) => setForm({ ...form, level: e.target.value })}
                placeholder="e.g. Level II"
                maxLength={100}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="ac-num">Certificate number</Label>
            <Input
              id="ac-num"
              value={form.certNumber}
              onChange={(e) => setForm({ ...form, certNumber: e.target.value })}
              maxLength={200}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ac-issue">Issue date</Label>
              <Input
                id="ac-issue"
                type="date"
                value={form.issueDate}
                onChange={(e) => setForm({ ...form, issueDate: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="ac-expiry">Expiry date</Label>
              <Input
                id="ac-expiry"
                type="date"
                value={form.expiryDate}
                onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Certificate file</Label>
            <input
              ref={fileRef}
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
                onClick={() => fileRef.current?.click()}
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
          <Button variant="outline" onClick={reset}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="admin-cert-form"
            disabled={!form.name.trim() || saveMut.isPending || uploading}
          >
            {saveMut.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
