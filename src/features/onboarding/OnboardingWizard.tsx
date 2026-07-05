// ---------------------------------------------------------------------------
// OnboardingWizard.tsx — first-run experience.
//
// Steps: Welcome -> Data folder -> Profile -> AI model -> Done.
// - Data folder: opens the native directory picker, remembers the choice as
//   the default project root in userPrefs. Skippable.
// - Profile: display name (auto-derives initials) + color theme.
// - AI model: detects a running Ollama server; if none, shows OS-specific
//   install instructions with a "Check again" button. If Ollama is up but the
//   default model isn't installed, offers a one-click pull with live progress.
// Once complete, sets `onboarded: true` so the wizard doesn't reappear.
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { getPrefs, updatePrefs, deriveInitials, type UserPrefs } from '@/lib/userPrefs';
import { useAppStore } from '@/store/useAppStore';
import {
  detectOllama,
  detectOS,
  ollamaInstallInstructions,
  pullOllamaModel,
} from '@/lib/ollamaSetup';
import { RECOMMENDED_MODELS } from '@/lib/ollamaClient';

type Step = 'welcome' | 'folder' | 'profile' | 'ai' | 'done';

const STEPS: Step[] = ['welcome', 'folder', 'profile', 'ai', 'done'];

export function OnboardingWizard({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState<Step>('welcome');
  const [prefs, setPrefsLocal] = useState<UserPrefs>(getPrefs());

  const patch = (p: Partial<UserPrefs>) => {
    const next = updatePrefs(p);
    setPrefsLocal(next);
  };

  const next = () => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };
  const back = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  };

  const finish = () => {
    updatePrefs({ onboarded: true });
    onFinish();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-zinc-950 flex items-center justify-center overflow-y-auto">
      <div className="w-full max-w-2xl mx-auto px-6 py-10">
        {/* Progress rail */}
        <div className="mb-8 flex items-center gap-2">
          {STEPS.slice(0, -1).map((s, i) => {
            const active = STEPS.indexOf(step) >= i;
            return (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  active ? 'bg-teal-500' : 'bg-zinc-800'
                }`}
              />
            );
          })}
        </div>

        {step === 'welcome' && <WelcomeStep onNext={next} />}
        {step === 'folder' && (
          <FolderStep prefs={prefs} onPatch={patch} onNext={next} onBack={back} />
        )}
        {step === 'profile' && (
          <ProfileStep prefs={prefs} onPatch={patch} onNext={next} onBack={back} />
        )}
        {step === 'ai' && (
          <AiStep prefs={prefs} onPatch={patch} onNext={next} onBack={back} />
        )}
        {step === 'done' && <DoneStep prefs={prefs} onFinish={finish} />}
      </div>
    </div>
  );
}

// -------------------------- Steps ------------------------------------------

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center space-y-6">
      <div className="mx-auto w-16 h-16 rounded-2xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3h6v7a4 4 0 0 1 2 3.5V18a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3v-4.5A4 4 0 0 1 9 10V3z" />
          <line x1="7" y1="3" x2="17" y2="3" />
          <line x1="10" y1="7" x2="14" y2="7" />
        </svg>
      </div>
      <div>
        <h1 className="text-3xl font-bold text-zinc-100 mb-2">Welcome to LabVAR</h1>
        <p className="text-zinc-400 text-sm max-w-md mx-auto">
          A local-first, open-source desktop tool for planning experiments, quantifying gels,
          plotting data, and running statistical tests. Everything stays on your machine.
        </p>
      </div>
      <div className="pt-4">
        <button
          onClick={onNext}
          className="px-8 py-3 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-teal-900/30"
        >
          Get started
        </button>
      </div>
      <p className="text-xs text-zinc-600 pt-2">Takes about a minute. You can change anything later in Settings.</p>
    </div>
  );
}

function FolderStep({
  prefs,
  onPatch,
  onNext,
  onBack,
}: {
  prefs: UserPrefs;
  onPatch: (p: Partial<UserPrefs>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    setPicking(true);
    try {
      // Import lazily so browser dev doesn't crash if the Tauri plugin isn't compiled.
      const dialog = await import('@tauri-apps/plugin-dialog');
      const chosen = await dialog.open({
        directory: true,
        multiple: false,
        title: 'Choose a default folder for LabVAR projects',
        defaultPath: prefs.dataDir ?? undefined,
      });
      if (typeof chosen === 'string' && chosen) {
        onPatch({ dataDir: chosen });
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not open a folder picker. You can set this later in Settings.'
      );
    } finally {
      setPicking(false);
    }
  };

  return (
    <StepFrame
      title="Choose a data folder"
      subtitle="LabVAR will save exports and copy imported files here by default. You can still choose a different folder per experiment later."
      onBack={onBack}
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5 space-y-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">Current default</div>
          <div className="font-mono text-sm text-zinc-200 break-all min-h-[1.25rem]">
            {prefs.dataDir ?? <span className="text-zinc-500 italic">Not set — you can pick one now or skip.</span>}
          </div>
          <div className="pt-2 flex flex-wrap gap-2">
            <button
              onClick={pick}
              disabled={picking}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
            >
              {picking ? 'Opening…' : prefs.dataDir ? 'Choose a different folder' : 'Choose folder'}
            </button>
            {prefs.dataDir && (
              <button
                onClick={() => onPatch({ dataDir: null })}
                className="px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded-md transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
        <p className="text-xs text-zinc-500">
          Tip: pick a folder you back up (Dropbox, iCloud, Time Machine). LabVAR itself keeps its
          provenance database in your OS's app-data folder.
        </p>
      </div>

      <StepFooter>
        <button onClick={onNext} className="btn-secondary">
          Skip
        </button>
        <button onClick={onNext} className="btn-primary" disabled={!prefs.dataDir}>
          Continue
        </button>
      </StepFooter>
    </StepFrame>
  );
}

function ProfileStep({
  prefs,
  onPatch,
  onNext,
  onBack,
}: {
  prefs: UserPrefs;
  onPatch: (p: Partial<UserPrefs>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const [name, setName] = useState(prefs.userName === 'Researcher' ? '' : prefs.userName);

  const commit = () => {
    const cleanName = name.trim() || 'Researcher';
    onPatch({ userName: cleanName, initials: deriveInitials(cleanName) });
  };

  return (
    <StepFrame
      title="Set up your profile"
      subtitle="Just a name for the sidebar and any local exports. Nothing leaves your machine."
      onBack={onBack}
    >
      <div className="space-y-5">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5 space-y-3">
          <label className="block text-xs uppercase tracking-wider text-zinc-500 font-semibold">
            Display name
          </label>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-teal-600/30 border border-teal-600/50 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-semibold text-teal-400">
                {deriveInitials(name || 'Researcher')}
              </span>
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              placeholder="e.g. Alex Chen"
              className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-700 focus:border-teal-600 rounded-md text-sm text-zinc-200 focus:outline-none"
            />
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <label className="block text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-3">
            Color theme
          </label>
          <div className="inline-flex items-center gap-1 rounded-md border border-zinc-700 p-0.5">
            <button
              onClick={() => setTheme('dark')}
              className={`px-4 py-1.5 text-sm rounded transition-colors ${
                theme === 'dark' ? 'bg-zinc-700 text-zinc-100 font-medium' : 'text-zinc-400'
              }`}
            >
              Dark
            </button>
            <button
              onClick={() => setTheme('light')}
              className={`px-4 py-1.5 text-sm rounded transition-colors ${
                theme === 'light' ? 'bg-zinc-700 text-zinc-100 font-medium' : 'text-zinc-400'
              }`}
            >
              Light
            </button>
          </div>
        </div>
      </div>

      <StepFooter>
        <button
          onClick={() => {
            commit();
            onNext();
          }}
          className="btn-primary"
        >
          Continue
        </button>
      </StepFooter>
    </StepFrame>
  );
}

function AiStep({
  prefs,
  onPatch,
  onNext,
  onBack,
}: {
  prefs: UserPrefs;
  onPatch: (p: Partial<UserPrefs>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [status, setStatus] = useState<'checking' | 'missing' | 'running' | 'error'>('checking');
  const [installed, setInstalled] = useState<string[]>([]);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>(prefs.defaultModel);
  const [pulling, setPulling] = useState<{ model: string; status: string; percent?: number } | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const os = detectOS();
  const instructions = ollamaInstallInstructions(os);

  const check = async () => {
    setStatus('checking');
    setCheckError(null);
    try {
      const res = await detectOllama(prefs.ollamaEndpoint);
      if (res.running) {
        setInstalled(res.models);
        setStatus('running');
      } else {
        setStatus('missing');
      }
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  };

  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasModel = installed.some((m) => m === selectedModel || m.startsWith(selectedModel.split(':')[0]));

  const pull = async () => {
    setPulling({ model: selectedModel, status: 'starting' });
    setPullError(null);
    try {
      await pullOllamaModel(selectedModel, (evt) => {
        setPulling({ model: selectedModel, status: evt.status, percent: evt.percent });
        if (evt.done && !evt.error) {
          // Re-check the model list.
          check();
        }
        if (evt.error) setPullError(evt.error);
      });
      onPatch({ defaultModel: selectedModel });
    } catch (e) {
      setPullError(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(null);
    }
  };

  return (
    <StepFrame
      title="Set up the AI Chart Builder (optional)"
      subtitle="LabVAR can use a local Ollama model to translate plain-English chart requests into Python or R code. Everything runs on your machine — the app never sends your data anywhere."
      onBack={onBack}
    >
      <div className="space-y-4">
        {/* Ollama status */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">Ollama server</div>
              <div className="font-mono text-xs text-zinc-400 mt-1">{prefs.ollamaEndpoint}</div>
            </div>
            <StatusPill status={status} />
          </div>

          {status === 'missing' && (
            <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2">
              <div className="text-sm font-semibold text-zinc-200">{instructions.title}</div>
              <ol className="text-xs text-zinc-400 list-decimal list-inside space-y-1">
                {instructions.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              <div className="flex gap-2 pt-2">
                <a
                  href={instructions.downloadUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="btn-primary text-center"
                >
                  Download Ollama
                </a>
                <button onClick={check} className="btn-secondary">
                  Check again
                </button>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="text-xs text-red-400">
              Couldn't check Ollama: {checkError}. You can install it later from Settings.
            </div>
          )}

          {status === 'running' && (
            <div className="text-xs text-zinc-400">
              Found {installed.length} model{installed.length === 1 ? '' : 's'} installed
              {installed.length > 0 && ` (${installed.slice(0, 3).join(', ')}${installed.length > 3 ? '…' : ''})`}
              .
            </div>
          )}
        </div>

        {/* Model picker + pull */}
        {status === 'running' && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5 space-y-3">
            <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">Default model</div>
            <div className="space-y-1">
              {RECOMMENDED_MODELS.map((m) => {
                const isInstalled = installed.some((im) => im === m.value || im.startsWith(m.value.split(':')[0]));
                return (
                  <label
                    key={m.value}
                    className={`flex items-center gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                      selectedModel === m.value
                        ? 'border-teal-600/60 bg-teal-500/5'
                        : 'border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="model"
                      value={m.value}
                      checked={selectedModel === m.value}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="accent-teal-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-zinc-200 font-mono">{m.value}</div>
                      <div className="text-xs text-zinc-500 truncate">{m.label}</div>
                    </div>
                    {isInstalled && (
                      <span className="text-[10px] text-teal-400 bg-teal-900/30 border border-teal-800/50 px-2 py-0.5 rounded-full">
                        installed
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            {pulling && (
              <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                <div className="flex items-center justify-between text-xs text-zinc-300">
                  <span>Pulling {pulling.model}</span>
                  <span className="text-zinc-500">
                    {pulling.status}
                    {typeof pulling.percent === 'number' ? ` — ${pulling.percent.toFixed(0)}%` : ''}
                  </span>
                </div>
                <div className="mt-2 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-teal-500 transition-all"
                    style={{ width: `${pulling.percent ?? 5}%` }}
                  />
                </div>
              </div>
            )}
            {pullError && (
              <div className="text-xs text-red-400 border border-red-900/50 bg-red-950/30 rounded-md p-2">
                {pullError}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              {!hasModel && !pulling && (
                <button onClick={pull} className="btn-primary">
                  Install {selectedModel}
                </button>
              )}
              {hasModel && (
                <button
                  onClick={() => {
                    onPatch({ defaultModel: selectedModel });
                    onNext();
                  }}
                  className="btn-primary"
                >
                  Use {selectedModel}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <StepFooter>
        <button onClick={onNext} className="btn-secondary">
          Skip for now
        </button>
        {status === 'running' && hasModel && (
          <button
            onClick={() => {
              onPatch({ defaultModel: selectedModel });
              onNext();
            }}
            className="btn-primary"
          >
            Continue
          </button>
        )}
      </StepFooter>
    </StepFrame>
  );
}

function DoneStep({ prefs, onFinish }: { prefs: UserPrefs; onFinish: () => void }) {
  return (
    <div className="text-center space-y-6">
      <div className="mx-auto w-16 h-16 rounded-2xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-zinc-100 mb-2">You're all set, {prefs.userName}</h1>
        <p className="text-zinc-400 text-sm max-w-md mx-auto">
          Head to Experimental Design to plan a study, drop a CSV into Plotting & Stats, or
          quantify a gel image. Change any of these settings anytime from the gear icon.
        </p>
      </div>
      <button
        onClick={onFinish}
        className="px-8 py-3 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-teal-900/30"
      >
        Open LabVAR
      </button>
    </div>
  );
}

// -------------------------- Shared bits ------------------------------------

function StepFrame({
  title,
  subtitle,
  onBack,
  children,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">{title}</h2>
          <p className="text-sm text-zinc-500 mt-1 max-w-lg">{subtitle}</p>
        </div>
        <button
          onClick={onBack}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Back
        </button>
      </div>
      {children}
    </div>
  );
}

function StepFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-4">
      {children}
      <style>{`
        .btn-primary {
          padding: 0.5rem 1rem;
          background-color: #0d9488;
          color: white;
          font-size: 0.875rem;
          font-weight: 500;
          border-radius: 0.375rem;
          transition: background-color 0.15s;
        }
        .btn-primary:hover { background-color: #14b8a6; }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-secondary {
          padding: 0.5rem 1rem;
          background-color: transparent;
          color: #a1a1aa;
          font-size: 0.875rem;
          border-radius: 0.375rem;
          border: 1px solid #3f3f46;
          transition: color 0.15s, border-color 0.15s;
        }
        .btn-secondary:hover { color: #e4e4e7; border-color: #52525b; }
      `}</style>
    </div>
  );
}

function StatusPill({ status }: { status: 'checking' | 'missing' | 'running' | 'error' }) {
  const map = {
    checking: { text: 'Checking…', cls: 'bg-zinc-800 text-zinc-400 border-zinc-700' },
    missing: { text: 'Not installed', cls: 'bg-amber-950/40 text-amber-400 border-amber-800/50' },
    running: { text: 'Running', cls: 'bg-teal-950/40 text-teal-400 border-teal-800/50' },
    error: { text: 'Error', cls: 'bg-red-950/40 text-red-400 border-red-800/50' },
  } as const;
  const p = map[status];
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full border ${p.cls}`}>
      {p.text}
    </span>
  );
}
