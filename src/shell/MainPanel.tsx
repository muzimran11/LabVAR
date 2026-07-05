import { useRef } from 'react';
import { useAppStore } from '@/store/useAppStore';
import type { View } from '@/store/useAppStore';
import { HomeView } from '@/features/experiments/HomeView';
import { ExperimentView } from '@/features/experiments/ExperimentView';
import { DesignWorkspace } from '@/features/design/DesignWorkspace';
import { PlotWorkspace } from '@/features/plot/PlotWorkspace';
import { GelWorkspace } from '@/features/gel/GelWorkspace';
import { AssayWorkspace } from '@/features/assays/AssayWorkspace';
import { LabMathWorkspace } from '@/features/labmath/LabMathWorkspace';
import { ImageWorkspace } from '@/features/image/ImageWorkspace';
import { NotebookWorkspace } from '@/features/notebook/NotebookWorkspace';
import { SettingsWorkspace } from '@/features/settings/SettingsWorkspace';
import { Modal } from '@/components/Modal';
import { NewExperimentModal } from '@/features/experiments/NewExperimentModal';

export function MainPanel() {
  const view = useAppStore((s) => s.view);
  const modalOpen = useAppStore((s) => s.modalOpen);
  const setModalOpen = useAppStore((s) => s.setModalOpen);

  const renderView = () => {
    switch (view) {
      case 'home':
        return <HomeView />;
      case 'experiment':
        return <ExperimentView />;
      case 'design':
        return <DesignWorkspace />;
      case 'plots':
        return <PlotWorkspace />;
      case 'gel':
        return <GelWorkspace />;
      case 'assays':
        return <AssayWorkspace />;
      case 'labmath':
        return <LabMathWorkspace />;
      case 'image':
        return <ImageWorkspace />;
      case 'notebook':
        return <NotebookWorkspace />;
      case 'settings':
        return <SettingsWorkspace />;
      default:
        return <HomeView />;
    }
  };

  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
      {/* slim top bar — persistent Node view tab on the right */}
      <div className="h-9 flex-shrink-0 flex items-center justify-end px-3 border-b border-zinc-800 bg-zinc-950 gap-1">
        <NodeViewTab />
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">{renderView()}</div>

      {/* Global modals */}
      {modalOpen === 'newExperiment' && (
        <Modal title="New Experiment" onClose={() => setModalOpen(null)}>
          <NewExperimentModal onClose={() => setModalOpen(null)} />
        </Modal>
      )}
    </main>
  );
}

/** A persistent tab that jumps into the full-screen Node view and back. */
function NodeViewTab() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const setActiveExperiment = useAppStore((s) => s.setActiveExperiment);
  const lastView = useRef<View>('home');

  if (view !== 'notebook') lastView.current = view;
  const active = view === 'notebook';

  return (
    <button
      onClick={() => {
        if (active) {
          setView(lastView.current === 'notebook' ? 'home' : lastView.current);
        } else {
          setActiveExperiment(null);
          setView('notebook');
        }
      }}
      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors border ${
        active
          ? 'bg-teal-500/20 text-teal-300 border-teal-600/40'
          : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 border-transparent'
      }`}
      title="Open the 3D node view"
    >
      Node view
    </button>
  );
}
