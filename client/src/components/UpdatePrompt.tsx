import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { onUpdateAvailable, applyUpdate } from "@/lib/offline/sw";

export function UpdatePrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    return onUpdateAvailable(() => setShow(true));
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-neutral-200 bg-white px-4 py-2 shadow-lg flex items-center gap-3">
      <RefreshCw className="h-4 w-4 text-primary" />
      <span className="text-sm text-neutral-800">A new version is available</span>
      <Button size="sm" onClick={() => applyUpdate()} className="h-7 px-3 text-xs">
        Reload
      </Button>
    </div>
  );
}
