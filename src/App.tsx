import { useEffect, useState } from 'react';
import { Sidebar } from './shell/Sidebar';
import { MainPanel } from './shell/MainPanel';
import { useAppStore, applyThemeClass } from './store/useAppStore';
import { getPrefs, useUserPrefs } from './lib/userPrefs';
import { OnboardingWizard } from './features/onboarding/OnboardingWizard';

export default function App() {
  const loadExperiments = useAppStore((s) => s.loadExperiments);
  const theme = useAppStore((s) => s.theme);
  const prefs = useUserPrefs();

  // Show onboarding on first ever run; the flag is checked once at mount so
  // toggling it inside Settings doesn't rip the wizard open mid-session.
  const [showOnboarding, setShowOnboarding] = useState(() => !getPrefs().onboarded);

  // Reflect the persisted theme onto <html> before first paint of children.
  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  useEffect(() => {
    loadExperiments();
  }, [loadExperiments]);

  if (showOnboarding) {
    return (
      <div className="h-screen w-screen bg-zinc-950 text-zinc-100">
        <OnboardingWizard onFinish={() => setShowOnboarding(false)} />
      </div>
    );
  }

  // Reference prefs so the shell subscribes and re-renders when the wizard finishes.
  void prefs;

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <Sidebar />
      <MainPanel />
    </div>
  );
}
