import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Eye, X } from "lucide-react";

// Fixed banner shown whenever an admin is impersonating another user, with a
// one-click exit back to the admin dashboard.
export function ImpersonationBanner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const stopMut = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/stop-impersonate");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      // Clear cached per-user data so the admin's own data reloads fresh.
      queryClient.clear();
      setLocation("/admin");
      toast({ title: "Back to your account" });
    },
    onError: (err: Error) =>
      toast({ title: "Could not exit", description: err.message, variant: "destructive" }),
  });

  if (!user?.impersonating) return null;

  return (
    <div className="sticky top-0 z-50 bg-amber-500 text-amber-950">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-2 font-medium min-w-0">
          <Eye className="h-4 w-4 shrink-0" />
          <span className="truncate">
            Viewing as {user.name || user.email} — changes apply to their account.
          </span>
        </span>
        <button
          type="button"
          onClick={() => stopMut.mutate()}
          disabled={stopMut.isPending}
          className="inline-flex items-center gap-1 rounded bg-amber-950/10 hover:bg-amber-950/20 px-2.5 py-1 font-semibold shrink-0"
        >
          <X className="h-3.5 w-3.5" />
          {stopMut.isPending ? "Exiting…" : "Exit"}
        </button>
      </div>
    </div>
  );
}
