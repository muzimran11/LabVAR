// ---------------------------------------------------------------------------
// exportFile.ts — save a file to a user-chosen location, with graceful fallback.
//
// Three strategies, tried in order:
//   1. Native Tauri dialog + fs  — a real OS "save as" dialog with a directory
//      picker. Requires the tauri-plugin-dialog / tauri-plugin-fs plugins to be
//      registered in the Rust backend (see NOTE below). Remembers the last-used
//      directory so subsequent exports default there.
//   2. File System Access API    — Chromium webviews (e.g. Windows WebView2)
//      expose window.showSaveFilePicker, which also lets the user pick a folder.
//   3. Blob <a download>         — universal fallback; the browser/webview puts
//      the file in its default download location.
//
// The whole native path is guarded in try/catch: if the plugins aren't present
// the invoke throws and we fall through, so the app never breaks — it just
// downgrades to the download fallback until the backend is rebuilt.
//
// NOTE (backend): to enable strategy 1 on macOS/Linux the Rust side needs:
//   Cargo.toml:  tauri-plugin-dialog = "2"   tauri-plugin-fs = "2"
//   lib.rs:      .plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_fs::init())
//   capabilities: grant dialog:allow-save and fs:allow-write-file
// The JS packages are already installed. Until then, strategy 2/3 are used.
// ---------------------------------------------------------------------------

const LAST_DIR_KEY = 'labvar.exportDir';

export interface ExportFilter {
  /** Human label, e.g. "PNG image". */
  name: string;
  /** Extensions without the dot, e.g. ["png"]. */
  extensions: string[];
}

export interface SaveResult {
  saved: boolean;
  /** Where it went, when the strategy can tell us. */
  path?: string;
  /** Which strategy handled it — useful for user feedback. */
  via: 'tauri' | 'fs-access' | 'download' | 'cancelled';
}

