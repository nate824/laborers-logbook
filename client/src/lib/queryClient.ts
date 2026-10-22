import { QueryClient, QueryFunction } from "@tanstack/react-query";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(`${status}: ${message}`);
    this.status = status;
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    if (res.status === 401 && typeof window !== "undefined") {
      // Session expired or never existed — pause the offline mutation queue
      // and bounce to re-auth. Queued writes resume after the user logs in
      // again (see resumeAfterAuth in the auth hook).
      try {
        const { pauseForAuth } = await import("@/lib/offline/online");
        pauseForAuth();
      } catch {
        /* ignore */
      }
      const here = window.location.pathname;
      if (!here.startsWith("/auth") && here !== "/") {
        window.location.assign("/auth");
      }
    }
    throw new ApiError(res.status, text);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

/**
 * Decide whether a mutation error is worth retrying. We retry network
 * failures and transient 5xx responses (with backoff via retryDelay), but
 * give up immediately on 4xx so the user sees the validation error.
 */
export function shouldRetryMutation(failureCount: number, error: Error): boolean {
  if (failureCount >= 3) return false;
  if (error instanceof ApiError) {
    return error.status >= 500;
  }
  // TypeError from fetch (network down, CORS, etc.) — retry.
  return true;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      // offlineFirst lets cached data render while offline instead of
      // surfacing a network error.
      networkMode: "offlineFirst",
      refetchInterval: false,
      refetchOnWindowFocus: false,
      // Allow rehydrated cache to be considered fresh briefly so the UI
      // doesn't flicker into error states on cold start.
      staleTime: 30 * 1000,
      gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days — needed for persistence
      retry: false,
    },
    mutations: {
      // Mutations pause when offline and resume on reconnect. Specific
      // mutations register their mutationFn via setMutationDefaults so
      // paused mutations can be replayed after a page reload.
      networkMode: "offlineFirst",
      retry: false,
    },
  },
});
