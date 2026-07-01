import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { saveFigure, getDataset } from '@/lib/invoke';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { VegaEmbed } from 'react-vega';
import {
  parseTable,
  toLong,
  analyzeConditions,
  orderedDoseLabels,
  orderedTimeLabels,
  type LongRow,
  type Condition,
} from '@/lib/labdata';
import { tukeyHSD, stars, type Group } from '@/lib/stats';

// ---------------------------------------------------------------------------
// Modes & styles
// ---------------------------------------------------------------------------

type PlotMode = 'concentration' | 'timecourse' | 'both';
type PlotStyle = 'box' | 'bar';
type Role = 'control' | 'experiment';

const MODES: { id: PlotMode; label: string; hint: string }[] = [
  { id: 'concentration', label: 'Concentration', hint: 'Control vs experiment across doses' },
  { id: 'timecourse', label: 'Time course', hint: 'Values over time' },
  { id: 'both', label: 'Both', hint: 'Time on X, colored by dose' },
];

// ---------------------------------------------------------------------------
// Vega-Lite projection + spec building
// ---------------------------------------------------------------------------

const DARK_CONFIG = {
  background: 'transparent',
  axis: {
    labelColor: '#a1a1aa',
    titleColor: '#d4d4d8',
    gridColor: '#27272a',
    domainColor: '#3f3f46',
    tickColor: '#3f3f46',
    labelFontSize: 11,
    titleFontSize: 13,
  },
  legend: { labelColor: '#a1a1aa', titleColor: '#d4d4d8' },
  title: { color: '#fafafa' },
  view: { stroke: 'transparent' },
};

interface Projection {
  values: { x: string; color: string; value: number }[];
  xOrder: string[];
  colorOrder: string[];
  xTitle: string;
  colorTitle: string;
  colorKind: 'role' | 'time' | 'dose';
}

/** Turn filtered long rows into {x, color, value} tuples for the chosen mode. */
function project(rows: LongRow[], mode: PlotMode): Projection {
  const times = orderedTimeLabels(rows).filter((t) => t !== '—');
  const hasTime = times.length > 0;

  // Time modes need timepoints; fall back to concentration if none exist.
  const effectiveMode = mode !== 'concentration' && !hasTime ? 'concentration' : mode;

  if (effectiveMode === 'concentration') {
    const multiTime = times.length > 1;
    const values = rows.map((r) => ({
      x: r.doseLabel,
      color: multiTime ? (r.timeLabel ?? '—') : r.role,
      value: r.value,
    }));
    return {
      values,
      xOrder: orderedDoseLabels(rows),
      colorOrder: multiTime ? times : ['control', 'experiment'],
      xTitle: 'Concentration',
      colorTitle: multiTime ? 'Time' : 'Group',
      colorKind: multiTime ? 'time' : 'role',
    };
  }

  // timecourse & both: X = time, color = dose
  const values = rows.map((r) => ({
    x: r.timeLabel ?? '—',
    color: r.doseLabel,
    value: r.value,
  }));
  return {
    values,
    xOrder: orderedTimeLabels(rows),
    colorOrder: orderedDoseLabels(rows),
    xTitle: 'Time',
    colorTitle: 'Concentration',
    colorKind: 'dose',
  };
}

function colorScale(kind: Projection['colorKind'], order: string[]) {
  if (kind === 'role') {
    return { domain: ['control', 'experiment'], range: ['#a1a1aa', '#14b8a6'] };
  }
  if (kind === 'time') {
    return { domain: order, scheme: 'set2' };
  }
  // dose — sequential teal→yellow reads as "more drug"
  return { domain: order, scheme: 'viridis' };
}

// ---------------------------------------------------------------------------
// Significance brackets (Tukey HSD) — concentration mode only
// ---------------------------------------------------------------------------

