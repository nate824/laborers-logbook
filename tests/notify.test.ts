import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  normalizePhone,
  buildSignatureSms,
  parseChannels,
  sendSms,
  deliverSignatureRequest,
  notificationStatus,
} from "../server/notify";

const ENV_KEYS = [
  "RESEND_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "TWILIO_MESSAGING_SERVICE_SID",
];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  ENV_KEYS.forEach((k) => delete process.env[k]);
});
afterEach(() => {
  ENV_KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
});

describe("normalizePhone", () => {
  it("assumes +1 for 10-digit numbers", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("1-555-123-4567")).toBe("+15551234567");
  });
  it("keeps explicit country codes", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("0044 20 7946 0958")).toBe("+442079460958");
  });
  it("rejects junk", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("parseChannels", () => {
  it("defaults to both and drops unknown values", () => {
    expect(parseChannels(undefined)).toEqual(["email", "sms"]);
    expect(parseChannels(["sms", "fax", "sms"])).toEqual(["sms"]);
    expect(parseChannels([])).toEqual(["email", "sms"]);
  });
});

describe("buildSignatureSms", () => {
  it("ends with the link so phones make it tappable", () => {
    const body = buildSignatureSms({ requester: "Sam", summary: "8h at Site A", url: "https://x/verify/abc" });
    expect(body).toContain("Sam");
    expect(body.endsWith("https://x/verify/abc")).toBe(true);
  });
});

describe("sendSms", () => {
  it("reports not_configured without Twilio keys and makes no request", async () => {
    const fetchMock = vi.fn();
    expect(await sendSms("5551234567", "hi", fetchMock as any)).toEqual({ status: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notificationStatus()).toEqual({ email: false, sms: false });
  });

  it("posts to the Twilio Messages API with basic auth", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "secret";
    process.env.TWILIO_FROM_NUMBER = "+15550000000";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SM1" }) });
    const result = await sendSms("555-123-4567", "hello", fetchMock as any);
    expect(result).toEqual({ status: "sent", id: "SM1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("AC123:secret").toString("base64")}`);
    const params = new URLSearchParams(init.body);
    expect(params.get("To")).toBe("+15551234567");
    expect(params.get("From")).toBe("+15550000000");
    expect(params.get("Body")).toBe("hello");
  });

  it("prefers a messaging service and surfaces Twilio errors", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "secret";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MG1";
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: "Unverified number" }) });
    const result = await sendSms("5551234567", "hi", fetchMock as any);
    expect(result).toEqual({ status: "failed", error: "Unverified number" });
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get("MessagingServiceSid")).toBe("MG1");
  });

  it("flags an invalid number before calling Twilio", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "secret";
    process.env.TWILIO_FROM_NUMBER = "+15550000000";
    expect((await sendSms("12", "hi", vi.fn() as any)).status).toBe("invalid_number");
  });
});

describe("deliverSignatureRequest", () => {
  it("does not call the email sender when Resend isn't configured", async () => {
    const sendEmail = vi.fn();
    const result = await deliverSignatureRequest({ channels: ["email", "sms"], phone: "5551234567", smsBody: "x", sendEmail });
    expect(result).toEqual({ email: "not_configured", sms: "not_configured" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("skips channels that weren't chosen", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const sendEmail = vi.fn().mockResolvedValue(true);
    const result = await deliverSignatureRequest({ channels: ["email"], phone: "5551234567", smsBody: "x", sendEmail });
    expect(result).toEqual({ email: "sent", sms: "skipped" });
  });
});
