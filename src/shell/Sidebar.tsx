import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { deleteExperiment, archiveExperiment, unarchiveExperiment, renameExperiment } from '@/lib/invoke';

const NAV_ITEMS = [
  { id: 'inventory' as const, label: 'Inventory', icon: '\u{1F4E6}' },
] as const;

export function Sidebar() {
  const view = useAppStore((s) => s.view);
  const experiments = useAppStore((s) => s.experiments);
  const activeExperimentId = useAppStore((s) => s.activeExperimentId);
  const setView = useAppStore((s) => s.setView);
  const setActiveExperiment = useAppStore((s) => s.setActiveExperiment);
  const setModalOpen = useAppStore((s) => s.setModalOpen);
  const loadExperiments = useAppStore((s) => s.loadExperiments);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);

  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const activeExperiments = experiments.filter(e => !e.archived);
  const archivedExperiments = experiments.filter(e => e.archived);

  const handleExperimentClick = (id: string) => {
    setActiveExperiment(id);
    setView('experiment');
  };

  return (
    <aside className="w-60 flex-shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col h-full">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 3h6v7a4 4 0 0 1 2 3.5V18a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3v-4.5A4 4 0 0 1 9 10V3z" />
            <line x1="7" y1="3" x2="17" y2="3" />
            <line x1="10" y1="7" x2="14" y2="7" />
          </svg>
          <span className="text-lg font-semibold text-zinc-100 tracking-tight">LabVAR</span>
          <span className="text-[10px] text-zinc-500 ml-auto font-mono">v0.1</span>
        </div>
      </div>

      {/* Experiments */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 pt-4 pb-1">
          <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider px-1">Experiments</h3>
        </div>
        <nav className="px-2 space-y-0.5">
          {activeExperiments.length === 0 && (
            <p className="text-xs text-zinc-600 px-2 py-2">No experiments yet</p>
          )}
          {activeExperiments.map((exp) => (
            <div key={exp.id} className="relative group">
              {renamingId === exp.id ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (renameValue.trim() && renameValue.trim() !== exp.name) {
                      await renameExperiment(exp.id, renameValue.trim());
                      await loadExperiments();
                    }
                    setRenamingId(null);
                  }}
                  className="px-1"
                >
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={async () => {
                      if (renameValue.trim() && renameValue.trim() !== exp.name) {
                        await renameExperiment(exp.id, renameValue.trim());
                        await loadExperiments();
                      }
                      setRenamingId(null);
                    }}
                    onKeyDown={(e) => { if (e.key === 'Escape') setRenamingId(null); }}
                    className="w-full px-1.5 py-1 text-sm bg-zinc-800 border border-teal-600 rounded text-zinc-200 focus:outline-none"
                  />
                </form>
              ) : (
                <>
                  <button
                    onClick={() => handleExperimentClick(exp.id)}
                    onDoubleClick={() => {
                      setRenamingId(exp.id);
                      setRenameValue(exp.name);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded text-sm truncate transition-colors pr-7 ${
                      view === 'experiment' && activeExperimentId === exp.id
                        ? 'bg-teal-500/15 text-teal-400 font-medium'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                    }`}
                  >
                    {exp.name}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === exp.id ? null : exp.id);
                    }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
                    </svg>
                  </button>
                </>
              )}
              {menuOpenId === exp.id && (
                <div className="absolute right-0 top-full mt-0.5 z-50 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[140px]">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(null);
                      setRenamingId(exp.id);
                      setRenameValue(exp.name);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    Rename
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      setMenuOpenId(null);
                      try {
                        await archiveExperiment(exp.id);
                        await loadExperiments();
                        if (activeExperimentId === exp.id) {
                          setActiveExperiment(null);
                          setView('home');
                        }
                      } catch (err) {
                        console.error('Failed to archive:', err);
                      }
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    Archive
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      setMenuOpenId(null);
                      try {
                        await deleteExperiment(exp.id);
                        await loadExperiments();
                        if (activeExperimentId === exp.id) {
                          setActiveExperiment(null);
                          setView('home');
                        }
                      } catch (err) {
                        alert(err instanceof Error ? err.message : String(err));
                      }
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-zinc-700 transition-colors"
                  >
                    Delete (empty only)
                  </button>
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="px-2 pt-2">
          <button
            onClick={() => setModalOpen('newExperiment')}
            className="w-full text-left px-2.5 py-1.5 rounded text-sm text-teal-500 hover:bg-teal-500/10 transition-colors flex items-center gap-1.5"
          >
            <span className="text-base leading-none">+</span> New Experiment
          </button>
        </div>

        {/* Archived Experiments */}
        {archivedExperiments.length > 0 && (
          <div className="px-2 pt-3">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="w-full text-left px-1 py-1 text-[11px] font-semibold text-zinc-600 uppercase tracking-wider hover:text-zinc-400 transition-colors flex items-center gap-1"
            >
              <svg className={`w-3 h-3 transition-transform ${showArchived ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              Archived ({archivedExperiments.length})
            </button>
            {showArchived && (
              <nav className="space-y-0.5 mt-1">
                {archivedExperiments.map((exp) => (
                  <div key={exp.id} className="relative group">
                    <button
                      onClick={() => handleExperimentClick(exp.id)}
                      className={`w-full text-left px-2.5 py-1.5 rounded text-sm truncate transition-colors pr-7 text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800 italic`}
                    >
                      {exp.name}
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await unarchiveExperiment(exp.id);
                          await loadExperiments();
                        } catch (err) {
                          console.error('Failed to unarchive:', err);
                        }
                      }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] text-zinc-500 hover:text-teal-400 hover:bg-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </nav>
            )}
          </div>
        )}

        {/* Quick Actions */}
        <div className="px-3 pt-6 pb-1">
          <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider px-1">Quick Actions</h3>
        </div>
        <nav className="px-2 space-y-0.5">
          <button
            onClick={() => {
              if (activeExperimentId) {
                setView('experiment');
                useAppStore.getState().setExperimentTab('data');
              }
            }}
            className="w-full text-left px-2.5 py-1.5 rounded text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            Import CSV
          </button>
          <button
            onClick={() => setModalOpen('logCultureCheck')}
            className="w-full text-left px-2.5 py-1.5 rounded text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            Log Culture Check
          </button>
        </nav>

        {/* Inventory */}
        <div className="px-3 pt-6 pb-1">
          <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider px-1">Lab Management</h3>
        </div>
        <nav className="px-2 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => { setView(item.id); setActiveExperiment(null); }}
              className={`w-full text-left px-2.5 py-1.5 rounded text-sm transition-colors flex items-center gap-2 ${
                view === item.id
                  ? 'bg-teal-500/15 text-teal-400 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <span className="text-sm">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-zinc-800 flex items-center justify-between">
        <button
          onClick={() => { setView('home'); setActiveExperiment(null); }}
          className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
        >
          Local-first research tool
        </button>
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle color theme"
          className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        >
          {theme === 'dark' ? (
            // Sun
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
              <circle cx="12" cy="12" r="4" />
              <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            // Moon
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          )}
        </button>
      </div>
    </aside>
  );
}
