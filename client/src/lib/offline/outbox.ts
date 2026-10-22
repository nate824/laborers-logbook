// Tiny localStorage-backed outbox for *unsynced creates*. We use it so that
// edits and deletes targeting an as-yet-unsynced (negative-id) row can
// coalesce into the queued create instead of trying to PATCH/DELETE
// /api/entries/-1 after a reload. The create mutation's mutationFn always
// reads the latest draft from this outbox right before posting, so any
// edits made while offline flow through naturally without us having to
// reach into Mutation internals.

import type { EntryDraft, RopeDraft } from "./mutations";

type Kind = "entries" | "rope";
type DraftFor<K extends Kind> = K extends "entries" ? EntryDraft : RopeDraft;

interface Drafts {
  entries: Record<string, EntryDraft>;
  rope: Record<string, RopeDraft>;
}

const KEY = "ojt-outbox-v1";

function read(): Drafts {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { entries: {}, rope: {} };
    const parsed = JSON.parse(raw) as Partial<Drafts>;
    return {
      entries: parsed.entries ?? {},
      rope: parsed.rope ?? {},
    };
  } catch {
    return { entries: {}, rope: {} };
  }
}

function write(d: Drafts) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage full / private mode — ignore */
  }
}

export function putDraft<K extends Kind>(
  kind: K,
  tempId: number,
  draft: DraftFor<K>,
): void {
  const d = read();
  (d[kind] as Record<string, DraftFor<K>>)[String(tempId)] = draft;
  write(d);
}

export function patchDraft<K extends Kind>(
  kind: K,
  tempId: number,
  patch: Partial<DraftFor<K>>,
): void {
  const d = read();
  const bucket = d[kind] as Record<string, DraftFor<K>>;
  const cur = bucket[String(tempId)];
  if (!cur) return;
  bucket[String(tempId)] = { ...cur, ...patch };
  write(d);
}

export function getDraft<K extends Kind>(
  kind: K,
  tempId: number,
): DraftFor<K> | undefined {
  const d = read();
  return (d[kind] as Record<string, DraftFor<K>>)[String(tempId)];
}

export function removeDraft(kind: Kind, tempId: number): void {
  const d = read();
  delete d[kind][String(tempId)];
  write(d);
}

/** Lowest (most-negative) tempId currently in the outbox, or 0 if empty. */
export function lowestOutboxTempId(): number {
  const d = read();
  let min = 0;
  for (const k of [...Object.keys(d.entries), ...Object.keys(d.rope)]) {
    const n = Number(k);
    if (Number.isFinite(n) && n < min) min = n;
  }
  return min;
}
