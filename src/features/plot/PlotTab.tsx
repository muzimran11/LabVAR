import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { saveFigure } from '@/lib/invoke';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { VegaEmbed } from 'react-vega';
import type { TopLevelSpec as VisualizationSpec } from 'vega-lite';

// ------- Types -------

interface Encodings {
  x: string | null;
  y: string | null;
  color: string | null;
  size: string | null;
  facet: string | null;
}

type TemplateId =
  | 'bar_scatter_error'
  | 'box_violin'
  | 'dose_response'
  | 'paired_before_after'
  | 'volcano'
  | 'time_series';

const TEMPLATES: { id: TemplateId; label: string; description: string }[] = [
  { id: 'bar_scatter_error', label: 'Bar + Scatter', description: 'With error bars' },
  { id: 'box_violin', label: 'Box / Violin', description: 'Distribution plots' },
  { id: 'dose_response', label: 'Dose-Response', description: 'Sigmoidal curve' },
  { id: 'paired_before_after', label: 'Before / After', description: 'Paired comparison' },
  { id: 'volcano', label: 'Volcano Plot', description: 'Fold change vs p-value' },
  { id: 'time_series', label: 'Time Series', description: 'Temporal data' },
];

// ------- CSV parsing -------

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

// ------- Vega-Lite spec builders -------

function inferType(rows: Record<string, unknown>[], col: string): 'quantitative' | 'nominal' | 'ordinal' | 'temporal' {
  const sample = rows.slice(0, 20).map((r) => r[col]);
  if (sample.every((v) => typeof v === 'number')) return 'quantitative';
  if (sample.some((v) => typeof v === 'string' && !isNaN(Date.parse(v as string)))) return 'temporal';
  const unique = new Set(sample).size;
  if (unique <= 10) return 'nominal';
  return 'nominal';
}

