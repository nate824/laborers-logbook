import type { QueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient, shouldRetryMutation } from "@/lib/queryClient";
import type { Entry, EntryDetails, RopeHours } from "@shared/schema";
import {
  getDraft,
  lowestOutboxTempId,
  patchDraft,
  putDraft,
  removeDraft,
} from "./outbox";

// Exponential backoff (1s, 2s, 4s …) capped at 30s so transient 5xx /
// network blips don't immediately surface as "Sync failed".
const retryDelay = (attempt: number) =>
  Math.min(30_000, 1_000 * 2 ** attempt);

export type EntryDraft = {
  date: string;
  location: string;
  method: string;
  hours: number;
  details?: EntryDetails;
};

export type RopeDraft = {
  startDate: string;
  endDate: string;
  location: string;
  skills: string;
  hours: number;
  employer?: string;
  workDetails?: string;
  maxHeight?: string;
  projectNumber?: string | null;
  workCode?: string | null;
};

// Temp IDs must stay unique across reloads — otherwise a freshly assigned
// "-1" could collide with an unsynced row already in the outbox / cache.
// Initialize the counter just below the lowest tempId we know about.
let _tempCounter = Math.min(-1, lowestOutboxTempId() - 1);
export const nextTempId = () => _tempCounter--;
/** Re-seed the counter from the outbox (used after the cache rehydrates). */
export function reseedTempIds(extraMin = 0): void {
  const fromOutbox = lowestOutboxTempId();
  _tempCounter = Math.min(_tempCounter, fromOutbox - 1, extraMin - 1);
}

type WithSync<T> = T & {
  _pendingSync?: boolean;
  _syncFailed?: string | null;
  _failedKind?: "create" | "update" | "delete";
  _failedDraft?: EntryDraft | RopeDraft;
  _failedPatch?: Partial<EntryDraft> | Partial<RopeDraft>;
};

const ENTRIES_KEY = ["/api/entries"] as const;
const ROPE_KEY = ["/api/rope-hours"] as const;

// ----------------------------- helpers --------------------------------

function makeOptimisticEntry(
  draft: EntryDraft,
  tempId: number,
): WithSync<Entry> {
  return {
    id: tempId,
    userId: 0,
    date: new Date(draft.date) as unknown as Entry["date"],
    location: draft.location,
    method: draft.method,
    hours: Number(draft.hours),
    details: draft.details ?? null,
    verified: false,
    verifiedBy: null,
    verifiedAt: null,
    verificationToken: null,
    verificationRequestedAt: null,
    sourceDocumentKey: null,
    sourceDocumentName: null,
    importedAt: null,
    _pendingSync: true,
    _syncFailed: null,
  } as unknown as WithSync<Entry>;
}

function makeOptimisticRope(
  draft: RopeDraft,
  tempId: number,
): WithSync<RopeHours> {
  return {
    id: tempId,
    userId: 0,
    startDate: new Date(draft.startDate) as unknown as RopeHours["startDate"],
    endDate: new Date(draft.endDate) as unknown as RopeHours["endDate"],
    location: draft.location,
    skills: draft.skills,
    hours: Number(draft.hours),
    employer: draft.employer ?? null,
    workDetails: draft.workDetails ?? null,
    maxHeight: draft.maxHeight ?? null,
    projectNumber: draft.projectNumber ?? null,
    workCode: draft.workCode ?? null,
    verified: false,
    verifiedBy: null,
    verifiedAt: null,
    verificationToken: null,
    verificationRequestedAt: null,
    sourceDocumentKey: null,
    sourceDocumentName: null,
    importedAt: null,
    _pendingSync: true,
    _syncFailed: null,
  } as unknown as WithSync<RopeHours>;
}

function findCreateMutation(
  qc: QueryClient,
  key: "entries.create" | "ropeHours.create",
  tempId: number,
) {
  const cache = qc.getMutationCache();
  return cache
    .getAll()
    .find(
      (m) =>
        Array.isArray(m.options.mutationKey) &&
        m.options.mutationKey[0] === key &&
        (m.state.variables as { tempId?: number } | undefined)?.tempId ===
          tempId,
    );
}

