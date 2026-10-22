import { formatCalendarDate } from "@shared/dates";
import { fieldMethodLabel } from "@shared/schema";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Award, BadgeCheck, FileText, ShieldCheck } from "lucide-react";

type PublicProfile = {
  name: string | null;
  ojt: {
    byMethod: {
      method: string;
      totalHours: number;
      verifiedHours: number;
      count: number;
    }[];
    totalVerifiedHours: number;
  };
  rope: { totalHours: number; verifiedHours: number; count: number } | null;
  certifications: {
    id: number;
    name: string;
    issuingBody: string | null;
    method: string | null;
    level: string | null;
    issueDate: string | null;
    expiryDate: string | null;
    hasDocument: boolean;
  }[];
};

// Only used for certification expiry, a calendar date.
function fmtDate(value: string | null): string | null {
  return formatCalendarDate(value) || null;
}

export default function PublicProfilePage() {
  const { token } = useParams();

  const { data, isLoading, isError } = useQuery<PublicProfile>({
    queryKey: [`/api/public-profile/${token}`],
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-100">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-100 px-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-neutral-900">
            Profile not available
          </h1>
          <p className="text-sm text-neutral-600 mt-2">
            This share link is invalid or has been disabled by its owner.
          </p>
        </div>
      </div>
    );
  }

  const hasOjt = data.ojt.byMethod.length > 0;
  const hasCerts = data.certifications.length > 0;

  const viewCertificate = async (certId: number) => {
    try {
      const res = await fetch(
        `/api/public-profile/${token}/certifications/${certId}/document`,
      );
      if (!res.ok) throw new Error("Could not open certificate");
      const { url } = (await res.json()) as { url: string };
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // Surface nothing intrusive on a public page; the link simply no-ops.
    }
  };

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="bg-white border-b">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <p className="text-sm font-medium text-primary uppercase tracking-wide">
            Verified Experience Summary
          </p>
          <h1 className="text-2xl font-bold text-neutral-900 mt-1">
            {data.name || "Technician"}
          </h1>
          <p className="text-sm text-neutral-600 mt-2 inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-green-600" />
            Hours marked verified were confirmed by a supervisor via signed link.
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Field hours */}
        {hasOjt && (
          <section className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-neutral-900">
                Field hours
              </h2>
              <div className="text-right">
                <div className="text-2xl font-bold text-neutral-900">
                  {data.ojt.totalVerifiedHours}
                </div>
                <div className="text-xs text-neutral-500">verified hours</div>
              </div>
            </div>
            <div className="border border-neutral-200 rounded-md divide-y">
              {data.ojt.byMethod.map((m) => (
                <div
                  key={m.method}
                  className="flex items-center justify-between p-3"
                >
                  <div>
                    <p className="font-medium text-neutral-900">{fieldMethodLabel(m.method)}</p>
                    <p className="text-xs text-neutral-500">
                      {m.count} {m.count === 1 ? "entry" : "entries"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-neutral-900 inline-flex items-center gap-1">
                      <BadgeCheck className="h-4 w-4 text-green-600" />
                      {m.verifiedHours}
                    </p>
                    <p className="text-xs text-neutral-500">
                      of {m.totalHours} hrs
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Rope access */}
        {data.rope && (
          <section className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900">
                  Rope access hours
                </h2>
                <p className="text-xs text-neutral-500 mt-1">
                  {data.rope.count} {data.rope.count === 1 ? "record" : "records"}
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-neutral-900 inline-flex items-center gap-1">
                  <BadgeCheck className="h-5 w-5 text-green-600" />
                  {data.rope.verifiedHours}
                </div>
                <div className="text-xs text-neutral-500">
                  verified of {data.rope.totalHours} hrs
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Certifications */}
        {hasCerts && (
          <section className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-neutral-900 flex items-center gap-2 mb-4">
              <Award className="h-5 w-5 text-primary" />
              Certifications
            </h2>
            <div className="border border-neutral-200 rounded-md divide-y">
              {data.certifications.map((c, i) => {
                const expiry = fmtDate(c.expiryDate);
                const expired =
                  c.expiryDate && new Date(c.expiryDate).getTime() < Date.now();
                return (
                  <div
                    key={c.id ?? i}
                    className="p-3 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-neutral-900">{c.name}</p>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        {[
                          c.issuingBody,
                          [c.method, c.level].filter(Boolean).join(" "),
                          expiry
                            ? `${expired ? "expired" : "expires"} ${expiry}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                    </div>
                    {c.hasDocument && (
                      <button
                        type="button"
                        onClick={() => viewCertificate(c.id)}
                        className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                      >
                        <FileText className="h-4 w-4" />
                        View certificate
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {!hasOjt && !data.rope && !hasCerts && (
          <p className="text-center text-sm text-neutral-500">
            Nothing has been shared on this profile yet.
          </p>
        )}

        <p className="text-center text-xs text-neutral-400 pt-4">
          Shared via Access Limited Logbook
        </p>
      </main>
    </div>
  );
}