function buildSpec(
  template: TemplateId | null,
  encodings: Encodings,
  rows: Record<string, unknown>[]
): VisualizationSpec | null {
  if (!encodings.x && !encodings.y) return null;

  const xType = encodings.x ? inferType(rows, encodings.x) : 'nominal';
  const yType = encodings.y ? inferType(rows, encodings.y) : 'quantitative';

  const base: Record<string, unknown> = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width: 'container',
    height: 300,
    data: { values: rows },
    config: {
      background: 'transparent',
      axis: {
        labelColor: '#a1a1aa',
        titleColor: '#d4d4d8',
        gridColor: '#27272a',
        domainColor: '#3f3f46',
        tickColor: '#3f3f46',
      },
      legend: { labelColor: '#a1a1aa', titleColor: '#d4d4d8' },
      title: { color: '#fafafa' },
      view: { stroke: '#27272a' },
    },
  };

  const enc: Record<string, unknown> = {};
  if (encodings.x) enc.x = { field: encodings.x, type: xType };
  if (encodings.y) enc.y = { field: encodings.y, type: yType };
  if (encodings.color) enc.color = { field: encodings.color, type: inferType(rows, encodings.color) };
  if (encodings.size) enc.size = { field: encodings.size, type: 'quantitative' };

  const facetEnc = encodings.facet
    ? { facet: { field: encodings.facet, type: inferType(rows, encodings.facet), columns: 3 } }
    : {};

  switch (template) {
    case 'bar_scatter_error':
      return {
        ...base,
        ...facetEnc,
        layer: [
          {
            mark: { type: 'bar', opacity: 0.7, color: '#14b8a6' },
            encoding: {
              x: enc.x ? { ...enc.x } : undefined,
              y: encodings.y ? { field: encodings.y, type: 'quantitative', aggregate: 'mean' } : undefined,
              color: enc.color ? { ...enc.color } : undefined,
            },
          },
          {
            mark: { type: 'circle', size: 40, opacity: 0.8 },
            encoding: { ...enc },
          },
          ...(encodings.y
            ? [
                {
                  mark: { type: 'errorbar' as const, extent: 'stderr' as const },
                  encoding: {
                    x: enc.x ? { ...enc.x } : undefined,
                    y: { field: encodings.y, type: 'quantitative' as const },
                  },
                },
              ]
            : []),
        ],
      } as VisualizationSpec;

    case 'box_violin':
      return {
        ...base,
        ...facetEnc,
        layer: [
          {
            mark: { type: 'boxplot', extent: 1.5, size: 30 },
            encoding: { ...enc },
          },
        ],
      } as VisualizationSpec;

    case 'dose_response':
      return {
        ...base,
        ...facetEnc,
        layer: [
          {
            mark: { type: 'point', filled: true, size: 60 },
            encoding: {
              ...enc,
              x: encodings.x ? { field: encodings.x, type: 'quantitative', scale: { type: 'log' } } : undefined,
            },
          },
          {
            mark: { type: 'line', interpolate: 'monotone' },
            encoding: {
              ...enc,
              x: encodings.x ? { field: encodings.x, type: 'quantitative', scale: { type: 'log' } } : undefined,
              y: encodings.y ? { field: encodings.y, type: 'quantitative', aggregate: 'mean' } : undefined,
              color: enc.color ? { ...enc.color } : undefined,
            },
          },
        ],
      } as VisualizationSpec;

    case 'paired_before_after':
      return {
        ...base,
        ...facetEnc,
        layer: [
          {
            mark: { type: 'line', opacity: 0.4 },
            encoding: {
              ...enc,
              detail: encodings.color ? { field: encodings.color } : undefined,
            },
          },
          {
            mark: { type: 'point', filled: true, size: 80 },
            encoding: { ...enc },
          },
        ],
      } as VisualizationSpec;

    case 'volcano':
      return {
        ...base,
        ...facetEnc,
        mark: { type: 'circle', opacity: 0.7 },
        encoding: {
          x: encodings.x ? { field: encodings.x, type: 'quantitative', title: 'log2(Fold Change)' } : undefined,
          y: encodings.y ? { field: encodings.y, type: 'quantitative', title: '-log10(p-value)' } : undefined,
          color: enc.color ? { ...enc.color } : { value: '#14b8a6' },
          size: enc.size ? { ...enc.size } : { value: 40 },
        },
      } as VisualizationSpec;

    case 'time_series':
      return {
        ...base,
        ...facetEnc,
        layer: [
          {
            mark: { type: 'line', interpolate: 'monotone' },
            encoding: {
              ...enc,
              x: encodings.x ? { field: encodings.x, type: 'temporal' } : undefined,
            },
          },
          {
            mark: { type: 'point', filled: true, size: 40 },
            encoding: {
              ...enc,
              x: encodings.x ? { field: encodings.x, type: 'temporal' } : undefined,
            },
          },
        ],
      } as VisualizationSpec;

    default:
      // Auto scatter/bar based on types
      if (xType === 'nominal' || xType === 'ordinal') {
        return {
          ...base,
          ...facetEnc,
          mark: { type: 'bar', color: '#14b8a6' },
          encoding: enc,
        } as VisualizationSpec;
      }
      return {
        ...base,
        ...facetEnc,
        mark: { type: 'circle', size: 50, color: '#14b8a6' },
        encoding: enc,
      } as VisualizationSpec;
  }
}

// ------- Draggable Column Chip -------

function DraggableColumn({ name }: { name: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `col-${name}`,
    data: { column: name },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`px-2.5 py-1 text-xs font-mono rounded cursor-grab select-none transition-colors ${
        isDragging
          ? 'bg-teal-600/40 text-teal-300 opacity-50'
          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'
      }`}
    >
      {name}
    </div>
  );
}

// ------- Droppable Encoding Shelf -------

function EncodingShelf({
  channel,
  label,
  value,
  onClear,
}: {
  channel: string;
  label: string;
  value: string | null;
  onClear: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `shelf-${channel}` });

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center justify-between px-3 py-2 rounded border transition-colors ${
        isOver
          ? 'border-teal-500 bg-teal-500/10'
          : 'border-zinc-700 border-dashed bg-zinc-900'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase text-zinc-500 font-semibold w-10">{label}</span>
        {value ? (
          <span className="text-xs font-mono text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded">
            {value}
          </span>
        ) : (
          <span className="text-xs text-zinc-600 italic">Drop column here</span>
        )}
      </div>
      {value && (
        <button
          onClick={onClear}
          className="text-zinc-600 hover:text-zinc-400 text-xs ml-2"
        >
          &times;
        </button>
      )}
    </div>
  );
}

// ------- Main PlotTab Component -------

