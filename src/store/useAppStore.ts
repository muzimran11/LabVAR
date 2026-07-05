import { create } from 'zustand';

// --- Type definitions ---

export interface Experiment {
  id: string;
  name: string;
  created_ts: string;
  archived: boolean;
}

export interface Dataset {
  id: string;
  experiment_id: string;
  name: string;
  rows: number;
  cols: number;
  sha256: string;
  csv_data?: string;
}

export interface Figure {
  id: string;
  experiment_id: string;
  dataset_id: string;
  vega_spec: string;
}

export interface TestResult {
  id: string;
  experiment_id: string;
  dataset_id: string;
  test: string;
  params_json: string;
  result_json: string;
  scipy_version: string;
}

export interface Hypothesis {
  id: string;
  experiment_id: string;
  question: string;
  hypothesis: string;
  null_h: string;
  alt_h: string;
}

export interface Note {
  id: string;
  experiment_id: string;
  content: string;
  created_ts: string;
}

// Top-level workspaces. Everything except `experiment` is usable standalone —
// nothing is committed to an experiment/project from the jump (Claude-app model).
export type View =
  | 'home'
  | 'experiment'
  | 'design' // Experimental Design workspace
  | 'plots' // Plotting & Stats builder (standalone)
  | 'gel' // Gel / GFP densitometry
  | 'assays' // Assay tracking (poor-man's Excel)
  | 'labmath' // Lab math + quick notes
  | 'image' // Image analysis (TIFF → SAM-assisted worm intensity)
  | 'notebook' // 3D node-graph lab notebook
  | 'settings'; // User preferences & account
export type ExperimentTab = 'data' | 'plots' | 'stats' | 'design' | 'notes';
export type Theme = 'dark' | 'light';

/** Read the persisted theme (defaults to dark). Safe on first run. */
function initialTheme(): Theme {
  try {
    const t = localStorage.getItem('labvar.theme');
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* localStorage may be unavailable */
  }
  return 'dark';
}

/** Reflect the theme onto <html> so CSS `.light` / `.dark` overrides apply. */
export function applyThemeClass(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle('light', theme === 'light');
  root.classList.toggle('dark', theme === 'dark');
}

// --- AI Chart Builder persisted state ---
export type AiChartPhase = 'form' | 'generating' | 'code-review' | 'running' | 'result' | 'error';

export interface AiChartCsvInfo {
  fileName: string;
  path: string;
  dir: string;
  columns: string[];
  preview: string;
  rawText: string;
}

export interface AiChartHistoryEntry {
  id: string;
  prompt: string;
  colorScheme: string;
  language: 'python' | 'r';
  fileName: string;
  timestamp: number;
}

export interface AiChartState {
  csv: AiChartCsvInfo | null;
  context: string;
  colorScheme: string;
  language: 'python' | 'r';
  phase: AiChartPhase;
  generatedCode: string;
  streamingOutput: string;
  runOutput: string;
  errorMsg: string;
  resultImageUrl: string;
  correctionNote: string;
  dataInterpretation: string;
  requestHistory: AiChartHistoryEntry[];
}

const INITIAL_AI_CHART: AiChartState = {
  csv: null,
  context: '',
  colorScheme: 'default',
  language: 'python',
  phase: 'form',
  generatedCode: '',
  streamingOutput: '',
  runOutput: '',
  errorMsg: '',
  resultImageUrl: '',
  correctionNote: '',
  dataInterpretation: '',
  requestHistory: [],
};

interface AppState {
  // Navigation
  view: View;
  activeExperimentId: string | null;
  experimentTab: ExperimentTab;

  // Appearance
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  // Data
  experiments: Experiment[];
  datasets: Dataset[];
  activeDatasetId: string | null;
  figures: Figure[];
  testResults: TestResult[];
  hypotheses: Hypothesis[];
  notes: Note[];

  // UI State
  modalOpen: string | null; // modal identifier or null
  loading: Record<string, boolean>;

  // AI Chart Builder — persisted so navigating away doesn't lose work
  aiChart: AiChartState;
  updateAiChart: (partial: Partial<AiChartState>) => void;
  resetAiChart: () => void;

  // Deep-link: ask a workspace to focus a specific item after navigation
  // (e.g. double-clicking a node in the notebook). The target workspace reads
  // it on mount, selects the item, then clears it.
  deepLink: { view: View; itemId: string } | null;
  setDeepLink: (d: { view: View; itemId: string } | null) => void;

  // Navigation actions
  setView: (view: View) => void;
  setActiveExperiment: (id: string | null) => void;
  setExperimentTab: (tab: ExperimentTab) => void;
  setActiveDataset: (id: string | null) => void;
  setModalOpen: (modal: string | null) => void;

  // Data setters
  setExperiments: (experiments: Experiment[]) => void;
  setDatasets: (datasets: Dataset[]) => void;
  setFigures: (figures: Figure[]) => void;
  setTestResults: (results: TestResult[]) => void;
  setHypotheses: (hypotheses: Hypothesis[]) => void;
  setNotes: (notes: Note[]) => void;

  // Loading state
  setLoading: (key: string, value: boolean) => void;

