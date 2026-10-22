import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Plus, Trash2 } from "lucide-react";

type TokenMeta = {
  id: number;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  userId: number;
};

export function ApiTokensCard() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [revealed, setRevealed] = useState<{ token: string; name: string } | null>(null);

  const { data: tokens = [], isLoading } = useQuery<TokenMeta[]>({
    queryKey: ["/api/tokens"],
  });

  const createMut = useMutation({
    mutationFn: async (tokenName: string) => {
      const res = await apiRequest("POST", "/api/tokens", { name: tokenName });
      return (await res.json()) as TokenMeta & { token: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tokens"] });
      setRevealed({ token: data.token, name: data.name });
      setName("");
    },
    onError: (err: Error) => {
      toast({
        title: "Could not create token",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/tokens/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tokens"] });
      toast({ title: "Token revoked" });
    },
  });

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Copy failed — select and copy manually", variant: "destructive" });
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 mt-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-neutral-900">Claude / MCP access tokens</h2>
        <p className="text-sm text-neutral-600 mt-1">
          Create a bearer token to let Claude (or another MCP client) read and update your work hours log on your
          behalf. Each token grants full access to your account except admin and signed-log import — treat
          them like passwords.
        </p>
      </div>

      <form
        className="flex flex-col sm:flex-row gap-2 sm:items-end mb-6"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          createMut.mutate(trimmed);
        }}
      >
        <div className="flex-1">
          <Label htmlFor="token-name">Token name</Label>
          <Input
            id="token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Claude desktop"
            maxLength={100}
          />
        </div>
        <Button type="submit" disabled={!name.trim() || createMut.isPending}>
          <Plus className="h-4 w-4 mr-2" />
          {createMut.isPending ? "Creating…" : "Create token"}
        </Button>
      </form>

      {isLoading ? (
        <p className="text-sm text-neutral-500">Loading tokens…</p>
      ) : tokens.length === 0 ? (
        <p className="text-sm text-neutral-500">No tokens yet.</p>
      ) : (
        <div className="border border-neutral-200 rounded-md divide-y">
          {tokens.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between p-3"
            >
              <div className="min-w-0">
                <p className="font-medium text-neutral-900 truncate">{t.name}</p>
                <p className="text-xs text-neutral-500 mt-0.5">
                  <code className="font-mono">{t.tokenPrefix}…</code>
                  {" · created "}
                  {new Date(t.createdAt).toLocaleDateString()}
                  {t.lastUsedAt
                    ? ` · last used ${new Date(t.lastUsedAt).toLocaleString()}`
                    : " · never used"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (confirm(`Revoke "${t.name}"? Any client using it will stop working.`)) {
                    deleteMut.mutate(t.id);
                  }
                }}
                disabled={deleteMut.isPending}
                title="Revoke token"
              >
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <details className="mt-6 text-sm">
        <summary className="cursor-pointer font-medium text-neutral-800">
          How to connect Claude to this app
        </summary>
        <div className="mt-3 space-y-3 text-neutral-700">
          <p>
            In Claude Desktop or Claude Code, add a remote MCP server pointing at this URL:
          </p>
          <pre className="bg-neutral-100 rounded p-3 text-xs overflow-x-auto">
{`${origin}/mcp`}
          </pre>
          <p>Authentication: <code>Authorization: Bearer &lt;your-token&gt;</code></p>
          <p>
            Once connected, Claude can list and log work hours, manage supervisors, request verification
            emails, and generate vendor PDF forms — all on your behalf.
          </p>
          <p>
            Need the full walkthrough (including a copy-paste skill)? See the{" "}
            <a href="/skillz" target="_blank" rel="noopener noreferrer" className="text-primary underline font-medium">
              Skillz onboarding page
            </a>
            .
          </p>
        </div>
      </details>

      <Dialog open={!!revealed} onOpenChange={(open) => !open && setRevealed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your token now</DialogTitle>
            <DialogDescription>
              This is the only time you'll see <strong>{revealed?.name}</strong>. Store it in your MCP
              client config — you can't view it again.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-neutral-100 rounded p-3 font-mono text-xs break-all">
            {revealed?.token}
          </div>
          <DialogFooter className="flex !justify-between">
            <Button
              variant="outline"
              onClick={() => revealed && handleCopy(revealed.token)}
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </Button>
            <Button onClick={() => setRevealed(null)}>I've saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