function getLastDir(): string | undefined {
  try {
    return localStorage.getItem(LAST_DIR_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function rememberDir(path: string) {
  try {
    const dir = path.replace(/[/\\][^/\\]*$/, ''); // strip trailing filename
    if (dir) localStorage.setItem(LAST_DIR_KEY, dir);
  } catch {
    /* ignore */
  }
}

/** Detect whether we're running inside the Tauri webview. */
async function runningInTauri(): Promise<boolean> {
  try {
    const core = await import('@tauri-apps/api/core');
    // isTauri exists in Tauri v2; fall back to the injected global otherwise.
    return typeof core.isTauri === 'function'
      ? core.isTauri()
      : typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';
  } catch {
    return false;
  }
}

function toBytes(data: Uint8Array | Blob): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return Promise.resolve(data);
  return data.arrayBuffer().then((b) => new Uint8Array(b));
}

/**
 * Write bytes to an absolute path via the Rust `write_export_file` command.
 * Rust creates parent dirs and writes with std::fs, so this is NOT limited by
 * the tauri-plugin-fs scope allowlist — we can write into any folder the user
 * picked with the dialog. Throws if not in Tauri or the command fails.
 */
async function writeAbs(path: string, data: Uint8Array | Blob): Promise<void> {
  const core = await import('@tauri-apps/api/core');
  const bytes = await toBytes(data);
  await core.invoke('write_export_file', { path, contents: Array.from(bytes) });
}

// --- Strategy 1: native Tauri ------------------------------------------------

async function saveViaTauri(
  data: Uint8Array | Blob,
  suggestedName: string,
  filters: ExportFilter[]
): Promise<SaveResult | null> {
  if (!(await runningInTauri())) return null;
  try {
    const dialog = await import('@tauri-apps/plugin-dialog');
    const lastDir = getLastDir();
    const defaultPath = lastDir ? `${lastDir}/${suggestedName}` : suggestedName;
    const path = await dialog.save({ defaultPath, filters });
    if (!path) return { saved: false, via: 'cancelled' };
    await writeAbs(path, data);
    rememberDir(path);
    return { saved: true, path, via: 'tauri' };
  } catch (err) {
    // Plugins not registered / permission missing — let the caller fall back.
    console.warn('Native save unavailable, falling back:', err);
    return null;
  }
}

// --- Strategy 2: File System Access API -------------------------------------

async function saveViaFsAccess(
  data: Uint8Array | Blob,
  suggestedName: string,
  filters: ExportFilter[]
): Promise<SaveResult | null> {
  const picker = (window as any).showSaveFilePicker;
  if (typeof picker !== 'function') return null;
  try {
    const types = filters.map((f) => ({
      description: f.name,
      accept: { 'application/octet-stream': f.extensions.map((e) => `.${e}`) },
    }));
    const handle = await picker({ suggestedName, types });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
    return { saved: true, path: handle.name, via: 'fs-access' };
  } catch (err) {
    if ((err as any)?.name === 'AbortError') return { saved: false, via: 'cancelled' };
    console.warn('File System Access save failed, falling back:', err);
    return null;
  }
}

// --- Strategy 3: blob download ----------------------------------------------

function saveViaDownload(data: Uint8Array | Blob, suggestedName: string): SaveResult {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { saved: true, path: suggestedName, via: 'download' };
}

// --- Public API --------------------------------------------------------------

/** Save arbitrary bytes/blob, letting the user choose where when possible. */
export async function saveFile(
  data: Uint8Array | Blob,
  suggestedName: string,
  filters: ExportFilter[] = [{ name: 'File', extensions: [suggestedName.split('.').pop() || 'bin'] }]
): Promise<SaveResult> {
  const viaTauri = await saveViaTauri(data, suggestedName, filters);
  if (viaTauri) return viaTauri;

  const viaFs = await saveViaFsAccess(data, suggestedName, filters);
  if (viaFs) return viaFs;

  return saveViaDownload(data, suggestedName);
}

/** Convenience for text payloads (CSV, SVG, JSON specs). */
export async function saveText(
  text: string,
  suggestedName: string,
  filters?: ExportFilter[]
): Promise<SaveResult> {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  return saveFile(blob, suggestedName, filters);
}

/**
 * Convert a data: URL (e.g. from Vega view.toImageURL) to bytes by decoding
 * the base64 payload directly. Avoids fetch() on a data: URL, which is
 * unreliable in the macOS WebKit webview.
 */
export async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (meta.includes(';base64')) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  // Non-base64 data URL (percent-encoded text).
  return new TextEncoder().encode(decodeURIComponent(payload));
}

// ---------------------------------------------------------------------------
// Project-folder export (Option B)
//
// Instead of a Save-As dialog per file, the user picks ONE project folder for
// an experiment. Subsequent exports write straight into it under a
// <root>/<dataset>/ subtree, no further prompts. The chosen root is remembered
// per-experiment in localStorage (key `labvar.projectDir.<experimentId>`).
//
// Picking a directory and writing to an absolute path both require the native
// Tauri dialog + fs plugins (a macOS WebKit webview has no showDirectoryPicker),
// so these functions only work in the Tauri build once the backend is compiled
// with tauri-plugin-dialog / tauri-plugin-fs. Outside Tauri they no-op / throw,
// and callers should fall back to the per-file saveFile() path above.
// ---------------------------------------------------------------------------

const PROJECT_DIR_PREFIX = 'labvar.projectDir.';

/** The project folder currently bound to an experiment, if any. */
export function getProjectDir(experimentId: string): string | undefined {
  try {
    return localStorage.getItem(PROJECT_DIR_PREFIX + experimentId) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Persist (or, with null, clear) an experiment's project folder. */
export function setProjectDir(experimentId: string, dir: string | null) {
  try {
    if (dir) localStorage.setItem(PROJECT_DIR_PREFIX + experimentId, dir);
    else localStorage.removeItem(PROJECT_DIR_PREFIX + experimentId);
  } catch {
    /* ignore */
  }
}

/**
 * Open a native folder picker and bind the result to the experiment.
 * Returns the chosen absolute path, or null if cancelled / unavailable.
 */
export async function chooseProjectDir(experimentId: string): Promise<string | null> {
  if (!(await runningInTauri())) {
    throw new Error(
      'Choosing a project folder needs the desktop app (the browser preview cannot pick a folder).'
    );
  }
  const dialog = await import('@tauri-apps/plugin-dialog');
  const current = getProjectDir(experimentId);
  const selected = await dialog.open({
    directory: true,
    multiple: false,
    title: 'Choose a project folder for this experiment',
    defaultPath: current,
  });
  if (typeof selected !== 'string') return null; // cancelled (null) or multi-array
  setProjectDir(experimentId, selected);
  return selected;
}

/** Join path segments with '/', collapsing empties and stray separators. */
function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((p) => p.replace(/[/\\]+$/g, ''))
    .join('/')
    .replace(/\/{2,}/g, '/');
}

/** Turn an arbitrary label into a filesystem-safe path segment. */
export function safeSegment(name: string): string {
  return (name || 'untitled').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'untitled';
}

/**
 * Write bytes/text into <baseDir>/<subdir>/<filename>, creating the subtree.
 * Requires the Tauri fs plugin; throws if unavailable so callers can fall back.
 */
export async function saveIntoDir(
  baseDir: string,
  subdir: string,
  filename: string,
  data: Uint8Array | Blob | string
): Promise<SaveResult> {
  if (!(await runningInTauri())) {
    throw new Error('saveIntoDir requires the desktop app.');
  }
  // Avoid runaway nesting: if the chosen folder already ends with the dataset
  // segment (e.g. the user re-picked the previously-created subfolder), don't
  // append it again.
  const baseTrimmed = baseDir.replace(/[/\\]+$/g, '');
  const lastSeg = baseTrimmed.split(/[/\\]/).pop();
  const effectiveSubdir = lastSeg === subdir ? '' : subdir;
  const fullPath = joinPath(baseTrimmed, effectiveSubdir, filename);
  // Rust's write_export_file creates <baseDir>/<subdir> as needed.
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  await writeAbs(fullPath, bytes);
  return { saved: true, path: fullPath, via: 'tauri' };
}
