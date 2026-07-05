import { useState, useMemo, useCallback, useEffect, useRef, type ReactNode } from 'react';
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
import {
  ENABLED_PRESETS,
  getPreset,
  presetFits,
  type DatasetShape,
} from '@/lib/figurePresets';
import {
  saveFile,
  saveText,
  dataUrlToBytes,
  getProjectDir,
  chooseProjectDir,
  setProjectDir,
  saveIntoDir,
  safeSegment,
  type SaveResult,
} from '@/lib/exportFile';

// ---------------------------------------------------------------------------
// Modes & styles
// ---------------------------------------------------------------------------

type PlotMode = 'concentration' | 'timecourse' | 'both';
type PlotStyle = 'box' | 'bar' | 'points' | 'line';
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

const LIGHT_CONFIG = {
  background: 'transparent',
  axis: {
    labelColor: '#52525b',
    titleColor: '#27272a',
    gridColor: '#e4e4e7',
    domainColor: '#d4d4d8',
    tickColor: '#d4d4d8',
    labelFontSize: 11,
    titleFontSize: 13,
  },
  legend: { labelColor: '#52525b', titleColor: '#27272a' },
  title: { color: '#18181b' },
  view: { stroke: 'transparent' },
};

// ---------------------------------------------------------------------------
// User-editable formatting
// ---------------------------------------------------------------------------

export interface PlotFormat {
  title: string; // '' → fall back to dataset name
  xTitle: string; // '' → projection default
  yTitle: string;
  titleFontSize: number;
  axisTitleFontSize: number;
  axisLabelFontSize: number;
  height: number;
  showPoints: boolean;
  showLegend: boolean;
  controlColor: string;
  experimentColor: string;
  paletteScheme: string; // categorical/sequential scheme for time & dose
}

export const DEFAULT_FORMAT: PlotFormat = {
  title: '',
  xTitle: '',
  yTitle: 'Value (A.U.)',
  titleFontSize: 15,
  axisTitleFontSize: 13,
  axisLabelFontSize: 11,
  height: 340,
  showPoints: true,
  showLegend: true,
  controlColor: '#a1a1aa',
  experimentColor: '#14b8a6',
  paletteScheme: 'viridis',
};

export const PALETTE_SCHEMES = [
  'viridis',
  'tableau10',
  'set2',
  'category10',
  'blues',
  'plasma',
  'magma',
];

/** Merge the base theme config with user font-size overrides. */
function makeConfig(theme: 'dark' | 'light', fmt: PlotFormat) {
  const base = theme === 'light' ? LIGHT_CONFIG : DARK_CONFIG;
  return {
    ...base,
    axis: {
      ...base.axis,
      labelFontSize: fmt.axisLabelFontSize,
      titleFontSize: fmt.axisTitleFontSize,
    },
  };
}

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

