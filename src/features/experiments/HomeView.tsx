import { useAppStore } from '@/store/useAppStore';
import { useState } from 'react';
import { useUserPrefs } from '@/lib/userPrefs';

export function HomeView() {
  const experiments = useAppStore((s) => s.experiments);
  const setView = useAppStore((s) => s.setView);
  const setActiveExperiment = useAppStore((s) => s.setActiveExperiment);
  const setModalOpen = useAppStore((s) => s.setModalOpen);
  const prefs = useUserPrefs();

  const [recentsCleared, setRecentsCleared] = useState(false);

  const activeExperiments = experiments.filter((e) => !e.archived);

  const handleOpenExperiment = (id: string) => {
    setActiveExperiment(id);
    setView('experiment');
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* Hero */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-zinc-100 mb-2">
          Welcome{prefs.userName && prefs.userName !== 'Researcher' ? `, ${prefs.userName.split(' ')[0]}` : ''}
        </h1>
        <p className="text-zinc-500 text-sm mb-6">
          Local-first experiment tracking, plotting, and statistical analysis
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setModalOpen('newExperiment')}
            className="px-6 py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-teal-900/30"
          >
            Start an Experiment
          </button>
          <button
            onClick={() => {
              setActiveExperiment(null);
              setView('plots');
            }}
            className="px-5 py-2.5 border border-zinc-700 hover:border-teal-600 text-zinc-300 hover:text-teal-300 text-sm font-medium rounded-lg transition-colors"
          >
            Plot a CSV
          </button>
        </div>
      </div>

      {/* Quick Action Cards */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        <QuickActionCard
          title="Import CSV"
          description="Load a dataset into the active experiment"
          icon={
            <svg className="w-5 h-5 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          }
          onClick={() => {
            if (experiments.length > 0) {
              setActiveExperiment(experiments[0].id);
              setView('experiment');
              useAppStore.getState().setExperimentTab('data');
            } else {
              setModalOpen('newExperiment');
            }
          }}
        />
        <QuickActionCard
          title="Experimental Design"
          description="Plan objectives, groups, reagents, and methods"
          icon={
            <svg className="w-5 h-5 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zM19.5 7.125L16.875 4.5" />
            </svg>
          }
          onClick={() => {
            setActiveExperiment(null);
            setView('design');
          }}
        />
      </div>

      {/* Recent Experiments */}
      {activeExperiments.length > 0 && !recentsCleared && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Recent Experiments</h2>
            <button
              onClick={() => setRecentsCleared(true)}
              className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Clear
            </button>
          </div>
          <div className="space-y-1.5">
            {activeExperiments.slice(0, 8).map((exp) => (
              <button
                key={exp.id}
                onClick={() => handleOpenExperiment(exp.id)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800/70 hover:border-zinc-700 transition-colors text-left group"
              >
                <div>
                  <span className="text-sm text-zinc-200 group-hover:text-zinc-100">{exp.name}</span>
                </div>
                <span className="text-xs text-zinc-600 font-mono">
                  {new Date(exp.created_ts).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeExperiments.length === 0 && (
        <div className="text-center py-10 border border-dashed border-zinc-800 rounded-lg">
          <p className="text-sm text-zinc-500">No experiments yet.</p>
          <p className="text-xs text-zinc-600 mt-1">Start one, or jump into any tool from the left.</p>
        </div>
      )}
    </div>
  );
}

function QuickActionCard({
  title,
  description,
  icon,
  onClick,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start gap-2 p-4 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800/70 hover:border-zinc-700 transition-colors text-left"
    >
      {icon}
      <div>
        <h3 className="text-sm font-medium text-zinc-200">{title}</h3>
        <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
      </div>
    </button>
  );
}
