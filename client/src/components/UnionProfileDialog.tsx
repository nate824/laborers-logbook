import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CLASSIFICATIONS, type Classification, type UnionProfile } from "@shared/union";
import { UNION_QUERY_KEYS } from "@/lib/union";

// "My union info": the few facts the rules can't get from the hours log.
export function UnionProfileDialog({
  open,
  onOpenChange,
  profile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: UnionProfile;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState(profile);
  useEffect(() => {
    if (open) setForm(profile);
    // Reset only when the dialog opens, not on every background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = useMutation({
    mutationFn: async (next: UnionProfile) => (await apiRequest("PUT", "/api/union/profile", next)).json(),
    onSuccess: (saved: UnionProfile) => {
      queryClient.setQueryData(UNION_QUERY_KEYS.profile, saved);
      toast({ title: "Saved", description: "Your union info is updated." });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const num = (k: keyof UnionProfile) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value === "" ? 0 : Number(e.target.value) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>My union info</DialogTitle>
          <DialogDescription>Used for your coverage, apprenticeship and dues reminders. Stays in your account.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form);
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label>Classification</Label>
              <Select value={form.classification} onValueChange={(v) => setForm({ ...form, classification: v as Classification })}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CLASSIFICATIONS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="up-local">Local #</Label>
              <Input id="up-local" className="h-11" value={form.localNumber} onChange={(e) => setForm({ ...form, localNumber: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="up-dues">Dues paid through</Label>
              <Input
                id="up-dues"
                type="month"
                className="h-11"
                value={form.duesPaidThrough ?? ""}
                onChange={(e) => setForm({ ...form, duesPaidThrough: e.target.value || null })}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor="up-bank">Health hour bank when you started this log</Label>
              <Input id="up-bank" type="number" min={0} max={400} inputMode="decimal" className="h-11" value={form.startingBank || ""} onChange={num("startingBank")} placeholder="0 if you're new" />
              <p className="text-xs text-muted-foreground">Check the trust fund portal. Leave at 0 if you haven't qualified yet.</p>
            </div>
            {form.classification === "APPRENTICE" && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="up-ojt">OJT hours before this log</Label>
                  <Input id="up-ojt" type="number" min={0} inputMode="decimal" className="h-11" value={form.priorOjtHours || ""} onChange={num("priorOjtHours")} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="up-rsi">Class hours before this log</Label>
                  <Input id="up-rsi" type="number" min={0} inputMode="decimal" className="h-11" value={form.priorRsiHours || ""} onChange={num("priorRsiHours")} />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" className="h-11 w-full sm:w-auto" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
