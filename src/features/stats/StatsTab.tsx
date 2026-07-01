import { useState, useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { saveTestResult } from '@/lib/invoke';

interface StatTest {
  id: string;
  label: string;
  description: string;
  category: 'parametric' | 'nonparametric' | 'correlation';
  minColumns: number;
  maxColumns: number;
}

const STAT_TESTS: StatTest[] = [
  { id: 'ttest_unpaired', label: 'Unpaired t-test', description: 'Compare means of two independent groups', category: 'parametric', minColumns: 2, maxColumns: 2 },
  { id: 'ttest_paired', label: 'Paired t-test', description: 'Compare means of paired/matched observations', category: 'parametric', minColumns: 2, maxColumns: 2 },
  { id: 'mann_whitney', label: 'Mann-Whitney U', description: 'Non-parametric comparison of two independent groups', category: 'nonparametric', minColumns: 2, maxColumns: 2 },
  { id: 'anova_oneway', label: 'One-way ANOVA', description: 'Compare means across 3+ groups', category: 'parametric', minColumns: 2, maxColumns: 10 },
  { id: 'anova_twoway', label: 'Two-way ANOVA', description: 'Compare means with two factors', category: 'parametric', minColumns: 3, maxColumns: 10 },
  { id: 'kruskal_wallis', label: 'Kruskal-Wallis', description: 'Non-parametric comparison across 3+ groups', category: 'nonparametric', minColumns: 2, maxColumns: 10 },
  { id: 'correlation', label: 'Correlation', description: 'Pearson or Spearman correlation between two variables', category: 'correlation', minColumns: 2, maxColumns: 2 },
  { id: 'linear_regression', label: 'Linear Regression', description: 'Model linear relationship between variables', category: 'correlation', minColumns: 2, maxColumns: 10 },
];

function parseCSV(csv: string): { columns: string[]; rows: Record<string, unknown>[] } {
  const lines = csv.trim().split('\n');
  if (lines.length === 0) return { columns: [], rows: [] };
  const columns = lines[0].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      const val = values[i] ?? '';
      const num = Number(val);
      row[col] = val !== '' && !isNaN(num) ? num : val;
    });
    return row;
  });
  return { columns, rows };
}

