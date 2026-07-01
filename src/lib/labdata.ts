// ---------------------------------------------------------------------------
// labdata.ts — robust tabular parsing + wet-lab structure inference.
//
// Two jobs:
//   1. Turn arbitrary spreadsheet text (CSV / TSV, CRLF, BOM, quoted commas)
//      into a clean { columns, rows } table.
//   2. Understand "wide" lab layouts where every COLUMN is a condition
//      (e.g. "24 Hours FUDR 12.5uM") and every CELL is a replicate value.
//      We pivot to long form and pull dose / unit / time / treatment out of
//      each column name — the same idea as the lab's R pivot_longer script.
// ---------------------------------------------------------------------------

export interface Table {
  columns: string[];
  rows: Record<string, unknown>[];
}

// ------- Robust delimited-text parser -------

/** Sniff the most likely delimiter from the header line. */
function sniffDelimiter(headerLine: string): string {
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    // count only delimiters that are not inside quotes
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < headerLine.length; i++) {
      const ch = headerLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** Split a single line on a delimiter, honoring double-quoted fields. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++; // escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse CSV/TSV text into a typed table. Handles BOM, CRLF/CR line endings,
 * blank lines, quoted fields, and auto-sniffs the delimiter.
 */
export function parseTable(text: string): Table {
  if (!text) return { columns: [], rows: [] };

  // Strip UTF-8 BOM if present.
  let clean = text.replace(/^﻿/, '');
  // Normalize line endings, then drop blank lines.
  const rawLines = clean
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '');

  if (rawLines.length === 0) return { columns: [], rows: [] };

  const delim = sniffDelimiter(rawLines[0]);
  const columns = splitLine(rawLines[0], delim).map((c) => c.replace(/^"|"$/g, ''));

  const rows = rawLines.slice(1).map((line) => {
    const values = splitLine(line, delim);
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      const raw = (values[i] ?? '').replace(/^"|"$/g, '');
      if (raw === '') {
        row[col] = null;
        return;
      }
      const num = Number(raw);
      row[col] = !isNaN(num) && raw !== '' ? num : raw;
    });
    return row;
  });

  return { columns, rows };
}

// ------- Condition-name inference -------

export interface Condition {
  /** Original column header, e.g. "24 Hours FUDR 12.5uM". */
  name: string;
  /** Numeric dose (0 for controls / no dose found). */
  dose: number;
  /** Human dose label, e.g. "12.5 µM" or "Control". */
  doseLabel: string;
  /** Concentration unit if detected (µM, nM, mM, %, etc.). */
  unit: string | null;
  /** Timepoint value if the name encodes one (e.g. 24), else null. */
  time: number | null;
  /** Time unit label (h, d, min) if detected. */
  timeUnit: string | null;
  /** Human time label, e.g. "24 h". */
  timeLabel: string | null;
  /** Treatment / agent name, e.g. "FUDR" or "Control". */
  treatment: string;
  /** True when this looks like a control / vehicle / untreated column. */
  isControl: boolean;
}

const CONTROL_RE = /\b(control|ctrl|vehicle|untreated|mock|dmso|no\s*drug|baseline|wt)\b/i;
const TIME_RE = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|days?|d|minutes?|mins?|min|weeks?|wks?|wk)\b/i;
// dose = a number optionally followed by a concentration unit
const DOSE_RE = /(\d+(?:\.\d+)?)\s*(µM|uM|nM|mM|pM|M|µg\/mL|ug\/mL|mg\/mL|ng\/mL|%)?/i;

function normalizeTimeUnit(u: string): string {
  const s = u.toLowerCase();
  if (s.startsWith('h')) return 'h';
  if (s.startsWith('d')) return 'd';
  if (s.startsWith('w')) return 'wk';
  if (s.startsWith('m')) return 'min';
  return s;
}

function normalizeConcUnit(u: string | undefined): string | null {
  if (!u) return null;
  const map: Record<string, string> = { um: 'µM', 'µm': 'µM', nm: 'nM', mm: 'mM', pm: 'pM' };
  const key = u.toLowerCase();
  return map[key] ?? u;
}

