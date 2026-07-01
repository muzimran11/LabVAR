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

// ---- Inventory: Stocks ----
export async function listStocks(): Promise<any[]> {
  return invoke('list_stocks');
}

export async function createStock(
  name: string,
  qty: number,
  unit: string,
  reorderAt: number
): Promise<string> {
  return invoke('create_stock', { name, qty, unit, reorderAt });
}

export async function updateStock(id: string, qty: number, reorderAt: number): Promise<string> {
  return invoke('update_stock', { id, qty, reorderAt });
}

// ---- Inventory: Cultures ----
export async function listCultures(): Promise<any[]> {
  return invoke('list_cultures');
}

export async function createCulture(
  name: string,
  kind: string,
  intervalDays: number
): Promise<string> {
  return invoke('create_culture', { name, kind, intervalDays });
}

export async function checkCulture(id: string): Promise<string> {
  return invoke('check_culture', { id });
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

// ---- PubMed ----
export async function searchPubmed(query: string, maxResults: number): Promise<any[]> {
  return invoke('search_pubmed', { query, maxResults });
}
