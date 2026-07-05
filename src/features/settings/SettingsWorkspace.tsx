import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Workspace } from '@/components/Workspace';
import { RECOMMENDED_MODELS } from '@/lib/ollamaClient';
import { useUserPrefs, updatePrefs, resetPrefs, deriveInitials } from '@/lib/userPrefs';
import type { PlotLanguage, ExportFormat } from '@/lib/userPrefs';
import { detectOllama } from '@/lib/ollamaSetup';

/**
 * Settings & Account — bound to userPrefs. Everything here is editable and
 * persisted immediately. "Reset onboarding" replays the first-run wizard on
 * the next boot; "Reset all preferences" wipes to defaults.
 */
export function SettingsWorkspace() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const prefs = useUserPrefs();
  const [checking, setChecking] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<null | { running: boolean; models: string[] }>(null);
  const [nameDraft, setNameDraft] = useState(prefs.userName);
  const [endpointDraft, setEndpointDraft] = useState(prefs.ollamaEndpoint);

  const commitName = () => {
    const cleanName = nameDraft.trim() || 'Researcher';
    updatePrefs({ userName: cleanName, initials: deriveInitials(cleanName) });
  };
  const commitEndpoint = () => {
    const clean = endpointDraft.trim() || 'http://localhost:11434';
    updatePrefs({ ollamaEndpoint: clean });
  };

  const pickFolder = async () => {
    try {
      const dialog = await import('@tauri-apps/plugin-dialog');
      const chosen = await dialog.open({
        directory: true,
        multiple: false,
        title: 'Choose a default folder for LabVAR projects',
        defaultPath: prefs.dataDir ?? undefined,
      });
      if (typeof chosen === 'string' && chosen) {
        updatePrefs({ dataDir: chosen });
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const checkOllama = async () => {
    setChecking(true);
    try {
      const res = await detectOllama(prefs.ollamaEndpoint);
      setOllamaStatus(res);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Workspace title="Settings" subtitle="Account and preferences">
      <div className="space-y-6 max-w-2xl">
        {/* Account */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <h3 className="text-sm font-semibold text-zinc-200 mb-4">Account</h3>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-full bg-teal-600/30 border border-teal-600/50 flex items-center justify-center flex-shrink-0">
              <span className="text-lg font-semibold text-teal-400">{prefs.initials}</span>
            </div>
            <div className="flex-1">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                placeholder="Your name"
                className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-700 focus:border-teal-600 rounded-md text-sm text-zinc-200 focus:outline-none"
              />
              <div className="text-xs text-zinc-500 mt-1">Local account. Nothing leaves your machine.</div>
            </div>
          </div>
        </section>

        {/* Appearance */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <h3 className="text-sm font-semibold text-zinc-200 mb-4">Appearance</h3>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-zinc-300">Color theme</div>
              <div className="text-xs text-zinc-500 mt-0.5">Dark or light mode</div>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-zinc-700 p-0.5">
              <button
                onClick={() => setTheme('dark')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  theme === 'dark' ? 'bg-zinc-700 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Dark
              </button>
              <button
                onClick={() => setTheme('light')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  theme === 'light' ? 'bg-zinc-700 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Light
              </button>
            </div>
          </div>
        </section>

        {/* Data & Export */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <h3 className="text-sm font-semibold text-zinc-200 mb-4">Data & Export</h3>
          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-sm text-zinc-300">Default project folder</div>
                  <div className="text-xs text-zinc-500 mt-0.5">Where LabVAR saves exports and copies imports</div>
                </div>
                <button
                  onClick={pickFolder}
                  className="text-xs px-2.5 py-1 text-zinc-300 border border-zinc-700 rounded hover:border-teal-600 hover:text-teal-300 transition-colors"
                >
                  {prefs.dataDir ? 'Change' : 'Choose'}
                </button>
              </div>
              <div className="font-mono text-xs text-zinc-400 bg-zinc-950 rounded px-2 py-1 break-all min-h-[1.5rem]">
                {prefs.dataDir ?? <span className="italic text-zinc-600">Not set</span>}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-zinc-300">Default export format</div>
                <div className="text-xs text-zinc-500 mt-0.5">Preferred figure format</div>
              </div>
              <select
                value={prefs.defaultExportFormat}
                onChange={(e) => updatePrefs({ defaultExportFormat: e.target.value as ExportFormat })}
                className="text-xs bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-teal-600"
              >
                <option value="png">PNG</option>
                <option value="svg">SVG</option>
                <option value="pdf">PDF</option>
              </select>
            </div>
          </div>
        </section>

        {/* AI / Ollama */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-zinc-200">AI Chart Builder</h3>
            <button
              onClick={checkOllama}
              disabled={checking}
              className="text-xs px-2.5 py-1 text-zinc-300 border border-zinc-700 rounded hover:border-teal-600 hover:text-teal-300 transition-colors disabled:opacity-50"
            >
              {checking ? 'Checking…' : 'Check Ollama'}
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                Ollama endpoint
              </div>
              <input
                value={endpointDraft}
                onChange={(e) => setEndpointDraft(e.target.value)}
                onBlur={commitEndpoint}
                placeholder="http://localhost:11434"
                className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-700 focus:border-teal-600 rounded-md text-xs font-mono text-zinc-200 focus:outline-none"
              />
              {ollamaStatus && (
                <div className="text-xs mt-2">
                  {ollamaStatus.running ? (
                    <span className="text-teal-400">
                      Running — {ollamaStatus.models.length} model
                      {ollamaStatus.models.length === 1 ? '' : 's'} installed
                    </span>
                  ) : (
                    <span className="text-amber-400">Not reachable. Install from ollama.com/download.</span>
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-2">
                Default model
              </div>
              <select
                value={prefs.defaultModel}
                onChange={(e) => updatePrefs({ defaultModel: e.target.value })}
                className="w-full text-xs bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-teal-600 font-mono"
              >
                {RECOMMENDED_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.value} — {m.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-zinc-500 mt-2">
                Install with the first-run wizard, or run:{' '}
                <code className="text-zinc-400">ollama pull {prefs.defaultModel}</code>
              </p>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-2">
                Default language
              </div>
              <div className="inline-flex items-center gap-1 rounded-md border border-zinc-700 p-0.5">
                {(['python', 'r'] as PlotLanguage[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => updatePrefs({ defaultLanguage: l })}
                    className={`px-3 py-1 text-xs rounded transition-colors ${
                      prefs.defaultLanguage === l
                        ? 'bg-zinc-700 text-zinc-100 font-medium'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {l === 'python' ? 'Python' : 'R'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Reset */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <h3 className="text-sm font-semibold text-zinc-200 mb-4">Reset</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm text-zinc-300">Show onboarding again</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  Replay the first-run wizard next time you launch LabVAR
                </div>
              </div>
              <button
                onClick={() => {
                  updatePrefs({ onboarded: false });
                  alert('Onboarding will show on next launch. Restart LabVAR to see it.');
                }}
                className="text-xs px-2.5 py-1 text-zinc-300 border border-zinc-700 rounded hover:border-teal-600 hover:text-teal-300 transition-colors flex-shrink-0"
              >
                Replay
              </button>
            </div>
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-zinc-800">
              <div className="min-w-0">
                <div className="text-sm text-zinc-300">Reset all preferences</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  Restore defaults. Does not delete experiments or files.
                </div>
              </div>
              <button
                onClick={() => {
                  if (confirm('Reset all preferences to defaults?')) {
                    resetPrefs();
                    setNameDraft('Researcher');
                    setEndpointDraft('http://localhost:11434');
                  }
                }}
                className="text-xs px-2.5 py-1 text-red-400 border border-red-900/50 rounded hover:bg-red-950/30 transition-colors flex-shrink-0"
              >
                Reset
              </button>
            </div>
          </div>
        </section>

        <p className="text-xs text-zinc-600 text-center pb-4">
          LabVAR — All data stays on your machine
        </p>
      </div>
    </Workspace>
  );
}
