import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { ProfileHeader } from "@/components/ProfileHeader";
import { SignerFormFields } from "@/components/SignerFormFields";
import { Pencil, Trash2, UserPlus, UserCheck, Phone, Mail } from "lucide-react";
import { Supervisor, SupervisorWithCreator, User, signerMethodLabel } from "@shared/schema";
import {
  supervisorFormSchema,
  signerToQualifications,
  type SupervisorFormValues,
} from "@/types";

const emptyValues: SupervisorFormValues = {
  name: "",
  email: "",
  phone: "",
  spratNumber: "",
  irataNumber: "",
  company: "",
  qualifications: [],
};

export default function SignersPage() {
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supervisor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Supervisor | null>(null);

  const { data: user } = useQuery<User>({ queryKey: ["/api/user"] });

  const { data: signers = [], isLoading } = useQuery<SupervisorWithCreator[]>({
    queryKey: ["/api/supervisors"],
    enabled: !!user,
  });

  const form = useForm<SupervisorFormValues>({
    resolver: zodResolver(supervisorFormSchema),
    defaultValues: emptyValues,
  });

  const openAdd = () => {
    setEditing(null);
    form.reset(emptyValues);
    setIsFormOpen(true);
  };

  const openEdit = (signer: Supervisor) => {
    setEditing(signer);
    form.reset({
      name: signer.name,
      email: signer.email,
      phone: signer.phone,
      spratNumber: signer.spratNumber ?? "",
      irataNumber: signer.irataNumber ?? "",
      company: signer.company ?? "",
      qualifications: signerToQualifications(signer),
    });
    setIsFormOpen(true);
  };

  // The list is shared company-wide; only whoever added a signer (or an admin)
  // can change it. The server enforces the same rule.
  const canEditSigner = (signer: Supervisor) =>
    signer.userId === user?.id || !!user?.isAdmin;

  const handleSubmit = async (values: SupervisorFormValues) => {
    try {
      const payload = {
        ...values,
        spratNumber: values.spratNumber || null,
        irataNumber: values.irataNumber || null,
        company: values.company || null,
        qualifications: values.qualifications,
      };

      if (editing) {
        const res = await apiRequest("PATCH", `/api/supervisors/${editing.id}`, payload);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || "Failed to update signer");
        }
        toast({ title: "Signer updated", description: `${values.name} has been updated.` });
      } else {
        const res = await apiRequest("POST", "/api/supervisors", payload);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || "Failed to create signer");
        }
        toast({ title: "Signer added", description: `${values.name} has been saved.` });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/supervisors"] });
      setIsFormOpen(false);
      setEditing(null);
      form.reset(emptyValues);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await apiRequest("DELETE", `/api/supervisors/${deleteTarget.id}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to delete signer");
      }
      toast({ title: "Signer removed", description: `${deleteTarget.name} has been removed.` });
      queryClient.invalidateQueries({ queryKey: ["/api/supervisors"] });
      setDeleteTarget(null);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  if (!user) return null;

  const formatMethod = (m: string) => signerMethodLabel(m);
  const shortLevel = (lvl: string) =>
    lvl === "Level I" ? "I" : lvl === "Level II" ? "II" : lvl === "Level III" ? "III" : lvl;

  return (
    <div className="min-h-screen bg-neutral-100">
      <ProfileHeader user={user} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 md:pt-8 pb-mobile-nav">
        <div className="md:bg-white md:rounded-lg md:shadow-sm md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-4 md:mb-6">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900 flex items-center gap-2">
                <UserCheck className="h-5 w-5" />
                Signers
              </h2>
              <p className="text-sm text-neutral-500 mt-1">
                Everyone using this logbook shares this list. Anyone can add a signer, and every signer is available on every entry.
              </p>
            </div>
            <Button onClick={openAdd} className="flex items-center gap-2 h-12 text-base md:h-10 md:text-sm">
              <UserPlus className="h-4 w-4" />
              Add Signer
            </Button>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-neutral-500">Loading signers...</div>
          ) : signers.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-neutral-200 rounded-md">
              <UserCheck className="mx-auto h-10 w-10 text-neutral-300 mb-2" />
              <p className="text-neutral-500 mb-4">No signers on the list yet.</p>
              <Button onClick={openAdd} variant="outline" className="flex items-center gap-2 mx-auto">
                <UserPlus className="h-4 w-4" />
                Add the First Signer
              </Button>
            </div>
          ) : (
            <>
            {/* Phones: one card per signer, tap-to-call / tap-to-email. */}
            <div className="space-y-3 md:hidden">
              {signers.map((signer) => {
                const quals = signerToQualifications(signer);
                return (
                  <div key={signer.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-base font-semibold text-foreground">{signer.name}</div>
                        {signer.addedByName && (
                          <div className="text-xs text-muted-foreground">
                            Added by {signer.userId === user.id ? "you" : signer.addedByName}
                          </div>
                        )}
                      </div>
                      {canEditSigner(signer) && (
                        <div className="flex shrink-0 -mr-2 -mt-2">
                          <Button size="icon" variant="ghost" className="h-10 w-10" onClick={() => openEdit(signer)} aria-label="Edit signer">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-10 w-10 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeleteTarget(signer)}
                            aria-label="Delete signer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="mt-2 space-y-1 text-sm">
                      {signer.phone && (
                        <a href={`tel:${signer.phone}`} className="flex items-center gap-2 py-1 text-primary">
                          <Phone className="h-4 w-4" /> {signer.phone}
                        </a>
                      )}
                      <a href={`mailto:${signer.email}`} className="flex items-center gap-2 py-1 text-primary break-all">
                        <Mail className="h-4 w-4 shrink-0" /> {signer.email}
                      </a>
                      {(signer.spratNumber || signer.irataNumber) && (
                        <div className="text-muted-foreground">
                          {signer.spratNumber && <>SPRAT #{signer.spratNumber}</>}
                          {signer.spratNumber && signer.irataNumber && " · "}
                          {signer.irataNumber && <>IRATA #{signer.irataNumber}</>}
                        </div>
                      )}
                    </div>
                    {quals.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {quals.map((q, i) => (
                          <span
                            key={`${q.method}-${q.level}-${i}`}
                            className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                          >
                            {formatMethod(q.method)} {shortLevel(q.level)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200">
                <thead>
                  <tr className="text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    <th className="px-3 py-3">Name</th>
                    <th className="px-3 py-3">Phone</th>
                    <th className="px-3 py-3">Email</th>
                    <th className="px-3 py-3">SPRAT #</th>
                    <th className="px-3 py-3">IRATA #</th>
                    <th className="px-3 py-3">Qualifications</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-neutral-200">
                  {signers.map((signer) => (
                    <tr key={signer.id} className="text-sm text-neutral-900">
                      <td className="px-3 py-3 font-medium">
                        <div className="flex flex-col gap-0.5">
                          <span>{signer.name}</span>
                          {signer.addedByName && (
                            <span className="text-xs font-normal text-neutral-500">
                              Added by {signer.userId === user.id ? "you" : signer.addedByName}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">{signer.phone}</td>
                      <td className="px-3 py-3">{signer.email}</td>
                      <td className="px-3 py-3">{signer.spratNumber || "—"}</td>
                      <td className="px-3 py-3">{signer.irataNumber || "—"}</td>
                      <td className="px-3 py-3">
                        {(() => {
                          const quals = signerToQualifications(signer);
                          if (quals.length === 0) return "—";
                          return (
                            <div className="flex flex-wrap gap-1">
                              {quals.map((q, i) => (
                                <span
                                  key={`${q.method}-${q.level}-${i}`}
                                  className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700"
                                >
                                  {formatMethod(q.method)} {shortLevel(q.level)}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          {canEditSigner(signer) ? (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => openEdit(signer)}
                                aria-label="Edit signer"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setDeleteTarget(signer)}
                                aria-label="Delete signer"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <span className="text-xs text-neutral-400">Read-only</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      </main>

      <Dialog open={isFormOpen} onOpenChange={(open) => { if (!open) { setIsFormOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Signer" : "Add Signer"}</DialogTitle>
            <DialogDescription>
              Name, phone number, and email are required. All other fields are optional.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <SignerFormFields form={form} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? "Saving..." : editing ? "Save Changes" : "Add Signer"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this signer?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  This will remove <span className="font-semibold">{deleteTarget.name}</span> from your saved signers.
                  Existing verified entries signed by them will not be affected.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
