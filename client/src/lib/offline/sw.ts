// Service worker registration + update lifecycle. We host the SW at /sw.js
// (in client/public). Registration is skipped in dev to avoid stale caches.

let waitingWorker: ServiceWorker | null = null;

export type UpdateListener = () => void;
const listeners = new Set<UpdateListener>();

export function onUpdateAvailable(fn: UpdateListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function applyUpdate(): Promise<void> {
  if (waitingWorker) {
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
    waitingWorker = null;
  }
  // Reload after the new SW takes control.
  setTimeout(() => window.location.reload(), 200);
}

function notifyUpdate(worker: ServiceWorker) {
  waitingWorker = worker;
  listeners.forEach((fn) => fn());
}

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // Skip in Vite dev to avoid caching transformed modules.
  if (import.meta.env.DEV) return;

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");

    if (registration.waiting) {
      notifyUpdate(registration.waiting);
    }

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (
          installing.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          notifyUpdate(installing);
        }
      });
    });

    // Periodic update check while the app is open.
    setInterval(
      () => {
        registration.update().catch(() => {
          /* ignore */
        });
      },
      60 * 60 * 1000,
    );

    // Reload when the active service worker changes (after applyUpdate).
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
    });
  } catch (err) {
    console.warn("Service worker registration failed", err);
  }
}