function colorScale(kind: Projection['colorKind'], order: string[], fmt: PlotFormat) {
  if (kind === 'role') {
    return {
      domain: ['control', 'experiment'],
      range: [fmt.controlColor, fmt.experimentColor],
    };
  }
  // time & dose use a scheme the user can pick.
  return { domain: order, scheme: fmt.paletteScheme };
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

interface BuildOpts {
  rows: LongRow[];
  mode: PlotMode;
  style: PlotStyle;
  datasetName: string;
  sig: SigInfo | null;
  chartW: number;
  format: PlotFormat;
  theme: 'dark' | 'light';
  /** User-defined x-axis category order (overrides the default sort). */
  xOrder?: string[] | null;
}

function buildSpec(opts: BuildOpts): object | null {
  const { rows, mode, style, datasetName, sig, chartW, format, theme, xOrder } = opts;
  if (rows.length === 0) return null;
  const p = project(rows, mode);
  const cfg = makeConfig(theme, format);
  const showPoints = format.showPoints;
  const starColor = theme === 'light' ? '#18181b' : '#fafafa';
  const ruleColor = theme === 'light' ? '#71717a' : '#d4d4d8';
  const pointStroke = theme === 'light' ? '#ffffff' : '#18181b';

  // Apply a user-defined x order when it covers the current categories.
  if (xOrder && xOrder.length > 0) {
    const present = new Set(p.xOrder);
    const reordered = xOrder.filter((c) => present.has(c));
    // append any categories the custom order forgot, so nothing disappears
    for (const c of p.xOrder) if (!reordered.includes(c)) reordered.push(c);
    if (reordered.length > 0) p.xOrder = reordered;
  }

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
          mark: { type: 'rule' as const, color: ruleColor, size: 1.2 },
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
              color: starColor,
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
    title: format.xTitle || p.xTitle,
    axis: { labelAngle: 0 },
  };
  const colorEnc = {
    field: 'color',
    type: 'nominal' as const,
    sort: p.colorOrder,
    title: p.colorTitle,
    scale: colorScale(p.colorKind, p.colorOrder, format),
    ...(format.showLegend ? {} : { legend: null }),
  };
  const yEnc = {
    field: 'value',
    type: 'quantitative' as const,
    title: format.yTitle,
    ...(annotate ? { scale: { domainMax: sig!.topY } } : {}),
  };
  const offset = { field: 'color', type: 'nominal' as const, sort: p.colorOrder };

  const title = format.title || datasetName;
  const base = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width: 'container',
    height: format.height,
    title: title
      ? { text: title, fontSize: format.titleFontSize, anchor: 'start' as const }
      : undefined,
    data: { values: p.values },
    config: cfg,
  };

  const errbarColor = theme === 'light' ? '#71717a' : '#e4e4e7';
  const pointLayer = {
    mark: {
      type: 'point' as const,
      filled: true,
      size: 34,
      opacity: 0.85,
      stroke: pointStroke,
      strokeWidth: 0.5,
    },
    encoding: { x: xEnc, y: yEnc, color: colorEnc, xOffset: offset },
  };

  if (style === 'box') {
    return {
      ...base,
      layer: [
        {
          mark: { type: 'boxplot', extent: 1.5, size: 26, opacity: 0.5, median: { color: starColor } },
          encoding: { x: xEnc, y: yEnc, color: colorEnc, xOffset: offset },
        },
        ...(showPoints ? [pointLayer] : []),
        ...annotationLayers,
      ],
    };
  }

  if (style === 'points') {
    // Dot plot: every replicate as a point, with a mean crossbar + SEM.
    return {
      ...base,
      layer: [
        {
          mark: { type: 'errorbar', extent: 'stderr', ticks: true, color: errbarColor },
          encoding: { x: xEnc, y: yEnc, xOffset: offset },
        },
        {
          mark: {
            type: 'point',
            filled: true,
            size: 40,
            opacity: 0.85,
            stroke: pointStroke,
            strokeWidth: 0.5,
          },
          encoding: { x: xEnc, y: yEnc, color: colorEnc, xOffset: offset },
        },
        {
          mark: { type: 'tick', thickness: 2, size: 22, color: starColor },
          encoding: { x: xEnc, y: { ...yEnc, aggregate: 'mean' }, xOffset: offset },
        },
        ...annotationLayers,
      ],
    };
  }

  if (style === 'line') {
    // Mean line per group with a shaded SEM band. Lines connect across the
    // x categories, so no xOffset here (that would split each group apart).
    return {
      ...base,
      layer: [
        {
          mark: { type: 'errorband', extent: 'stderr', opacity: 0.18, borders: false },
          encoding: { x: xEnc, y: yEnc, color: colorEnc },
        },
        {
          mark: { type: 'line', strokeWidth: 2.5, point: false },
          encoding: { x: xEnc, y: { ...yEnc, aggregate: 'mean' }, color: colorEnc },
        },
        ...(showPoints
          ? [
              {
                mark: {
                  type: 'point' as const,
                  filled: true,
                  size: 55,
                  stroke: pointStroke,
                  strokeWidth: 0.6,
                },
                encoding: { x: xEnc, y: { ...yEnc, aggregate: 'mean' }, color: colorEnc },
              },
            ]
          : []),
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
        mark: { type: 'errorbar', extent: 'stderr', ticks: true, color: errbarColor },
        encoding: { x: xEnc, y: yEnc, xOffset: offset },
      },
      ...(showPoints
        ? [
            {
              mark: {
                type: 'point' as const,
                filled: true,
                size: 30,
                opacity: 0.85,
                stroke: pointStroke,
                strokeWidth: 0.5,
              },
              encoding: { x: xEnc, y: yEnc, color: colorEnc, xOffset: offset },
            },
          ]
        : []),
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
// Format panel — titles, colours, fonts, size, and x-axis ordering
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600';

function FormatPanel({
  format,
  updateFormat,
  onReset,
  xOrder,
  onReorderX,
  xReordered,
}: {
  format: PlotFormat;
  updateFormat: <K extends keyof PlotFormat>(key: K, value: PlotFormat[K]) => void;
  onReset: () => void;
  xOrder: string[];
  onReorderX: (order: string[] | null) => void;
  xReordered: boolean;
}) {
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= xOrder.length) return;
    const next = [...xOrder];
    [next[i], next[j]] = [next[j], next[i]];
    onReorderX(next);
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-3 space-y-4">
      {/* Titles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Chart title">
          <input
            className={inputCls}
            value={format.title}
            onChange={(e) => updateFormat('title', e.target.value)}
            placeholder="(dataset name)"
          />
        </Field>
        <Field label="X-axis title">
          <input
            className={inputCls}
            value={format.xTitle}
            onChange={(e) => updateFormat('xTitle', e.target.value)}
            placeholder="(auto)"
          />
        </Field>
        <Field label="Y-axis title">
          <input
            className={inputCls}
            value={format.yTitle}
            onChange={(e) => updateFormat('yTitle', e.target.value)}
            placeholder="Value (A.U.)"
          />
        </Field>
      </div>

      {/* Colours + palette */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="Control colour">
          <input
            type="color"
            className="h-7 w-full bg-zinc-800 border border-zinc-700 rounded cursor-pointer"
            value={format.controlColor}
            onChange={(e) => updateFormat('controlColor', e.target.value)}
          />
        </Field>
        <Field label="Experiment colour">
          <input
            type="color"
            className="h-7 w-full bg-zinc-800 border border-zinc-700 rounded cursor-pointer"
            value={format.experimentColor}
            onChange={(e) => updateFormat('experimentColor', e.target.value)}
          />
        </Field>
        <Field label="Palette (time / dose)">
          <select
            className={inputCls}
            value={format.paletteScheme}
            onChange={(e) => updateFormat('paletteScheme', e.target.value)}
          >
            {PALETTE_SCHEMES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Height (px)">
          <input
            type="number"
            min={200}
            max={900}
            step={20}
            className={inputCls}
            value={format.height}
            onChange={(e) => updateFormat('height', Number(e.target.value) || DEFAULT_FORMAT.height)}
          />
        </Field>
      </div>

      {/* Fonts */}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Title font">
          <input
            type="number"
            min={8}
            max={40}
            className={inputCls}
            value={format.titleFontSize}
            onChange={(e) => updateFormat('titleFontSize', Number(e.target.value) || DEFAULT_FORMAT.titleFontSize)}
          />
        </Field>
        <Field label="Axis title font">
          <input
            type="number"
            min={8}
            max={30}
            className={inputCls}
            value={format.axisTitleFontSize}
            onChange={(e) =>
              updateFormat('axisTitleFontSize', Number(e.target.value) || DEFAULT_FORMAT.axisTitleFontSize)
            }
          />
        </Field>
        <Field label="Axis label font">
          <input
            type="number"
            min={7}
            max={24}
            className={inputCls}
            value={format.axisLabelFontSize}
            onChange={(e) =>
              updateFormat('axisLabelFontSize', Number(e.target.value) || DEFAULT_FORMAT.axisLabelFontSize)
            }
          />
        </Field>
      </div>

      {/* Toggles */}
      <div className="flex items-center gap-5">
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={format.showPoints}
            onChange={(e) => updateFormat('showPoints', e.target.checked)}
          />
          Show individual points
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={format.showLegend}
            onChange={(e) => updateFormat('showLegend', e.target.checked)}
          />
          Show legend
        </label>
      </div>

      {/* X-axis order */}
      {xOrder.length > 1 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
              X-axis order
            </span>
            {xReordered && (
              <button
                onClick={() => onReorderX(null)}
                className="text-[10px] text-zinc-500 hover:text-teal-400"
              >
                Reset order
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {xOrder.map((cat, i) => (
              <div
                key={cat}
                className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1"
              >
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="text-zinc-500 hover:text-teal-400 disabled:opacity-30 text-xs leading-none"
                  title="Move left"
                >
                  ◀
                </button>
                <span className="text-xs text-zinc-200 px-0.5 max-w-[9rem] truncate" title={cat}>
                  {cat}
                </span>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === xOrder.length - 1}
                  className="text-zinc-500 hover:text-teal-400 disabled:opacity-30 text-xs leading-none"
                  title="Move right"
                >
                  ▶
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button onClick={onReset} className="text-xs text-zinc-500 hover:text-red-400">
          Reset all formatting
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Toast text for a completed export, tailored to how/where it was saved. */
function exportedMsg(res: SaveResult): string {
  if (res.via === 'download') return 'Downloaded';
  // Native writes (Save-As or project folder) report an absolute path.
  if (res.via === 'tauri' && res.path?.includes('/')) return 'Saved to folder';
  return 'Exported';
}

export function PlotTab() {
  const datasets = useAppStore((s) => s.datasets);
  const activeDatasetId = useAppStore((s) => s.activeDatasetId);
  const activeExperimentId = useAppStore((s) => s.activeExperimentId);
  const figures = useAppStore((s) => s.figures);
  const loadFigures = useAppStore((s) => s.loadFigures);

  const [mode, setMode] = useState<PlotMode>('concentration');
  const [style, setStyle] = useState<PlotStyle>('box');
  const [presetId, setPresetId] = useState<string>('box-dots');
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [roleOverrides, setRoleOverrides] = useState<Record<string, Role>>({});
  const [dragged, setDragged] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [projectDir, setProjectDirState] = useState<string | undefined>(undefined);
  const [view, setView] = useState<any>(null);
  const [showSig, setShowSig] = useState(true);
  const [vegaError, setVegaError] = useState<string>('');
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(640);
  const theme = useAppStore((s) => s.theme);

  // Formatting + custom x-axis order
  const [format, setFormat] = useState<PlotFormat>(DEFAULT_FORMAT);
  const [showFormat, setShowFormat] = useState(false);
  const [customXOrder, setCustomXOrder] = useState<string[] | null>(null);
  const updateFormat = useCallback(
    <K extends keyof PlotFormat>(key: K, value: PlotFormat[K]) =>
      setFormat((f) => ({ ...f, [key]: value })),
    []
  );

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
    setCustomXOrder(null);
  }, [activeDatasetId, table.columns.length]);

  const hasTime = useMemo(
    () => conditions.some((c) => c.time !== null),
    [conditions]
  );

  // Shape summary used to grey out presets that don't fit this dataset.
  const datasetShape = useMemo<DatasetShape>(() => {
    const doseLabels = new Set(conditions.map((c) => c.doseLabel));
    return {
      groups: doseLabels.size,
      hasTime,
      hasDose: conditions.some((c) => c.dose > 0),
    };
  }, [conditions, hasTime]);

  // Applying a preset just sets the render mode/style/sig defaults; the user can
  // still fine-tune with the mode + style controls afterwards.
  const applyPreset = useCallback(
    (id: string) => {
      const p = getPreset(id);
      if (!p || !p.mode || !p.style) return;
      setPresetId(id);
      // 'timecourse' mode is meaningless without timepoints — fall back.
      setMode(p.mode !== 'concentration' && !hasTime ? 'concentration' : p.mode);
      setStyle(p.style);
      setShowSig(p.showSig ?? false);
    },
    [hasTime]
  );

  const longRows = useMemo(() => {
    const all = toLong(table, roleOverrides);
    return all.filter((r) => included.has(r.condition));
  }, [table, roleOverrides, included]);

  const sigInfo = useMemo(() => computeSig(longRows, mode), [longRows, mode]);

  // Default x-axis category order for the current data/mode, and the effective
  // order after applying any user drag-reordering.
  const defaultXOrder = useMemo(() => project(longRows, mode).xOrder, [longRows, mode]);
  const effectiveXOrder = useMemo(() => {
    if (!customXOrder) return defaultXOrder;
    const present = new Set(defaultXOrder);
    const merged = customXOrder.filter((c) => present.has(c));
    for (const c of defaultXOrder) if (!merged.includes(c)) merged.push(c);
    return merged;
  }, [customXOrder, defaultXOrder]);

  const spec = useMemo(
    () =>
      buildSpec({
        rows: longRows,
        mode,
        style,
        datasetName: activeDataset?.name ?? '',
        sig: showSig ? sigInfo : null,
        chartW: chartWidth,
        format,
        theme,
        xOrder: effectiveXOrder,
      }),
    [longRows, mode, style, activeDataset?.name, showSig, sigInfo, chartWidth, format, theme, effectiveXOrder]
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
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (err) {
      setSaveMsg('Save failed');
      console.error('Failed to save figure:', err);
    } finally {
      setSaving(false);
    }
  }, [activeExperimentId, activeDatasetId, spec, loadFigures]);

  const safeName = (activeDataset?.name || 'figure').replace(/[^\w.-]+/g, '_');

  const flash = useCallback((msg: string) => {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(''), 2500);
  }, []);

  // Load this experiment's bound project folder (persisted per-experiment).
  useEffect(() => {
    setProjectDirState(activeExperimentId ? getProjectDir(activeExperimentId) : undefined);
  }, [activeExperimentId]);

  const pickProjectDir = useCallback(async () => {
    if (!activeExperimentId) return;
    try {
      const dir = await chooseProjectDir(activeExperimentId);
      if (dir) {
        setProjectDirState(dir);
        flash('Project folder set');
      }
    } catch (err) {
      console.error('Choose folder failed:', err);
      flash(err instanceof Error ? err.message : 'Folder picker unavailable');
    }
  }, [activeExperimentId, flash]);

  const clearProjectDir = useCallback(() => {
    if (!activeExperimentId) return;
    setProjectDir(activeExperimentId, null);
    setProjectDirState(undefined);
    flash('Project folder cleared');
  }, [activeExperimentId, flash]);

  // Route one export: if a project folder is bound, write into
  // <root>/<dataset>/<filename> with no prompt; otherwise fall back to the
  // per-file Save-As / download path.
  const routeExport = useCallback(
    async (
      filename: string,
      data: Uint8Array | string,
      filters: { name: string; extensions: string[] }[]
    ): Promise<SaveResult> => {
      if (projectDir) {
        try {
          return await saveIntoDir(projectDir, safeSegment(activeDataset?.name || 'figure'), filename, data);
        } catch (err) {
          console.warn('Project-folder write failed, falling back to Save-As:', err);
        }
      }
      return typeof data === 'string'
        ? saveText(data, filename, filters)
        : saveFile(data, filename, filters);
    },
    [projectDir, activeDataset]
  );

  const exportPNG = useCallback(async () => {
    if (longRows.length === 0) return;
    try {
      // Always export PNGs on a white background with the light theme, so
      // figures are publication-ready regardless of the on-screen (dark) theme —
      // painting white behind dark-theme light text would hide it, so we
      // re-render with the light config instead.
      const exportSpec = buildSpec({
        rows: longRows,
        mode,
        style,
        datasetName: activeDataset?.name ?? '',
        sig: showSig ? sigInfo : null,
        chartW: chartWidth,
        format,
        theme: 'light',
        xOrder: effectiveXOrder,
      }) as any;
      if (!exportSpec) return;
      // buildSpec uses width:'container' (responsive), which renders a ZERO-width
      // (empty) canvas offscreen because the detached div has no measured width.
      // Give the export a concrete pixel width + fit autosize so it renders.
      const exportW = Math.max(chartWidth - 8, 320);
      exportSpec.width = exportW;
      exportSpec.autosize = { type: 'fit', contains: 'padding' };

      // 1) Render the light-theme chart to a (transparent) PNG offscreen.
      //    toImageURL is the one primitive that works reliably in this webview.
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-100000px';
      container.style.top = '0';
      container.style.width = `${exportW}px`;
      document.body.appendChild(container);
      let url: string;
      try {
        const embed = (await import('vega-embed')).default;
        const result = await embed(container, exportSpec, { actions: false, renderer: 'canvas' });
        url = await result.view.toImageURL('png', 2); // 2x for print resolution
        result.view.finalize();
      } finally {
        container.remove();
      }

      // 2) Flatten onto solid white in Rust (Vega exports transparent; webview
      //    canvas compositing is unreliable). Light theme => dark content stays
      //    visible on the white page.
      const transparent = await dataUrlToBytes(url);
      const core = await import('@tauri-apps/api/core');
      let bytes: Uint8Array = transparent;
      try {
        const flat = (await core.invoke('flatten_png_white', {
          png: Array.from(transparent),
        })) as number[];
        bytes = new Uint8Array(flat);
      } catch (e) {
        console.warn('White flatten unavailable, exporting as-is:', e);
      }

      const res = await routeExport(`${safeName}_${mode}_${style}.png`, bytes, [
        { name: 'PNG image', extensions: ['png'] },
      ]);
      if (res.saved) flash(exportedMsg(res));
    } catch (err) {
      console.error('PNG export failed:', err);
      flash(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [longRows, mode, style, activeDataset?.name, showSig, sigInfo, chartWidth, format, effectiveXOrder, safeName, flash, routeExport]);

  const exportSVG = useCallback(async () => {
    if (!view) return;
    try {
      const svg: string = await view.toSVG();
      const res = await routeExport(`${safeName}_${mode}_${style}.svg`, svg, [
        { name: 'SVG vector', extensions: ['svg'] },
      ]);
      if (res.saved) flash(exportedMsg(res));
    } catch (err) {
      console.error('SVG export failed:', err);
      flash('Export failed');
    }
  }, [view, safeName, mode, style, flash, routeExport]);

  const exportSpec = useCallback(async () => {
    if (!spec) return;
    const res = await routeExport(`${safeName}_spec.vl.json`, JSON.stringify(spec, null, 2), [
      { name: 'Vega-Lite spec', extensions: ['json'] },
    ]);
    if (res.saved) flash(exportedMsg(res));
  }, [spec, safeName, flash, routeExport]);

  const exportCSV = useCallback(async () => {
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
    const res = await routeExport(`${safeName}_plotted_data.csv`, lines.join('\n'), [
      { name: 'CSV data', extensions: ['csv'] },
    ]);
    if (res.saved) flash(exportedMsg(res));
  }, [longRows, safeName, flash, routeExport]);

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
          {/* Preset picker */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
              Preset
            </span>
            <select
              value={presetId}
              onChange={(e) => applyPreset(e.target.value)}
              title="Start from a literature-shaped figure template"
              className="text-xs bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-200 hover:border-zinc-700 focus:border-teal-600 focus:outline-none max-w-[15rem]"
            >
              {ENABLED_PRESETS.map((p) => {
                const fits = presetFits(p, datasetShape);
                return (
                  <option key={p.id} value={p.id} disabled={!fits}>
                    {p.label}
                    {fits ? '' : ' — n/a for this data'}
                  </option>
                );
              })}
            </select>
            {getPreset(presetId)?.description && (
              <span className="text-[11px] text-zinc-500 truncate hidden lg:inline">
                {getPreset(presetId)!.description}
              </span>
            )}
          </div>

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
              {(
                [
                  ['box', 'Box + points'],
                  ['bar', 'Bar + SEM'],
                  ['points', 'Dot plot'],
                  ['line', 'Line'],
                ] as [PlotStyle, string][]
              ).map(([s, label]) => (
                <button
                  key={s}
                  onClick={() => setStyle(s)}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    style === s ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {label}
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
              Sig. bars
            </button>
            {mode === 'concentration' && showSig && sigInfo.reason && (
              <span className="text-[11px] text-zinc-500">{sigInfo.reason}</span>
            )}

            <button
              onClick={() => setShowFormat((v) => !v)}
              title="Titles, colours, fonts, size, axis order"
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ml-auto ${
                showFormat
                  ? 'border-teal-600/50 bg-teal-600/15 text-teal-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Format
            </button>
          </div>

          {/* Format panel */}
          {showFormat && (
            <FormatPanel
              format={format}
              updateFormat={updateFormat}
              onReset={() => {
                setFormat(DEFAULT_FORMAT);
                setCustomXOrder(null);
              }}
              xOrder={effectiveXOrder}
              onReorderX={setCustomXOrder}
              xReordered={customXOrder !== null}
            />
          )}

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
                      // react-vega v8 exposes the Vega view via onEmbed(result),
                      // NOT onNewView — capturing result.view is what enables the
                      // PNG/SVG export buttons.
                      onEmbed={(result: any) => setView(result?.view ?? null)}
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

          {/* Project folder — one-time destination for all exports */}
          <div className="mt-3 flex items-center gap-2 text-xs">
            <span className="text-zinc-500">Export to:</span>
            {projectDir ? (
              <>
                <span
                  className="font-mono text-teal-400 truncate max-w-[280px]"
                  title={projectDir}
                >
                  {projectDir}
                  <span className="text-zinc-600">/{safeSegment(activeDataset?.name || 'figure')}/</span>
                </span>
                <button
                  onClick={pickProjectDir}
                  className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded"
                >
                  Change
                </button>
                <button
                  onClick={clearProjectDir}
                  className="px-2 py-0.5 text-zinc-500 hover:text-zinc-300"
                >
                  Clear
                </button>
              </>
            ) : (
              <>
                <span className="text-zinc-600">no project folder — exports prompt for a location</span>
                <button
                  onClick={pickProjectDir}
                  className="px-2 py-0.5 bg-teal-700 hover:bg-teal-600 text-white rounded"
                >
                  Choose project folder…
                </button>
              </>
            )}
          </div>

          {/* Save */}
          <div className="mt-2 flex items-center gap-3">
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
              onClick={exportSVG}
              disabled={!view || !spec}
              className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 border border-zinc-700 rounded transition-colors font-medium"
              title="Export the chart as a scalable SVG (best for publications)"
            >
              Export SVG
            </button>
            <button
              onClick={exportCSV}
              disabled={longRows.length === 0}
              className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 border border-zinc-700 rounded transition-colors font-medium"
              title="Export the plotted data as tidy CSV"
            >
              Export CSV
            </button>
            <button
              onClick={exportSpec}
              disabled={!spec}
              className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 border border-zinc-700 rounded transition-colors font-medium"
              title="Export the Vega-Lite spec (reproducible figure recipe)"
            >
              Export spec
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
