import { useAppStore } from '@/store/useAppStore';
import { useEffect, useState } from 'react';

export function HomeView() {
  const experiments = useAppStore((s) => s.experiments);
  const stocks = useAppStore((s) => s.stocks);
  const cultures = useAppStore((s) => s.cultures);
  const setView = useAppStore((s) => s.setView);
  const setActiveExperiment = useAppStore((s) => s.setActiveExperiment);
  const setModalOpen = useAppStore((s) => s.setModalOpen);
  const loadStocks = useAppStore((s) => s.loadStocks);
  const loadCultures = useAppStore((s) => s.loadCultures);

  useEffect(() => {
    loadStocks();
    loadCultures();
  }, [loadStocks, loadCultures]);

  const [recentsCleared, setRecentsCleared] = useState(false);
  const activeExperiments = experiments.filter(e => !e.archived);

  const lowStocks = stocks.filter((s) => s.qty <= s.reorder_at * 1.5);
  const overdueCultures = cultures.filter((c) => {
    if (!c.next_due) return false;
    return new Date(c.next_due) <= new Date();
  });
  const dueTodayCultures = cultures.filter((c) => {
    if (!c.next_due) return false;
    const due = new Date(c.next_due);
    const now = new Date();
    return due > now && due.toDateString() === now.toDateString();
  });

  const handleOpenExperiment = (id: string) => {
    setActiveExperiment(id);
    setView('experiment');
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* Hero */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-zinc-100 mb-2">LabVAR</h1>
        <p className="text-zinc-500 text-sm mb-6">Local-first experiment tracking, plotting, and statistical analysis</p>
        <button
          onClick={() => setModalOpen('newExperiment')}
          className="px-6 py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-teal-900/30"
        >
          Start an Experiment
        </button>
      </div>

      {/* Quick Action Cards */}
      <div className="grid grid-cols-3 gap-3 mb-8">
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
          title="Log Culture Check"
          description="Record a cell culture observation"
          icon={
            <svg className="w-5 h-5 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          onClick={() => setModalOpen('logCultureCheck')}
        />
        <QuickActionCard
          title="Add Stock Item"
          description="Track a new reagent or consumable"
          icon={
            <svg className="w-5 h-5 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
          }
          onClick={() => {
            setView('inventory');
            setTimeout(() => setModalOpen('addStock'), 100);
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

      {/* Dashboard Alerts */}
      {(lowStocks.length > 0 || overdueCultures.length > 0 || dueTodayCultures.length > 0) && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Alerts</h2>

          {overdueCultures.length > 0 && (
            <AlertCard
              type="danger"
              title={`${overdueCultures.length} overdue culture check${overdueCultures.length > 1 ? 's' : ''}`}
              items={overdueCultures.map((c) => c.name)}
              action="View Inventory"
              onAction={() => setView('inventory')}
            />
          )}

          {dueTodayCultures.length > 0 && (
            <AlertCard
              type="warning"
              title={`${dueTodayCultures.length} culture check${dueTodayCultures.length > 1 ? 's' : ''} due today`}
              items={dueTodayCultures.map((c) => c.name)}
              action="View Inventory"
              onAction={() => setView('inventory')}
            />
          )}

          {lowStocks.length > 0 && (
            <AlertCard
              type="warning"
              title={`${lowStocks.length} stock item${lowStocks.length > 1 ? 's' : ''} running low`}
              items={lowStocks.map((s) => `${s.name}: ${s.qty} ${s.unit}`)}
              action="View Inventory"
              onAction={() => setView('inventory')}
            />
          )}
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

function AlertCard({
  type,
  title,
  items,
  action,
  onAction,
}: {
  type: 'danger' | 'warning';
  title: string;
  items: string[];
  action: string;
  onAction: () => void;
}) {
  const borderColor = type === 'danger' ? 'border-red-800' : 'border-amber-800';
  const bgColor = type === 'danger' ? 'bg-red-950/30' : 'bg-amber-950/30';
  const dotColor = type === 'danger' ? 'bg-red-500' : 'bg-amber-500';

  return (
    <div className={`${bgColor} ${borderColor} border rounded-lg px-4 py-3`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <div className={`w-2 h-2 rounded-full ${dotColor} mt-1.5 flex-shrink-0`} />
          <div>
            <p className="text-sm text-zinc-200 font-medium">{title}</p>
            <p className="text-xs text-zinc-500 mt-1">{items.slice(0, 3).join(', ')}{items.length > 3 ? ` +${items.length - 3} more` : ''}</p>
          </div>
        </div>
        <button
          onClick={onAction}
          className="text-xs text-teal-500 hover:text-teal-400 transition-colors whitespace-nowrap ml-4"
        >
          {action}
        </button>
      </div>
    </div>
  );
}
