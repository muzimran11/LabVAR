// ---------------------------------------------------------------------------
// userPrefs.ts — User preferences persisted to localStorage.
//
// Backs the first-run onboarding wizard and the Settings workspace so the same
// values are read from and written to a single source of truth. Reactive: a
// small pub/sub lets React components re-render when prefs change from anywhere
// (wizard, settings panel, or another window/tab).
//
// The `onboarded` flag gates whether the first-run wizard is shown at boot.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from 'react';

export type PlotLanguage = 'python' | 'r';
export type ExportFormat = 'png' | 'svg' | 'pdf';

export interface UserPrefs {
  /** True once the user has completed (or skipped through) the wizard. */
  onboarded: boolean;
  /** Display name shown in the sidebar avatar + settings. */
  userName: string;
  /** Two-letter initials shown in the avatar circle. */
  initials: string;
  /** Root folder LabVAR should default to for new projects (optional). */
  dataDir: string | null;
  /** Default language for the AI Chart Builder. */
  defaultLanguage: PlotLanguage;
  /** Default Ollama model tag (e.g. "qwen2.5-coder:3b"). */
  defaultModel: string;
  /** Local Ollama HTTP endpoint. */
  ollamaEndpoint: string;
  /** Default figure export format. */
  defaultExportFormat: ExportFormat;
}

const STORAGE_KEY = 'labvar.userPrefs';

export const DEFAULT_PREFS: UserPrefs = {
  onboarded: false,
  userName: 'Researcher',
  initials: 'LV',
  dataDir: null,
  defaultLanguage: 'python',
  defaultModel: 'qwen2.5-coder:3b',
  ollamaEndpoint: 'http://localhost:11434',
  defaultExportFormat: 'png',
};

// ---- read/write ----

let cached: UserPrefs | null = null;

function readPrefs(): UserPrefs {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cached = { ...DEFAULT_PREFS };
      return cached;
    }
    const parsed = JSON.parse(raw) as Partial<UserPrefs>;
    cached = { ...DEFAULT_PREFS, ...parsed };
    return cached;
  } catch {
    cached = { ...DEFAULT_PREFS };
    return cached;
  }
}

function writePrefs(next: UserPrefs): void {
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    console.error('userPrefs write failed:', e);
  }
  listeners.forEach((fn) => fn());
}

// ---- pub/sub ----

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Mirror storage events from other windows.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      cached = null; // force reread on next getPrefs()
      listeners.forEach((fn) => fn());
    }
  });
}

// ---- public API ----

/** Get the current preferences (synchronous). */
export function getPrefs(): UserPrefs {
  return readPrefs();
}

/** Shallow-merge a patch into the preferences and persist. */
export function updatePrefs(patch: Partial<UserPrefs>): UserPrefs {
  const current = readPrefs();
  const next = { ...current, ...patch };
  // Auto-derive initials from name whenever name changes and initials aren't set explicitly.
  if (patch.userName && !patch.initials) {
    next.initials = deriveInitials(patch.userName);
  }
  writePrefs(next);
  return next;
}

/** Reset ALL preferences (including the onboarded flag). */
export function resetPrefs(): void {
  writePrefs({ ...DEFAULT_PREFS });
}

/** Compute two-letter initials from a display name. Falls back to "LV". */
export function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'LV';
  if (parts.length === 1) {
    const p = parts[0];
    return (p.slice(0, 2) || 'LV').toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** React hook — re-renders when any pref changes. */
export function useUserPrefs(): UserPrefs {
  return useSyncExternalStore(subscribe, readPrefs, readPrefs);
}
