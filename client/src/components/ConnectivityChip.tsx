import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { useOnlineStatus, usePendingSyncCount } from "@/lib/offline/online";

export function ConnectivityChip() {
  const online = useOnlineStatus();
  const pending = usePendingSyncCount();

  if (online && pending === 0) {
    return (
      <span
        className="hidden sm:inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700"
        title="Connected to server"
      >
        <Wifi className="h-3 w-3" />
        Online
      </span>
    );
  }

  if (online && pending > 0) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-primary/5 px-2 py-0.5 text-xs text-primary"
        title="Syncing pending changes"
      >
        <RefreshCw className="h-3 w-3 animate-spin" />
        Syncing {pending}…
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800"
      title="You are offline. Changes will sync when you reconnect."
    >
      <WifiOff className="h-3 w-3" />
      Offline{pending > 0 ? ` — ${pending} queued` : ""}
    </span>
  );
}
