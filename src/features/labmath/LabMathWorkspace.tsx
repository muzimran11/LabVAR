import { useState } from 'react';
import { Workspace } from '@/components/Workspace';
import { Button } from '@/components/Button';
import { useCollection, COLLECTIONS, type BaseRecord } from '@/lib/localStore';

type Tab = 'dilution' | 'molarity' | 'serial' | 'notes';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dilution', label: 'Dilution (C1V1)' },
  { id: 'molarity', label: 'Molarity' },
  { id: 'serial', label: 'Serial dilution' },
  { id: 'notes', label: 'Quick notes' },
];

export function LabMathWorkspace() {
  const [tab, setTab] = useState<Tab>('dilution');
  return (
    <Workspace title="Lab Math" subtitle="Dilutions, molarity, and scratch math — no formulas to memorise.">
      <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-1.5 mb-3">
        Tip: add a <strong>Lab math</strong> node in the Node view and link it to your experiment to keep calculations in context.
      </div>
      <div className="flex gap-1 border-b border-zinc-800 mb-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium transition-colors relative ${
              tab === t.id ? 'text-teal-400' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t.label}
            {tab === t.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500 rounded-t" />}
          </button>
        ))}
      </div>
      {tab === 'dilution' && <DilutionCalc />}
      {tab === 'molarity' && <MolarityCalc />}
      {tab === 'serial' && <SerialDilution />}
      {tab === 'notes' && <QuickNotes />}
    </Workspace>
  );
}

