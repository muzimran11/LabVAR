// ---------------------------------------------------------------------------
// figurePresets.ts — the figure preset library.
//
// Single source of truth for "what figures can this app draw". Each preset
// bundles:
//   - how to render it   (mode + style consumed by PlotTab.buildSpec)
//   - what it's FOR       (description + the assay shape it matches)
//   - which stat test it pairs with (`recommendedTest`)
//   - what data it needs  (`needs`) so the recommender can filter presets
//                          that don't fit the loaded dataset
//
// PlotTab reads ENABLED_PRESETS to render the picker. `status: 'roadmap'`
// entries are documented-but-not-yet-drawable figure types (they need data
// shapes the current CSV parser doesn't produce, e.g. per-gene stats tables).
// Keeping them here means the roadmap lives with the code, and the recommender
// can already reason about them.
// ---------------------------------------------------------------------------

/** Render mode understood by PlotTab.project(). */
export type PlotMode = 'concentration' | 'timecourse' | 'both';

/** Mark family understood by PlotTab.buildSpec(). */
export type PlotStyle = 'bar' | 'box' | 'points' | 'line';

/** Statistical test the preset is designed to be read alongside. */
export type RecommendedTest =
  | 't-test'
  | 'welch-t'
  | 'paired-t'
  | 'mann-whitney'
  | 'one-way-anova'
  | 'two-way-anova'
  | 'kruskal-wallis'
  | 'wilcoxon'
  | 'linear-regression'
  | 'correlation'
  | 'log-rank'
  | 'repeated-measures-anova'
  | 'chi-square'
  | 'none';

/** What a preset needs from the dataset to be applicable. */
export interface DataNeeds {
  /** Minimum distinct groups on the x-axis. */
  minGroups: number;
  /** Requires timepoints encoded in the data. */
  requiresTime?: boolean;
  /** Requires a numeric/ordered dose axis (dose-response). */
  requiresDose?: boolean;
  /** Requires paired/matched replicates across conditions. */
  requiresPaired?: boolean;
  /** Requires a per-feature stats table (log2FC, p) — not the wide lab format. */
  requiresFeatureStats?: boolean;
}

