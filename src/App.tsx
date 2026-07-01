import { useEffect } from 'react';
import { Sidebar } from './shell/Sidebar';
import { MainPanel } from './shell/MainPanel';
import { useAppStore } from './store/useAppStore';

export default function App() {
  const loadExperiments = useAppStore((s) => s.loadExperiments);

  useEffect(() => {
    loadExperiments();
  }, [loadExperiments]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <MainPanel />
    </div>
  );
}
