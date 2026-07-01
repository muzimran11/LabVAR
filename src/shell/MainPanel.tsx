import { useAppStore } from '@/store/useAppStore';
import { HomeView } from '@/features/experiments/HomeView';
import { ExperimentView } from '@/features/experiments/ExperimentView';
import { InventoryView } from '@/features/inventory/InventoryView';
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
      case 'inventory':
        return <InventoryView />;
      default:
        return <HomeView />;
    }
  };

  return (
    <main className="flex-1 overflow-y-auto bg-zinc-950">
      {renderView()}

      {/* Global modals */}
      {modalOpen === 'newExperiment' && (
        <Modal title="New Experiment" onClose={() => setModalOpen(null)}>
          <NewExperimentModal onClose={() => setModalOpen(null)} />
        </Modal>
      )}
    </main>
  );
}
