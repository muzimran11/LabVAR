// ---------------------------------------------------------------------------
// analysisExport.ts — turn measurement rows (worm intensities, gel lanes) into
// graph-ready CSVs and push them straight into the plot builder.
//
// The whole point: a researcher should get ONE clean CSV they can drop into any
// graphing tool, or hit "Graph" and land in SpliceVar's plot builder with the
// data already shaped — no useless columns (area, IoU, file paths) in the way.
//
// Two shapes:
//   • wideCsv  — one column per group, replicate values down the rows. This is
//     exactly what the plot builder ingests (dose/condition × replicate), so
//     "Graph" produces a real grouped plot immediately.
//   • longCsv  — tidy Group,Value (+ optional Normalized) for GraphPad/R/Excel.
// ---------------------------------------------------------------------------

export interface Measurement {
  /** The condition / sample / group this value belongs to (a plot category). */
  group: string;
  /** The numeric readout (intensity, integrated density, normalized, …). */
  value: number;
}

export function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Unique group names, preserving first-seen order (keeps plot order sensible). */
export function groupOrder(rows: Measurement[]): string[] {
  const seen: string[] = [];
  for (const r of rows) if (!seen.includes(r.group)) seen.push(r.group);
  return seen;
}

export function valuesByGroup(rows: Measurement[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const r of rows) {
    if (!isFinite(r.value)) continue;
    const arr = m.get(r.group) ?? [];
    arr.push(r.value);
    m.set(r.group, arr);
  }
  return m;
}

/**
 * Wide CSV: header = group names, each column holds that group's replicate
 * values, ragged columns padded with blanks. Directly plottable.
 */
export function wideCsv(rows: Measurement[], round = 4): string {
  const groups = groupOrder(rows);
  const byGroup = valuesByGroup(rows);
  const maxLen = Math.max(0, ...groups.map((g) => byGroup.get(g)?.length ?? 0));
  const lines: string[] = [groups.map(csvCell).join(',')];
  for (let i = 0; i < maxLen; i++) {
    lines.push(
      groups
        .map((g) => {
          const v = byGroup.get(g)?.[i];
          return v == null ? '' : csvCell(+v.toFixed(round));
        })
        .join(',')
    );
  }
  return lines.join('\n');
}

/** Tidy long CSV: Group,<valueName> (+ Normalized column when provided). */
export function longCsv(
  rows: (Measurement & { normalized?: number | null })[],
  valueName = 'Value',
  round = 4
): string {
  const hasNorm = rows.some((r) => r.normalized != null && isFinite(r.normalized));
  const header = hasNorm ? `Group,${valueName},Normalized` : `Group,${valueName}`;
  const body = rows
    .map((r) => {
      const base = `${csvCell(r.group)},${csvCell(+r.value.toFixed(round))}`;
      if (!hasNorm) return base;
      const nm = r.normalized != null && isFinite(r.normalized) ? +r.normalized.toFixed(round) : '';
      return `${base},${nm}`;
    })
    .join('\n');
  return header + '\n' + body;
}

/**
 * Normalize a set of measurements to a control group's mean → fold-change.
 * Returns rows with a `normalized` field (value / controlMean). If the control
 * group is missing or has no positive mean, normalized is null.
 */
export function normalizeToControl(
  rows: Measurement[],
  controlGroup: string | null
): (Measurement & { normalized: number | null })[] {
  let controlMean: number | null = null;
  if (controlGroup) {
    const vals = rows.filter((r) => r.group === controlGroup && isFinite(r.value)).map((r) => r.value);
    if (vals.length) {
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (m > 0) controlMean = m;
    }
  }
  return rows.map((r) => ({
    ...r,
    normalized: controlMean != null ? r.value / controlMean : null,
  }));
}

/**
 * Create a throwaway "scratch" experiment from a CSV string and jump straight
 * into its plot builder. Works only in the desktop app (needs the Rust backend);
 * throws otherwise so the caller can fall back to a plain CSV export.
 */
export async function graphFromCsv(name: string, csv: string): Promise<void> {
  const { createExperiment, importDataset } = await import('@/lib/invoke');
  const { useAppStore } = await import('@/store/useAppStore');
  const expId = await createExperiment(name);
  await importDataset(expId, name, csv);
  const s = useAppStore.getState();
  await s.loadExperiments();
  s.setActiveExperiment(expId);
  s.setExperimentTab('plots');
  s.setView('experiment');
}
