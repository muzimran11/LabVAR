import { useState, useCallback } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { addNote, deleteNote } from '@/lib/invoke';

export function NotesTab() {
  const activeExperimentId = useAppStore((s) => s.activeExperimentId);
  const notes = useAppStore((s) => s.notes);
  const loadNotes = useAppStore((s) => s.loadNotes);

  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAddNote = useCallback(async () => {
    if (!activeExperimentId || !content.trim()) return;
    setSubmitting(true);
    try {
      await addNote(activeExperimentId, content.trim());
      await loadNotes(activeExperimentId);
      setContent('');
    } catch (err) {
      console.error('Failed to add note:', err);
    } finally {
      setSubmitting(false);
    }
  }, [activeExperimentId, content, loadNotes]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleAddNote();
    }
  };

  const handleDeleteNote = useCallback(async (id: string) => {
    if (!activeExperimentId) return;
    if (!confirm('Delete this note?')) return;
    try {
      await deleteNote(id);
      await loadNotes(activeExperimentId);
    } catch (err) {
      alert('Could not delete note: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, [activeExperimentId, loadNotes]);

  // Sort notes newest first
  const sortedNotes = [...notes].sort(
    (a, b) => new Date(b.created_ts).getTime() - new Date(a.created_ts).getTime()
  );

  return (
    <div className="max-w-2xl space-y-5">
      {/* Add note form */}
      <div className="space-y-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a lab note... (Cmd+Enter to save)"
          rows={4}
          className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600/30 resize-none"
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-600">Notes save to the provenance log. You can delete them anytime.</p>
          <button
            onClick={handleAddNote}
            disabled={submitting || !content.trim()}
            className="px-4 py-1.5 text-sm bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded transition-colors font-medium"
          >
            {submitting ? 'Saving...' : 'Add Note'}
          </button>
        </div>
      </div>

      {/* Notes list */}
      {sortedNotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <p className="text-sm text-zinc-400">No notes yet</p>
          <p className="text-xs text-zinc-600 mt-1">Record observations, methods, and ideas</p>
        </div>
      ) : (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            Notes ({sortedNotes.length})
          </h3>
          {sortedNotes.map((note) => (
            <div
              key={note.id}
              className="group bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3"
            >
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed flex-1">
                  {note.content}
                </p>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-[11px] text-zinc-600 font-mono whitespace-nowrap">
                    {formatTimestamp(note.created_ts)}
                  </span>
                  <button
                    onClick={() => handleDeleteNote(note.id)}
                    className="text-[11px] text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