export function PlotTab() {
  const datasets = useAppStore((s) => s.datasets);
  const activeDatasetId = useAppStore((s) => s.activeDatasetId);
  const activeExperimentId = useAppStore((s) => s.activeExperimentId);
  const figures = useAppStore((s) => s.figures);
  const loadFigures = useAppStore((s) => s.loadFigures);

  const [encodings, setEncodings] = useState<Encodings>({
    x: null,
    y: null,
    color: null,
    size: null,
    facet: null,
  });
  const [activeTemplate, setActiveTemplate] = useState<TemplateId | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeDataset = datasets.find((d) => d.id === activeDatasetId);
  const parsed = useMemo(() => {
    if (!activeDataset?.csv_data) return { columns: [], rows: [] };
    return parseCSV(activeDataset.csv_data);
  }, [activeDataset?.csv_data]);

  const spec = useMemo(
    () => buildSpec(activeTemplate, encodings, parsed.rows),
    [activeTemplate, encodings, parsed.rows]
  );

  const handleDragStart = (event: DragStartEvent) => {
    setDraggedColumn(event.active.data.current?.column ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggedColumn(null);
    const { over, active } = event;
    if (!over) return;

    const channel = (over.id as string).replace('shelf-', '') as keyof Encodings;
    const column = active.data.current?.column as string;
    if (channel && column) {
      setEncodings((prev) => ({ ...prev, [channel]: column }));
    }
  };

  const clearChannel = (channel: keyof Encodings) => {
    setEncodings((prev) => ({ ...prev, [channel]: null }));
  };

  const handleSave = useCallback(async () => {
    if (!activeExperimentId || !activeDatasetId || !spec) return;
    setSaving(true);
    try {
      await saveFigure(activeExperimentId, activeDatasetId, JSON.stringify(spec));
      await loadFigures(activeExperimentId);
    } catch (err) {
      console.error('Failed to save figure:', err);
    } finally {
      setSaving(false);
    }
  }, [activeExperimentId, activeDatasetId, spec, loadFigures]);

  if (!activeDataset) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-zinc-400 mb-1">No dataset selected</p>
        <p className="text-xs text-zinc-600">Import a CSV in the Data tab first</p>
      </div>
    );
  }

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 h-full min-h-[500px]">
        {/* Left: Columns */}
        <div className="w-40 flex-shrink-0">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            Columns
          </h3>
          <div className="space-y-1">
            {parsed.columns.map((col) => (
              <DraggableColumn key={col} name={col} />
            ))}
          </div>
        </div>

        {/* Center: Chart */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex-1 flex items-center justify-center min-h-[320px]">
            {spec ? (
              <div className="w-full">
                <VegaEmbed
                  spec={spec as any}
                  options={{ actions: false }}
                />
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm text-zinc-500">Drag columns to encoding shelves</p>
                <p className="text-xs text-zinc-600 mt-1">Then pick a template below</p>
              </div>
            )}
          </div>

          {/* Templates */}
          <div className="mt-3">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              Templates
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTemplate(activeTemplate === t.id ? null : t.id)}
                  className={`px-2.5 py-1.5 text-xs rounded transition-colors ${
                    activeTemplate === t.id
                      ? 'bg-teal-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 border border-zinc-700'
                  }`}
                  title={t.description}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Save / Export */}
          {spec && (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !activeDatasetId}
                className="px-3 py-1.5 text-sm bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded transition-colors font-medium"
              >
                {saving ? 'Saving...' : 'Save Figure'}
              </button>
            </div>
          )}

          {/* Saved Figures */}
          {figures.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Saved Figures
              </h3>
              <div className="space-y-1">
                {figures.map((fig) => (
                  <div
                    key={fig.id}
                    className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-sm"
                  >
                    <span className="text-zinc-300 font-mono text-xs truncate">{fig.id.slice(0, 8)}</span>
                    <span className="text-xs text-zinc-600">
                      dataset: {fig.dataset_id.slice(0, 8)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Encoding Shelves */}
        <div className="w-48 flex-shrink-0">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            Encodings
          </h3>
          <div className="space-y-2">
            <EncodingShelf channel="x" label="X" value={encodings.x} onClear={() => clearChannel('x')} />
            <EncodingShelf channel="y" label="Y" value={encodings.y} onClear={() => clearChannel('y')} />
            <EncodingShelf channel="color" label="Color" value={encodings.color} onClear={() => clearChannel('color')} />
            <EncodingShelf channel="size" label="Size" value={encodings.size} onClear={() => clearChannel('size')} />
            <EncodingShelf channel="facet" label="Facet" value={encodings.facet} onClear={() => clearChannel('facet')} />
          </div>
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {draggedColumn && (
          <div className="px-2.5 py-1 text-xs font-mono rounded bg-teal-600 text-white shadow-lg">
            {draggedColumn}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
