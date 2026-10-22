import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, X, Share } from "lucide-react";

const DISMISS_KEY = "ojt-install-dismissed-v1";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function InstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOS, setShowIOS] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY) === "1") {
      setDismissed(true);
      return;
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    if (isIOS()) {
      // iOS doesn't fire beforeinstallprompt — show our own helper
      setShowIOS(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
    setEvent(null);
    setShowIOS(false);
  };

  const install = async () => {
    if (!event) return;
    await event.prompt();
    await event.userChoice;
    setEvent(null);
  };

  if (dismissed) return null;
  if (!event && !showIOS) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-lg border border-primary/30 bg-white p-4 shadow-lg sm:left-auto sm:right-4">
      <button
        type="button"
        onClick={dismiss}
        className="absolute top-2 right-2 text-neutral-400 hover:text-neutral-600"
        aria-label="Dismiss install prompt"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-primary/10 p-2 text-primary">
          <Download className="h-5 w-5" />
        </div>
        <div className="flex-1 pr-4">
          <h3 className="text-sm font-semibold text-neutral-900">
            Install Laborers Logbook
          </h3>
          {showIOS ? (
            <p className="mt-1 text-xs text-neutral-600">
              Tap <Share className="inline h-3.5 w-3.5 -mt-0.5" /> in Safari, then
              choose <strong>Add to Home Screen</strong> to use this app offline
              on the job site.
            </p>
          ) : (
            <p className="mt-1 text-xs text-neutral-600">
              Add Laborers Logbook to your home screen to log hours offline on the job
              site.
            </p>
          )}
          {event && (
            <Button
              size="sm"
              onClick={install}
              className="mt-3"
            >
              Install
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
