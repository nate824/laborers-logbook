import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Check, CheckCircle2, Copy, Mail, MessageSquare, Share2 } from "lucide-react";

export type ChannelStatus = "sent" | "failed" | "not_configured" | "skipped" | "invalid_number";
export type Channel = "email" | "sms";

export interface SignatureRequestResult {
  verificationUrl: string;
  smsBody?: string;
  delivery?: { email: ChannelStatus; sms: ChannelStatus; smsError?: string };
  supervisor?: { name: string; email: string; phone?: string | null };
}

// Which channels the server has keys for (Resend email, Twilio SMS).
export function useNotificationStatus() {
  return useQuery<{ email: boolean; sms: boolean }>({
    queryKey: ["/api/notifications/status"],
    staleTime: 5 * 60 * 1000,
  });
}

// Opens the phone's Messages app with the signer and text pre-filled.
// "?&body=" is the form both iOS and Android accept.
export function smsHref(phone: string | null | undefined, body: string) {
  const to = (phone ?? "").replace(/[^\d+]/g, "");
  return `sms:${to}?&body=${encodeURIComponent(body)}`;
}

// Opens the phone's mail app with the signer, subject and message pre-filled.
export function mailtoHref(email: string, subject: string, body: string) {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function StatusLine({ icon: Icon, label, status, detail }: {
  icon: typeof Mail;
  label: string;
  status: ChannelStatus;
  detail?: string;
}) {
  if (status === "skipped") return null;
  // No Resend/Twilio keys: sending from the technician's own phone is the
  // normal path, not a failure.
  if (status === "not_configured") {
    return (
      <div className="flex items-start gap-2 text-sm text-foreground">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0">
          {label}: tap below to send it from your phone
          {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
        </span>
      </div>
    );
  }
  const ok = status === "sent";
  const text =
    status === "sent"
      ? `${label} sent`
      : status === "invalid_number"
      ? `${label}: phone number doesn't look valid`
      : `${label} failed`;
  return (
    <div className={`flex items-start gap-2 text-sm ${ok ? "text-green-700" : "text-amber-700"}`}>
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
      <span className="min-w-0">
        <Icon className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
        {text}
        {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
    </div>
  );
}

// What went out, plus ways to get the link to the signer by hand when the
// automatic channels didn't (no keys yet, bad number, provider error).
export function SignatureLinkSent({ result, onDone }: { result: SignatureRequestResult; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const { delivery, supervisor, verificationUrl } = result;
  const smsBody = result.smsBody ?? `Please review and sign my logged hours: ${verificationUrl}`;
  const emailSent = delivery?.email === "sent";
  const textSent = delivery?.sms === "sent";
  const delivered = emailSent || textSent;
  // Offer the by-hand version of each channel the user picked that didn't go
  // out automatically. (No delivery info = older response: offer both.)
  const offerEmail = !!supervisor?.email && !emailSent && delivery?.email !== "skipped";
  const offerText = !!supervisor?.phone && !textSent && delivery?.sms !== "skipped";
  const firstName = supervisor?.name?.split(" ")[0];
  const emailBody = `${firstName ? `Hi ${firstName},` : "Hi,"}\n\n${smsBody}\n\nThanks!`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(verificationUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard needs a secure context; the link is visible below anyway.
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
        {delivery ? (
          <>
            <StatusLine icon={Mail} label="Email" status={delivery.email} detail={supervisor?.email} />
            <StatusLine
              icon={MessageSquare}
              label="Text"
              status={delivery.sms}
              detail={delivery.smsError ?? supervisor?.phone ?? undefined}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Signature link created.</p>
        )}
        {!delivered && !offerEmail && !offerText && (
          <p className="text-sm text-foreground">
            Send the link yourself{supervisor?.name ? ` to ${supervisor.name}` : ""}:
          </p>
        )}
      </div>

      <div className="grid gap-2">
        {offerEmail && (
          <Button asChild className="h-12 text-base">
            <a href={mailtoHref(supervisor!.email, "Please sign off my logged hours", emailBody)}>
              <Mail className="mr-2 h-4 w-4" /> Email it from my phone
            </a>
          </Button>
        )}
        {offerText && (
          <Button asChild className="h-12 text-base">
            <a href={smsHref(supervisor!.phone, smsBody)}>
              <MessageSquare className="mr-2 h-4 w-4" /> Text it from my phone
            </a>
          </Button>
        )}
        {canShare && (
          <Button
            type="button"
            variant="outline"
            className="h-12 text-base"
            onClick={() =>
              navigator.share({ title: "Sign off my hours", text: smsBody }).catch(() => {})
            }
          >
            <Share2 className="mr-2 h-4 w-4" /> Share link…
          </Button>
        )}
        <Button type="button" variant="outline" className="h-12 text-base" onClick={copy}>
          {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>

      <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
        {verificationUrl}
      </p>

      <Button type="button" className="h-11 w-full" variant="secondary" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

export function SignatureLinkSentDialog({
  result,
  onClose,
}: {
  result: SignatureRequestResult | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!result} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Verification requested</DialogTitle>
          <DialogDescription>
            {result?.supervisor?.name
              ? `${result.supervisor.name} can sign off from the link.`
              : "The signer can sign off from the link."}
          </DialogDescription>
        </DialogHeader>
        {result && <SignatureLinkSent result={result} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

// "Send by" chips: email and/or text. Unconfigured channels stay selectable;
// the result screen then offers to send by hand.
export function ChannelPicker({
  value,
  onChange,
  email,
  phone,
}: {
  value: Channel[];
  onChange: (next: Channel[]) => void;
  email?: string | null;
  phone?: string | null;
}) {
  const { data: status } = useNotificationStatus();
  const toggle = (c: Channel) =>
    onChange(value.includes(c) ? value.filter((v) => v !== c) : [...value, c]);
  const options: { key: Channel; icon: typeof Mail; label: string; detail?: string | null; note?: string }[] = [
    { key: "email", icon: Mail, label: "Email", detail: email, note: status && !status.email ? "sends from your phone" : undefined },
    { key: "sms", icon: MessageSquare, label: "Text", detail: phone, note: status && !status.sms ? "sends from your phone" : undefined },
  ];
  return (
    <div>
      <div className="mb-2 text-sm font-medium">Send by</div>
      <div className="grid grid-cols-2 gap-2">
        {options.map(({ key, icon: Icon, label, detail, note }) => {
          const active = value.includes(key);
          const disabled = !detail;
          return (
            <button
              key={key}
              type="button"
              role="checkbox"
              aria-checked={active}
              disabled={disabled}
              onClick={() => toggle(key)}
              className={`min-w-0 rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
                active && !disabled ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
              }`}
            >
              <span className="flex items-center gap-2 font-medium text-foreground">
                <Icon className={`h-4 w-4 ${active && !disabled ? "text-primary" : "text-muted-foreground"}`} />
                {label}
                {active && !disabled && <Check className="ml-auto h-4 w-4 text-primary" />}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail || "none on file"}</span>
              {note && <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">{note}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