/** Walk the cache for the lowest temp id used by paused create mutations. */
function lowestPendingTempId(qc: QueryClient): number {
  let min = 0;
  for (const m of qc.getMutationCache().getAll()) {
    const k = m.options.mutationKey;
    if (
      Array.isArray(k) &&
      (k[0] === "entries.create" || k[0] === "ropeHours.create")
    ) {
      const t = (m.state.variables as { tempId?: number } | undefined)
        ?.tempId;
      if (typeof t === "number" && t < min) min = t;
    }
  }
  return min;
}

function setRowState<T extends { id: number }>(
  qc: QueryClient,
  key: readonly unknown[],
  id: number,
  patch: Partial<WithSync<T>>,
) {
  qc.setQueryData<T[]>([...key], (cur) =>
    (cur ?? []).map((e) =>
      e.id === id ? ({ ...e, ...patch } as T) : e,
    ),
  );
}

// =============================================================
//                          REGISTRATION
// =============================================================

export function setupOfflineMutations(qc: QueryClient): void {
  // After rehydrate the mutation cache may already contain creates with
  // negative temp ids. Re-seed our counter so newly created rows can't
  // collide with an unsynced one.
  reseedTempIds(lowestPendingTempId(qc));

  // ----------------- entries.create (single, with tempId) ---------------
  qc.setMutationDefaults(["entries.create"], {
    networkMode: "offlineFirst",
    retry: shouldRetryMutation,
    retryDelay,
    mutationFn: async (vars: { tempId: number; draft: EntryDraft }) => {
      // Use the *latest* coalesced draft from the outbox so any offline
      // edits made before the create syncs are included.
      const latest = getDraft("entries", vars.tempId) ?? vars.draft;
      const res = await apiRequest("POST", "/api/entries", [latest]);
      const arr = (await res.json()) as Entry[];
      return arr[0];
    },
    onMutate: async (vars: { tempId: number; draft: EntryDraft }) => {
      await qc.cancelQueries({ queryKey: ENTRIES_KEY });
      const prev = qc.getQueryData<Entry[]>([...ENTRIES_KEY]) ?? [];
      putDraft("entries", vars.tempId, vars.draft);
      const optimistic = makeOptimisticEntry(vars.draft, vars.tempId);
      qc.setQueryData<Entry[]>([...ENTRIES_KEY], [...prev, optimistic]);
      return { prev };
    },
    onError: (err: Error, vars: { tempId: number; draft: EntryDraft }) => {
      // Keep the row but flip it into the "failed" state so the user can
      // retry or discard. The outbox draft stays so retry uses the latest.
      setRowState<Entry>(qc, ENTRIES_KEY, vars.tempId, {
        _pendingSync: false,
        _syncFailed: err.message || "Sync failed",
        _failedKind: "create",
        _failedDraft: getDraft("entries", vars.tempId) ?? vars.draft,
      });
    },
    onSuccess: (created: Entry, vars) => {
      removeDraft("entries", vars.tempId);
      qc.setQueryData<Entry[]>([...ENTRIES_KEY], (cur) =>
        (cur ?? []).map((e) => (e.id === vars.tempId ? created : e)),
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ENTRIES_KEY });
    },
  });

  // ----------------- entries.update -----------------
  qc.setMutationDefaults(["entries.update"], {
    networkMode: "offlineFirst",
    scope: { id: "entries.update" }, // serialize replays in order
    retry: shouldRetryMutation,
    retryDelay,
    mutationFn: async (vars: {
      id: number;
      patch: Partial<EntryDraft>;
    }) => {
      if (vars.id < 0) return null; // coalesced into the queued create
      const res = await apiRequest(
        "PATCH",
        `/api/entries/${vars.id}`,
        vars.patch,
      );
      return (await res.json()) as Entry;
    },
    onMutate: async (vars: { id: number; patch: Partial<EntryDraft> }) => {
      await qc.cancelQueries({ queryKey: ENTRIES_KEY });
      const prev = qc.getQueryData<Entry[]>([...ENTRIES_KEY]) ?? [];

      if (vars.id < 0) {
        // Coalesce into the outbox; the queued create's mutationFn reads
        // getDraft() right before POSTing so the merged payload flows
        // through without us needing to reach into Mutation internals.
        patchDraft("entries", vars.id, vars.patch);
      }

      qc.setQueryData<Entry[]>([...ENTRIES_KEY], (cur) =>
        (cur ?? []).map((e) =>
          e.id === vars.id
            ? ({
                ...e,
                ...vars.patch,
                date: vars.patch.date
                  ? (new Date(vars.patch.date) as unknown as Entry["date"])
                  : e.date,
                _pendingSync: vars.id < 0 ? true : true,
                _syncFailed: null,
              } as WithSync<Entry>)
            : e,
        ),
      );
      return { prev };
    },
    onError: (err: Error, vars) => {
      setRowState<Entry>(qc, ENTRIES_KEY, vars.id, {
        _pendingSync: false,
        _syncFailed: err.message || "Sync failed",
        _failedKind: "update",
        _failedPatch: vars.patch,
      });
    },
    onSuccess: (_data, vars) => {
      // For real ids, clear the pending flag; for negative ids the create
      // mutation is the one that ultimately resolves the row.
      if (vars.id > 0) {
        setRowState<Entry>(qc, ENTRIES_KEY, vars.id, {
          _pendingSync: false,
          _syncFailed: null,
        });
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ENTRIES_KEY });
    },
  });

  // ----------------- entries.delete -----------------
  qc.setMutationDefaults(["entries.delete"], {
    networkMode: "offlineFirst",
    scope: { id: "entries.delete" },
    retry: shouldRetryMutation,
    retryDelay,
    mutationFn: async (id: number) => {
      if (id < 0) return id; // coalesced — nothing on the server to delete
      await apiRequest("DELETE", `/api/entries/${id}`);
      return id;
    },
    onMutate: async (id: number) => {
      await qc.cancelQueries({ queryKey: ENTRIES_KEY });
      const prev = qc.getQueryData<Entry[]>([...ENTRIES_KEY]) ?? [];

      if (id < 0) {
        // Cancel the queued create if it hasn't synced yet.
        removeDraft("entries", id);
        const target = findCreateMutation(qc, "entries.create", id);
        if (target) qc.getMutationCache().remove(target);
      }

      qc.setQueryData<Entry[]>([...ENTRIES_KEY], (cur) =>
        (cur ?? []).filter((e) => e.id !== id),
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      const c = ctx as { prev?: Entry[] } | undefined;
      if (c?.prev) qc.setQueryData([...ENTRIES_KEY], c.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ENTRIES_KEY });
    },
  });

  // ----------------- ropeHours.create -----------------
  qc.setMutationDefaults(["ropeHours.create"], {
    networkMode: "offlineFirst",
    retry: shouldRetryMutation,
    retryDelay,
    mutationFn: async (vars: { tempId: number; draft: RopeDraft }) => {
      const latest = getDraft("rope", vars.tempId) ?? vars.draft;
      const res = await apiRequest("POST", "/api/rope-hours", latest);
      return (await res.json()) as RopeHours;
    },
    onMutate: async (vars: { tempId: number; draft: RopeDraft }) => {
      await qc.cancelQueries({ queryKey: ROPE_KEY });
      const prev = qc.getQueryData<RopeHours[]>([...ROPE_KEY]) ?? [];
      putDraft("rope", vars.tempId, vars.draft);
      const optimistic = makeOptimisticRope(vars.draft, vars.tempId);
      qc.setQueryData<RopeHours[]>([...ROPE_KEY], [...prev, optimistic]);
      return { prev };
    },
    onError: (err: Error, vars) => {
      setRowState<RopeHours>(qc, ROPE_KEY, vars.tempId, {
        _pendingSync: false,
        _syncFailed: err.message || "Sync failed",
        _failedKind: "create",
        _failedDraft: getDraft("rope", vars.tempId) ?? vars.draft,
      });
    },
    onSuccess: (created: RopeHours, vars) => {
      removeDraft("rope", vars.tempId);
      qc.setQueryData<RopeHours[]>([...ROPE_KEY], (cur) =>
        (cur ?? []).map((e) => (e.id === vars.tempId ? created : e)),
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ROPE_KEY });
    },
  });

  // ----------------- ropeHours.update -----------------
  qc.setMutationDefaults(["ropeHours.update"], {
    networkMode: "offlineFirst",
    scope: { id: "ropeHours.update" },
    retry: shouldRetryMutation,
    retryDelay,
    mutationFn: async (vars: { id: number; patch: Partial<RopeDraft> }) => {
      if (vars.id < 0) return null;
      const res = await apiRequest(
        "PATCH",
        `/api/rope-hours/${vars.id}`,
        vars.patch,
      );
      return (await res.json()) as RopeHours;
    },
    onMutate: async (vars: { id: number; patch: Partial<RopeDraft> }) => {
      await qc.cancelQueries({ queryKey: ROPE_KEY });
      const prev = qc.getQueryData<RopeHours[]>([...ROPE_KEY]) ?? [];

      if (vars.id < 0) {
        patchDraft("rope", vars.id, vars.patch);
      }

      qc.setQueryData<RopeHours[]>([...ROPE_KEY], (cur) =>
        (cur ?? []).map((e) =>
          e.id === vars.id
            ? ({
                ...e,
                ...vars.patch,
                startDate: vars.patch.startDate
                  ? (new Date(
                      vars.patch.startDate,
                    ) as unknown as RopeHours["startDate"])
                  : e.startDate,
                endDate: vars.patch.endDate
                  ? (new Date(
                      vars.patch.endDate,
                    ) as unknown as RopeHours["endDate"])
                  : e.endDate,
                _pendingSync: true,
                _syncFailed: null,
              } as WithSync<RopeHours>)
            : e,
        ),
      );
      return { prev };
    },
    onError: (err: Error, vars) => {
      setRowState<RopeHours>(qc, ROPE_KEY, vars.id, {
        _pendingSync: false,
        _syncFailed: err.message || "Sync failed",
        _failedKind: "update",
        _failedPatch: vars.patch,
      });
    },
    onSuccess: (_data, vars) => {
      if (vars.id > 0) {
        setRowState<RopeHours>(qc, ROPE_KEY, vars.id, {
          _pendingSync: false,
          _syncFailed: null,
        });
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ROPE_KEY });
    },
  });

  // ----------------- ropeHours.delete -----------------
  qc.setMutationDefaults(["ropeHours.delete"], {
    networkMode: "offlineFirst",
    scope: { id: "ropeHours.delete" },
    retry: shouldRetryMutation,
    retryDelay,
    mutationFn: async (id: number) => {
      if (id < 0) return id;
      await apiRequest("DELETE", `/api/rope-hours/${id}`);
      return id;
    },
    onMutate: async (id: number) => {
      await qc.cancelQueries({ queryKey: ROPE_KEY });
      const prev = qc.getQueryData<RopeHours[]>([...ROPE_KEY]) ?? [];

      if (id < 0) {
        removeDraft("rope", id);
        const target = findCreateMutation(qc, "ropeHours.create", id);
        if (target) qc.getMutationCache().remove(target);
      }

      qc.setQueryData<RopeHours[]>([...ROPE_KEY], (cur) =>
        (cur ?? []).filter((e) => e.id !== id),
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      const c = ctx as { prev?: RopeHours[] } | undefined;
      if (c?.prev) qc.setQueryData([...ROPE_KEY], c.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ROPE_KEY });
    },
  });
}

