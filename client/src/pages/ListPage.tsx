import { useState } from "react";
import { ProfileHeader } from "@/components/ProfileHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAddDispatchEvent, useDeleteUnionRow, useUnionData } from "@/lib/union";
import { formatCalendarDate, todayLocalISODate } from "@shared/dates";
import { DISPATCH_KINDS, UNION_RULES, type DispatchKind } from "@shared/union";
import { Trash2 } from "lucide-react";

// The member's own out-of-work list history. Dispatch history matters beyond
// the 30-day clock: hours per contractor decide name-request eligibility and
// which referral group you're in (MLA Art. III).
export default function ListPage() {
  const data = useUnionData();
  const { toast } = useToast();
  const add = useAddDispatchEvent();
  const del = useDeleteUnionRow("dispatch");
  const preset = new URLSearchParams(window.location.search).get("add");
  const [form, setForm] = useState({
    kind: (preset && preset in DISPATCH_KINDS ? preset : "REGISTERED") as DispatchKind,
    date: todayLocalISODate(),
    employer: "",
    note: "",
  });

  if (!data.user) return null;
  const l = data.list;

  return (
    <div className="min-h-screen bg-background">
      <ProfileHeader user={data.user} />
      <main className="mx-auto max-w-3xl space-y-5 px-4 pt-4 pb-mobile-nav md:py-8">
        <section>
          <h1 className="text-xl font-semibold text-foreground">Out-of-work list</h1>
          <p className="text-sm text-muted-foreground">
            {l.state === "ON_LIST"
              ? `On the list. Re-register by ${l.reRegisterBy!.toLocaleDateString("en-US")} (${l.daysLeft! < 0 ? `${-l.daysLeft!} days overdue` : `${l.daysLeft} days left`}).`
              : l.state === "WORKING"
                ? `Working${l.employer ? ` for ${l.employer}` : ""}.`
                : "Not on the list."}{" "}
            The hall's rule is to re-register every {UNION_RULES.outOfWork.reRegisterDays} days. The hall's list is the official
            one. This is your copy.
          </p>
        </section>

        <form
          className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate(
              { ...form, employer: form.employer || null, note: form.note || null },
              {
                onSuccess: () => {
                  toast({ title: "Logged", description: DISPATCH_KINDS[form.kind] });
                  setForm({ ...form, employer: "", note: "" });
                },
                onError: (err: Error) => toast({ title: "Couldn't save", description: err.message, variant: "destructive" }),
              },
            );
          }}
        >
          <div className="col-span-2 space-y-1">
            <Label>What happened</Label>
            <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as DispatchKind })}>
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DISPATCH_KINDS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-date">Date</Label>
            <Input id="ev-date" type="date" className="h-11" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-employer">Contractor</Label>
            <Input id="ev-employer" className="h-11" value={form.employer} onChange={(e) => setForm({ ...form, employer: e.target.value })} placeholder={form.kind === "DISPATCHED" ? "Who sent you out" : "Optional"} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="ev-note">Note</Label>
            <Input id="ev-note" className="h-11" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Optional: list #, name request, job site…" />
          </div>
          <Button type="submit" className="col-span-2 h-11" disabled={add.isPending}>
            Add to history
          </Button>
        </form>

        <section className="space-y-2">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">History</h2>
          {data.dispatch.length === 0 && <p className="px-1 text-sm text-muted-foreground">Nothing yet.</p>}
          {data.dispatch.map((ev) => (
            <div key={ev.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              <div className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{formatCalendarDate(ev.date)}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{DISPATCH_KINDS[ev.kind as DispatchKind] ?? ev.kind}</div>
                {(ev.employer || ev.note) && (
                  <div className="truncate text-xs text-muted-foreground">{[ev.employer, ev.note].filter(Boolean).join(" · ")}</div>
                )}
              </div>
              <button
                type="button"
                aria-label="Delete"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-destructive"
                onClick={() => del.mutate(ev.id)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
