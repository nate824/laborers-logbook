import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Settings, User } from "lucide-react";

// Segmented control letting an admin flip between their own technician view
// and the admin dashboard. Renders nothing for non-admins.
export function AdminViewToggle() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();

  if (!user?.isAdmin) return null;
  // Hide while impersonating — the impersonation banner owns the exit there.
  if (user.impersonating) return null;

  const onAdmin = location.startsWith("/admin");

  return (
    <div className="inline-flex rounded-md border border-neutral-200 bg-neutral-50 p-0.5 text-sm">
      <button
        type="button"
        onClick={() => setLocation("/field-hours")}
        className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
          !onAdmin
            ? "bg-white text-neutral-900 shadow-sm"
            : "text-neutral-500 hover:text-neutral-700"
        }`}
      >
        <User className="h-3.5 w-3.5" />
        My view
      </button>
      <button
        type="button"
        onClick={() => setLocation("/admin")}
        className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
          onAdmin
            ? "bg-white text-neutral-900 shadow-sm"
            : "text-neutral-500 hover:text-neutral-700"
        }`}
      >
        <Settings className="h-3.5 w-3.5" />
        Admin
      </button>
    </div>
  );
}
