import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { importDataset, getDataset } from '@/lib/invoke';
import { DataTable, createColumnsFromKeys } from '@/components/DataTable';

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

export function DataTab() {
  const activeExperimentId = useAppStore((s) => s.activeExperimentId);
  const datasets = useAppStore((s) => s.datasets);
  const activeDatasetId = useAppStore((s) => s.activeDatasetId);
  const setActiveDataset = useAppStore((s) => s.setActiveDataset);
  const loadDatasets = useAppStore((s) => s.loadDatasets);

  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [datasetName, setDatasetName] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeDataset = datasets.find((d) => d.id === activeDatasetId);

  // If csv_data is missing (list endpoint didn't include it), fetch the full dataset
  useEffect(() => {
    if (activeDatasetId && activeDataset && !activeDataset.csv_data) {
      getDataset(activeDatasetId).then((full) => {
        if (full?.csv_data) {
          useAppStore.setState((s) => ({
            datasets: s.datasets.map((d) =>
              d.id === activeDatasetId ? { ...d, csv_data: full.csv_data } : d
            ),
          }));
        }
      }).catch(console.error);
    }
  }, [activeDatasetId, activeDataset?.csv_data]);

  const parsedData = useMemo(() => {
    if (!activeDataset?.csv_data) return { columns: [], rows: [] };
    return parseCSV(activeDataset.csv_data);
  }, [activeDataset?.csv_data]);

  const columns = useMemo(
    () => createColumnsFromKeys<Record<string, unknown>>(parsedData.columns),
    [parsedData.columns]
  );

  const handleImport = useCallback(async () => {
    if (!activeExperimentId) return;
    if (!csvText.trim()) {
      setError('Paste CSV data above');
      return;
    }
    if (!datasetName.trim()) {
      setError('Enter a dataset name');
      return;
    }

    setImporting(true);
    setError('');
    try {
      await importDataset(activeExperimentId, datasetName.trim(), csvText.trim());
      await loadDatasets(activeExperimentId);
      setCsvText('');
      setDatasetName('');
      setShowImport(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }, [activeExperimentId, csvText, datasetName, loadDatasets]);

  const handleFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeExperimentId) return;

    setImporting(true);
    setError('');
    try {
      const text = await file.text();
      const name = datasetName.trim() || file.name.replace(/\.csv$/i, '');
      await importDataset(activeExperimentId, name, text.trim());
      await loadDatasets(activeExperimentId);
      setDatasetName('');
      setShowImport(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }, [activeExperimentId, datasetName, loadDatasets]);

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.tsv,.txt"
        onChange={handleFileImport}
        className="hidden"
      />
      {/* Dataset selector + Import button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {datasets.length > 0 && (
            <select
              value={activeDatasetId ?? ''}
              onChange={(e) => setActiveDataset(e.target.value)}
              className="text-sm bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-zinc-200 focus:outline-none focus:border-teal-600"
            >
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.name} ({ds.rows} rows)
                </option>
              ))}
            </select>
          )}
          {datasets.length > 0 && (
            <span className="text-xs text-zinc-600">
              {parsedData.columns.length} columns, {parsedData.rows.length} rows
            </span>
          )}
        </div>
        <button
          onClick={() => setShowImport(!showImport)}
          className="px-3 py-1.5 text-sm bg-teal-600 hover:bg-teal-500 text-white rounded transition-colors font-medium"
        >
          {showImport ? 'Cancel' : 'Import CSV'}
        </button>
      </div>

      {/* Import Panel */}
      {showImport && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Dataset Name</label>
            <input
              type="text"
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              placeholder="e.g., viability_assay_plate1"
              className="w-full max-w-sm px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="px-4 py-2 text-sm bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-zinc-200 rounded transition-colors font-medium flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              Choose .csv file
            </button>
            <span className="text-xs text-zinc-600">or paste below</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Paste CSV Data</label>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={"concentration,viability,replicate\n0,100,1\n0.1,95.2,1\n1,78.4,1\n10,45.1,1\n100,12.3,1"}
              rows={8}
              className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600 font-mono resize-none"
              spellCheck={false}
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end">
            <button
              onClick={handleImport}
              disabled={importing}
              className="px-4 py-2 text-sm bg-teal-600 hover:bg-teal-500 disabled:bg-teal-800 disabled:text-teal-400 text-white rounded transition-colors font-medium"
            >
              {importing ? 'Importing...' : 'Import'}
            </button>
          </div>
        </div>
      )}

      {/* Data Table */}
      {datasets.length === 0 && !showImport ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-3">
            <svg className="w-6 h-6 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <p className="text-sm text-zinc-400 mb-1">No datasets yet</p>
          <p className="text-xs text-zinc-600">Import a CSV to get started</p>
        </div>
      ) : (
        activeDataset && (
          <DataTable
            data={parsedData.rows}
            columns={columns}
            emptyMessage="No data in this dataset"
          />
        )
      )}
    </div>
  );
}