/** Infer dose / time / treatment structure from a single condition name. */
export function inferCondition(name: string): Condition {
  let remainder = name;

  // 1. Pull the time token out first so its number isn't mistaken for a dose.
  let time: number | null = null;
  let timeUnit: string | null = null;
  let timeLabel: string | null = null;
  const timeMatch = name.match(TIME_RE);
  if (timeMatch) {
    time = parseFloat(timeMatch[1]);
    timeUnit = normalizeTimeUnit(timeMatch[2]);
    timeLabel = `${time} ${timeUnit}`;
    remainder = remainder.replace(timeMatch[0], ' ');
  }

  // 2. Control detection on the remaining text.
  const isControl = CONTROL_RE.test(remainder) || /\bcontrol\b/i.test(name);

  // 3. Dose from the remainder (after time is removed).
  let dose = 0;
  let unit: string | null = null;
  let doseLabel = 'Control';
  if (!isControl) {
    const doseMatch = remainder.match(DOSE_RE);
    if (doseMatch && doseMatch[1] !== undefined) {
      dose = parseFloat(doseMatch[1]);
      unit = normalizeConcUnit(doseMatch[2]);
      doseLabel = unit ? `${dose} ${unit}` : `${dose}`;
    } else {
      doseLabel = remainder.trim() || name;
    }
  }

  // 4. Treatment = leftover words with numbers/units stripped.
  let treatment = remainder
    .replace(DOSE_RE, ' ')
    .replace(/µM|uM|nM|mM|pM|µg\/mL|ug\/mL|mg\/mL|ng\/mL|%/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (isControl) treatment = 'Control';
  if (!treatment) treatment = isControl ? 'Control' : name;

  return {
    name,
    dose,
    doseLabel,
    unit,
    time,
    timeUnit,
    timeLabel,
    treatment,
    isControl,
  };
}

/** Infer structure for every column header. */
export function analyzeConditions(columns: string[]): Condition[] {
  return columns.map(inferCondition);
}

// ------- Wide-format detection + pivot to long -------

/**
 * A table is "wide lab format" when the columns are conditions (labels) and
 * the cells are numeric measurements — i.e. most values are numbers and there
 * is no obvious single "value"/"measurement" column paired with a grouping
 * column. Heuristic: >=2 columns and the majority of non-null cells are numeric.
 */
export function isWideFormat(table: Table): boolean {
  if (table.columns.length < 2 || table.rows.length === 0) return false;
  let numeric = 0;
  let total = 0;
  for (const row of table.rows) {
    for (const col of table.columns) {
      const v = row[col];
      if (v === null || v === undefined || v === '') continue;
      total++;
      if (typeof v === 'number') numeric++;
    }
  }
  if (total === 0) return false;
  return numeric / total >= 0.8;
}

export interface LongRow {
  condition: string;
  value: number;
  replicate: number;
  dose: number;
  doseLabel: string;
  unit: string | null;
  time: number | null;
  timeLabel: string | null;
  treatment: string;
  role: 'control' | 'experiment';
}

/**
 * Pivot a wide table to long form, attaching inferred dose/time metadata.
 * `roleOverrides` lets the UI flip a condition between control/experiment.
 */
export function toLong(
  table: Table,
  roleOverrides: Record<string, 'control' | 'experiment'> = {}
): LongRow[] {
  const conditions = analyzeConditions(table.columns);
  const byName = new Map(conditions.map((c) => [c.name, c]));
  const out: LongRow[] = [];

  table.rows.forEach((row, rIdx) => {
    for (const col of table.columns) {
      const v = row[col];
      if (typeof v !== 'number' || isNaN(v)) continue; // skip blanks / non-numeric
      const c = byName.get(col)!;
      const role =
        roleOverrides[col] ?? (c.isControl ? 'control' : 'experiment');
      out.push({
        condition: col,
        value: v,
        replicate: rIdx + 1,
        dose: c.dose,
        doseLabel: c.doseLabel,
        unit: c.unit,
        time: c.time,
        timeLabel: c.timeLabel,
        treatment: c.treatment,
        role,
      });
    }
  });

  return out;
}

/** Distinct dose labels ordered by numeric dose (controls first). */
export function orderedDoseLabels(rows: LongRow[]): string[] {
  const seen = new Map<string, number>();
  for (const r of rows) if (!seen.has(r.doseLabel)) seen.set(r.doseLabel, r.dose);
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
}

/** Distinct time labels ordered by numeric time. */
export function orderedTimeLabels(rows: LongRow[]): string[] {
  const seen = new Map<string, number>();
  for (const r of rows) {
    const label = r.timeLabel ?? '—';
    const t = r.time ?? -1;
    if (!seen.has(label)) seen.set(label, t);
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
}
