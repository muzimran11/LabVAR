import { useEffect, useState } from 'react';
import { Workspace } from '@/components/Workspace';
import { Button } from '@/components/Button';
import { useAppStore } from '@/store/useAppStore';
import { useCollection, newId, type BaseRecord, COLLECTIONS } from '@/lib/localStore';
import { saveText } from '@/lib/exportFile';

// ---- data model ------------------------------------------------------------

type ColType = 'text' | 'number' | 'date';

interface AssayColumn {
  id: string;
  name: string;
  type: ColType;
}

interface Assay extends BaseRecord {
  name: string;
  description: string;
  columns: AssayColumn[];
  rows: Record<string, string>[]; // keyed by column id
}

type TemplateId = 'lifespan' | 'timecourse' | 'blank';

const TEMPLATES: { id: TemplateId; label: string; desc: string; columns: Omit<AssayColumn, 'id'>[] }[] = [
  {
    id: 'lifespan',
    label: 'Lifespan / survival',
    desc: 'Daily scoring per group: alive, dead, censored.',
    columns: [
      { name: 'Group', type: 'text' },
      { name: 'Day', type: 'number' },
      { name: 'Alive', type: 'number' },
      { name: 'Dead', type: 'number' },
      { name: 'Censored', type: 'number' },
      { name: 'Notes', type: 'text' },
    ],
  },
  {
    id: 'timecourse',
    label: 'Timecourse measurement',
    desc: 'A measured value per group over time, with replicate.',
    columns: [
      { name: 'Group', type: 'text' },
      { name: 'Timepoint', type: 'text' },
      { name: 'Replicate', type: 'number' },
      { name: 'Value', type: 'number' },
      { name: 'Notes', type: 'text' },
    ],
  },
  {
    id: 'blank',
    label: 'Blank table',
    desc: 'Start from scratch with two columns.',
    columns: [
      { name: 'Column 1', type: 'text' },
      { name: 'Column 2', type: 'number' },
    ],
  },
];

function withIds(cols: Omit<AssayColumn, 'id'>[]): AssayColumn[] {
  return cols.map((c) => ({ ...c, id: newId() }));
}

// ---- CSV / JSON serialisation ---------------------------------------------

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function assayToCsv(a: Assay): string {
  const header = a.columns.map((c) => csvEscape(c.name)).join(',');
  const body = a.rows
    .map((r) => a.columns.map((c) => csvEscape(r[c.id] ?? '')).join(','))
    .join('\n');
  return header + '\n' + body;
}

function assayToJson(a: Assay): string {
  // Human-friendly JSON: rows keyed by column *name*, numbers coerced.
  const rows = a.rows.map((r) => {
    const o: Record<string, string | number> = {};
    for (const c of a.columns) {
      const raw = r[c.id] ?? '';
      o[c.name] = c.type === 'number' && raw !== '' && !isNaN(Number(raw)) ? Number(raw) : raw;
    }
    return o;
  });
  return JSON.stringify(
    { name: a.name, description: a.description, columns: a.columns.map((c) => ({ name: c.name, type: c.type })), rows },
    null,
    2
  );
}

// ---- component -------------------------------------------------------------

