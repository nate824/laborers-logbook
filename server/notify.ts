// Delivery of signature links to signers: email (Resend, see email.ts) and
// text message (Twilio). Both are optional: with no keys configured the
// request still succeeds and the client falls back to sharing the link from
// the technician's own phone (sms: link / share sheet / copy).

export type ChannelStatus = "sent" | "failed" | "not_configured" | "skipped" | "invalid_number";

export interface DeliveryResult {
  email: ChannelStatus;
  sms: ChannelStatus;
  smsError?: string;
}

export type Channel = "email" | "sms";

export function emailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

export function smsConfigured() {
  return (
    !!process.env.TWILIO_ACCOUNT_SID &&
    !!process.env.TWILIO_AUTH_TOKEN &&
    (!!process.env.TWILIO_FROM_NUMBER || !!process.env.TWILIO_MESSAGING_SERVICE_SID)
  );
}

export function notificationStatus() {
  return { email: emailConfigured(), sms: smsConfigured() };
}

// Normalize a typed phone number to E.164. Numbers without a country code are
// assumed to be North American (+1), which covers ACL's crews. Returns null
// when it can't be a real number.
export function normalizePhone(raw: string | null | undefined, defaultCountryCode = "1"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (trimmed.startsWith("00")) {
    const rest = digits.slice(2);
    return rest.length >= 8 && rest.length <= 15 ? `+${rest}` : null;
  }
  if (defaultCountryCode === "1") {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return null;
  }
  return digits.length >= 8 && digits.length + defaultCountryCode.length <= 15
    ? `+${defaultCountryCode}${digits}`
    : null;
}

// Keep it short: one SMS segment where possible. The link is last so phones
// render it as a tappable URL.
export function buildSignatureSms(opts: { requester: string; summary: string; url: string }) {
  return `Laborers Logbook: ${opts.requester} asked you to sign off ${opts.summary}. Review and sign: ${opts.url}`;
}

export function parseChannels(input: unknown): Channel[] {
  if (!Array.isArray(input)) return ["email", "sms"];
  const out = input.filter((c): c is Channel => c === "email" || c === "sms");
  return out.length ? Array.from(new Set(out)) : ["email", "sms"];
}

type FetchLike = typeof fetch;

export async function sendSms(
  to: string | null | undefined,
  body: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ status: ChannelStatus; id?: string; error?: string }> {
  if (!smsConfigured()) return { status: "not_configured" };
  const phone = normalizePhone(to);
  if (!phone) return { status: "invalid_number" };

  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const params = new URLSearchParams({ To: phone, Body: body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    params.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
  } else {
    params.set("From", process.env.TWILIO_FROM_NUMBER!);
  }

  try {
    const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Twilio SMS failed:", res.status, data?.message);
      return { status: "failed", error: data?.message || `HTTP ${res.status}` };
    }
    console.log("SMS sent via Twilio:", data?.sid);
    return { status: "sent", id: data?.sid };
  } catch (error: any) {
    console.error("Twilio SMS error:", error?.message);
    return { status: "failed", error: error?.message };
  }
}

// Send a signature request over the chosen channels. `sendEmail` is the
// template-specific Resend sender from email.ts (returns false on failure).
export async function deliverSignatureRequest(opts: {
  channels: Channel[];
  phone: string | null | undefined;
  smsBody: string;
  sendEmail: () => Promise<boolean>;
}): Promise<DeliveryResult> {
  const wantEmail = opts.channels.includes("email");
  const wantSms = opts.channels.includes("sms");

  const [email, sms] = await Promise.all([
    !wantEmail
      ? Promise.resolve<ChannelStatus>("skipped")
      : !emailConfigured()
      ? Promise.resolve<ChannelStatus>("not_configured")
      : opts.sendEmail().then((ok): ChannelStatus => (ok ? "sent" : "failed")),
    !wantSms
      ? Promise.resolve<{ status: ChannelStatus; error?: string }>({ status: "skipped" })
      : sendSms(opts.phone, opts.smsBody),
  ]);

  return { email, sms: sms.status, ...(sms.error ? { smsError: sms.error } : {}) };
}