// ----------------------- consumer-side helpers --------------------------

export function isPendingSync(row: {
  id: number;
  _pendingSync?: boolean;
}): boolean {
  return row.id < 0 || row._pendingSync === true;
}

export function getSyncFailure(row: {
  _syncFailed?: string | null;
}): string | null {
  return row._syncFailed ?? null;
}

/**
 * Retry a failed mutation. Handles all three kinds:
 *  - create: re-run the create mutation with the latest draft.
 *  - update: re-run the update mutation with the saved patch.
 *  - delete: re-run the delete mutation.
 */
export function retryFailedEntry(row: Entry): void {
  const r = row as WithSync<Entry>;
  if (!r._syncFailed) return;
  const cache = queryClient.getMutationCache();
  if (r._failedKind === "update") {
    const patch = (r._failedPatch as Partial<EntryDraft>) ?? {};
    cache
      .build(queryClient, { mutationKey: ["entries.update"] })
      .execute({ id: r.id, patch });
    return;
  }
  if (r._failedKind === "delete") {
    cache
      .build(queryClient, { mutationKey: ["entries.delete"] })
      .execute(r.id);
    return;
  }
  // create (default)
  const draft =
    (r._failedDraft as EntryDraft) ??
    ({
      date: new Date(r.date).toISOString().split("T")[0],
      location: r.location,
      method: r.method,
      hours: r.hours,
      details: r.details ?? undefined,
    } as EntryDraft);
  cache
    .build(queryClient, { mutationKey: ["entries.create"] })
    .execute({ tempId: r.id, draft });
}