interface Bracket {
  a: string;
  b: string;
  y: number;
  star: string;
}
interface SigInfo {
  enabled: boolean;
  reason: string;
  brackets: Bracket[];
  topY: number;
}

/**
 * Compute GraphPad-style significance brackets from a Tukey HSD across the
 * dose groups. Only valid when a single timepoint is on screen (otherwise
 * grouping by dose would pool timepoints). Brackets are stacked so they don't
 * collide.
 */
function computeSig(rows: LongRow[], mode: PlotMode): SigInfo {
  const empty: SigInfo = { enabled: false, reason: '', brackets: [], topY: 0 };
  if (mode !== 'concentration') {
    return { ...empty, reason: 'Significance bars apply to Concentration mode' };
  }
  if (rows.length === 0) return empty;

  const times = new Set(rows.map((r) => r.timeLabel).filter(Boolean));
  if (times.size > 1) {
    return { ...empty, reason: 'Show one timepoint to draw significance bars' };
  }

  const order = orderedDoseLabels(rows);
  if (order.length < 2) return { ...empty, reason: 'Need at least two doses' };

  // Group plotted values by dose label.
  const byDose = new Map<string, number[]>();
  for (const r of rows) {
    if (!byDose.has(r.doseLabel)) byDose.set(r.doseLabel, []);
    byDose.get(r.doseLabel)!.push(r.value);
  }
  const groups: Group[] = order
    .map((d) => ({ name: d, values: byDose.get(d) ?? [] }))
    .filter((g) => g.values.length >= 2);
  if (groups.length < 2) return { ...empty, reason: 'Need ≥2 replicates per group' };

  const pairs = tukeyHSD(groups).filter((t) => t.significant);
  if (pairs.length === 0) {
    return { enabled: true, reason: 'No significant pairs', brackets: [], topY: 0 };
  }

  const idx = (label: string) => order.indexOf(label);
  const vals = rows.map((r) => r.value);
  const maxVal = Math.max(...vals);
  const minVal = Math.min(...vals);
  const range = maxVal - minVal || Math.abs(maxVal) || 1;
  const base = maxVal + range * 0.06;
  const step = range * 0.1;

  // Greedy vertical stacking: narrowest span first, lowest free level.
  const sorted = [...pairs].sort(
    (p1, p2) => Math.abs(idx(p1.a) - idx(p1.b)) - Math.abs(idx(p2.a) - idx(p2.b))
  );
  const levels: [number, number][][] = [];
  const brackets: Bracket[] = [];
  for (const p of sorted) {
    const lo = Math.min(idx(p.a), idx(p.b));
    const hi = Math.max(idx(p.a), idx(p.b));
    let level = 0;
    while (
      levels[level] &&
      levels[level].some(([l, h]) => lo <= h && l <= hi)
    ) {
      level++;
    }
    if (!levels[level]) levels[level] = [];
    levels[level].push([lo, hi]);
    brackets.push({ a: p.a, b: p.b, y: base + level * step, star: stars(p.pValue) });
  }
  const topY = base + levels.length * step + range * 0.04;
  return { enabled: true, reason: '', brackets, topY };
}

