import { useEffect, useCallback } from 'react';
import { Button } from '@/components/Button';
import { useAppStore } from '@/store/useAppStore';
import type { AiChartCsvInfo, AiChartHistoryEntry } from '@/store/useAppStore';
import {
  generateChartCode,
  interpretData,
  extractCode,
  patchImports,
  patchPlotCalls,
  generateBoilerplate,
  isWideFormat,
  checkOllama,
  COLOR_SCHEMES,
  DEFAULT_OLLAMA_CONFIG,
  TEMP_CHART_OUTPUT,
  type ChartRequest,
} from '@/lib/ollamaClient';
import { parseTable } from '@/lib/labdata';
import { useState } from 'react';

// ---------------------------------------------------------------------------
// AI Chart Builder — single-prompt interface.
//
// All form/generation state lives in the Zustand store (`aiChart` slice) so
// navigating to another workspace and back preserves everything.
// ---------------------------------------------------------------------------

export function AiChartWorkspace() {
  const ac = useAppStore((s) => s.aiChart);
  const set = useAppStore((s) => s.updateAiChart);
  const resetAll = useAppStore((s) => s.resetAiChart);

  const [ollamaStatus, setOllamaStatus] = useState<{
    online: boolean;
    modelAvailable: boolean;
    models: string[];
  } | null>(null);

  useEffect(() => {
    checkOllama().then(setOllamaStatus);
  }, []);

  // --- File picker ---
  const pickFile = useCallback(async () => {
    try {
      const dialog = await import('@tauri-apps/plugin-dialog');
      const picked = await dialog.open({
        multiple: false,
        filters: [{ name: 'Data', extensions: ['csv', 'tsv', 'txt', 'xlsx', 'xls'] }],
      });
      if (typeof picked !== 'string') return;

      const fullPath = picked;
      const dir = fullPath.substring(0, Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\')));
      const fileName = fullPath.split(/[\\/]/).pop() || fullPath;

      let text: string;
      if (/\.xlsx?$/i.test(fileName)) {
        const { readFile } = await import('@tauri-apps/plugin-fs');
        const bytes = await readFile(fullPath);
        const XLSX = await import('xlsx');
        const wb = XLSX.read(bytes, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        text = XLSX.utils.sheet_to_csv(ws);
      } else {
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        text = await readTextFile(fullPath);
      }

      const table = parseTable(text);
      const previewRows = text.split('\n').slice(0, 21).join('\n');

      const csv: AiChartCsvInfo = {
        fileName,
        path: fullPath,
        dir,
        columns: table.columns,
        preview: previewRows,
        rawText: text,
      };
      set({ csv, dataInterpretation: '' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('not a function') || msg.includes('__TAURI__')) {
        set({ errorMsg: 'Native file picker requires the compiled Tauri app. Use "npm run deploy" first.', phase: 'error' });
      } else {
        set({ errorMsg: 'Could not open file: ' + msg, phase: 'error' });
      }
    }
  }, [set]);

  // --- Generate ---
  const handleGenerate = useCallback(async () => {
    if (!ac.csv?.path) return;

    set({ phase: 'generating', streamingOutput: '', errorMsg: '' });

    try {
      // Phase 1: interpret data
      let interpretation = ac.dataInterpretation;
      if (!interpretation) {
        interpretation = await interpretData(ac.csv.preview);
        set({ dataInterpretation: interpretation });
      }

      // Phase 2: generate code
      const req: ChartRequest = {
        context: ac.context,
        colorScheme: ac.colorScheme,
        language: ac.language,
        csvPath: ac.csv.path,
        csvDir: ac.csv.dir,
        csvPreview: ac.csv.preview,
        columns: ac.csv.columns,
        dataInterpretation: interpretation,
      };

      const raw = await generateChartCode(req, DEFAULT_OLLAMA_CONFIG, (partial) => {
        set({ streamingOutput: partial });
      });

      const plotCode = patchPlotCalls(patchImports(extractCode(raw), ac.language), ac.language);
      const wide = isWideFormat(ac.csv.columns, ac.csv.preview);
      const boilerplate = generateBoilerplate(ac.csv.path, ac.csv.dir, ac.csv.columns, ac.language, wide);
      const code = boilerplate + plotCode;

      // Save to history
      const entry: AiChartHistoryEntry = {
        id: Date.now().toString(),
        prompt: ac.context,
        colorScheme: ac.colorScheme,
        language: ac.language,
        fileName: ac.csv.fileName,
        timestamp: Date.now(),
      };
      const history = [entry, ...ac.requestHistory.filter((h) => h.id !== entry.id)].slice(0, 20);

      set({ generatedCode: code, phase: 'code-review', requestHistory: history });
    } catch (e) {
      set({ errorMsg: e instanceof Error ? e.message : String(e), phase: 'error' });
    }
  }, [ac.csv, ac.context, ac.colorScheme, ac.language, ac.dataInterpretation, ac.requestHistory, set]);

  // --- Run code ---
  const handleRunCode = useCallback(async () => {
    if (!ac.csv?.dir || !ac.generatedCode) return;

    set({ phase: 'running', runOutput: '', errorMsg: '' });

    try {
      const { runPlotScript } = await import('@/lib/invoke');
      const output = await runPlotScript(ac.generatedCode, ac.language, ac.csv.dir);
      set({ runOutput: output });

      try {
        const { readFile } = await import('@tauri-apps/plugin-fs');
        const bytes = await readFile(TEMP_CHART_OUTPUT);
        const blob = new Blob([bytes], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        set({ resultImageUrl: url, phase: 'result' });
      } catch {
        set({ phase: 'result' });
      }
    } catch (e) {
      set({ errorMsg: e instanceof Error ? e.message : String(e), phase: 'error' });
    }
  }, [ac.csv, ac.generatedCode, ac.language, set]);

  // --- Save as ---
  const handleSave = useCallback(async () => {
    try {
      const dialog = await import('@tauri-apps/plugin-dialog');
      const dest = await dialog.save({
        defaultPath: ac.csv?.dir ? `${ac.csv.dir}/chart.png` : 'chart.png',
        filters: [{ name: 'Image', extensions: ['png'] }],
      });
      if (!dest) return;
      const { readFile, writeFile } = await import('@tauri-apps/plugin-fs');
      const bytes = await readFile(TEMP_CHART_OUTPUT);
      await writeFile(dest, bytes);
    } catch (e) {
      console.error('Save failed:', e);
    }
  }, [ac.csv]);

  // --- Correction ---
  const handleCorrection = useCallback(async () => {
    if (!ac.csv || !ac.correctionNote.trim()) return;

    set({ phase: 'generating', streamingOutput: '', errorMsg: '' });

    try {
      const req: ChartRequest = {
        context: ac.context,
        colorScheme: ac.colorScheme,
        language: ac.language,
        csvPath: ac.csv.path,
        csvDir: ac.csv.dir,
        csvPreview: ac.csv.preview,
        columns: ac.csv.columns,
        previousCode: ac.generatedCode,
        correctionNote: ac.correctionNote,
      };

      const raw = await generateChartCode(req, DEFAULT_OLLAMA_CONFIG, (partial) => {
        set({ streamingOutput: partial });
      });

      let code = patchPlotCalls(patchImports(extractCode(raw), ac.language), ac.language);
      if (!code.includes('pd.read_csv') && !code.includes('read_csv(')) {
        const wide = isWideFormat(ac.csv.columns, ac.csv.preview);
        const boilerplate = generateBoilerplate(ac.csv.path, ac.csv.dir, ac.csv.columns, ac.language, wide);
        code = boilerplate + code;
      }
      set({ generatedCode: code, correctionNote: '', phase: 'code-review' });
    } catch (e) {
      set({ errorMsg: e instanceof Error ? e.message : String(e), phase: 'error' });
    }
  }, [ac, set]);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Ollama status */}
      <div className="flex items-center gap-2 text-xs">
        <div
          className={`w-2 h-2 rounded-full ${
            ollamaStatus?.online
              ? ollamaStatus.modelAvailable
                ? 'bg-teal-400'
                : 'bg-amber-400'
              : 'bg-red-400'
          }`}
        />
        <span className="text-zinc-500">
          {ollamaStatus === null
            ? 'Checking Ollama...'
            : ollamaStatus.online
            ? ollamaStatus.modelAvailable
              ? `${DEFAULT_OLLAMA_CONFIG.model} ready`
              : `Ollama online but ${DEFAULT_OLLAMA_CONFIG.model} not found. Run: ollama pull ${DEFAULT_OLLAMA_CONFIG.model}`
            : 'Ollama offline — start it with "ollama serve"'}
        </span>
        <button
          onClick={() => checkOllama().then(setOllamaStatus)}
          className="text-zinc-600 hover:text-zinc-400 transition-colors ml-1"
        >
          Refresh
        </button>
      </div>

      {/* Data interpretation */}
      {ac.dataInterpretation && ac.phase === 'form' && (
        <div className="rounded-lg border border-teal-800/40 bg-teal-900/10 p-3">
          <p className="text-[11px] text-teal-500 uppercase tracking-wider font-semibold mb-1">AI data interpretation</p>
          <p className="text-xs text-zinc-300">{ac.dataInterpretation}</p>
        </div>
      )}

      {/* Request history */}
      {ac.requestHistory.length > 0 && ac.phase === 'form' && (
        <details className="text-xs">
          <summary className="text-zinc-500 cursor-pointer hover:text-zinc-400 font-medium">
            Previous requests ({ac.requestHistory.length})
          </summary>
          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {ac.requestHistory.map((h) => (
              <button
                key={h.id}
                onClick={() => set({ context: h.prompt, colorScheme: h.colorScheme, language: h.language })}
                className="w-full text-left px-3 py-2 rounded border border-zinc-800 bg-zinc-900 hover:border-teal-700 hover:bg-zinc-800 transition-colors group"
              >
                <span className="text-zinc-300 group-hover:text-teal-300 block truncate">
                  {h.prompt || '(no description)'}
                </span>
                <span className="text-zinc-600 text-[10px]">
                  {h.fileName} · {h.language} · {new Date(h.timestamp).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        </details>
      )}

      {/* ===== FORM ===== */}
      {(ac.phase === 'form' || (ac.phase === 'error' && !ac.generatedCode)) && (
        <div className="space-y-4">
          {/* CSV picker */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Button variant="secondary" onClick={pickFile}>
                {ac.csv ? 'Change file' : 'Choose CSV / Excel'}
              </Button>
              {ac.csv && (
                <div className="min-w-0 flex-1">
                  <span className="text-xs text-zinc-300 truncate block">
                    {ac.csv.fileName} ({ac.csv.columns.length} cols)
                  </span>
                  <span className="text-[10px] text-zinc-600 truncate block font-mono">{ac.csv.path}</span>
                </div>
              )}
            </div>
            {ac.csv && (
              <details className="text-xs">
                <summary className="text-zinc-500 cursor-pointer hover:text-zinc-400">Preview</summary>
                <div className="mt-2 font-mono text-zinc-400 bg-zinc-800 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre text-[11px]">
                  Columns: {ac.csv.columns.join(', ')}
                  {'\n\n'}
                  {ac.csv.preview}
                </div>
              </details>
            )}
          </div>

          {/* Single prompt */}
          <div>
            <label className="text-sm font-medium text-zinc-300 block mb-1">Describe the chart you want</label>
            <p className="text-[11px] text-zinc-500 mb-1.5">
              Include chart type, style, titles, axis labels — everything in one go
            </p>
            <textarea
              value={ac.context}
              onChange={(e) => set({ context: e.target.value })}
              placeholder="e.g. Grouped strip plot with mean bars and SEM error bars. Group by drug concentration on x-axis, color by time point (0h vs 24h). Title: FUDR dose response. Y-axis: GFP intensity (A.U.)"
              className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-600 resize-y h-28"
            />
          </div>

          {/* Color + language row */}
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium text-zinc-300 block mb-1">Colors</label>
              <select
                value={ac.colorScheme}
                onChange={(e) => set({ colorScheme: e.target.value })}
                className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:border-teal-600"
              >
                {COLOR_SCHEMES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-zinc-700 p-0.5">
              <button
                onClick={() => set({ language: 'python' })}
                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                  ac.language === 'python' ? 'bg-teal-600/30 text-teal-300 font-medium' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Python
              </button>
              <button
                onClick={() => set({ language: 'r' })}
                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                  ac.language === 'r' ? 'bg-teal-600/30 text-teal-300 font-medium' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                R
              </button>
            </div>
          </div>

          {ac.phase === 'error' && ac.errorMsg && (
            <div className="rounded-lg border border-red-800/50 bg-red-900/20 p-3 text-sm text-red-300">
              {ac.errorMsg}
            </div>
          )}

          <Button
            variant="primary"
            onClick={handleGenerate}
            disabled={!ac.csv?.path || !ac.context.trim() || !ollamaStatus?.online}
          >
            Generate
          </Button>
        </div>
      )}

      {/* ===== GENERATING ===== */}
      {ac.phase === 'generating' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <Spinner />
            Generating...
          </div>
          {ac.streamingOutput && (
            <pre className="text-xs font-mono text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-lg p-4 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
              {ac.streamingOutput}
            </pre>
          )}
        </div>
      )}

      {/* ===== CODE REVIEW ===== */}
      {ac.phase === 'code-review' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-200">Generated code</h3>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={resetAll}>Start over</Button>
              <Button variant="primary" onClick={handleRunCode}>Run code</Button>
            </div>
          </div>
          <textarea
            value={ac.generatedCode}
            onChange={(e) => set({ generatedCode: e.target.value })}
            className="w-full h-64 px-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-300 focus:outline-none focus:border-teal-600 resize-y"
          />
          {ac.correctionNote && (
            <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 space-y-2">
              <p className="text-xs text-amber-300 font-medium">Auto-fix queued</p>
              <p className="text-xs text-zinc-400 whitespace-pre-wrap">{ac.correctionNote}</p>
              <Button variant="primary" onClick={handleCorrection}>Send to AI</Button>
            </div>
          )}
        </div>
      )}

      {/* ===== RUNNING ===== */}
      {ac.phase === 'running' && (
        <div className="flex items-center gap-2 text-sm text-zinc-300">
          <Spinner />
          Running script...
        </div>
      )}

      {/* ===== RESULT ===== */}
      {ac.phase === 'result' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-200">Result</h3>
            <div className="flex gap-2">
              {ac.resultImageUrl && (
                <Button variant="secondary" onClick={handleSave}>Save as...</Button>
              )}
              <Button variant="secondary" onClick={resetAll}>New chart</Button>
            </div>
          </div>

          {ac.resultImageUrl && (
            <div className="rounded-lg border border-zinc-800 bg-white p-2">
              <img src={ac.resultImageUrl} alt="Generated chart" className="max-w-full h-auto rounded" />
            </div>
          )}

          {ac.runOutput && (
            <details className="text-xs">
              <summary className="text-zinc-500 cursor-pointer hover:text-zinc-400">Script output</summary>
              <pre className="mt-2 font-mono text-zinc-400 bg-zinc-800 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {ac.runOutput}
              </pre>
            </details>
          )}

          <details className="text-xs">
            <summary className="text-zinc-500 cursor-pointer hover:text-zinc-400">Code used</summary>
            <pre className="mt-2 font-mono text-zinc-400 bg-zinc-900 border border-zinc-800 rounded p-3 overflow-x-auto whitespace-pre-wrap">
              {ac.generatedCode}
            </pre>
          </details>

          {/* Correction */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
            <label className="text-sm font-medium text-zinc-300">Change something?</label>
            <textarea
              value={ac.correctionNote}
              onChange={(e) => set({ correctionNote: e.target.value })}
              placeholder="e.g. Make the font bigger, add a legend, change colors..."
              className="w-full h-16 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-600 resize-y"
            />
            <Button variant="primary" onClick={handleCorrection} disabled={!ac.correctionNote.trim()}>
              Fix it
            </Button>
          </div>
        </div>
      )}

      {/* ===== ERROR ===== */}
      {ac.phase === 'error' && ac.errorMsg && ac.generatedCode && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-red-300">Script failed</h3>
            <Button variant="secondary" onClick={resetAll}>Start over</Button>
          </div>
          <pre className="text-xs font-mono text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg p-4 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">
            {ac.errorMsg}
          </pre>
          <details className="text-xs">
            <summary className="text-zinc-500 cursor-pointer hover:text-zinc-400">Code that failed</summary>
            <pre className="mt-2 font-mono text-zinc-400 bg-zinc-900 border border-zinc-800 rounded p-3 overflow-x-auto whitespace-pre-wrap">
              {ac.generatedCode}
            </pre>
          </details>
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={() => {
                set({
                  correctionNote: `The script threw this error:\n${ac.errorMsg}\n\nFix the code so it runs without errors.`,
                  phase: 'code-review',
                });
              }}
            >
              Let AI fix it
            </Button>
            <Button variant="secondary" onClick={() => set({ phase: 'code-review' })}>
              Edit manually
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin text-teal-400" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