export interface FigurePreset {
  id: string;
  /** Short picker label. */
  label: string;
  /** One-line explanation of when to reach for it. */
  description: string;
  /** Grouping in the picker. */
  category: 'Comparison' | 'Relationship' | 'Time' | 'Survival' | 'Genomics' | 'Distribution';
  /** 'enabled' = drawable now; 'roadmap' = documented, not yet wired. */
  status: 'enabled' | 'roadmap';
  /** How PlotTab should render it (enabled presets only). */
  mode?: PlotMode;
  style?: PlotStyle;
  /** Default: show Tukey significance brackets. */
  showSig?: boolean;
  /** The stat test this figure is meant to be read with. */
  recommendedTest: RecommendedTest;
  /** Dataset requirements, used by the recommender. */
  needs: DataNeeds;
  /** Whether individual replicate points are shown by default. */
  showPoints: boolean;
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

export const FIGURE_PRESETS: FigurePreset[] = [
  // ---- Comparison (the workhorses) ----
  {
    id: 'bar-sem-dots',
    label: 'Bar + SEM (dots)',
    description:
      'Mean bar with SEM error bars and every replicate overlaid. The default for treatment-vs-control expression.',
    category: 'Comparison',
    status: 'enabled',
    mode: 'concentration',
    style: 'bar',
    showSig: true,
    recommendedTest: 'one-way-anova',
    needs: { minGroups: 2 },
    showPoints: true,
  },
  {
    id: 'box-dots',
    label: 'Box + dots',
    description:
      'Box plot with individual points. Honest about spread and skew — reach for it when data may not be normal.',
    category: 'Comparison',
    status: 'enabled',
    mode: 'concentration',
    style: 'box',
    showSig: true,
    recommendedTest: 'kruskal-wallis',
    needs: { minGroups: 2 },
    showPoints: true,
  },
  {
    id: 'dot-plot',
    label: 'Dot plot (mean ± SEM)',
    description:
      'Every replicate as a point with a mean crossbar and SEM. Cleanest for small n — no bars implying data that isn’t there.',
    category: 'Comparison',
    status: 'enabled',
    mode: 'concentration',
    style: 'points',
    showSig: true,
    recommendedTest: 't-test',
    needs: { minGroups: 2 },
    showPoints: true,
  },
  {
    id: 'grouped-bar-2factor',
    label: 'Grouped bar (2-factor)',
    description:
      'Two categorical factors side by side (e.g. genotype × treatment). Auto-groups when the data has multiple timepoints.',
    category: 'Comparison',
    status: 'enabled',
    mode: 'concentration',
    style: 'bar',
    showSig: false,
    recommendedTest: 'two-way-anova',
    needs: { minGroups: 2 },
    showPoints: true,
  },

  // ---- Time ----
  {
    id: 'timecourse-line',
    label: 'Time course (line)',
    description:
      'Mean line with a shaded SEM band over timepoints, one line per group. For anything measured repeatedly over time.',
    category: 'Time',
    status: 'enabled',
    mode: 'timecourse',
    style: 'line',
    showSig: false,
    recommendedTest: 'repeated-measures-anova',
    needs: { minGroups: 1, requiresTime: true },
    showPoints: true,
  },
  {
    id: 'dose-response-curve',
    label: 'Dose–response curve',
    description:
      'Response plotted across ordered doses with a connecting mean line and error. The shape for concentration series and EC50-style reads.',
    category: 'Relationship',
    status: 'enabled',
    mode: 'concentration',
    style: 'line',
    showSig: false,
    recommendedTest: 'linear-regression',
    needs: { minGroups: 3, requiresDose: true },
    showPoints: true,
  },

  // ---- Roadmap: need data shapes the current parser doesn't emit yet ----
  {
    id: 'paired-slopegraph',
    label: 'Before / after (paired)',
    description:
      'Lines connecting the same sample across two conditions. Needs matched replicate identity across columns.',
    category: 'Comparison',
    status: 'roadmap',
    recommendedTest: 'paired-t',
    needs: { minGroups: 2, requiresPaired: true },
    showPoints: true,
  },
  {
    id: 'violin-dots',
    label: 'Violin + dots',
    description:
      'Kernel-density violins with points. Distribution-heavy comparisons (single-cell style). Needs a density transform layer.',
    category: 'Distribution',
    status: 'roadmap',
    recommendedTest: 'mann-whitney',
    needs: { minGroups: 2 },
    showPoints: true,
  },
  {
    id: 'scatter-regression',
    label: 'Scatter + regression',
    description:
      'Two continuous variables with a fitted line and r / R². Needs paired X–Y columns rather than the wide condition layout.',
    category: 'Relationship',
    status: 'roadmap',
    recommendedTest: 'correlation',
    needs: { minGroups: 1, requiresFeatureStats: false },
    showPoints: true,
  },
  {
    id: 'kaplan-meier',
    label: 'Survival (Kaplan–Meier)',
    description:
      'Stepped survival curves over time — core for C. elegans lifespan work. Needs event/censoring data.',
    category: 'Survival',
    status: 'roadmap',
    recommendedTest: 'log-rank',
    needs: { minGroups: 2 },
    showPoints: false,
  },
];

/** Presets that can be drawn right now, for the picker. */
export const ENABLED_PRESETS = FIGURE_PRESETS.filter((p) => p.status === 'enabled');

/** Lookup by id. */
export function getPreset(id: string): FigurePreset | undefined {
  return FIGURE_PRESETS.find((p) => p.id === id);
}

/**
 * Feature summary of the loaded dataset, used to decide which presets fit.
 * PlotTab computes this from the parsed conditions.
 */
export interface DatasetShape {
  groups: number;
  hasTime: boolean;
  hasDose: boolean;
}

/** True when a preset's data needs are satisfiable by the dataset. */
export function presetFits(preset: FigurePreset, shape: DatasetShape): boolean {
  if (preset.status !== 'enabled') return false;
  if (shape.groups < preset.needs.minGroups) return false;
  if (preset.needs.requiresTime && !shape.hasTime) return false;
  if (preset.needs.requiresDose && !shape.hasDose) return false;
  return true;
}