function buildSpec(
  rows: LongRow[],
  mode: PlotMode,
  style: PlotStyle,
  title: string,
  sig: SigInfo | null,
  chartW: number
): object | null {
  if (rows.length === 0) return null;
  const p = project(rows, mode);
  const annotate = sig && sig.enabled && sig.brackets.length > 0;

  // Vega-Lite drops `x2` on text marks, so a star can't span two categories
  // natively. We draw the bracket line with a rule (x/x2 works there) and place
  // each star with a pixel dx offset to the midpoint between its two categories.
  const nCats = Math.max(p.xOrder.length, 1);
  const innerW = Math.max(chartW - 60, 120); // approx plotting width minus y-axis
  const step = innerW / nCats;
  const annotationLayers = annotate
    ? [
        {
          data: { values: sig!.brackets },
          mark: { type: 'rule' as const, color: '#d4d4d8', size: 1.2 },
          encoding: {
            x: { field: 'a', type: 'nominal' as const, sort: p.xOrder },
            x2: { field: 'b' },
            y: { field: 'y', type: 'quantitative' as const },
          },
        },
        ...sig!.brackets.map((br) => {
          const i = p.xOrder.indexOf(br.a);
          const j = p.xOrder.indexOf(br.b);
          const dx = ((j - i) / 2) * step;
          return {
            data: { values: [br] },
            mark: {
              type: 'text' as const,
              color: '#fafafa',
              dx,
              dy: -6,
              fontSize: 13,
              fontWeight: 'bold' as const,
              align: 'center' as const,
              baseline: 'bottom' as const,
            },
            encoding: {
              x: { field: 'a', type: 'nominal' as const, sort: p.xOrder },
              y: { field: 'y', type: 'quantitative' as const },
              text: { field: 'star', type: 'nominal' as const },
            },
          };
        }),
      ]
    : [];

  const xEnc = {
    field: 'x',
    type: 'nominal' as const,
    sort: p.xOrder,
    title: p.xTitle,
    axis: { labelAngle: 0 },
  };
  const colorEnc = {
    field: 'color',
    type: 'nominal' as const,
    sort: p.colorOrder,
    title: p.colorTitle,
    scale: colorScale(p.colorKind, p.colorOrder),
  };
  const yEnc = {
    field: 'value',
    type: 'quantitative' as const,
    title: 'Value (A.U.)',
    ...(annotate ? { scale: { domainMax: sig!.topY } } : {}),
  };
  const offset = { field: 'color', type: 'nominal' as const, sort: p.colorOrder };

  const base = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width: 'container',
    height: 340,
    title: title ? { text: title, fontSize: 15, anchor: 'start' as const } : undefined,
    data: { values: p.values },
    config: DARK_CONFIG,
  };

  if (style === 'box') {
    return {
      ...base,
      layer: [
        {
          mark: { type: 'boxplot', extent: 1.5, size: 26, opacity: 0.5, median: { color: '#fafafa' } },
          encoding: { x: xEnc, y: yEnc, color: colorEnc, xOffset: offset },
        },
        {
          mark: { type: 'point', filled: true, size: 34, opacity: 0.85, stroke: '#18181b', strokeWidth: 0.5 },
          encoding: { x: xEnc, y: yEnc, color: colorEnc, xOffset: offset },
        },
        ...annotationLayers,
      ],
    };
  }

  // bar + SEM + points
  return {
    ...base,
    layer: [
      {
        mark: { type: 'bar', opacity: 0.55, cornerRadiusEnd: 2 },
        encoding: {
          x: xEnc,
          y: { ...yEnc, aggregate: 'mean' },
          color: colorEnc,
          xOffset: offset,
        },
      },
      {
        mark: { type: 'errorbar', extent: 'stderr', ticks: true, color: '#e4e4e7' },
        encoding: { x: xEnc, y: yEnc, xOffset: offset },
      },
      {
        mark: { type: 'point', filled: true, size: 30, opacity: 0.85, stroke: '#18181b', strokeWidth: 0.5 },
        encoding: { x: xEnc, y: yEnc, color: colorEnc, xOffset: offset },
      },
      ...annotationLayers,
    ],
  };
}

// ---------------------------------------------------------------------------
// Draggable condition chip
// ---------------------------------------------------------------------------

