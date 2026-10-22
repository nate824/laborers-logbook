import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ProfileHeader } from "@/components/ProfileHeader";
import { UnionProfileDialog } from "@/components/UnionProfileDialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useAddDispatchEvent, useUnionData } from "@/lib/union";
import { todayLocalISODate } from "@shared/dates";
import { CLASSIFICATIONS, UNION_RULES, monthKey, monthLabel, type Reminder } from "@shared/union";
import { AlertTriangle, BadgeCheck, CalendarClock, ChevronRight, GraduationCap, HeartPulse, ListOrdered, Settings2 } from "lucide-react";

// Home screen: what needs doing, health coverage, the out-of-work list and
// apprenticeship progress at a glance. Everything is the member's own
// estimate from their log; the official records are the hall's, the trust
// fund's and the JAC's.
export default function StatusPage() {
  const data = useUnionData();
  const [profileOpen, setProfileOpen] = useState(false);

  // The dues reminder links to #profile; open the dialog for it, including
  // when the link is tapped while already on this page.
  useEffect(() => {
    const check = () => {
      if (window.location.hash === "#profile") {
        setProfileOpen(true);
        history.replaceState(null, "", window.location.pathname);
      }
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  if (data.loadingUser) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  if (!data.user) return null;

  const { profile } = data;
  const monthEntries = data.entries.filter((e) => monthKey(e.date) === data.asOf);
  const monthUnion = monthEntries.filter((e) => e.method === "ON_THE_JOB" && e.details?.union !== "Non-union").reduce((s, e) => s + e.hours, 0);
  const unsigned = data.entries.filter((e) => !e.verified).length;

  return (
    <div className="min-h-screen bg-background">
      <ProfileHeader user={data.user} />
      <main className="mx-auto max-w-3xl space-y-4 px-4 pt-4 pb-mobile-nav md:py-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Hi {data.user.name?.split(" ")[0] || "there"}</h1>
            <p className="text-sm text-muted-foreground">
              {CLASSIFICATIONS[profile.classification]} · Local {profile.localNumber}
            </p>
          </div>
          <Button variant="outline" className="h-10" onClick={() => setProfileOpen(true)}>
            <Settings2 className="mr-2 h-4 w-4" /> My union info
          </Button>
        </div>

        <RemindersCard items={data.reminders} />

        <div className="grid gap-4 md:grid-cols-2">
          <CoverageCard data={data} />
          <ListCard data={data} />
        </div>

        {profile.classification === "APPRENTICE" && <ApprenticeCard data={data} />}

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-medium text-muted-foreground">{monthLabel(data.asOf)}</h2>
          <div className="mt-2 grid grid-cols-3 gap-3 text-center">
            <Stat value={monthUnion} label="union hrs" />
            <Stat value={data.certs.length} label="certs on file" />
            <Stat value={unsigned} label="days unsigned" />
          </div>
          <Link href="/hours" className="mt-3 flex h-11 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
            Log today's hours
          </Link>
        </section>

        <p className="px-1 text-xs text-muted-foreground">
          Your own record and estimates, not the union's, the trust fund's or the JAC's official records. Rules are set from
          public documents and may be out of date.
        </p>
      </main>
      <UnionProfileDialog open={profileOpen} onOpenChange={setProfileOpen} profile={profile} />
    </div>
  );
}

type Data = ReturnType<typeof useUnionData>;

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums text-foreground">{Math.round(value * 10) / 10}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

const LEVEL_STYLE: Record<Reminder["level"], string> = {
  urgent: "border-l-destructive",
  soon: "border-l-amber-500",
  info: "border-l-muted-foreground/40",
};

function RemindersCard({ items }: { items: Reminder[] }) {
  if (!items.length) {
    return (
      <section className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
        <BadgeCheck className="h-6 w-6 text-primary" />
        <p className="text-sm text-foreground">You're caught up. Nothing due right now.</p>
      </section>
    );
  }
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-sm font-medium text-muted-foreground">To do</h2>
      {items.map((r) => {
        const body = (
          <div className={`flex items-center gap-3 rounded-lg border border-border border-l-4 bg-card p-3 ${LEVEL_STYLE[r.level]}`}>
            {r.level === "urgent" && <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">{r.title}</div>
              {r.detail && <div className="text-xs text-muted-foreground">{r.detail}</div>}
            </div>
            {r.href && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </div>
        );
        return r.href ? (
          <a key={r.id} href={r.href} className="block">
            {body}
          </a>
        ) : (
          <div key={r.id}>{body}</div>
        );
      })}
    </section>
  );
}

function CoverageCard({ data }: { data: Data }) {
  const h = data.health;
  const cap = UNION_RULES.health.bankCap;
  // First coverage month already earned that hasn't started yet.
  const upcoming = h.rows.map((r) => r.covers).filter((c): c is string => !!c && c > data.asOf).sort()[0];
  return (
    <Link href="/benefits" className="block rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/40">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <HeartPulse className="h-4 w-4" /> Health coverage <ChevronRight className="ml-auto h-4 w-4" />
      </div>
      {h.qualifying ? (
        <>
          <div className="mt-2 text-lg font-semibold text-foreground">Not covered yet</div>
          <p className="text-sm text-muted-foreground">
            {h.qualifying.hours} of {UNION_RULES.health.initialHours} union hrs in the last {UNION_RULES.health.windowMonths} months
          </p>
          <Progress className="mt-3 h-2" value={(h.qualifying.hours / UNION_RULES.health.initialHours) * 100} />
          <p className="mt-2 text-xs text-muted-foreground">{h.qualifying.needed} more hrs to qualify</p>
        </>
      ) : (
        <>
          <div className="mt-2 text-lg font-semibold text-foreground">
            {h.coveredNow ? `Covered through ${monthLabel(h.projectedThrough!)}` : `Coverage starts ${monthLabel(upcoming ?? h.projectedThrough!)}`}
          </div>
          <p className="text-sm text-muted-foreground">Hour bank: {h.bank} of {cap} hrs</p>
          <Progress className="mt-3 h-2" value={(h.bank / cap) * 100} />
          <p className="mt-2 text-xs text-muted-foreground">If you stopped working today, through {monthLabel(h.projectedThrough!)}</p>
        </>
      )}
    </Link>
  );
}

function ListCard({ data }: { data: Data }) {
  const { toast } = useToast();
  const add = useAddDispatchEvent();
  const l = data.list;
  const log = (kind: string, msg: string) =>
    add.mutate(
      { date: todayLocalISODate(), kind },
      {
        onSuccess: () => toast({ title: msg }),
        onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
      },
    );

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <Link href="/list" className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <ListOrdered className="h-4 w-4" /> Out-of-work list <ChevronRight className="ml-auto h-4 w-4" />
      </Link>
      {l.state === "ON_LIST" && (
        <>
          <div className="mt-2 text-lg font-semibold text-foreground">
            {l.daysLeft! < 0 ? `Re-register overdue by ${-l.daysLeft!} days` : `Re-register in ${l.daysLeft} days`}
          </div>
          <p className="text-sm text-muted-foreground">By {l.reRegisterBy!.toLocaleDateString("en-US")} · on the list since {l.since!.toLocaleDateString("en-US")}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button className="h-11" disabled={add.isPending} onClick={() => log("RE_REGISTERED", "Re-registration logged")}>
              <CalendarClock className="mr-2 h-4 w-4" /> Re-registered today
            </Button>
            <Button asChild variant="outline" className="h-11">
              <Link href="/list?add=DISPATCHED">Got dispatched</Link>
            </Button>
          </div>
        </>
      )}
      {l.state === "WORKING" && (
        <>
          <div className="mt-2 text-lg font-semibold text-foreground">Working{l.employer ? ` for ${l.employer}` : ""}</div>
          <p className="text-sm text-muted-foreground">Since {l.since!.toLocaleDateString("en-US")}. Off the list while you work.</p>
          <Button variant="outline" className="mt-3 h-11 w-full" disabled={add.isPending} onClick={() => log("LAID_OFF", "Layoff logged. Sign back on the list.")}>
            Job ended / laid off
          </Button>
        </>
      )}
      {l.state === "OFF_LIST" && (
        <>
          <div className="mt-2 text-lg font-semibold text-foreground">Not on the list</div>
          <p className="text-sm text-muted-foreground">Sign the list at the hall when you're out of work, then log it here.</p>
          <Button className="mt-3 h-11 w-full" disabled={add.isPending} onClick={() => log("REGISTERED", "Sign-in logged. 30-day clock started.")}>
            I signed the list today
          </Button>
        </>
      )}
    </section>
  );
}

function ApprenticeCard({ data }: { data: Data }) {
  const a = data.apprentice;
  const cfg = UNION_RULES.apprentice;
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <GraduationCap className="h-4 w-4" /> Apprenticeship (CCL)
      </div>
      <div className="mt-2 text-lg font-semibold text-foreground">
        {a.journeyperson ? "Hours complete for journeyperson" : `Period ${a.period} of ${cfg.periods.length}${a.wage ? ` · $${a.wage.toFixed(2)}/hr` : ""}`}
      </div>
      <div className="mt-3 space-y-3">
        <div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>On-the-job</span>
            <span className="tabular-nums">
              {Math.round(a.ojt)} / {cfg.journeyOjt}
            </span>
          </div>
          <Progress className="mt-1 h-2" value={a.ojtPct} />
        </div>
        <div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Class (RSI)</span>
            <span className="tabular-nums">
              {Math.round(a.rsi)} / {cfg.journeyRsi}
            </span>
          </div>
          <Progress className="mt-1 h-2" value={a.rsiPct} />
        </div>
      </div>
      {a.next && (
        <p className="mt-3 text-sm text-foreground">
          {a.next.period > cfg.periods.length ? "To journeyperson" : `To period ${a.next.period}`}:{" "}
          {[a.next.ojtNeeded > 0 && `${Math.ceil(a.next.ojtNeeded)} OJT hrs`, a.next.rsiNeeded > 0 && `${Math.ceil(a.next.rsiNeeded)} class hrs`]
            .filter(Boolean)
            .join(" + ") || "ready, ask your coordinator"}
          {a.next.wage ? ` → $${a.next.wage.toFixed(2)}/hr` : ""}
        </p>
      )}
    </section>
  );
}
