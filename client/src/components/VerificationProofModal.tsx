import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VerificationAuditTrail } from "@shared/schema";
import {
  BadgeCheck,
  Clock,
  Globe,
  Mail,
  Monitor,
  ShieldCheck,
  Send,
  MousePointerClick,
} from "lucide-react";

// The subset of an Entry / RopeHours row that carries verification evidence.
// Both record types share these columns, so one modal serves both.
export type VerificationRecord = {
  verified?: boolean | null;
  verifiedBy?: string | null;
  verifiedByEmail?: string | null;
  verifiedAt?: string | Date | null;
  verificationRequestedAt?: string | Date | null;
  supervisorIpAddress?: string | null;
  supervisorBrowserInfo?: string | null;
  auditTrail?: VerificationAuditTrail | null;
};

interface VerificationProofModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  // What was confirmed — caller passes the record's own fields (date, method…).
  summaryRows: { label: string; value: string }[];
  record: VerificationRecord;
}

function fmt(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

const ACTION_META: Record<
  string,
  { label: string; icon: typeof Send }
> = {
  verification_requested: { label: "Verification requested", icon: Send },
  link_opened: { label: "Supervisor opened the link", icon: MousePointerClick },
  verified: { label: "Hours confirmed", icon: BadgeCheck },
};

export function VerificationProofModal({
  open,
  onOpenChange,
  title = "Verification record",
  summaryRows,
  record,
}: VerificationProofModalProps) {
  const trail = record.auditTrail ?? [];
  const attested = trail.some((e) => e.action === "verified" && e.attestation);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-green-600" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          {/* Who & when */}
          <div className="rounded-md border border-green-200 bg-green-50 p-3">
            <p className="font-medium text-green-800 flex items-center gap-1.5">
              <BadgeCheck className="h-4 w-4" />
              Verified by {record.verifiedBy || "—"}
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-neutral-700">
              {record.verifiedByEmail && (
                <>
                  <dt className="text-neutral-500 inline-flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5" /> Email
                  </dt>
                  <dd className="font-medium break-all">
                    {record.verifiedByEmail}
                  </dd>
                </>
              )}
              <dt className="text-neutral-500 inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> Confirmed
              </dt>
              <dd className="font-medium">{fmt(record.verifiedAt)}</dd>
              <dt className="text-neutral-500 inline-flex items-center gap-1">
                <Send className="h-3.5 w-3.5" /> Requested
              </dt>
              <dd className="font-medium">
                {fmt(record.verificationRequestedAt)}
              </dd>
            </dl>
          </div>

          {/* Attestation */}
          {attested && (
            <p className="text-neutral-700 italic border-l-2 border-green-400 pl-3">
              The verifier attested that these hours are true and correct, that
              the details are accurate, and that they were authorized to verify
              them.
            </p>
          )}

          {/* What was confirmed */}
          <div>
            <h3 className="font-medium text-neutral-900 mb-2">
              What was confirmed
            </h3>
            <dl className="rounded-md border border-neutral-200 divide-y">
              {summaryRows.map((row) => (
                <div
                  key={row.label}
                  className="flex justify-between gap-4 px-3 py-2"
                >
                  <dt className="text-neutral-500">{row.label}</dt>
                  <dd className="text-neutral-900 font-medium text-right">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Captured evidence */}
          {(record.supervisorIpAddress || record.supervisorBrowserInfo) && (
            <div>
              <h3 className="font-medium text-neutral-900 mb-2">
                Captured at confirmation
              </h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-neutral-700">
                {record.supervisorIpAddress && (
                  <>
                    <dt className="text-neutral-500 inline-flex items-center gap-1">
                      <Globe className="h-3.5 w-3.5" /> IP address
                    </dt>
                    <dd className="font-medium break-all">
                      {record.supervisorIpAddress}
                    </dd>
                  </>
                )}
                {record.supervisorBrowserInfo && (
                  <>
                    <dt className="text-neutral-500 inline-flex items-center gap-1">
                      <Monitor className="h-3.5 w-3.5" /> Device
                    </dt>
                    <dd className="font-medium break-all">
                      {record.supervisorBrowserInfo}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {/* Timeline */}
          {trail.length > 0 && (
            <div>
              <h3 className="font-medium text-neutral-900 mb-2">Audit trail</h3>
              <ol className="relative border-l border-neutral-200 ml-2 space-y-4">
                {trail.map((event, i) => {
                  const meta = ACTION_META[event.action] ?? {
                    label: event.action,
                    icon: Clock,
                  };
                  const Icon = meta.icon;
                  return (
                    <li key={i} className="ml-4">
                      <span className="absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full bg-white">
                        <Icon className="h-3.5 w-3.5 text-neutral-500" />
                      </span>
                      <p className="font-medium text-neutral-800">
                        {meta.label}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {fmt(event.timestamp)}
                        {event.actor ? ` · ${event.actor}` : ""}
                        {event.email ? ` · ${event.email}` : ""}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          <p className="text-xs text-neutral-400 border-t pt-3">
            This record is captured automatically when a supervisor confirms
            hours via the unique link emailed to their address.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