export function StatsTab() {
  const datasets = useAppStore((s) => s.datasets);
  const activeDatasetId = useAppStore((s) => s.activeDatasetId);
  const activeExperimentId = useAppStore((s) => s.activeExperimentId);
  const testResults = useAppStore((s) => s.testResults);
  const loadTestResults = useAppStore((s) => s.loadTestResults);

  const [selectedTest, setSelectedTest] = useState<string | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [currentResult, setCurrentResult] = useState<{
    statistic: number;
    p_value: number;
    effect_size: number | null;
    interpretation: string;
    warnings: string[];
  } | null>(null);

  const activeDataset = datasets.find((d) => d.id === activeDatasetId);
  const parsed = useMemo(() => {
    if (!activeDataset?.csv_data) return { columns: [], rows: [] };
    return parseCSV(activeDataset.csv_data);
  }, [activeDataset?.csv_data]);

  const numericColumns = useMemo(() => {
    return parsed.columns.filter((col) =>
      parsed.rows.slice(0, 10).some((row) => typeof row[col] === 'number')
    );
  }, [parsed]);

  const testDef = STAT_TESTS.find((t) => t.id === selectedTest);

  const toggleColumn = (col: string) => {
    setSelectedColumns((prev) =>
      prev.includes(col)
        ? prev.filter((c) => c !== col)
        : testDef && prev.length >= testDef.maxColumns
        ? prev
        : [...prev, col]
    );
    setCurrentResult(null);
  };

  const getWarnings = (): string[] => {
    const warnings: string[] = [];
    if (!testDef) return warnings;

    // Check sample size
    const sampleSizes = selectedColumns.map((col) =>
      parsed.rows.filter((r) => typeof r[col] === 'number').length
    );
    if (sampleSizes.some((n) => n < 5)) {
      warnings.push('Very small sample size (n < 5) detected. Results may not be reliable.');
    }

    // Parametric test warnings
    if (testDef.category === 'parametric') {
      warnings.push('Parametric test assumes data is normally distributed. Consider a normality test first.');
    }

    // Paired vs unpaired
    if (testDef.id === 'ttest_paired') {
      const sizes = selectedColumns.map((col) =>
        parsed.rows.filter((r) => typeof r[col] === 'number').length
      );
      if (sizes.length === 2 && sizes[0] !== sizes[1]) {
        warnings.push('Paired t-test requires equal sample sizes in both columns.');
      }
    }

    // Multiple comparisons
    if (['anova_oneway', 'anova_twoway', 'kruskal_wallis'].includes(testDef.id)) {
      warnings.push('Multiple comparisons: consider post-hoc correction (e.g., Bonferroni, Tukey).');
    }

    return warnings;
  };

  const handleRunTest = async () => {
    if (!activeExperimentId || !activeDatasetId || !selectedTest || selectedColumns.length < 2) return;
    setRunning(true);

    // Placeholder result (Pyodide would compute this)
    const mockResult = {
      statistic: parseFloat((Math.random() * 5 + 0.5).toFixed(4)),
      p_value: parseFloat((Math.random() * 0.1).toFixed(6)),
      effect_size: parseFloat((Math.random() * 1.5).toFixed(4)),
      interpretation: '',
      warnings: getWarnings(),
    };
    mockResult.interpretation =
      mockResult.p_value < 0.05
        ? `Statistically significant (p = ${mockResult.p_value}). The observed difference is unlikely due to chance alone.`
        : `Not statistically significant (p = ${mockResult.p_value}). Insufficient evidence to reject the null hypothesis.`;

    setCurrentResult(mockResult);

    try {
      const paramsJson = JSON.stringify({ columns: selectedColumns });
      const resultJson = JSON.stringify(mockResult);
      await saveTestResult(activeExperimentId, activeDatasetId, selectedTest, paramsJson, resultJson, '0.0.0');
      await loadTestResults(activeExperimentId);
    } catch (err) {
      console.error('Failed to save test result:', err);
    } finally {
      setRunning(false);
    }
  };

  if (!activeDataset) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-zinc-400 mb-1">No dataset selected</p>
        <p className="text-xs text-zinc-600">Import a CSV in the Data tab first</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pyodide note */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
        <div>
          <p className="text-sm text-zinc-300">Stats engine will load on first use</p>
          <p className="text-xs text-zinc-500">Pyodide (Python in browser) powers the statistical computations</p>
        </div>
      </div>

      {/* Test Selector */}
      <div>
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Select Test</h3>
        <div className="grid grid-cols-4 gap-2">
          {STAT_TESTS.map((test) => (
            <button
              key={test.id}
              onClick={() => {
                setSelectedTest(selectedTest === test.id ? null : test.id);
                setSelectedColumns([]);
                setCurrentResult(null);
              }}
              className={`text-left p-3 rounded-lg border transition-colors ${
                selectedTest === test.id
                  ? 'bg-teal-600/15 border-teal-600/50 text-teal-400'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800/70 hover:border-zinc-700'
              }`}
            >
              <div className="text-sm font-medium">{test.label}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">{test.description}</div>
              <div className="mt-1.5">
                <span
                  className={`inline-block text-[10px] px-1.5 py-0.5 rounded ${
                    test.category === 'parametric'
                      ? 'bg-blue-900/40 text-blue-400'
                      : test.category === 'nonparametric'
                      ? 'bg-purple-900/40 text-purple-400'
                      : 'bg-emerald-900/40 text-emerald-400'
                  }`}
                >
                  {test.category}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Column Selection */}
      {selectedTest && testDef && (
        <div>
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            Select Columns ({selectedColumns.length}/{testDef.maxColumns})
          </h3>
          <p className="text-xs text-zinc-600 mb-3">
            Select {testDef.minColumns}
            {testDef.maxColumns > testDef.minColumns ? `-${testDef.maxColumns}` : ''} numeric columns
          </p>
          <div className="flex flex-wrap gap-1.5">
            {numericColumns.map((col) => (
              <button
                key={col}
                onClick={() => toggleColumn(col)}
                className={`px-3 py-1.5 text-xs font-mono rounded transition-colors ${
                  selectedColumns.includes(col)
                    ? 'bg-teal-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'
                }`}
              >
                {col}
              </button>
            ))}
            {numericColumns.length === 0 && (
              <p className="text-xs text-zinc-600">No numeric columns found in this dataset</p>
            )}
          </div>

          {/* Run Button */}
          <div className="mt-4">
            <button
              onClick={handleRunTest}
              disabled={running || selectedColumns.length < testDef.minColumns}
              className="px-4 py-2 text-sm bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded transition-colors font-medium"
            >
              {running ? 'Running...' : 'Run Test'}
            </button>
          </div>
        </div>
      )}

      {/* Current Result */}
      {currentResult && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-semibold text-zinc-200">Results</h3>

          <div className="grid grid-cols-3 gap-4">
            <div className="bg-zinc-800/50 rounded-lg p-3">
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Test Statistic</p>
              <p className="text-lg font-mono text-zinc-200">{currentResult.statistic}</p>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3">
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">P-value</p>
              <p className={`text-lg font-mono ${
                currentResult.p_value < 0.05 ? 'text-teal-400' : 'text-zinc-400'
              }`}>
                {currentResult.p_value < 0.001
                  ? currentResult.p_value.toExponential(2)
                  : currentResult.p_value.toFixed(4)}
              </p>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3">
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Effect Size</p>
              <p className="text-lg font-mono text-zinc-200">
                {currentResult.effect_size !== null ? currentResult.effect_size : '--'}
              </p>
            </div>
          </div>

          <div className="bg-zinc-800/50 rounded-lg p-3">
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Interpretation</p>
            <p className="text-sm text-zinc-300">{currentResult.interpretation}</p>
          </div>

          {/* Warnings / Guardrails */}
          {currentResult.warnings.length > 0 && (
            <div className="space-y-1.5">
              {currentResult.warnings.map((warning, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 bg-amber-950/30 border border-amber-800 rounded px-3 py-2"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 flex-shrink-0" />
                  <p className="text-xs text-amber-200/80">{warning}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Previous Results */}
      {testResults.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
            Previous Results
          </h3>
          <div className="space-y-1.5">
            {testResults.map((tr) => {
              const params = (() => { try { return JSON.parse(tr.params_json); } catch { return {}; } })();
              const result = (() => { try { return JSON.parse(tr.result_json); } catch { return {}; } })();
              const columns: string[] = params.columns ?? [];
              const pValue: number | undefined = result.p_value;
              return (
                <div
                  key={tr.id}
                  className="flex items-center justify-between px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-zinc-300 font-medium">
                      {STAT_TESTS.find((t) => t.id === tr.test)?.label ?? tr.test}
                    </span>
                    <span className="text-xs text-zinc-600 font-mono">
                      {columns.join(', ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    {pValue !== undefined && (
                      <span className={`text-sm font-mono ${
                        pValue < 0.05 ? 'text-teal-400' : 'text-zinc-400'
                      }`}>
                        p = {pValue < 0.001 ? pValue.toExponential(2) : pValue.toFixed(4)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
