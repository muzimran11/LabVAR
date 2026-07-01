import { useState, useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { saveTestResult } from '@/lib/invoke';
import { parseTable, inferCondition } from '@/lib/labdata';
import {
  oneWayAnova,
  tukeyHSD,
  tTestUnpaired,
  tTestPaired,
  pearson,
  summarize,
  formatP,
  stars,
  type Group,
  type AnovaResult,
  type TukeyPair,
  type TTestResult,
  type CorrelationResult,
  type GroupSummary,
} from '@/lib/stats';

interface StatTest {
  id: string;
  label: string;
  description: string;
  category: 'parametric' | 'correlation';
  minColumns: number;
  maxColumns: number;
}

const STAT_TESTS: StatTest[] = [
  { id: 'anova_tukey', label: 'One-way ANOVA + Tukey', description: 'Compare 3+ groups with post-hoc pairwise Tukey HSD', category: 'parametric', minColumns: 2, maxColumns: 20 },
  { id: 'ttest_unpaired', label: 'Unpaired t-test', description: "Welch's t-test between two independent groups", category: 'parametric', minColumns: 2, maxColumns: 2 },
  { id: 'ttest_paired', label: 'Paired t-test', description: 'Compare two paired/matched columns', category: 'parametric', minColumns: 2, maxColumns: 2 },
  { id: 'correlation', label: 'Correlation', description: 'Pearson correlation between two variables', category: 'correlation', minColumns: 2, maxColumns: 2 },
];

type Role = 'control' | 'experiment';

type Result =
  | { kind: 'anova'; anova: AnovaResult; tukey: TukeyPair[]; controls: string[] }
  | { kind: 'ttest'; res: TTestResult; groups: GroupSummary[] }
  | { kind: 'correlation'; res: CorrelationResult; cols: string[] };

const num = (n: number, d = 4) => (isNaN(n) ? '' : n.toFixed(d));

/** Serialize a stats result into a shareable, multi-section CSV. */
function statsToCsv(result: Result): string {
  const L: string[] = [];
  if (result.kind === 'anova') {
    const a = result.anova;
    L.push('One-way ANOVA');
    L.push('Source,SS,df,MS,F,p');
    L.push(`Between groups,${num(a.ssBetween, 3)},${a.dfBetween},${num(a.msBetween, 3)},${num(a.F, 4)},${num(a.pValue, 6)}`);
    L.push(`Within groups,${num(a.ssWithin, 3)},${a.dfWithin},${num(a.msWithin, 3)},,`);
    L.push(`Total,${num(a.ssBetween + a.ssWithin, 3)},${a.dfBetween + a.dfWithin},,,`);
    L.push('');
    const ctrl = new Set(result.controls);
    L.push('Group,Role,n,mean,SD,SEM');
    for (const g of a.groups)
      L.push(`${csvCell(g.name)},${ctrl.has(g.name) ? 'control' : 'experiment'},${g.n},${num(g.mean, 4)},${num(g.sd, 4)},${num(g.sem, 4)}`);
    L.push('');
    L.push('Tukey HSD comparison A,Comparison B,Mean diff,CI low,CI high,q,p (adj),Significant');
    for (const t of result.tukey) {
      L.push(
        `${csvCell(t.a)},${csvCell(t.b)},${num(t.meanDiff, 4)},${num(t.ciLow, 4)},${num(t.ciHigh, 4)},${num(t.q, 4)},${num(t.pValue, 6)},${t.significant ? 'yes' : 'no'}`
      );
    }
  } else if (result.kind === 'ttest') {
    const r = result.res;
    L.push(`${r.test} t-test`);
    L.push('t,df,p,Mean diff');
    L.push(`${num(r.t, 4)},${num(r.df, 2)},${num(r.pValue, 6)},${num(r.meanDiff, 4)}`);
    L.push('');
    L.push('Group,n,mean,SD,SEM');
    for (const g of result.groups) L.push(`${csvCell(g.name)},${g.n},${num(g.mean, 4)},${num(g.sd, 4)},${num(g.sem, 4)}`);
  } else {
    const r = result.res;
    L.push('Pearson correlation');
    L.push('Variable A,Variable B,r,r^2,p,n');
    L.push(`${csvCell(result.cols[0])},${csvCell(result.cols[1])},${num(r.r, 4)},${num(r.r * r.r, 4)},${num(r.pValue, 6)},${r.n}`);
  }
  return L.join('\n');
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function StatsTab() {
  const datasets = useAppStore((s) => s.datasets);
  const activeDatasetId = useAppStore((s) => s.activeDatasetId);
  const activeExperimentId = useAppStore((s) => s.activeExperimentId);
  const testResults = useAppStore((s) => s.testResults);
  const loadTestResults = useAppStore((s) => s.loadTestResults);

  const [selectedTest, setSelectedTest] = useState<string | null>('anova_tukey');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

  // Role of a column: user override, else inferred (Control-named columns).
  const roleOf = (col: string): Role => roles[col] ?? (inferCondition(col).isControl ? 'control' : 'experiment');
  const setRole = (col: string, role: Role) => {
    setRoles((prev) => ({ ...prev, [col]: role }));
    setResult(null);
  };

  const activeDataset = datasets.find((d) => d.id === activeDatasetId);
  const parsed = useMemo(() => {
    if (!activeDataset?.csv_data) return { columns: [], rows: [] };
    return parseTable(activeDataset.csv_data);
  }, [activeDataset?.csv_data]);

  const numericColumns = useMemo(
    () => parsed.columns.filter((col) => parsed.rows.some((row) => typeof row[col] === 'number')),
    [parsed]
  );

  const testDef = STAT_TESTS.find((t) => t.id === selectedTest);

  const columnValues = (col: string): number[] =>
    parsed.rows.map((r) => r[col]).filter((v): v is number => typeof v === 'number' && !isNaN(v));

  const toggleColumn = (col: string) => {
    setResult(null);
    setError('');
    setSelectedColumns((prev) =>
      prev.includes(col)
        ? prev.filter((c) => c !== col)
        : testDef && prev.length >= testDef.maxColumns
        ? testDef.maxColumns === 2
          ? [prev[1], col] // sliding window for 2-column tests
          : prev
        : [...prev, col]
    );
  };

  const handleRun = async () => {
    if (!activeExperimentId || !activeDatasetId || !testDef) return;
    if (selectedColumns.length < testDef.minColumns) return;
    setRunning(true);
    setError('');
    try {
      const groups: Group[] = selectedColumns.map((c) => ({ name: c, values: columnValues(c) }));
      let res: Result;
      let statistic = 0;
      let pValue = 1;

      if (testDef.id === 'anova_tukey') {
        // Order controls first so the ANOVA table and Tukey read control → doses.
        const ordered = [...groups].sort((a, b) => {
          const ra = roleOf(a.name) === 'control' ? 0 : 1;
          const rb = roleOf(b.name) === 'control' ? 0 : 1;
          return ra - rb;
        });
        const controls = ordered.filter((g) => roleOf(g.name) === 'control').map((g) => g.name);
        const anova = oneWayAnova(ordered);
        const tukey = tukeyHSD(ordered);
        res = { kind: 'anova', anova, tukey, controls };
        statistic = anova.F;
        pValue = anova.pValue;
      } else if (testDef.id === 'ttest_unpaired') {
        const r = tTestUnpaired(groups[0].values, groups[1].values, true);
        res = { kind: 'ttest', res: r, groups: groups.map(summarize) };
        statistic = r.t;
        pValue = r.pValue;
      } else if (testDef.id === 'ttest_paired') {
        if (groups[0].values.length !== groups[1].values.length) {
          throw new Error('Paired t-test needs equal-length columns (same number of replicates).');
        }
        const r = tTestPaired(groups[0].values, groups[1].values);
        res = { kind: 'ttest', res: r, groups: groups.map(summarize) };
        statistic = r.t;
        pValue = r.pValue;
      } else {
        const r = pearson(groups[0].values, groups[1].values);
        res = { kind: 'correlation', res: r, cols: selectedColumns };
        statistic = r.r;
        pValue = r.pValue;
      }

      setResult(res);

      const paramsJson = JSON.stringify({ columns: selectedColumns });
      const resultJson = JSON.stringify({ statistic, p_value: pValue, detail: res });
      await saveTestResult(activeExperimentId, activeDatasetId, testDef.id, paramsJson, resultJson, 'exact-ts');
      await loadTestResults(activeExperimentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setRunning(false);
    }
  };

  const exportStatsCsv = () => {
    if (!result) return;
    const csv = statsToCsv(result);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const safe = (activeDataset?.name || 'stats').replace(/[^\w.-]+/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safe}_${result.kind}_stats.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!activeDataset) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-zinc-400 mb-1">No dataset selected</p>
        <p className="text-xs text-zinc-600">Import a spreadsheet in the Data tab first</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-teal-500 flex-shrink-0" />
        <div>
          <p className="text-sm text-zinc-300">Exact statistics, computed on device</p>
          <p className="text-xs text-zinc-500">
            Each column is treated as one group. Results match SciPy — no network, no Python.
          </p>
        </div>
      </div>

      {/* Test selector */}
      <div>
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Select Test</h3>
        <div className="grid grid-cols-4 gap-2">
          {STAT_TESTS.map((test) => (
            <button
              key={test.id}
              onClick={() => {
                setSelectedTest(test.id);
                setSelectedColumns([]);
                setResult(null);
                setError('');
              }}
              className={`text-left p-3 rounded-lg border transition-colors ${
                selectedTest === test.id
                  ? 'bg-teal-600/15 border-teal-600/50 text-teal-400'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800/70 hover:border-zinc-700'
              }`}
            >
              <div className="text-sm font-medium">{test.label}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">{test.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Column selection */}
      {testDef && (
        <div>
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            {testDef.maxColumns === 2 ? 'Pick two columns' : 'Pick group columns'} ({selectedColumns.length}
            {testDef.maxColumns === 2 ? '/2' : ''})
          </h3>
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

          {/* Control / Experiment grouping (ANOVA only) */}
          {testDef.id === 'anova_tukey' && selectedColumns.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Assign groups
              </h4>
              <div className="space-y-1.5">
                {selectedColumns.map((col) => {
                  const role = roleOf(col);
                  return (
                    <div key={col} className="flex items-center justify-between gap-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5">
                      <span className="text-xs font-mono text-zinc-300 truncate" title={col}>{col}</span>
                      <div className="flex gap-1 flex-shrink-0">
                        {(['control', 'experiment'] as Role[]).map((r) => (
                          <button
                            key={r}
                            onClick={() => setRole(col, r)}
                            className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                              role === r
                                ? r === 'control'
                                  ? 'bg-zinc-600 text-white'
                                  : 'bg-teal-600 text-white'
                                : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            {r === 'control' ? 'Control' : 'Experiment'}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleRun}
              disabled={running || selectedColumns.length < testDef.minColumns}
              className="px-4 py-2 text-sm bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded transition-colors font-medium"
            >
              {running ? 'Running…' : 'Run Test'}
            </button>
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="flex justify-end -mb-3">
          <button
            onClick={exportStatsCsv}
            className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded transition-colors font-medium"
            title="Download the full stats table as CSV"
          >
            Export CSV
          </button>
        </div>
      )}
      {result && result.kind === 'anova' && <AnovaView anova={result.anova} tukey={result.tukey} controls={result.controls} />}
      {result && result.kind === 'ttest' && <TTestView res={result.res} groups={result.groups} />}
      {result && result.kind === 'correlation' && <CorrelationView res={result.res} cols={result.cols} />}

      {/* Previous results */}
      {testResults.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Previous Results</h3>
          <div className="space-y-1.5">
            {testResults.map((tr) => {
              const params = (() => { try { return JSON.parse(tr.params_json); } catch { return {}; } })();
              const res = (() => { try { return JSON.parse(tr.result_json); } catch { return {}; } })();
              const columns: string[] = params.columns ?? [];
              const pValue: number | undefined = res.p_value;
              return (
                <div key={tr.id} className="flex items-center justify-between px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm text-zinc-300 font-medium flex-shrink-0">
                      {STAT_TESTS.find((t) => t.id === tr.test)?.label ?? tr.test}
                    </span>
                    <span className="text-xs text-zinc-600 font-mono truncate">{columns.join(', ')}</span>
                  </div>
                  {pValue !== undefined && (
                    <span className={`text-sm font-mono flex-shrink-0 ${pValue < 0.05 ? 'text-teal-400' : 'text-zinc-400'}`}>
                      p = {formatP(pValue)} {stars(pValue)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ------- Result views -------

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-zinc-800/50 rounded-lg p-3">
      <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg font-mono ${highlight ? 'text-teal-400' : 'text-zinc-200'}`}>{value}</p>
    </div>
  );
}

function AnovaView({ anova, tukey, controls }: { anova: AnovaResult; tukey: TukeyPair[]; controls: string[] }) {
  const sig = anova.pValue < 0.05;
  const controlSet = new Set(controls);
  const [posthoc, setPosthoc] = useState<'all' | 'vsControl'>(controls.length > 0 ? 'vsControl' : 'all');
  const isCtrl = (name: string) => controlSet.has(name);
  const shownTukey =
    posthoc === 'vsControl' && controls.length > 0
      ? tukey.filter((t) => isCtrl(t.a) !== isCtrl(t.b)) // exactly one side is a control
      : tukey;
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">One-way ANOVA</h3>
        <span className={`text-xs px-2 py-0.5 rounded ${sig ? 'bg-teal-900/40 text-teal-300' : 'bg-zinc-800 text-zinc-400'}`}>
          {sig ? 'Significant difference among groups' : 'No significant difference'}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="F" value={anova.F.toFixed(4)} />
        <StatCard label="p-value" value={`${formatP(anova.pValue)} ${stars(anova.pValue)}`} highlight={sig} />
        <StatCard label="df (between, within)" value={`${anova.dfBetween}, ${anova.dfWithin}`} />
        <StatCard label="Groups (k)" value={String(anova.k)} />
      </div>

      {/* ANOVA table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-500 border-b border-zinc-800">
              <th className="text-left py-1.5 pr-4 font-medium">Source</th>
              <th className="text-right py-1.5 px-3 font-medium">SS</th>
              <th className="text-right py-1.5 px-3 font-medium">df</th>
              <th className="text-right py-1.5 px-3 font-medium">MS</th>
              <th className="text-right py-1.5 pl-3 font-medium">F</th>
            </tr>
          </thead>
          <tbody className="font-mono text-zinc-300">
            <tr className="border-b border-zinc-800/50">
              <td className="py-1.5 pr-4 font-sans text-zinc-400">Between groups</td>
              <td className="text-right px-3">{anova.ssBetween.toFixed(3)}</td>
              <td className="text-right px-3">{anova.dfBetween}</td>
              <td className="text-right px-3">{anova.msBetween.toFixed(3)}</td>
              <td className="text-right pl-3">{anova.F.toFixed(3)}</td>
            </tr>
            <tr className="border-b border-zinc-800/50">
              <td className="py-1.5 pr-4 font-sans text-zinc-400">Within groups</td>
              <td className="text-right px-3">{anova.ssWithin.toFixed(3)}</td>
              <td className="text-right px-3">{anova.dfWithin}</td>
              <td className="text-right px-3">{anova.msWithin.toFixed(3)}</td>
              <td className="text-right pl-3">—</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-4 font-sans text-zinc-400">Total</td>
              <td className="text-right px-3">{(anova.ssBetween + anova.ssWithin).toFixed(3)}</td>
              <td className="text-right px-3">{anova.dfBetween + anova.dfWithin}</td>
              <td className="text-right px-3">—</td>
              <td className="text-right pl-3">—</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Tukey post-hoc */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-zinc-400">Tukey HSD — pairwise comparisons</h4>
          {controls.length > 0 && (
            <div className="flex items-center gap-1 bg-zinc-800 rounded-md p-0.5">
              {(['vsControl', 'all'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPosthoc(m)}
                  className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                    posthoc === m ? 'bg-teal-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {m === 'vsControl' ? 'vs Control' : 'All pairs'}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-800">
                <th className="text-left py-1.5 pr-4 font-medium">Comparison</th>
                <th className="text-right py-1.5 px-3 font-medium">Mean diff</th>
                <th className="text-right py-1.5 px-3 font-medium">95% CI</th>
                <th className="text-right py-1.5 px-3 font-medium">q</th>
                <th className="text-right py-1.5 px-3 font-medium">p (adj)</th>
                <th className="text-center py-1.5 pl-3 font-medium">Sig</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {shownTukey.map((t) => (
                <tr key={`${t.a}|${t.b}`} className="border-b border-zinc-800/50">
                  <td className="py-1.5 pr-4 truncate max-w-[220px]" title={`${t.a} vs ${t.b}`}>
                    {isCtrl(t.a) && <span className="text-zinc-500">◆ </span>}
                    {t.a} <span className="text-zinc-600">vs</span> {t.b}
                    {isCtrl(t.b) && <span className="text-zinc-500"> ◆</span>}
                  </td>
                  <td className="text-right px-3 font-mono">{t.meanDiff.toFixed(3)}</td>
                  <td className="text-right px-3 font-mono text-zinc-500">
                    [{t.ciLow.toFixed(2)}, {t.ciHigh.toFixed(2)}]
                  </td>
                  <td className="text-right px-3 font-mono">{t.q.toFixed(3)}</td>
                  <td className={`text-right px-3 font-mono ${t.significant ? 'text-teal-400' : 'text-zinc-400'}`}>
                    {formatP(t.pValue)}
                  </td>
                  <td className={`text-center pl-3 font-mono ${t.significant ? 'text-teal-400' : 'text-zinc-600'}`}>
                    {stars(t.pValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-zinc-600 mt-2">
          Significance: **** p&lt;0.0001 · *** p&lt;0.001 · ** p&lt;0.01 · * p&lt;0.05 · ns not significant.
          p-values are family-wise adjusted (studentized range).
        </p>
      </div>
    </div>
  );
}

function TTestView({ res, groups }: { res: TTestResult; groups: GroupSummary[] }) {
  const sig = res.pValue < 0.05;
  const label = res.test === 'paired' ? 'Paired t-test' : "Welch's unpaired t-test";
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
      <h3 className="text-sm font-semibold text-zinc-200">{label}</h3>
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="t" value={res.t.toFixed(4)} />
        <StatCard label="df" value={res.df.toFixed(res.test === 'welch' ? 2 : 0)} />
        <StatCard label="p-value" value={`${formatP(res.pValue)} ${stars(res.pValue)}`} highlight={sig} />
        <StatCard label="Mean diff" value={res.meanDiff.toFixed(4)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {groups.map((g) => (
          <div key={g.name} className="bg-zinc-800/50 rounded-lg p-3">
            <p className="text-xs text-zinc-300 font-medium truncate" title={g.name}>{g.name}</p>
            <p className="text-[11px] text-zinc-500 font-mono mt-1">
              n={g.n} · mean={g.mean.toFixed(3)} · SD={g.sd.toFixed(3)} · SEM={g.sem.toFixed(3)}
            </p>
          </div>
        ))}
      </div>
      <p className="text-sm text-zinc-400">
        {sig
          ? `The two groups differ significantly (p = ${formatP(res.pValue)}).`
          : `No significant difference between the two groups (p = ${formatP(res.pValue)}).`}
      </p>
    </div>
  );
}

function CorrelationView({ res, cols }: { res: CorrelationResult; cols: string[] }) {
  const sig = res.pValue < 0.05;
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
      <h3 className="text-sm font-semibold text-zinc-200">Pearson correlation</h3>
      <p className="text-xs text-zinc-500 font-mono">{cols[0]} vs {cols[1]}</p>
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="r" value={res.r.toFixed(4)} />
        <StatCard label="p-value" value={`${formatP(res.pValue)} ${stars(res.pValue)}`} highlight={sig} />
        <StatCard label="n" value={String(res.n)} />
      </div>
      <p className="text-sm text-zinc-400">
        r² = {(res.r * res.r).toFixed(4)} — {(res.r * res.r * 100).toFixed(1)}% of variance shared.
      </p>
    </div>
  );
}
