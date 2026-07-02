import { useEffect } from 'react';
import { Sidebar } from './shell/Sidebar';
import { MainPanel } from './shell/MainPanel';
import { useAppStore, applyThemeClass } from './store/useAppStore';

export default function App() {
  const loadExperiments = useAppStore((s) => s.loadExperiments);
  const theme = useAppStore((s) => s.theme);

  // Reflect the persisted theme onto <html> before first paint of children.
  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  useEffect(() => {
    loadExperiments();
  }, [loadExperiments]);

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <Sidebar />
      <MainPanel />
    </div>
  );
}
