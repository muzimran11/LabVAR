import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { DataTab } from '@/features/experiments/DataTab';
import { PlotTab } from '@/features/plot/PlotTab';
import { StatsTab } from '@/features/stats/StatsTab';
import { DesignTab } from '@/features/design/DesignTab';
import { NotesTab } from '@/features/experiments/NotesTab';
import type { ExperimentTab } from '@/store/useAppStore';
import { getProjectDir, setProjectDir, chooseProjectDir } from '@/lib/exportFile';

// Hypothesis-first ordering: think it through, then import data, then plot & test.
const TABS: { id: ExperimentTab; label: string }[] = [
  { id: 'design', label: '1 · Hypothesis' },
  { id: 'data', label: '2 · Data' },
  { id: 'plots', label: '3 · Plots' },
  { id: 'stats', label: '4 · Stats' },
  { id: 'notes', label: 'Notes' },
];

export function ExperimentView() {
  const activeExperimentId = useAppStore((s) => s.activeExperimentId);
  const experiments = useAppStore((s) => s.experiments);
  const experimentTab = useAppStore((s) => s.experimentTab);
  const setExperimentTab = useAppStore((s) => s.setExperimentTab);
  const setView = useAppStore((s) => s.setView);
  const loadDatasets = useAppStore((s) => s.loadDatasets);
  const loadFigures = useAppStore((s) => s.loadFigures);
  const loadTestResults = useAppStore((s) => s.loadTestResults);
  const loadNotes = useAppStore((s) => s.loadNotes);
  const loadHypotheses = useAppStore((s) => s.loadHypotheses);

  const experiment = experiments.find((e) => e.id === activeExperimentId);

  useEffect(() => {
    if (activeExperimentId) {
      loadDatasets(activeExperimentId);
      loadFigures(activeExperimentId);
      loadTestResults(activeExperimentId);
      loadNotes(activeExperimentId);
      loadHypotheses(activeExperimentId);
    }
  }, [activeExperimentId, loadDatasets, loadFigures, loadTestResults, loadNotes, loadHypotheses]);

  if (!experiment) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-zinc-500 text-sm">No experiment selected</p>
      </div>
    );
  }

  const renderTab = () => {
    switch (experimentTab) {
      case 'data':
        return <DataTab />;
      case 'plots':
        return <PlotTab />;
      case 'stats':
        return <StatsTab />;
      case 'design':
        return <DesignTab />;
      case 'notes':
        return <NotesTab />;
      default:
        return <DataTab />;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-5 pb-0 flex-shrink-0">
        <div className="flex items-baseline gap-3 mb-1">
          <h1 className="text-xl font-semibold text-zinc-100">{experiment.name}</h1>
          <span className="text-xs text-zinc-600 font-mono">
            {new Date(experiment.created_ts).toLocaleDateString()}
          </span>
          <button
            onClick={() => {
              try { localStorage.setItem('labvar.graph.project', experiment.id); } catch { /* ignore */ }
              setView('notebook');
            }}
            className="ml-auto text-xs text-teal-500 hover:text-teal-400"
            title="Open this experiment's node cluster in the Node view"
          >
            Open node cluster
          </button>
        </div>

        <ProjectFolderBar experimentId={experiment.id} />

        {/* Tab Bar */}
        <div className="flex gap-0 border-b border-zinc-800">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setExperimentTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                experimentTab === tab.id
                  ? 'text-teal-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab.label}
              {experimentTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500 rounded-t" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {renderTab()}
      </div>
    </div>
  );
}

/**
 * Binds one on-disk folder to this experiment/project. Once set, imported files
 * are copied into it (under data/ and images/) and exports land there, so the
 * whole project — data, images, figures — lives together in one directory.
 */
function ProjectFolderBar({ experimentId }: { experimentId: string }) {
  const [dir, setDir] = useState<string | undefined>(() => getProjectDir(experimentId));

  useEffect(() => {
    setDir(getProjectDir(experimentId));
  }, [experimentId]);

  const pick = async () => {
    try {
      const chosen = await chooseProjectDir(experimentId);
      if (chosen) setDir(chosen);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const clear = () => {
    setProjectDir(experimentId, null);
    setDir(undefined);
  };

  return (
    <div className="flex items-center gap-2 mb-2 text-xs">
      <span className="text-zinc-500">Project folder:</span>
      {dir ? (
        <>
          <span className="text-zinc-300 font-mono truncate max-w-[46ch]" title={dir}>{dir}</span>
          <button onClick={pick} className="text-teal-500 hover:text-teal-400">Change</button>
          <button onClick={clear} className="text-zinc-500 hover:text-red-400">Clear</button>
        </>
      ) : (
        <>
          <span className="text-zinc-600">not set — inputs stay where they are and exports prompt each time</span>
          <button onClick={pick} className="text-teal-500 hover:text-teal-400">Set folder</button>
        </>
      )}
    </div>
  );
}