export function AssayWorkspace() {
  const { items, create, update, remove, replaceAll } = useCollection<Assay>(COLLECTIONS.assays);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const flashSaved = () => {
    setSavedMsg('Saved');
    setTimeout(() => setSavedMsg(null), 1800);
  };
  const deepLink = useAppStore((s) => s.deepLink);
  const setDeepLink = useAppStore((s) => s.setDeepLink);

  // Focus a specific assay when arriving via a notebook double-click.
  useEffect(() => {
    if (deepLink?.view === 'assays') {
      setSelectedId(deepLink.itemId);
      setDeepLink(null);
    }
  }, [deepLink, setDeepLink]);

  const selected = items.find((a) => a.id === selectedId) ?? items[0] ?? null;

  const startCreate = (tpl: TemplateId, name: string) => {
    const t = TEMPLATES.find((x) => x.id === tpl)!;
    const rec = create({
      name: name || t.label,
      description: '',
      columns: withIds(t.columns),
      rows: [],
    } as Omit<Assay, keyof BaseRecord>);
    setSelectedId(rec.id);
    setCreating(false);
  };

  const patch = (a: Assay, p: Partial<Assay>) => update(a.id, p);

  const addRow = (a: Assay) => {
    const blank: Record<string, string> = {};
    a.columns.forEach((c) => (blank[c.id] = ''));
    patch(a, { rows: [...a.rows, blank] });
  };

  const addColumn = (a: Assay) => {
    const col: AssayColumn = { id: newId(), name: `Column ${a.columns.length + 1}`, type: 'text' };
    patch(a, {
      columns: [...a.columns, col],
      rows: a.rows.map((r) => ({ ...r, [col.id]: '' })),
    });
  };

  const exportFile = async (a: Assay, fmt: 'csv' | 'json') => {
    const safe = a.name.replace(/[^\w.-]+/g, '_') || 'assay';
    if (fmt === 'csv') await saveText(assayToCsv(a), `${safe}.csv`, [{ name: 'CSV', extensions: ['csv'] }]);
    else await saveText(assayToJson(a), `${safe}.json`, [{ name: 'JSON', extensions: ['json'] }]);
  };

  return (
    <Workspace
      title="Assay Tracking"
      subtitle="A lightweight, editable data log for assays (lifespan, timecourses, anything). Export to CSV or JSON."
      actions={
        <>
          {savedMsg && <span className="text-xs text-teal-400">{savedMsg}</span>}
          <span className="text-[11px] text-zinc-600">Autosaves</span>
          {selected && (
            <Button variant="secondary" onClick={flashSaved}>
              Save
            </Button>
          )}
          {items.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => {
                if (confirm('Delete ALL assays? This cannot be undone.')) {
                  replaceAll([]);
                  setSelectedId(null);
                }
              }}
            >
              Clear all
            </Button>
          )}
          <Button onClick={() => setCreating(true)}>+ New assay</Button>
        </>
      }
    >
      {creating && <CreateAssay onCancel={() => setCreating(false)} onCreate={startCreate} />}

      {items.length === 0 && !creating ? (
        <EmptyState onNew={() => setCreating(true)} />
      ) : (
        <div className="flex gap-4">
          {/* assay list */}
          <div className="w-52 flex-shrink-0 space-y-1">
            {items.map((a) => (
              <div key={a.id} className="group relative">
                <button
                  onClick={() => setSelectedId(a.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors pr-7 ${
                    selected?.id === a.id
                      ? 'bg-teal-500/15 text-teal-400 font-medium'
                      : 'text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {a.name}
                  <span className="block text-[10px] text-zinc-500 font-mono">{a.rows.length} rows</span>
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete assay "${a.name}"? This cannot be undone.`)) {
                      remove(a.id);
                      if (selectedId === a.id) setSelectedId(null);
                    }
                  }}
                  className="absolute right-1.5 top-2 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                  title="Delete assay"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {/* editor */}
          {selected && (
            <AssayEditor
              key={selected.id}
              assay={selected}
              onPatch={(p) => patch(selected, p)}
              onAddRow={() => addRow(selected)}
              onAddColumn={() => addColumn(selected)}
              onExport={(fmt) => exportFile(selected, fmt)}
            />
          )}
        </div>
      )}
    </Workspace>
  );
}

// ---- subcomponents ---------------------------------------------------------

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-700 p-10 text-center">
      <p className="text-sm text-zinc-300 font-medium">No assays yet</p>
      <p className="text-xs text-zinc-500 mt-1 mb-4">
        Track recordings like a lifespan assay (n= per group, scored daily) without wrestling Excel.
      </p>
      <Button onClick={onNew}>+ New assay</Button>
    </div>
  );
}

function CreateAssay({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (tpl: TemplateId, name: string) => void;
}) {
  const [name, setName] = useState('');
  const [tpl, setTpl] = useState<TemplateId>('lifespan');
  return (
    <div className="mb-5 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Assay name (e.g. daf-16 lifespan, 20°C)"
        className="w-full px-3 py-2 mb-3 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:border-teal-600"
      />
      <div className="grid grid-cols-3 gap-2 mb-3">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => setTpl(t.id)}
            className={`text-left p-2.5 rounded-lg border text-xs transition-colors ${
              tpl === t.id ? 'border-teal-600 bg-teal-500/10' : 'border-zinc-700 hover:border-zinc-600'
            }`}
          >
            <div className="font-medium text-zinc-200">{t.label}</div>
            <div className="text-zinc-500 mt-0.5">{t.desc}</div>
          </button>
        ))}
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onCreate(tpl, name.trim())}>Create</Button>
      </div>
    </div>
  );
}

function AssayEditor({
  assay,
  onPatch,
  onAddRow,
  onAddColumn,
  onExport,
}: {
  assay: Assay;
  onPatch: (p: Partial<Assay>) => void;
  onAddRow: () => void;
  onAddColumn: () => void;
  onExport: (fmt: 'csv' | 'json') => void;
}) {
  const setCell = (rowIdx: number, colId: string, value: string) => {
    const rows = assay.rows.map((r, i) => (i === rowIdx ? { ...r, [colId]: value } : r));
    onPatch({ rows });
  };
  const renameColumn = (colId: string, name: string) =>
    onPatch({ columns: assay.columns.map((c) => (c.id === colId ? { ...c, name } : c)) });
  const setColType = (colId: string, type: ColType) =>
    onPatch({ columns: assay.columns.map((c) => (c.id === colId ? { ...c, type } : c)) });
  const removeColumn = (colId: string) =>
    onPatch({
      columns: assay.columns.filter((c) => c.id !== colId),
      rows: assay.rows.map(({ [colId]: _drop, ...rest }) => rest),
    });
  const removeRow = (rowIdx: number) => onPatch({ rows: assay.rows.filter((_, i) => i !== rowIdx) });

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <input
          value={assay.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          className="flex-1 px-2 py-1 text-base font-semibold bg-transparent border-b border-transparent hover:border-zinc-700 focus:border-teal-600 text-zinc-100 focus:outline-none"
        />
        <Button variant="secondary" size="sm" onClick={() => onExport('csv')}>Export CSV</Button>
        <Button variant="secondary" size="sm" onClick={() => onExport('json')}>Export JSON</Button>
      </div>
      <input
        value={assay.description}
        onChange={(e) => onPatch({ description: e.target.value })}
        placeholder="Short description / conditions…"
        className="w-full px-2 py-1 mb-3 text-xs bg-transparent border-b border-zinc-800 focus:border-teal-600 text-zinc-400 focus:outline-none"
      />

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="text-sm">
          <thead>
            <tr className="bg-zinc-900">
              <th className="w-8 text-[10px] text-zinc-600 font-mono px-1">#</th>
              {assay.columns.map((c) => (
                <th key={c.id} className="px-1 py-1.5 min-w-[110px] group/col border-l border-zinc-800">
                  <div className="flex items-center gap-1">
                    <input
                      value={c.name}
                      onChange={(e) => renameColumn(c.id, e.target.value)}
                      className="w-full px-1 py-0.5 text-xs font-semibold bg-transparent text-zinc-200 focus:bg-zinc-800 rounded focus:outline-none"
                    />
                    <button
                      onClick={() => removeColumn(c.id)}
                      className="text-zinc-700 hover:text-red-400 opacity-0 group-hover/col:opacity-100 text-xs"
                      title="Delete column"
                    >
                      ×
                    </button>
                  </div>
                  <select
                    value={c.type}
                    onChange={(e) => setColType(c.id, e.target.value as ColType)}
                    className="w-full mt-0.5 text-[10px] bg-transparent text-zinc-500 focus:outline-none cursor-pointer"
                  >
                    <option value="text">text</option>
                    <option value="number">number</option>
                    <option value="date">date</option>
                  </select>
                </th>
              ))}
              <th className="px-1">
                <button onClick={onAddColumn} className="text-teal-500 hover:text-teal-400 text-lg leading-none px-1" title="Add column">
                  +
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {assay.rows.map((row, ri) => (
              <tr key={ri} className="group/row border-t border-zinc-800 hover:bg-zinc-900/40">
                <td className="text-[10px] text-zinc-600 font-mono text-center relative">
                  <span className="group-hover/row:hidden">{ri + 1}</span>
                  <button
                    onClick={() => removeRow(ri)}
                    className="hidden group-hover/row:inline text-red-400 hover:text-red-300"
                    title="Delete row"
                  >
                    ×
                  </button>
                </td>
                {assay.columns.map((c) => (
                  <td key={c.id} className="border-l border-zinc-800 p-0">
                    <input
                      type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                      value={row[c.id] ?? ''}
                      onChange={(e) => setCell(ri, c.id, e.target.value)}
                      className="w-full px-2 py-1.5 bg-transparent text-zinc-200 focus:bg-zinc-800 focus:outline-none"
                    />
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={onAddRow}
        className="mt-2 text-sm text-teal-500 hover:text-teal-400 flex items-center gap-1.5"
      >
        <span className="text-base leading-none">+</span> Add row
      </button>
    </div>
  );
}
