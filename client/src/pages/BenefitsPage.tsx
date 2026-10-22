import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ProfileHeader } from "@/components/ProfileHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { UNION_QUERY_KEYS, useDeleteUnionRow, useUnionData } from "@/lib/union";
import { UNION_RULES, addMonths, monthLabel, type CrossCheckRow } from "@shared/union";
import { ExternalLink, Trash2 } from "lucide-react";

const STATUS: Record<CrossCheckRow["status"], { label: string; cls: string }> = {
  MATCH: { label: "Matches", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  SHORT: { label: "Fund shows less", cls: "bg-destructive/15 text-destructive" },
  OVER: { label: "Fund shows more", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  NOT_CHECKED: { label: "Not checked", cls: "bg-muted text-muted-foreground" },
  PENDING: { label: "Not reported yet", cls: "bg-muted text-muted-foreground" },
};

const r1 = (n: number) => Math.round(n * 10) / 10;

// Health plan detail: how each month's union hours fed the hour bank, and a
// month-by-month check of the member's log against what the trust fund shows.
export default function BenefitsPage() {
  const data = useUnionData();
  if (!data.user) return null;
  const h = data.health;
  const rules = UNION_RULES.health;
  const rows = [...h.rows].reverse().slice(0, 18);

  return (
    <div className="min-h-screen bg-background">
      <ProfileHeader user={data.user} />
      <main className="mx-auto max-w-3xl space-y-6 px-4 pt-4 pb-mobile-nav md:py-8">
        <section className="space-y-2">
          <h1 className="text-xl font-semibold text-foreground">Health coverage</h1>
          <p className="text-sm text-muted-foreground">
            First qualify with {rules.initialHours} union hours in {rules.windowMonths} months or fewer. After that, each month's
            hours go into a bank (max {rules.bankCap}) and {rules.monthlyDeduction} come out for each month you're covered.
            Hours you work in a month pay for coverage two months later, because employers report a month late. Non-union work
            in the area empties the bank.
          </p>
          {h.warnings.map((w) => (
            <p key={w} className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {w}
            </p>
          ))}
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Worked</th>
                <th className="px-2 py-2 text-right font-medium">Union hrs</th>
                <th className="px-2 py-2 text-right font-medium">Bank</th>
                <th className="px-3 py-2 text-left font-medium">Pays for</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    Log on-the-job hours and they'll show up here by month.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.month} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{monthLabel(r.month)}</div>
                    {r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}
                    {r.pendingReport && <div className="text-xs text-muted-foreground">Employer hasn't reported yet</div>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.nonUnion ? <span className="text-destructive">non-union</span> : r1(r.hours)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r1(r.bankAfter)}</td>
                  <td className="px-3 py-2">{r.covers ? monthLabel(r.covers) : <span className="text-muted-foreground">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <FundCheck data={data} />

        <section className="space-y-1 rounded-xl border border-border bg-card p-4 text-sm">
          <h2 className="font-medium text-foreground">Where the official numbers are</h2>
          <p className="text-muted-foreground">
            The Laborers Health & Welfare Trust Fund (run by Pacific Southwest Administrators) keeps the official hours.
          </p>
          <a className="inline-flex items-center gap-1 text-primary" href="https://sccl.pswadmin.com/Account/Login" target="_blank" rel="noreferrer">
            Trust fund participant portal <ExternalLink className="h-3 w-3" />
          </a>
          <p className="text-muted-foreground">Trust Fund Office: (800) 887-5679 · Local 220 hall: (661) 322-3460</p>
          <p className="text-xs text-muted-foreground">Rules and numbers from public documents (2013 plan summary); they may have changed.</p>
        </section>
      </main>
    </div>
  );
}

function FundCheck({ data }: { data: ReturnType<typeof useUnionData> }) {
  const { toast } = useToast();
  const employers = Array.from(new Set(data.entries.map((e) => e.details?.employer).filter((x): x is string => !!x)));
  const [form, setForm] = useState({ month: addMonths(data.asOf, -2), employer: employers[0] ?? "", hours: "" });
  const del = useDeleteUnionRow("fundReports");
  const add = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/union/fund-reports", { ...form, hours: Number(form.hours) })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: UNION_QUERY_KEYS.fundReports });
      setForm({ ...form, hours: "" });
      toast({ title: "Added", description: "Compared against your log below." });
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  const checks = data.crossCheck.slice(0, 24);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Check your hours against the fund</h2>
        <p className="text-sm text-muted-foreground">
          Look up a month on the trust fund portal and enter the hours it shows for each employer. If the fund shows less than
          you logged, your employer may not have paid in, and those hours might not count toward coverage. Bring your signed
          hours to the Trust Fund Office or the hall.
        </p>
      </div>

      <form
        className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="fr-month" className="text-xs">Month worked</Label>
          <Input id="fr-month" type="month" className="h-11" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fr-hours" className="text-xs">Fund shows (hrs)</Label>
          <Input id="fr-hours" type="number" inputMode="decimal" min={0} step="0.5" className="h-11" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} required />
        </div>
        <div className="col-span-2 space-y-1 sm:col-span-1">
          <Label htmlFor="fr-employer" className="text-xs">Employer</Label>
          <Input id="fr-employer" list="fr-employers" className="h-11" value={form.employer} onChange={(e) => setForm({ ...form, employer: e.target.value })} required />
          <datalist id="fr-employers">
            {employers.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
        </div>
        <Button type="submit" className="col-span-2 h-11 self-end sm:col-span-1" disabled={add.isPending}>
          Add
        </Button>
      </form>

      <div className="space-y-2">
        {checks.length === 0 && <p className="text-sm text-muted-foreground">Nothing to check yet.</p>}
        {checks.map((c) => {
          const reports = data.fundReports.filter((f) => f.month === c.month && f.employer.trim().toLowerCase() === c.employer.trim().toLowerCase());
          return (
            <div key={`${c.month}-${c.employer}`} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">
                  {monthLabel(c.month)} · {c.employer}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  You logged {r1(c.logged)} · fund {c.reported === null ? "-" : r1(c.reported)}
                  {c.diff !== null && c.diff !== 0 && ` (${c.diff > 0 ? "+" : ""}${r1(c.diff)})`}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span>
              {reports.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-destructive"
                  aria-label="Remove what the fund shows"
                  onClick={() => del.mutate(f.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