  // Async data loaders (call invoke, then set state)
  loadExperiments: () => Promise<void>;
  loadDatasets: (experimentId: string) => Promise<void>;
  loadFigures: (experimentId: string) => Promise<void>;
  loadTestResults: (experimentId: string) => Promise<void>;
  loadNotes: (experimentId: string) => Promise<void>;
  loadHypotheses: (experimentId: string) => Promise<void>;
  loadDatasetDetail: (datasetId: string) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Navigation
  view: 'home',
  activeExperimentId: null,
  experimentTab: 'design',

  // Appearance
  theme: initialTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem('labvar.theme', theme);
    } catch {
      /* ignore */
    }
    applyThemeClass(theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),

  // Data
  experiments: [],
  datasets: [],
  activeDatasetId: null,
  figures: [],
  testResults: [],
  hypotheses: [],
  notes: [],

  // AI Chart Builder
  aiChart: { ...INITIAL_AI_CHART },
  updateAiChart: (partial) => set((s) => ({ aiChart: { ...s.aiChart, ...partial } })),
  resetAiChart: () => set((s) => ({ aiChart: { ...INITIAL_AI_CHART, requestHistory: s.aiChart.requestHistory } })),

  // UI State
  modalOpen: null,
  loading: {},
  deepLink: null,
  setDeepLink: (deepLink) => set({ deepLink }),

  // Navigation actions
  setView: (view) => set({ view }),
  setActiveExperiment: (id) => set({ activeExperimentId: id, experimentTab: 'design' }),
  setExperimentTab: (tab) => set({ experimentTab: tab }),
  setActiveDataset: (id) => {
    set({ activeDatasetId: id });
    if (id) get().loadDatasetDetail(id);
  },
  setModalOpen: (modal) => set({ modalOpen: modal }),

  // Data setters
  setExperiments: (experiments) => set({ experiments }),
  setDatasets: (datasets) => set({ datasets }),
  setFigures: (figures) => set({ figures }),
  setTestResults: (results) => set({ testResults: results }),
  setHypotheses: (hypotheses) => set({ hypotheses }),
  setNotes: (notes) => set({ notes }),

  // Loading
  setLoading: (key, value) => set((s) => ({ loading: { ...s.loading, [key]: value } })),

  // Async loaders
  loadExperiments: async () => {
    const { setLoading, setExperiments } = get();
    setLoading('experiments', true);
    try {
      const { listExperiments } = await import('@/lib/invoke');
      const experiments = await listExperiments();
      setExperiments(experiments);
    } catch (e) {
      console.error('Failed to load experiments:', e);
    } finally {
      setLoading('experiments', false);
    }
  },

  loadDatasets: async (experimentId: string) => {
    const { setLoading, setDatasets } = get();
    setLoading('datasets', true);
    try {
      const { listDatasets } = await import('@/lib/invoke');
      const datasets = await listDatasets(experimentId);
      setDatasets(datasets);
      // Auto-select the first dataset if none selected
      const currentActive = get().activeDatasetId;
      const activeId = currentActive && datasets.some(d => d.id === currentActive)
        ? currentActive
        : datasets.length > 0 ? datasets[0].id : null;
      if (activeId) {
        set({ activeDatasetId: activeId });
        get().loadDatasetDetail(activeId);
      }
    } catch (e) {
      console.error('Failed to load datasets:', e);
    } finally {
      setLoading('datasets', false);
    }
  },

  loadDatasetDetail: async (datasetId: string) => {
    try {
      const { getDataset } = await import('@/lib/invoke');
      const full = await getDataset(datasetId);
      // Merge csv_data into the existing dataset in the array
      set((s) => ({
        datasets: s.datasets.map((d) =>
          d.id === datasetId ? { ...d, csv_data: full.csv_data } : d
        ),
      }));
    } catch (e) {
      console.error('Failed to load dataset detail:', e);
    }
  },

  loadFigures: async (experimentId: string) => {
    const { setLoading, setFigures } = get();
    setLoading('figures', true);
    try {
      const { listFigures } = await import('@/lib/invoke');
      const figures = await listFigures(experimentId);
      setFigures(figures);
    } catch (e) {
      console.error('Failed to load figures:', e);
    } finally {
      setLoading('figures', false);
    }
  },

  loadTestResults: async (experimentId: string) => {
    const { setLoading, setTestResults } = get();
    setLoading('testResults', true);
    try {
      const { listTestResults } = await import('@/lib/invoke');
      const results = await listTestResults(experimentId);
      setTestResults(results);
    } catch (e) {
      console.error('Failed to load test results:', e);
    } finally {
      setLoading('testResults', false);
    }
  },

  loadNotes: async (experimentId: string) => {
    const { setLoading, setNotes } = get();
    setLoading('notes', true);
    try {
      const { listNotes } = await import('@/lib/invoke');
      const notes = await listNotes(experimentId);
      setNotes(notes);
    } catch (e) {
      console.error('Failed to load notes:', e);
    } finally {
      setLoading('notes', false);
    }
  },

  loadHypotheses: async (experimentId: string) => {
    const { setLoading, setHypotheses } = get();
    setLoading('hypotheses', true);
    try {
      const { listHypotheses } = await import('@/lib/invoke');
      const hypotheses = await listHypotheses(experimentId);
      setHypotheses(hypotheses);
    } catch (e) {
      console.error('Failed to load hypotheses:', e);
    } finally {
      setLoading('hypotheses', false);
    }
  },
}));