/**
 * Discard a failed mutation.
 *  - For a failed *create*, drop the row entirely (it never made it to the
 *    server) and clear the outbox draft.
 *  - For a failed *update* or *delete*, the canonical row still exists on
 *    the server, so just clear the failure flag and refetch from the
 *    server to restore the authoritative state.
 */
export function discardFailedEntry(row: Entry): void {
  const r = row as WithSync<Entry>;
  if (r._failedKind === "create") {
    removeDraft("entries", row.id);
    queryClient.setQueryData<Entry[]>(["/api/entries"], (cur) =>
      (cur ?? []).filter((e) => e.id !== row.id),
    );
    return;
  }
  setRowState<Entry>(queryClient, ENTRIES_KEY, row.id, {
    _pendingSync: false,
    _syncFailed: null,
    _failedKind: undefined,
    _failedDraft: undefined,
    _failedPatch: undefined,
  });
  queryClient.invalidateQueries({ queryKey: ENTRIES_KEY });
}

export function retryFailedRope(row: RopeHours): void {
  const r = row as WithSync<RopeHours>;
  if (!r._syncFailed) return;
  const cache = queryClient.getMutationCache();
  if (r._failedKind === "update") {
    const patch = (r._failedPatch as Partial<RopeDraft>) ?? {};
    cache
      .build(queryClient, { mutationKey: ["ropeHours.update"] })
      .execute({ id: r.id, patch });
    return;
  }
  if (r._failedKind === "delete") {
    cache
      .build(queryClient, { mutationKey: ["ropeHours.delete"] })
      .execute(r.id);
    return;
  }
  const draft =
    (r._failedDraft as RopeDraft) ??
    ({
      startDate: new Date(r.startDate).toISOString().split("T")[0],
      endDate: new Date(r.endDate).toISOString().split("T")[0],
      location: r.location,
      skills: r.skills,
      hours: r.hours,
      employer: r.employer ?? undefined,
      workDetails: r.workDetails ?? undefined,
      maxHeight: r.maxHeight ?? undefined,
      projectNumber: r.projectNumber ?? undefined,
      workCode: r.workCode ?? undefined,
    } as RopeDraft);
  cache
    .build(queryClient, { mutationKey: ["ropeHours.create"] })
    .execute({ tempId: r.id, draft });
}

export function discardFailedRope(row: RopeHours): void {
  const r = row as WithSync<RopeHours>;
  if (r._failedKind === "create") {
    removeDraft("rope", row.id);
    queryClient.setQueryData<RopeHours[]>(["/api/rope-hours"], (cur) =>
      (cur ?? []).filter((e) => e.id !== row.id),
    );
    return;
  }
  setRowState<RopeHours>(queryClient, ROPE_KEY, row.id, {
    _pendingSync: false,
    _syncFailed: null,
    _failedKind: undefined,
    _failedDraft: undefined,
    _failedPatch: undefined,
  });
  queryClient.invalidateQueries({ queryKey: ROPE_KEY });
}
