import { useEffect, useState } from "react";
import { onlineManager, useMutationState } from "@tanstack/react-query";

// We need a way to *temporarily* tell TanStack the network is offline even
// when navigator.onLine is true — specifically when we get a 401 from the
// server, so queued writes don't keep firing into the void while the user
// re-authenticates. Both signals are AND'd together below.
let authPaused = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine && !authPaused : true,
  );
  useEffect(() => {
    const update = () => setOnline(navigator.onLine && !authPaused);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    listeners.add(update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      listeners.delete(update);
    };
  }, []);
  return online;
}

export function setupOnlineManager() {
  if (typeof window === "undefined") return;
  onlineManager.setEventListener((setOnline) => {
    const handler = () => setOnline(navigator.onLine && !authPaused);
    window.addEventListener("online", handler);
    window.addEventListener("offline", handler);
    listeners.add(handler);
    return () => {
      window.removeEventListener("online", handler);
      window.removeEventListener("offline", handler);
      listeners.delete(handler);
    };
  });
}

/** Pause the sync queue until the user re-authenticates. */
export function pauseForAuth(): void {
  if (authPaused) return;
  authPaused = true;
  onlineManager.setOnline(false);
  notify();
}

/** Called after a successful login — drains the paused queue. */
export function resumeAfterAuth(): void {
  if (!authPaused) return;
  authPaused = false;
  onlineManager.setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
  notify();
}

export function isAuthPaused(): boolean {
  return authPaused;
}

export function usePendingSyncCount(): number {
  // In v5, status === "pending" covers both in-flight and paused mutations,
  // which is exactly the "queued changes" count we want to show in the chip.
  return useMutationState({
    filters: { status: "pending" },
  }).length;
}
