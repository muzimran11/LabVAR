import { invoke } from '@tauri-apps/api/core';

// ---- Provenance ----
export async function appendEvent(
  entityType: string,
  entityId: string,
  eventType: string,
  payload: string
): Promise<string> {
  return invoke('append_event', { entityType, entityId, eventType, payload });
}

export async function verifyChain(): Promise<{ ok: boolean; broken_at: number | null }> {
  return invoke('verify_chain');
}

// ---- Experiments ----
export async function listExperiments(): Promise<any[]> {
  return invoke('list_experiments');
}

export async function getExperiment(id: string): Promise<any> {
  return invoke('get_experiment', { id });
}

export async function createExperiment(name: string): Promise<string> {
  return invoke('create_experiment', { name });
}

// ---- Experiment Management ----
export async function renameExperiment(id: string, name: string): Promise<void> {
  return invoke('rename_experiment', { id, name });
}

export async function deleteExperiment(id: string): Promise<void> {
  return invoke('delete_experiment', { id });
}

export async function archiveExperiment(id: string): Promise<void> {
  return invoke('archive_experiment', { id });
}

export async function unarchiveExperiment(id: string): Promise<void> {
  return invoke('unarchive_experiment', { id });
}

// ---- Datasets ----
export async function importDataset(experimentId: string, name: string, csvContent: string): Promise<string> {
  return invoke('import_dataset', { experimentId, name, csvContent });
}

export async function listDatasets(experimentId: string): Promise<any[]> {
  return invoke('list_datasets', { experimentId });
}

export async function getDataset(id: string): Promise<any> {
  return invoke('get_dataset', { id });
}

export async function deleteDataset(id: string): Promise<void> {
  return invoke('delete_dataset', { id });
}

// ---- Figures ----
export async function saveFigure(experimentId: string, datasetId: string, vegaSpec: string): Promise<string> {
  return invoke('save_figure', { experimentId, datasetId, vegaSpec });
}

export async function listFigures(experimentId: string): Promise<any[]> {
  return invoke('list_figures', { experimentId });
}

export async function getFigure(id: string): Promise<any> {
  return invoke('get_figure', { id });
}

export async function deleteFigure(id: string): Promise<void> {
  return invoke('delete_figure', { id });
}

// ---- Stats / Test Results ----
export async function saveTestResult(
  experimentId: string,
  datasetId: string,
  test: string,
  paramsJson: string,
  resultJson: string,
  scipyVersion: string
): Promise<string> {
  return invoke('save_test_result', {
    experimentId,
    datasetId,
    test,
    paramsJson,
    resultJson,
    scipyVersion,
  });
}

export async function listTestResults(experimentId: string): Promise<any[]> {
  return invoke('list_test_results', { experimentId });
}

export async function deleteTestResult(id: string): Promise<void> {
  return invoke('delete_test_result', { id });
}

// ---- Hypotheses ----
export async function saveHypothesis(
  experimentId: string,
  question: string,
  hypothesis: string,
  nullH: string,
  altH: string
): Promise<string> {
  return invoke('save_hypothesis', {
    experimentId,
    question,
    hypothesis,
    nullH,
    altH,
  });
}

export async function listHypotheses(experimentId: string): Promise<any[]> {
  return invoke('list_hypotheses', { experimentId });
}

// ---- Notes ----
export async function addNote(experimentId: string, content: string): Promise<string> {
  return invoke('add_note', { experimentId, content });
}

export async function listNotes(experimentId: string): Promise<any[]> {
  return invoke('list_notes', { experimentId });
}

export async function deleteNote(id: string): Promise<void> {
  return invoke('delete_note', { id });
}

// ---- Project folder: copy an input file into the experiment's directory ----
/** Copy a source file (absolute path) into the project folder at `dest`. */
export async function copyFile(src: string, dest: string): Promise<string> {
  return invoke('copy_file', { src, dest });
}

// ---- PubMed ----
export async function searchPubmed(query: string, maxResults: number): Promise<any[]> {
  return invoke('search_pubmed', { query, maxResults });
}

// ---- Image analysis: TIFF ingestion (Stage 1) ----
export interface TiffMeta {
  path: string;
  name: string;
  width: number;
  height: number;
  bits_per_sample: number;
  samples: number;
  pages: number;
  error: string | null;
}

export interface DecodedTiff {
  nat_w: number;
  nat_h: number;
  preview_w: number;
  preview_h: number;
  scale: number;
  pages: number;
  bits_per_sample: number;
  samples: number;
  raw_min: number;
  raw_max: number;
  applied_low: number;
  applied_high: number;
  /** `data:image/png;base64,...` grayscale preview (contrast-stretched, view-only). */
  preview_png_base64: string;
}

/** List TIFF files (non-recursive) in a directory with header metadata. */
export async function listTiffs(dir: string): Promise<TiffMeta[]> {
  return invoke('list_tiffs', { dir });
}

/**
 * Decode one page of a TIFF to a downsampled contrast-stretched preview.
 * `low`/`high` set an explicit raw-intensity window; omit for auto (0.5–99.5 pct).
 * Preview is view-only — never measure off it.
 */
export async function decodeTiff(
  path: string,
  opts?: { maxDim?: number; page?: number; low?: number; high?: number }
): Promise<DecodedTiff> {
  return invoke('decode_tiff', {
    path,
    maxDim: opts?.maxDim ?? null,
    page: opts?.page ?? null,
    low: opts?.low ?? null,
    high: opts?.high ?? null,
  });
}

// ---- AI Chart Builder: run generated Python/R scripts ----
/**
 * Execute a Python or R script in `workDir`. The Rust command writes the code
 * to a temp file, runs the interpreter, and returns stdout on success or
 * throws with stderr on failure.
 */
export async function runPlotScript(
  code: string,
  language: 'python' | 'r',
  workDir: string
): Promise<string> {
  return invoke('run_plot_script', { code, language, workDir });
}
