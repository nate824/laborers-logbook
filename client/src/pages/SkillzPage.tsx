import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  KeyRound,
  Plug,
  FileCode,
  Copy,
  Check,
  Download,
  ExternalLink,
  ListChecks,
  Bot,
  ShieldAlert,
} from "lucide-react";

const ORIGIN = typeof window !== "undefined" ? window.location.origin : "https://ojt.n8ai.io";

type MethodInfo = { code: string; name: string; aliases: string };

const METHODS: MethodInfo[] = [
  { code: "ON_THE_JOB", name: "On the job", aliases: "worked, on the job, shift, day on site" },
  { code: "CLASSROOM", name: "Class / training", aliases: "class, training, school, OSHA course" },
];

const ROPE_SKILLS = [
  "Aid Climbing",
  "Anchorage Systems",
  "Ascent",
  "Descent",
  "Deviation",
  "Dual Main Systems",
  "Hauling",
  "Lowering",
  "Re-anchor",
  "Retrievable Rope Systems",
  "Rope to Rope Transfer",
  "Tension Rope Systems",
];

function buildSkillMd(origin: string): string {
  return `---
name: acl-field-logbook
description: Log union work hours (on the job, class) to the Laborers Logbook and request supervisor verification, from plain language like "10 hours for Granite on Hwy 58 today".
---

# Laborers Logbook

Use this skill to record daily union work hours and rope-access
hours in the Laborers Logbook, and to send entries to a supervisor for verification.

## Setup (one time)
The user must give you a personal API token. If you don't have one, ask for it.
They create it in the app: Field Hours -> "Claude / MCP access tokens" -> Create token.
Store it and send it on EVERY request as a header:

    Authorization: Bearer <TOKEN>

API base URL: ${origin}/api
All requests and responses are JSON. Always send: Content-Type: application/json

## When to act
Trigger when the user describes field or rope hours, e.g.
"10 hours for Granite on Hwy 58 today", "log 8h OSHA class yesterday",
"3 days rope access at Glenwood Canyon, 30 hours, ascent and descent".

Always:
1. Parse the fields (see below).
2. Confirm the parsed entry back to the user in one short line.
3. Create the entry.
4. Offer to send it for verification; if they say yes, do it.

## Field method codes
Map spoken shorthand to ONE of these exact, case-sensitive codes:
${METHODS.map((m) => m.code).join(", ")}
${METHODS.map((m) => `- ${m.aliases} -> ${m.code}`).join("\n")}
Rope access is NOT a field method — log it as rope-access hours (below).
If the method is ambiguous, ask one quick clarifying question before logging.

## Dates
Interpret relative dates in the user's local time, then send ISO YYYY-MM-DD.
- "today" -> today's date, "yesterday" -> the day before.

## Log a field-hours entry
POST ${origin}/api/entries
Body: { "date": "2026-06-06", "location": "Hwy 58 Bakersfield", "method": "ON_THE_JOB", "hours": 10,
        "details": { "employer": "Granite Construction", "union": "Union", "overtime": "2" } }
- hours: number, typically 0-24 for one day ; location: free text ; method: a code above.
- The response includes the new entry's "id".
- To log several at once, POST an ARRAY of those objects.

## Log rope-access hours
POST ${origin}/api/rope-hours
Body: {
  "startDate": "2026-06-01", "endDate": "2026-06-03",
  "location": "Glenwood Canyon", "skills": "Ascent, Descent, Hauling",
  "hours": 30, "employer": "Access Limited", "workDetails": "...", "maxHeight": "30m"
}
- hours may exceed 24 (multi-day). skills: comma-separated free text. Common values:
  ${ROPE_SKILLS.join(", ")}.
- employer / workDetails / maxHeight are optional.

## Request verification from a supervisor (signer)
1. List signers: GET ${origin}/api/supervisors  -> [{ "id", "name", "email", ... }]
2. If none exist, create one:
   POST ${origin}/api/supervisors
   Body: { "name": "...", "email": "...", "phone": "...",
           "certificationLevel": "...", "company": "..." }
3. Send the request:
   - One field-hours entry:  POST ${origin}/api/verify-request/{entryId}   Body: { "supervisorId": 123 }
   - Several field-hours entries in one email (needs 2+ entry ids):
                     POST ${origin}/api/batch-verify-request        Body: { "entryIds": [1,2,3], "supervisorId": 123 }
   - A rope-hours entry:
                     POST ${origin}/api/verify-request-rope/{id}    Body: { "supervisorId": 123 }
Pick the signer by name if the user names one; otherwise ask which to use.

## Worked example: "10 hours for Granite on Hwy 58 today"
1. Parse -> date=today, location="Hwy 58", method="ON_THE_JOB", hours=10, details.employer="Granite".
2. Say: "Logging 10h on the job for Granite at Hwy 58 on <today> - go ahead?"
3. POST /api/entries with that body; keep the returned id.
4. Ask: "Send it to a supervisor for verification?"
5. If yes: choose supervisorId, then POST /api/verify-request/{id} with it.

## Notes
- Never guess a method or date you're unsure about - ask.
- Entries that are already verified cannot be re-verified.
- Keep confirmations short; do the work instead of over-explaining.
`;
}