function ConditionChip({
  cond,
  included,
  onToggle,
}: {
  cond: Condition;
  included: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `cond-${cond.name}`,
    data: { condition: cond.name },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onToggle}
      title={included ? 'Click to remove from plot' : 'Click or drag to add to plot'}
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded cursor-grab select-none transition-colors border ${
        isDragging
          ? 'opacity-40 border-teal-500'
          : included
          ? 'bg-teal-600/15 border-teal-600/50 hover:border-teal-500'
          : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700'
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          cond.isControl ? 'bg-zinc-400' : 'bg-teal-400'
        }`}
      />
      <div className="min-w-0">
        <div className="text-xs font-medium text-zinc-200 truncate">{cond.doseLabel}</div>
        <div className="text-[10px] text-zinc-500 truncate">
          {cond.timeLabel ? `${cond.timeLabel} · ` : ''}
          {cond.treatment}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function PlotTab() {
  const datasets = useAppStore((s) => s.datasets);
  const activeDatasetId = useAppStore((s) => s.activeDatasetId);
  const activeExperimentId = useAppStore((s) => s.activeExperimentId);
  const figures = useAppStore((s) => s.figures);
  const loadFigures = useAppStore((s) => s.loadFigures);

  const [mode, setMode] = useState<PlotMode>('concentration');
  const [style, setStyle] = useState<PlotStyle>('box');
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [roleOverrides, setRoleOverrides] = useState<Record<string, Role>>({});
  const [dragged, setDragged] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [view, setView] = useState<any>(null);
  const [showSig, setShowSig] = useState(true);
  const [vegaError, setVegaError] = useState<string>('');
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(640);

  // Measure the chart container so Vega gets a real pixel width (width:'container'
  // resolves to 0 in some webviews and silently renders nothing).
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 40) setChartWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const activeDataset = datasets.find((d) => d.id === activeDatasetId);

  // Ensure csv_data is loaded.
  useEffect(() => {
    if (activeDatasetId && activeDataset && !activeDataset.csv_data) {
      getDataset(activeDatasetId)
        .then((full) => {
          if (full?.csv_data) {
            useAppStore.setState((s) => ({
              datasets: s.datasets.map((d) =>
                d.id === activeDatasetId ? { ...d, csv_data: full.csv_data } : d
              ),
            }));
          }
        })
        .catch(console.error);
    }
  }, [activeDatasetId, activeDataset?.csv_data]);

  const table = useMemo(
    () => (activeDataset?.csv_data ? parseTable(activeDataset.csv_data) : { columns: [], rows: [] }),
    [activeDataset?.csv_data]
  );

  const conditions = useMemo(() => analyzeConditions(table.columns), [table.columns]);

  // Reset selection when the dataset changes: include everything by default.
  useEffect(() => {
    setIncluded(new Set(table.columns));
    setRoleOverrides({});
  }, [activeDatasetId, table.columns.length]);

  const hasTime = useMemo(
    () => conditions.some((c) => c.time !== null),
    [conditions]
  );

  const longRows = useMemo(() => {
    const all = toLong(table, roleOverrides);
    return all.filter((r) => included.has(r.condition));
  }, [table, roleOverrides, included]);

  const sigInfo = useMemo(() => computeSig(longRows, mode), [longRows, mode]);

  const spec = useMemo(
    () => buildSpec(longRows, mode, style, activeDataset?.name ?? '', showSig ? sigInfo : null, chartWidth),
    [longRows, mode, style, activeDataset?.name, showSig, sigInfo, chartWidth]
  );

  // Clear any stale render error when the spec changes.
  useEffect(() => setVegaError(''), [spec]);

  // --- interactions ---
  const toggleInclude = useCallback((name: string) => {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const setRole = useCallback((name: string, role: Role) => {
    setRoleOverrides((prev) => ({ ...prev, [name]: role }));
  }, []);

  const handleDragStart = (e: DragStartEvent) => setDragged(e.active.data.current?.condition ?? null);
  const handleDragEnd = (e: DragEndEvent) => {
    setDragged(null);
    const name = e.active.data.current?.condition as string | undefined;
    if (e.over?.id === 'included-zone' && name) {
      setIncluded((prev) => new Set(prev).add(name));
    }
  };

  const { isOver, setNodeRef: dropRef } = useDroppable({ id: 'included-zone' });

  const handleSave = useCallback(async () => {
    if (!activeExperimentId || !activeDatasetId || !spec) return;
    setSaving(true);
    setSaveMsg('');
    try {
      await saveFigure(activeExperimentId, activeDatasetId, JSON.stringify(spec));
      await loadFigures(activeExperimentId);
      setSaveMsg('Saved ✓');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (err) {
      setSaveMsg('Save failed');
      console.error('Failed to save figure:', err);
    } finally {
      setSaving(false);
    }
  }, [activeExperimentId, activeDatasetId, spec, loadFigures]);

  const safeName = (activeDataset?.name || 'figure').replace(/[^\w.-]+/g, '_');

  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const exportPNG = useCallback(async () => {
    if (!view) return;
    try {
      const url = await view.toImageURL('png', 2); // 2x for print resolution
      triggerDownload(url, `${safeName}_${mode}_${style}.png`);
    } catch (err) {
      console.error('PNG export failed:', err);
    }
  }, [view, safeName, mode, style]);

  const exportCSV = useCallback(() => {
    if (longRows.length === 0) return;
    const header = ['condition', 'treatment', 'dose', 'unit', 'time', 'replicate', 'value', 'role'];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(',')];
    for (const r of longRows) {
      lines.push(
        [r.condition, r.treatment, r.dose, r.unit ?? '', r.time ?? '', r.replicate, r.value, r.role]
          .map(esc)
          .join(',')
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `${safeName}_plotted_data.csv`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [longRows, safeName]);

  if (!activeDataset) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-zinc-400 mb-1">No dataset selected</p>
        <p className="text-xs text-zinc-600">Import a spreadsheet in the Data tab first</p>
      </div>
    );
  }

  const includedConds = conditions.filter((c) => included.has(c.name));

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 h-full min-h-[540px]">
        {/* Left: condition palette */}
        <div className="w-52 flex-shrink-0 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Conditions</h3>
            <div className="flex gap-1">
              <button
                onClick={() => setIncluded(new Set(table.columns))}
                className="text-[10px] text-zinc-400 hover:text-teal-400"
              >
                All
              </button>
              <span className="text-zinc-700">·</span>
              <button
                onClick={() => setIncluded(new Set())}
                className="text-[10px] text-zinc-400 hover:text-teal-400"
              >
                None
              </button>
            </div>
          </div>
          <div className="space-y-1 overflow-y-auto pr-1">
            {conditions.map((c) => (
              <ConditionChip
                key={c.name}
                cond={c}
                included={included.has(c.name)}
                onToggle={() => toggleInclude(c.name)}
              />
            ))}
          </div>
        </div>

        {/* Center: controls + chart */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Mode + style bar */}
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
              {MODES.map((m) => {
                const disabled = m.id !== 'concentration' && !hasTime;
                return (
                  <button
                    key={m.id}
                    disabled={disabled}
                    onClick={() => setMode(m.id)}
                    title={disabled ? 'No timepoints detected in this dataset' : m.hint}
                    className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                      mode === m.id
                        ? 'bg-teal-600 text-white'
                        : disabled
                        ? 'text-zinc-700 cursor-not-allowed'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
              {(['box', 'bar'] as PlotStyle[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStyle(s)}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    style === s ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {s === 'box' ? 'Box + points' : 'Bar + SEM'}
                </button>
              ))}
            </div>

            {/* Significance bars toggle */}
            <button
              onClick={() => setShowSig((v) => !v)}
              disabled={mode !== 'concentration'}
              title={
                mode !== 'concentration'
                  ? 'Significance bars apply to Concentration mode'
                  : sigInfo.reason || 'Tukey HSD significance brackets'
              }
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                mode !== 'concentration'
                  ? 'border-zinc-800 text-zinc-700 cursor-not-allowed'
                  : showSig
                  ? 'border-teal-600/50 bg-teal-600/15 text-teal-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              ✳ Sig. bars
            </button>
            {mode === 'concentration' && showSig && sigInfo.reason && (
              <span className="text-[11px] text-zinc-500">{sigInfo.reason}</span>
            )}
          </div>

          {/* Chart */}
          <div
            ref={chartRef}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex-1 flex items-center justify-center min-h-[360px]"
          >
            {spec ? (
              <div className="w-full">
                {(() => {
                  const Embed = VegaEmbed as any;
                  const renderSpec = { ...(spec as any), width: chartWidth - 8, autosize: { type: 'fit', contains: 'padding' } };
                  return (
                    <Embed
                      spec={renderSpec}
                      options={{ actions: false, renderer: 'canvas' }}
                      onNewView={(v: any) => setView(v)}
                      onError={(e: any) => setVegaError(e?.message ?? String(e))}
                    />
                  );
                })()}
                {vegaError && (
                  <p className="text-xs text-red-400 mt-2 font-mono">Chart error: {vegaError}</p>
                )}
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm text-zinc-500">No conditions selected</p>
                <p className="text-xs text-zinc-600 mt-1">
                  Click or drag conditions from the left to plot them
                </p>
              </div>
            )}
          </div>

          {/* Save */}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !spec}
              className="px-3 py-1.5 text-sm bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded transition-colors font-medium"
            >
              {saving ? 'Saving…' : 'Save Figure'}
            </button>
            <div className="h-4 w-px bg-zinc-800" />
            <button
              onClick={exportPNG}
              disabled={!view || !spec}
              className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 border border-zinc-700 rounded transition-colors font-medium"
              title="Download the chart as a 2× PNG"
            >
              Export PNG
            </button>
            <button
              onClick={exportCSV}
              disabled={longRows.length === 0}
              className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 border border-zinc-700 rounded transition-colors font-medium"
              title="Download the plotted data as tidy CSV"
            >
              Export CSV
            </button>
            {saveMsg && <span className="text-xs text-teal-400">{saveMsg}</span>}
            {figures.length > 0 && (
              <span className="text-xs text-zinc-600">{figures.length} saved figure(s)</span>
            )}
          </div>
        </div>

        {/* Right: included set + roles */}
        <div className="w-56 flex-shrink-0 flex flex-col">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            In the plot ({includedConds.length})
          </h3>
          <div
            ref={dropRef}
            className={`flex-1 rounded-lg border p-2 space-y-1.5 overflow-y-auto transition-colors ${
              isOver ? 'border-teal-500 bg-teal-500/5' : 'border-dashed border-zinc-800 bg-zinc-950'
            }`}
          >
            {includedConds.length === 0 ? (
              <p className="text-xs text-zinc-600 italic text-center py-6">Drag conditions here</p>
            ) : (
              includedConds.map((c) => {
                const role: Role = roleOverrides[c.name] ?? (c.isControl ? 'control' : 'experiment');
                return (
                  <div
                    key={c.name}
                    className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs text-zinc-300 truncate" title={c.name}>
                        {c.doseLabel}
                        {c.timeLabel ? ` · ${c.timeLabel}` : ''}
                      </span>
                      <button
                        onClick={() => toggleInclude(c.name)}
                        className="text-zinc-600 hover:text-zinc-300 text-xs flex-shrink-0"
                        title="Remove"
                      >
                        &times;
                      </button>
                    </div>
                    <div className="flex gap-1 mt-1">
                      {(['control', 'experiment'] as Role[]).map((r) => (
                        <button
                          key={r}
                          onClick={() => setRole(c.name, r)}
                          className={`flex-1 text-[10px] py-0.5 rounded transition-colors ${
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
              })
            )}
          </div>
        </div>
      </div>

      <DragOverlay>
        {dragged && (
          <div className="px-2.5 py-1.5 text-xs rounded bg-teal-600 text-white shadow-lg">
            {dragged}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
