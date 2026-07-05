import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Workspace } from '@/components/Workspace';
import { Button } from '@/components/Button';
import { createExperiment, importDataset } from '@/lib/invoke';
import { AiChartWorkspace } from '@/features/aichart/AiChartWorkspace';

/** Read a dropped/selected file as CSV text (xlsx converted via SheetJS). */
async function fileToCsv(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_csv(ws);
  }
  return file.text();
}

type PlotMode = 'presets' | 'ai';

/**
 * Plotting & Stats hub. Two modes:
 * 1. **Presets** (original) — CSV → Vega-Lite via the preset registry.
 * 2. **AI Chart Builder** — describe what you want, Phi-3 generates code.
 */
export function PlotWorkspace() {
  const experiments = useAppStore((s) => s.experiments);
  const loadExperiments = useAppStore((s) => s.loadExperiments);
  const setActiveExperiment = useAppStore((s) => s.setActiveExperiment);
  const setExperimentTab = useAppStore((s) => s.setExperimentTab);
  const setView = useAppStore((s) => s.setView);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<PlotMode>('presets');

  useEffect(() => {
    loadExperiments();
  }, [loadExperiments]);

  const active = experiments.filter((e) => !e.archived);

  const openPlots = (id: string) => {
    setActiveExperiment(id);
    setExperimentTab('plots');
    setView('experiment');
  };

  const quickPlot = async (file: File) => {
    setBusy(true);
    try {
      const csv = await fileToCsv(file);
      const stamp = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const expId = await createExperiment(`Scratch · ${stamp}`);
      await importDataset(expId, file.name.replace(/\.[^.]+$/, ''), csv);
      await loadExperiments();
      openPlots(expId);
    } catch (e) {
      alert('Could not import that file: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Workspace
      title="Plotting & Stats"
      subtitle={
        mode === 'presets'
          ? 'Turn a wide-format lab CSV into publication figures + tests.'
          : 'Describe exactly what you want — AI generates the code, you run it.'
      }
      actions={
        mode === 'presets' ? (
          <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? 'Importing...' : 'Quick plot from CSV'}
          </Button>
        ) : undefined
      }
    >
      {/* Mode toggle */}
      <div className="flex items-center gap-1 rounded-md border border-zinc-700 p-0.5 w-fit mb-6">
        <button
          onClick={() => setMode('presets')}
          className={`px-4 py-1.5 text-sm rounded transition-colors ${
            mode === 'presets'
              ? 'bg-teal-600/30 text-teal-300 font-medium'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Preset Charts
        </button>
        <button
          onClick={() => setMode('ai')}
          className={`px-4 py-1.5 text-sm rounded transition-colors ${
            mode === 'ai'
              ? 'bg-teal-600/30 text-teal-300 font-medium'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          AI Chart Builder
        </button>
      </div>

      {mode === 'ai' ? (
        <AiChartWorkspace />
      ) : (
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) quickPlot(f);
              e.target.value = '';
            }}
          />

          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) quickPlot(f);
            }}
            onClick={() => fileRef.current?.click()}
            className={`rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
              dragging ? 'border-teal-500 bg-teal-500/5' : 'border-zinc-700 hover:border-zinc-600'
            }`}
          >
            <p className="text-sm text-zinc-300 font-medium">Drop a CSV / Excel file to plot it now</p>
            <p className="text-xs text-zinc-500 mt-1">
              Creates a scratch experiment so you don't have to set anything up. Rename or delete it later.
            </p>
          </div>

          {/* Existing experiments to plot within */}
          <div className="mt-8">
            <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              Or plot within an experiment
            </h3>
            {active.length === 0 ? (
              <p className="text-sm text-zinc-500">No experiments yet — use the drop zone above to start.</p>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                {active.map((exp) => (
                  <button
                    key={exp.id}
                    onClick={() => openPlots(exp.id)}
                    className="text-left rounded-lg border border-zinc-800 bg-zinc-900 hover:border-teal-600/50 hover:bg-zinc-800/60 transition-colors p-3"
                  >
                    <div className="text-sm text-zinc-200 font-medium truncate">{exp.name}</div>
                    <div className="text-[11px] text-zinc-500 mt-1 font-mono">
                      {new Date(exp.created_ts).toLocaleDateString()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Workspace>
  );
}
