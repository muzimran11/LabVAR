// ---------------------------------------------------------------------------
// ollamaSetup.ts — helpers for the onboarding wizard to detect Ollama, kick
// off `ollama pull <model>` through the Rust backend, and stream progress.
//
// The Rust command `pull_ollama_model` writes each line of `ollama pull`
// output to the frontend via a Tauri event channel. The frontend listens for
// `ollama-pull-progress` events tagged with the model name and updates the UI.
// ---------------------------------------------------------------------------

import { DEFAULT_OLLAMA_CONFIG } from '@/lib/ollamaClient';

/** Ping the Ollama API. Returns installed model tags if reachable. */
export async function detectOllama(
  endpoint: string = DEFAULT_OLLAMA_CONFIG.baseUrl
): Promise<{ running: boolean; models: string[] }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${endpoint}/api/tags`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return { running: false, models: [] };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((m) => m.name);
    return { running: true, models };
  } catch {
    return { running: false, models: [] };
  }
}

/** Detect the host OS. Only three matter for LabVAR: macOS, Windows, Linux. */
export function detectOS(): 'mac' | 'windows' | 'linux' | 'unknown' {
  if (typeof navigator === 'undefined') return 'unknown';
  const p = (navigator.platform || '').toLowerCase();
  const ua = (navigator.userAgent || '').toLowerCase();
  if (p.includes('mac') || ua.includes('mac os')) return 'mac';
  if (p.includes('win') || ua.includes('windows')) return 'windows';
  if (p.includes('linux') || ua.includes('linux')) return 'linux';
  return 'unknown';
}

/** Human-readable per-OS Ollama install instructions. */
export function ollamaInstallInstructions(os: 'mac' | 'windows' | 'linux' | 'unknown'): {
  title: string;
  steps: string[];
  downloadUrl: string;
} {
  switch (os) {
    case 'mac':
      return {
        title: 'Install Ollama on macOS',
        steps: [
          'Download the Ollama app from ollama.com/download',
          'Move Ollama.app to your Applications folder and open it once',
          'The app runs a local server at localhost:11434 in the background',
          'Come back here and click "Check again"',
        ],
        downloadUrl: 'https://ollama.com/download/mac',
      };
    case 'windows':
      return {
        title: 'Install Ollama on Windows',
        steps: [
          'Download the OllamaSetup.exe installer from ollama.com/download',
          'Run the installer (it starts the local server automatically)',
          'The server listens on localhost:11434',
          'Come back here and click "Check again"',
        ],
        downloadUrl: 'https://ollama.com/download/windows',
      };
    case 'linux':
      return {
        title: 'Install Ollama on Linux',
        steps: [
          'Run: curl -fsSL https://ollama.com/install.sh | sh',
          'Start the server: ollama serve &',
          'It will listen on localhost:11434',
          'Come back here and click "Check again"',
        ],
        downloadUrl: 'https://ollama.com/download/linux',
      };
    default:
      return {
        title: 'Install Ollama',
        steps: [
          'Visit ollama.com/download',
          'Follow the instructions for your operating system',
          'Once running, it exposes an API at localhost:11434',
          'Come back here and click "Check again"',
        ],
        downloadUrl: 'https://ollama.com/download',
      };
  }
}

export interface PullEvent {
  status: string;
  percent?: number;
  done?: boolean;
  error?: string;
}

/**
 * Kick off `ollama pull <model>` via the Rust backend and subscribe to
 * progress events. Returns an object with the pull promise and an
 * `unsubscribe` callback.
 */
export async function pullOllamaModel(
  model: string,
  onProgress: (evt: PullEvent) => void
): Promise<void> {
  const core = await import('@tauri-apps/api/core');
  const eventApi = await import('@tauri-apps/api/event');
  const eventName = `ollama-pull-progress:${model}`;
  const unlisten = await eventApi.listen<PullEvent>(eventName, (e) => {
    onProgress(e.payload);
  });
  try {
    await core.invoke('pull_ollama_model', { model });
    onProgress({ status: 'complete', percent: 100, done: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onProgress({ status: 'error', error: msg, done: true });
    throw err;
  } finally {
    unlisten();
  }
}
