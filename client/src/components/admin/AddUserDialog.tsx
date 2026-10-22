import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { Check, Copy, Mail, TriangleAlert } from "lucide-react";

type CreateResult = {
  user: { id: number; email: string; name: string | null };
  tempPassword: string;
  invited: boolean;
  inviteError: string | null;
};

export function AddUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (userId: number) => void;
}) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [result, setResult] = useState<CreateResult | null>(null);

  const reset = () => {
    setEmail("");
    setName("");
    setEmployeeNumber("");
    setSendInvite(true);
    setResult(null);
    onClose();
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/users", {
        email: email.trim(),
        name: name.trim() || null,
        employeeNumber: employeeNumber.trim() || null,
        sendInvite,
      });
      return (await res.json()) as CreateResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setResult(data);
    },
    onError: (err: Error) =>
      toast({ title: "Could not create user", description: err.message, variant: "destructive" }),
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : reset())}>
      <DialogContent>
        {!result ? (
          <>
            <DialogHeader>
              <DialogTitle>Add user</DialogTitle>
              <DialogDescription>
                Creates an account with a generated password. They sign in and manage
                their own profile.
              </DialogDescription>
            </DialogHeader>
            <form
              id="add-user-form"
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!email.trim()) return;
                createMut.mutate();
              }}
            >
              <div>
                <Label htmlFor="nu-email">Email *</Label>
                <Input
                  id="nu-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tech@company.com"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="nu-name">Name</Label>
                  <Input
                    id="nu-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={200}
                  />
                </div>
                <div>
                  <Label htmlFor="nu-emp">Employee #</Label>
                  <Input
                    id="nu-emp"
                    value={employeeNumber}
                    onChange={(e) => setEmployeeNumber(e.target.value)}
                    maxLength={100}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={sendInvite}
                  onChange={(e) => setSendInvite(e.target.checked)}
                />
                Email them an invite with their login now
              </label>
            </form>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="add-user-form"
                disabled={!email.trim() || createMut.isPending}
              >
                {createMut.isPending ? "Creating…" : "Create user"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>User created</DialogTitle>
              <DialogDescription>
                {result.invited ? (
                  <span className="inline-flex items-center gap-1.5 text-green-700">
                    <Mail className="h-4 w-4" /> Invite emailed to {result.user.email}.
                  </span>
                ) : result.inviteError ? (
                  <span className="inline-flex items-center gap-1.5 text-amber-700">
                    <TriangleAlert className="h-4 w-4" /> {result.inviteError}
                  </span>
                ) : (
                  <span>Share these credentials with the user.</span>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between bg-neutral-100 rounded p-2">
                <span>
                  <span className="text-neutral-500">Email: </span>
                  <span className="font-mono">{result.user.email}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => copy(result.user.email)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center justify-between bg-neutral-100 rounded p-2">
                <span>
                  <span className="text-neutral-500">Temp password: </span>
                  <span className="font-mono">{result.tempPassword}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => copy(result.tempPassword)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  const id = result.user.id;
                  reset();
                  onCreated(id);
                }}
              >
                <Check className="h-4 w-4 mr-1.5" />
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
