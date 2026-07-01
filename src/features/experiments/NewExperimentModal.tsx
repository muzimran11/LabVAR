import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { createExperiment } from '@/lib/invoke';

interface Props {
  onClose: () => void;
}

export function NewExperimentModal({ onClose }: Props) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadExperiments = useAppStore((s) => s.loadExperiments);
  const setView = useAppStore((s) => s.setView);
  const setActiveExperiment = useAppStore((s) => s.setActiveExperiment);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Experiment name is required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const id = await createExperiment(name.trim());
      await loadExperiments();
      setActiveExperiment(id);
      setView('experiment');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create experiment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">
          Experiment Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., siRNA knockdown dose response"
          className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600/30"
          autoFocus
        />
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 text-sm bg-teal-600 hover:bg-teal-500 disabled:bg-teal-800 disabled:text-teal-400 text-white rounded transition-colors font-medium"
        >
          {submitting ? 'Creating...' : 'Create Experiment'}
        </button>
      </div>
    </form>
  );
}