function CodeBlock({ text, label }: { text: string; label?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed — select the text manually", variant: "destructive" });
    }
  };

  return (
    <div className="relative">
      {label && (
        <div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>
      )}
      <pre className="bg-muted text-foreground rounded-md p-3 pr-12 text-xs overflow-x-auto whitespace-pre-wrap break-words border border-border">
        {text}
      </pre>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={copy}
        className="absolute top-1 right-1 h-7 px-2"
        aria-label="Copy to clipboard"
      >
        {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

export default function SkillzPage() {
  const { toast } = useToast();
  const skillMd = buildSkillMd(ORIGIN);

  const downloadSkill = () => {
    try {
      const blob = new Blob([skillMd], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "SKILL.md";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed — copy the text instead", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            <span className="font-semibold">Laborers Logbook — Skillz</span>
          </div>
          <Link href="/field-hours">
            <Button variant="outline" size="sm">
              Open the app
              <ExternalLink className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        {/* Hero */}
        <section className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-medium">
            <Sparkles className="h-3.5 w-3.5" />
            Connect your AI assistant
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Log your hours by just talking to Claude
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Hook up a Claude coworker once, then say things like{" "}
            <span className="font-medium text-foreground">"10 hours for Granite on Hwy 58 today"</span> and it
            will add the entry and send it off for supervisor verification — no forms.
          </p>
        </section>

        {/* Step 1: token */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white text-sm font-bold">
                1
              </span>
              <KeyRound className="h-5 w-5" />
              Get your personal access token
            </CardTitle>
            <CardDescription>
              This token lets your assistant act on your account. Treat it like a password.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>
                Open the app and go to{" "}
                <Link href="/field-hours" className="text-primary underline font-medium">
                  your profile
                </Link>
                .
              </li>
              <li>
                Find the <span className="text-foreground font-medium">"Claude / MCP access tokens"</span>{" "}
                card and create a token (e.g. name it "Claude").
              </li>
              <li>Copy it once and paste it into your assistant when asked.</li>
            </ol>
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                Only paste the token into <strong>your own</strong> assistant. Anyone with it can read
                and change your hours. You can revoke a token anytime from the same card.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Step 2: choose a path */}
        <div className="text-center">
          <h2 className="text-xl font-semibold flex items-center justify-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white text-sm font-bold">
              2
            </span>
            Connect it — two ways
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Pick whichever matches your setup. Both do the same thing.
          </p>
        </div>

        {/* Option A: MCP */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5 text-primary" />
              Option A — Add as a connector (MCP)
            </CardTitle>
            <CardDescription>
              Best for Claude.ai and Claude Desktop. Add it once under Settings → Connectors.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="mb-2">Use this server URL:</p>
              <CodeBlock text={`${ORIGIN}/mcp`} />
            </div>
            <div>
              <p className="mb-2">Authentication header (paste your token):</p>
              <CodeBlock text={`Authorization: Bearer YOUR_TOKEN_HERE`} />
            </div>
            <div>
              <p className="font-medium mb-1 flex items-center gap-2">
                <ListChecks className="h-4 w-4" />
                Once connected, your assistant can:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                <li>Log, list, update, and delete field hours and rope-access hours</li>
                <li>See running totals by field method</li>
                <li>Add supervisors (signers) and request verification emails</li>
                <li>Generate rope-access logbook PDFs (SPRAT, IRATA)</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Option B: skill */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCode className="h-5 w-5 text-primary" />
              Option B — Build a skill
            </CardTitle>
            <CardDescription>
              Best for Claude Code or any assistant that can make web requests. Hand it the file
              below and it will know exactly how to log your hours.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Copy or download this <code>SKILL.md</code>, then tell your assistant to save it as a
              skill. It already has your app's address baked in.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={downloadSkill}>
                <Download className="h-4 w-4 mr-2" />
                Download SKILL.md
              </Button>
            </div>
            <CodeBlock text={skillMd} label="SKILL.md" />
          </CardContent>
        </Card>

        {/* Reference */}
        <Card>
          <CardHeader>
            <CardTitle>Reference</CardTitle>
            <CardDescription>
              Handy when your assistant asks what a code or skill name should be.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 text-sm">
            <div>
              <h3 className="font-medium mb-2">Field method codes</h3>
              <div className="overflow-x-auto border border-border rounded-md">
                <table className="w-full text-left">
                  <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Code</th>
                      <th className="px-3 py-2">Method</th>
                      <th className="px-3 py-2">You can say</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {METHODS.map((m) => (
                      <tr key={m.code}>
                        <td className="px-3 py-2 font-mono font-medium">{m.code}</td>
                        <td className="px-3 py-2">{m.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{m.aliases}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Rope access isn't a field method — it's logged separately as rope hours.
              </p>
            </div>

            <div>
              <h3 className="font-medium mb-2">Rope-access skill names</h3>
              <div className="flex flex-wrap gap-1.5">
                {ROPE_SKILLS.map((s) => (
                  <span
                    key={s}
                    className="px-2 py-1 rounded-full bg-muted text-muted-foreground text-xs"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-medium mb-2">Things you can say</h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>"10 hours for Granite on Hwy 58 today"</li>
                <li>"Log 6h shotcrete yesterday at Glenwood, then send it to John for verification"</li>
                <li>"3 days rope access at Glenwood Canyon, 30 hours — ascent, descent and hauling"</li>
                <li>"What are my verified union hours this month?"</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground pb-4">
          Powered by the Laborers Logbook MCP server at <code>{ORIGIN}/mcp</code>
        </p>
      </main>
    </div>
  );
}
