import { useEffect, useState } from 'react';
import { Workspace } from '@/components/Workspace';
import { Button } from '@/components/Button';
import { useAppStore } from '@/store/useAppStore';
import { useCollection, COLLECTIONS, type BaseRecord } from '@/lib/localStore';
import { saveText } from '@/lib/exportFile';

interface DesignDoc extends BaseRecord {
  title: string;
  objective: string;
  hypothesis: string;
  constraints: string;
  groups: string;
  methods: string;
  ideas: string;
}

const BLANK = (): Omit<DesignDoc, keyof BaseRecord> => ({
  title: 'Untitled design',
  objective: '',
  hypothesis: '',
  constraints: '',
  groups: '',
  methods: '',
  ideas: '',
});

export function DesignWorkspace() {
  const { items, create, update, remove, replaceAll } = useCollection<DesignDoc>(COLLECTIONS.designDocs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const flashSaved = () => {
    setSavedMsg('Saved');
    setTimeout(() => setSavedMsg(null), 1800);
  };
  const deepLink = useAppStore((s) => s.deepLink);
  const setDeepLink = useAppStore((s) => s.setDeepLink);

  // Focus a specific design when arriving via a notebook double-click.
  useEffect(() => {
    if (deepLink?.view === 'design') {
      setSelectedId(deepLink.itemId);
      setDeepLink(null);
    }
  }, [deepLink, setDeepLink]);

  const selected = items.find((d) => d.id === selectedId) ?? items[0] ?? null;
  const patch = (p: Partial<DesignDoc>) => selected && update(selected.id, p);

  return (
    <Workspace
      title="Experimental Design"
      subtitle="Design the experiment, hit your constraints, and draft Materials & Methods."
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
                if (confirm('Delete ALL designs? This cannot be undone.')) {
                  replaceAll([]);
                  setSelectedId(null);
                }
              }}
            >
              Clear all
            </Button>
          )}
          <Button
            onClick={() => {
              const rec = create(BLANK());
              setSelectedId(rec.id);
            }}
          >
            + New design
          </Button>
        </>
      }
    >
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-700 p-10 text-center">
          <p className="text-sm text-zinc-300 font-medium">No designs yet</p>
          <p className="text-xs text-zinc-500 mt-1 mb-4">
            Plan an experiment end-to-end: objective, hypothesis, groups, constraints, and a methods draft you can export.
          </p>
          <Button
            onClick={() => {
              const rec = create(BLANK());
              setSelectedId(rec.id);
            }}
          >
            + New design
          </Button>
        </div>
      ) : (
        <div className="flex gap-4">
          <div className="w-52 flex-shrink-0 space-y-1">
            {items.map((d) => (
              <div key={d.id} className="group relative">
                <button
                  onClick={() => setSelectedId(d.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate pr-7 transition-colors ${
                    selected?.id === d.id ? 'bg-teal-500/15 text-teal-400 font-medium' : 'text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {d.title || 'Untitled'}
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete design "${d.title}"?`)) {
                      remove(d.id);
                      if (selectedId === d.id) setSelectedId(null);
                    }
                  }}
                  className="absolute right-1.5 top-2 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {selected && (
            <div className="flex-1 min-w-0 space-y-4">
              <input
                value={selected.title}
                onChange={(e) => patch({ title: e.target.value })}
                className="w-full px-2 py-1 text-lg font-semibold bg-transparent border-b border-transparent hover:border-zinc-700 focus:border-teal-600 text-zinc-100 focus:outline-none"
              />

              <div className="grid grid-cols-2 gap-4">
                <Section label="Objective / question" value={selected.objective} onChange={(v) => patch({ objective: v })} rows={3} />
                <Section label="Hypothesis" value={selected.hypothesis} onChange={(v) => patch({ hypothesis: v })} rows={3} />
                <Section
                  label="Constraints (time, budget, equipment, sample size)"
                  value={selected.constraints}
                  onChange={(v) => patch({ constraints: v })}
                  rows={3}
                />
                <Section
                  label="Groups / conditions"
                  value={selected.groups}
                  onChange={(v) => patch({ groups: v })}
                  rows={3}
                />
              </div>

              {/* Ideas + Methods */}
              <Section label="Ideas / scratchpad" value={selected.ideas} onChange={(v) => patch({ ideas: v })} rows={4} />

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Materials & Methods draft</h3>
                  <div className="flex gap-2">
                    <button onClick={() => exportMethods(selected, 'doc')} className="text-xs text-teal-500 hover:text-teal-400">
                      Export Word
                    </button>
                    <button onClick={() => exportMethods(selected, 'md')} className="text-xs text-zinc-400 hover:text-zinc-200">
                      Export Markdown
                    </button>
                  </div>
                </div>
                <textarea
                  value={selected.methods}
                  onChange={(e) => patch({ methods: e.target.value })}
                  rows={8}
                  placeholder="Draft the methods paragraph here — reagents, concentrations, steps, instruments, statistics…"
                  className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:border-teal-600 resize-y font-mono leading-relaxed"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </Workspace>
  );
}

function Section({
  label,
  value,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full mt-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:border-teal-600 resize-y"
      />
    </label>
  );
}

// ---- exports ---------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function exportMethods(d: DesignDoc, fmt: 'doc' | 'md') {
  const safe = (d.title || 'design').replace(/[^\w.-]+/g, '_');
  if (fmt === 'md') {
    const md = `# ${d.title}\n\n## Objective\n${d.objective}\n\n## Hypothesis\n${d.hypothesis}\n\n## Groups / Conditions\n${d.groups}\n\n## Constraints\n${d.constraints}\n\n## Materials & Methods\n${d.methods}\n`;
    await saveText(md, `${safe}_methods.md`, [{ name: 'Markdown', extensions: ['md'] }]);
    return;
  }
  // Word-compatible HTML (.doc). Word opens this natively.
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(d.title)}</title></head><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5">
<h1>${esc(d.title)}</h1>
<h2>Objective</h2><p>${esc(d.objective).replace(/\n/g, '<br>')}</p>
<h2>Hypothesis</h2><p>${esc(d.hypothesis).replace(/\n/g, '<br>')}</p>
<h2>Groups / Conditions</h2><p>${esc(d.groups).replace(/\n/g, '<br>')}</p>
<h2>Constraints</h2><p>${esc(d.constraints).replace(/\n/g, '<br>')}</p>
<h2>Materials &amp; Methods</h2><p>${esc(d.methods).replace(/\n/g, '<br>')}</p>
</body></html>`;
  await saveText(html, `${safe}_methods.doc`, [{ name: 'Word', extensions: ['doc'] }]);
}
