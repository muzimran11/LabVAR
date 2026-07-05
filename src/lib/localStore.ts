// ---------------------------------------------------------------------------
// localStore.ts — a tiny namespaced, reactive collection store on localStorage.
//
// WHY THIS EXISTS (and the migration path)
// The append-only provenance backend (events → projections) is the canonical
// store for experiments/datasets/figures/etc. The newer workspace features
// (assay tracking, lab-math notes, gel analyses, design docs, the notebook
// graph) need their own persistence, but adding each as a Rust event type +
// projection table can't be compiled in every environment. So for now these
// live in localStorage behind this small CRUD layer. Everything is keyed and
// serialised the same way, so swapping the backing store to Tauri events later
// is a matter of reimplementing `read`/`write` — the feature code and the
// `useCollection` hook stay unchanged.
//
// Records are plain JSON objects with at least `{ id, created_ts, updated_ts }`.
// Editable + deletable, exactly as the product requires.
// ---------------------------------------------------------------------------

import { useSyncExternalStore, useCallback } from 'react';

export interface BaseRecord {
  id: string;
  created_ts: string;
  updated_ts: string;
}

const PREFIX = 'labvar.store.';

// ---- id + serialisation helpers -------------------------------------------

/** RFC4122-ish id; crypto.randomUUID when available, else a good-enough fallback. */
export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}

function keyFor(collection: string): string {
  return PREFIX + collection;
}

// Snapshot cache: useSyncExternalStore requires getSnapshot to return a stable
// reference when nothing changed, or it re-renders forever. We cache the parsed
// array keyed by the raw string it came from.
const cache = new Map<string, { raw: string; parsed: unknown[] }>();

function read<T>(collection: string): T[] {
  try {
    const raw = localStorage.getItem(keyFor(collection)) ?? '[]';
    const hit = cache.get(collection);
    if (hit && hit.raw === raw) return hit.parsed as T[];
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? (parsed as T[]) : [];
    cache.set(collection, { raw, parsed: arr });
    return arr;
  } catch {
    const empty: T[] = [];
    cache.set(collection, { raw: '[]', parsed: empty });
    return empty;
  }
}

function write<T>(collection: string, items: T[]): void {
  const raw = JSON.stringify(items);
  try {
    localStorage.setItem(keyFor(collection), raw);
  } catch (e) {
    console.error('localStore write failed for', collection, e);
  }
  cache.set(collection, { raw, parsed: items });
  emit(collection);
}

// ---- pub/sub so React views re-render on change ---------------------------

const listeners = new Map<string, Set<() => void>>();

function emit(collection: string) {
  listeners.get(collection)?.forEach((fn) => fn());
  // Fire a global channel too, for cross-collection consumers (e.g. the graph).
  listeners.get('*')?.forEach((fn) => fn());
}

function subscribe(collection: string, fn: () => void): () => void {
  let set = listeners.get(collection);
  if (!set) {
    set = new Set();
    listeners.set(collection, set);
  }
  set.add(fn);
  return () => set!.delete(fn);
}

// React across tabs/windows: mirror storage events into our pub/sub.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith(PREFIX)) {
      emit(e.key.slice(PREFIX.length));
    }
  });
}

// ---- imperative CRUD API ---------------------------------------------------

export const store = {
  list<T extends BaseRecord>(collection: string): T[] {
    return read<T>(collection);
  },

  get<T extends BaseRecord>(collection: string, id: string): T | undefined {
    return read<T>(collection).find((r) => r.id === id);
  },

  /** Insert a new record. `data` supplies everything except the base fields. */
  create<T extends BaseRecord>(collection: string, data: Omit<T, keyof BaseRecord>): T {
    const ts = nowIso();
    const record = { id: newId(), created_ts: ts, updated_ts: ts, ...data } as T;
    const items = read<T>(collection);
    items.unshift(record);
    write(collection, items);
    return record;
  },

  /** Insert a fully-formed record (used when the id is chosen elsewhere). */
  put<T extends BaseRecord>(collection: string, record: T): T {
    const items = read<T>(collection).filter((r) => r.id !== record.id);
    items.unshift({ ...record, updated_ts: nowIso() });
    write(collection, items);
    return record;
  },

  /** Shallow-merge a patch into an existing record; bumps updated_ts. */
  update<T extends BaseRecord>(collection: string, id: string, patch: Partial<T>): T | undefined {
    const items = read<T>(collection);
    const idx = items.findIndex((r) => r.id === id);
    if (idx === -1) return undefined;
    items[idx] = { ...items[idx], ...patch, updated_ts: nowIso() };
    write(collection, items);
    return items[idx];
  },

  remove(collection: string, id: string): void {
    const items = read<BaseRecord>(collection).filter((r) => r.id !== id);
    write(collection, items);
  },

  /** Replace the whole collection (import, bulk edit). */
  replaceAll<T extends BaseRecord>(collection: string, items: T[]): void {
    write(collection, items);
  },

  clear(collection: string): void {
    write(collection, []);
  },

  subscribe,
};

// ---- React hook ------------------------------------------------------------

/**
 * Reactive view over a collection. Re-renders when the collection changes
 * (including from other components or other windows). Returns the items plus
 * bound CRUD helpers.
 */
export function useCollection<T extends BaseRecord>(collection: string) {
  const subscribeFn = useCallback((cb: () => void) => subscribe(collection, cb), [collection]);
  const getSnapshot = useCallback(() => read<T>(collection), [collection]);
  const items = useSyncExternalStore(subscribeFn, getSnapshot, getSnapshot);

  const create = useCallback(
    (data: Omit<T, keyof BaseRecord>) => store.create<T>(collection, data),
    [collection]
  );
  const update = useCallback(
    (id: string, patch: Partial<T>) => store.update<T>(collection, id, patch),
    [collection]
  );
  const remove = useCallback((id: string) => store.remove(collection, id), [collection]);
  const replaceAll = useCallback(
    (next: T[]) => store.replaceAll<T>(collection, next),
    [collection]
  );

  return { items, create, update, remove, replaceAll };
}

// Collection name constants (single source of truth for keys).
export const COLLECTIONS = {
  assays: 'assays',
  assayRecords: 'assayRecords',
  labMathNotes: 'labMathNotes',
  designDocs: 'designDocs',
  gelAnalyses: 'gelAnalyses',
  imageAnalyses: 'imageAnalyses',
  graphNodes: 'graphNodes',
  graphEdges: 'graphEdges',
} as const;

/**
 * Per-project (per-experiment) graph collection keys. Each experiment directory
 * gets its own node cluster: nodes/edges live under `graphNodes:<expId>` /
 * `graphEdges:<expId>`. `project === null` is the shared "Scratch / all" board,
 * which reuses the base keys so any pre-existing global graph stays visible.
 */
export function scopedGraphKeys(project: string | null): { nodes: string; edges: string } {
  const suffix = project ? `:${project}` : '';
  return { nodes: `${COLLECTIONS.graphNodes}${suffix}`, edges: `${COLLECTIONS.graphEdges}${suffix}` };
}