// ---- helpers ---------------------------------------------------------------
function num(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function fmt(n: number): string {
  if (!isFinite(n)) return '—';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs < 0.001 || abs >= 1e6) return n.toExponential(3);
  return Number(n.toPrecision(5)).toString();
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-zinc-500 uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full mt-1 px-2.5 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:border-teal-600';

function Result({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-teal-700/40 bg-teal-500/5 p-4 text-sm text-zinc-200 leading-relaxed">
      {children}
    </div>
  );
}

// ---- C1V1 dilution ---------------------------------------------------------
const CONC_UNITS = ['M', 'mM', 'µM', 'nM', 'mg/mL', 'µg/mL', 'ng/mL', 'X', '%'] as const;
const VOL_UNITS  = ['L', 'mL', 'µL'] as const;

// Molar scale factors (relative to mol/L). Only applies to M/mM/µM/nM.
const MOL_SCALE: Record<string, number> = { M: 1, mM: 1e-3, 'µM': 1e-6, nM: 1e-9 };
const VOL_SCALE: Record<string, number> = { L: 1, mL: 1e-3, 'µL': 1e-6 };

function isMolar(u: string): boolean {
  return u in MOL_SCALE;
}

function DilutionCalc() {
  const [c1, setC1] = useState('');
  const [c2, setC2] = useState('');
  const [v2, setV2] = useState('');
  const [c1Unit, setC1Unit] = useState('µM');
  const [c2Unit, setC2Unit] = useState('µM');
  const [v1Unit, setV1Unit] = useState('µL');
  const [v2Unit, setV2Unit] = useState('µL');

  const nc1 = num(c1);
  const nc2 = num(c2);
  const nv2 = num(v2);

  const allFilled = nc1 !== null && nc2 !== null && nv2 !== null && nc1 > 0;

  // Determine if units are compatible
  const bothMolar    = isMolar(c1Unit) && isMolar(c2Unit);
  const bothSameNonM = !isMolar(c1Unit) && !isMolar(c2Unit) && c1Unit === c2Unit;
  const incompatible = !bothMolar && !bothSameNonM;

  let v1Display: number | null = null;
  let diluentDisplay: number | null = null;
  let overC = false;

  if (allFilled && !incompatible) {
    if (bothMolar) {
      const c1_SI  = nc1! * MOL_SCALE[c1Unit];
      const c2_SI  = nc2! * MOL_SCALE[c2Unit];
      const v2_SI  = nv2! * VOL_SCALE[v2Unit];
      overC = c2_SI > c1_SI;
      if (!overC) {
        const v1_SI    = (c2_SI * v2_SI) / c1_SI;
        v1Display      = v1_SI / VOL_SCALE[v1Unit];
        const dil_SI   = v2_SI - v1_SI;
        diluentDisplay = dil_SI / VOL_SCALE[v1Unit];
      }
    } else {
      // Same non-molar unit: simple ratio, output in v1Unit (convert from v2Unit)
      overC = nc2! > nc1!;
      if (!overC) {
        const v2_L        = nv2! * VOL_SCALE[v2Unit];
        const v1_L        = (nc2! * v2_L) / nc1!;
        v1Display         = v1_L / VOL_SCALE[v1Unit];
        diluentDisplay    = (v2_L - v1_L) / VOL_SCALE[v1Unit];
      }
    }
  }

  return (
    <div className="max-w-xl">
      <p className="text-sm text-zinc-400 mb-4">
        Make a diluted working stock. Enter your stock concentration, the target, and the final volume.
      </p>

      {/* C1 row */}
      <div className="grid grid-cols-[1fr_auto] gap-2 mb-2">
        <Labeled label="Stock concentration (C1)">
          <input className={inputCls} value={c1} onChange={(e) => setC1(e.target.value)} placeholder="e.g. 10000" />
        </Labeled>
        <Labeled label="C1 unit">
          <select className={inputCls} value={c1Unit} onChange={(e) => setC1Unit(e.target.value)}>
            {CONC_UNITS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </Labeled>
      </div>

      {/* C2 row */}
      <div className="grid grid-cols-[1fr_auto] gap-2 mb-2">
        <Labeled label="Target concentration (C2)">
          <input className={inputCls} value={c2} onChange={(e) => setC2(e.target.value)} placeholder="e.g. 50" />
        </Labeled>
        <Labeled label="C2 unit">
          <select className={inputCls} value={c2Unit} onChange={(e) => setC2Unit(e.target.value)}>
            {CONC_UNITS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </Labeled>
      </div>

      {/* V2 row */}
      <div className="grid grid-cols-[1fr_auto] gap-2 mb-2">
        <Labeled label="Final volume (V2)">
          <input className={inputCls} value={v2} onChange={(e) => setV2(e.target.value)} placeholder="e.g. 1000" />
        </Labeled>
        <Labeled label="V2 unit">
          <select className={inputCls} value={v2Unit} onChange={(e) => setV2Unit(e.target.value)}>
            {VOL_UNITS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </Labeled>
      </div>

      {/* Output unit row */}
      <div className="grid grid-cols-[1fr_auto] gap-2 mb-2">
        <Labeled label="Show V1 / diluent in">
          <select className={inputCls} value={v1Unit} onChange={(e) => setV1Unit(e.target.value)}>
            {VOL_UNITS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </Labeled>
        <div /> {/* spacer */}
      </div>

      {allFilled && incompatible && (
        <div className="mt-3 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
          Incompatible units — convert C1 and C2 to the same unit family first (e.g. both molar, or both mg/mL).
        </div>
      )}

      {allFilled && !incompatible && overC && (
        <Result>
          <span className="text-amber-400">
            Target is higher than the stock — you can't dilute up to {c2} {c2Unit} from {c1} {c1Unit}.
          </span>
        </Result>
      )}

      {allFilled && !incompatible && !overC && v1Display !== null && (
        <Result>
          Add <strong className="text-teal-400">{fmt(v1Display)} {v1Unit}</strong> of stock and{' '}
          <strong className="text-teal-400">{fmt(diluentDisplay!)} {v1Unit}</strong> of diluent
          <span className="text-zinc-500"> (total {fmt(nv2!)} {v2Unit})</span>.
          {bothMolar && c1Unit !== c2Unit && (
            <div className="text-xs text-zinc-500 mt-1">Units converted: {c1Unit} to {c2Unit} via SI.</div>
          )}
        </Result>
      )}
    </div>
  );
}

// ---- molarity --------------------------------------------------------------
function MolarityCalc() {
  const [mw, setMw] = useState('');
  const [conc, setConc] = useState('');
  const [vol, setVol] = useState('');
  const [concUnit, setConcUnit] = useState('mM');
  const [volUnit, setVolUnit] = useState('mL');

  const concToM: Record<string, number> = { M: 1, mM: 1e-3, 'µM': 1e-6, nM: 1e-9 };
  const volToL: Record<string, number> = { L: 1, mL: 1e-3, 'µL': 1e-6 };

  const nmw = num(mw);
  const nc = num(conc);
  const nv = num(vol);
  const ready = nmw !== null && nc !== null && nv !== null && nmw > 0;

  const grams = ready ? nc! * concToM[concUnit] * (nv! * volToL[volUnit]) * nmw! : null;
  const display =
    grams === null ? null : grams >= 1 ? `${fmt(grams)} g` : grams >= 1e-3 ? `${fmt(grams * 1e3)} mg` : `${fmt(grams * 1e6)} µg`;

  return (
    <div className="max-w-xl">
      <p className="text-sm text-zinc-400 mb-4">How much powder to weigh out for a target molar concentration.</p>
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Molecular weight (g/mol)">
          <input className={inputCls} value={mw} onChange={(e) => setMw(e.target.value)} placeholder="e.g. 246.47" />
        </Labeled>
        <div />
        <Labeled label="Target concentration">
          <input className={inputCls} value={conc} onChange={(e) => setConc(e.target.value)} placeholder="e.g. 100" />
        </Labeled>
        <Labeled label="Conc unit">
          <select className={inputCls} value={concUnit} onChange={(e) => setConcUnit(e.target.value)}>
            {Object.keys(concToM).map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Final volume">
          <input className={inputCls} value={vol} onChange={(e) => setVol(e.target.value)} placeholder="e.g. 50" />
        </Labeled>
        <Labeled label="Volume unit">
          <select className={inputCls} value={volUnit} onChange={(e) => setVolUnit(e.target.value)}>
            {Object.keys(volToL).map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </Labeled>
      </div>
      {ready && display && (
        <Result>
          Weigh out <strong className="text-teal-400">{display}</strong> and dissolve in {fmt(nv!)} {volUnit}.
        </Result>
      )}
    </div>
  );
}

// ---- serial dilution -------------------------------------------------------
function SerialDilution() {
  const [start, setStart] = useState('');
  const [fold, setFold] = useState('10');
  const [steps, setSteps] = useState('5');
  const [unit, setUnit] = useState('µM');

  const s = num(start);
  const f = num(fold);
  const n = num(steps);
  const rows: number[] = [];
  if (s !== null && f !== null && n !== null && f > 0 && n > 0 && n <= 30) {
    let cur = s;
    for (let i = 0; i < n; i++) {
      rows.push(cur);
      cur = cur / f;
    }
  }

  return (
    <div className="max-w-xl">
      <p className="text-sm text-zinc-400 mb-4">Build a dose series by repeated fold-dilution.</p>
      <div className="grid grid-cols-4 gap-3">
        <Labeled label="Start conc">
          <input className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} placeholder="1000" />
        </Labeled>
        <Labeled label="Fold">
          <input className={inputCls} value={fold} onChange={(e) => setFold(e.target.value)} />
        </Labeled>
        <Labeled label="Steps">
          <input className={inputCls} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </Labeled>
        <Labeled label="Unit">
          <select className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)}>
            {['M', 'mM', 'µM', 'nM', 'mg/mL', 'µg/mL', 'X'].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </Labeled>
      </div>
      {rows.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {rows.map((r, i) => (
            <div key={i} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm">
              <div className="text-[10px] text-zinc-500 font-mono">step {i + 1}</div>
              <div className="text-teal-400 font-medium">{fmt(r)} {unit}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- quick notes -----------------------------------------------------------
interface MathNote extends BaseRecord {
  text: string;
}

function QuickNotes() {
  const { items, create, update, remove, replaceAll } = useCollection<MathNote>(COLLECTIONS.labMathNotes);
  const [draft, setDraft] = useState('');

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-zinc-500">Notes autosave as you type.</span>
        {items.length > 0 && (
          <button
            onClick={() => {
              if (confirm('Clear all quick notes? This cannot be undone.')) replaceAll([]);
            }}
            className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>
      <div className="flex gap-2 mb-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Jot a calculation, a recipe, a reminder…"
          rows={2}
          className="flex-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:border-teal-600 resize-y"
        />
        <Button
          onClick={() => {
            if (draft.trim()) {
              create({ text: draft.trim() } as Omit<MathNote, keyof BaseRecord>);
              setDraft('');
            }
          }}
        >
          Add
        </Button>
      </div>
      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm text-zinc-500">No notes yet.</p>}
        {items.map((nt) => (
          <div key={nt.id} className="group rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <textarea
              value={nt.text}
              onChange={(e) => update(nt.id, { text: e.target.value })}
              rows={Math.max(1, nt.text.split('\n').length)}
              className="w-full bg-transparent text-sm text-zinc-200 focus:outline-none resize-none"
            />
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-zinc-600 font-mono">
                {new Date(nt.updated_ts).toLocaleString()}
              </span>
              <button
                onClick={() => remove(nt.id)}
                className="text-xs text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
