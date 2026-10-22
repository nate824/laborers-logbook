import { get, set, del } from "idb-keyval";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

const KEY = "ojt-rq-cache-v1";

export function createIDBPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      try {
        await set(KEY, client);
      } catch {
        // storage may be unavailable in private mode; ignore
      }
    },
    restoreClient: async () => {
      try {
        return (await get<PersistedClient>(KEY)) ?? undefined;
      } catch {
        return undefined;
      }
    },
    removeClient: async () => {
      try {
        await del(KEY);
      } catch {
        // ignore
      }
    },
  };
}
