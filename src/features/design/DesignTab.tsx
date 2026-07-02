import { useState, useCallback } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { saveHypothesis, searchPubmed } from '@/lib/invoke';

interface ReviewerCritique {
  id: string;
  text: string;
  addressed_by: string;
}

interface PubmedResult {
  pmid: string;
  title: string;
  authors: string[];
  journal: string;
  year: string;
  doi?: string;
}

export function DesignTab() {
  const activeExperimentId = useAppStore((s) => s.activeExperimentId);
  const hypotheses = useAppStore((s) => s.hypotheses);
  const loadHypotheses = useAppStore((s) => s.loadHypotheses);

  // Hypothesis fields
  const [question, setQuestion] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [nullH, setNullH] = useState('');
  const [altH, setAltH] = useState('');
  const [savingHypothesis, setSavingHypothesis] = useState(false);

  // PubMed search
  const [pubmedQuery, setPubmedQuery] = useState('');
  const [pubmedResults, setPubmedResults] = useState<PubmedResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [savedArticles, setSavedArticles] = useState<PubmedResult[]>([]);

  // Reviewer critiques (local UI state, not persisted)
  const [reviewerCritiques, setReviewerCritiques] = useState<ReviewerCritique[]>([]);
  const [newCritiqueText, setNewCritiqueText] = useState('');
  const [newCritiqueAddressedBy, setNewCritiqueAddressedBy] = useState('');

  // Load existing hypothesis if available
  const existingHyp = hypotheses.length > 0 ? hypotheses[0] : null;

  const handleSaveHypothesis = useCallback(async () => {
    if (!activeExperimentId) return;
    setSavingHypothesis(true);
    try {
      await saveHypothesis(
        activeExperimentId,
        question.trim(),
        hypothesis.trim(),
        nullH.trim(),
        altH.trim()
      );
      await loadHypotheses(activeExperimentId);
    } catch (err) {
      console.error('Failed to save hypothesis:', err);
    } finally {
      setSavingHypothesis(false);
    }
  }, [activeExperimentId, question, hypothesis, nullH, altH, loadHypotheses]);

  const handlePubmedSearch = useCallback(async () => {
    if (!pubmedQuery.trim()) return;
    setSearching(true);
    try {
      const results = await searchPubmed(pubmedQuery.trim(), 10);
      setPubmedResults(results);
    } catch (err) {
      console.error('PubMed search failed:', err);
      // Show mock data for development
      setPubmedResults([]);
    } finally {
      setSearching(false);
    }
  }, [pubmedQuery]);

  const addArticle = (article: PubmedResult) => {
    if (!savedArticles.find((a) => a.pmid === article.pmid)) {
      setSavedArticles((prev) => [...prev, article]);
    }
  };

  const removeArticle = (pmid: string) => {
    setSavedArticles((prev) => prev.filter((a) => a.pmid !== pmid));
  };

  const addCritique = () => {
    if (!newCritiqueText.trim()) return;
    const critique = {
      id: crypto.randomUUID(),
      text: newCritiqueText.trim(),
      addressed_by: newCritiqueAddressedBy.trim(),
    };
    setReviewerCritiques([...reviewerCritiques, critique]);
    setNewCritiqueText('');
    setNewCritiqueAddressedBy('');
  };

  const removeCritique = (id: string) => {
    setReviewerCritiques(reviewerCritiques.filter((c) => c.id !== id));
  };

  return (
    <div className="max-w-3xl space-y-8">
      {/* Section 1: Research Question */}
      <section>
        <SectionHeader number={1} title="Research Question" />
        <textarea
          value={question || existingHyp?.question || ''}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What specific question does this experiment address?"
          rows={3}
          className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600/30 resize-none"
        />
      </section>

      {/* Section 2: Literature */}
      <section>
        <SectionHeader number={2} title="Literature" />
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={pubmedQuery}
              onChange={(e) => setPubmedQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePubmedSearch()}
              placeholder="Search PubMed..."
              className="flex-1 px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600"
            />
            <button
              onClick={handlePubmedSearch}
              disabled={searching}
              className="px-4 py-1.5 text-sm bg-teal-600 hover:bg-teal-500 disabled:bg-teal-800 text-white rounded transition-colors font-medium"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>

          {/* Search Results */}
          {pubmedResults.length > 0 && (
            <div className="border border-zinc-800 rounded-lg divide-y divide-zinc-800 max-h-60 overflow-y-auto">
              {pubmedResults.map((result) => (
                <div key={result.pmid} className="px-3 py-2 hover:bg-zinc-800/50 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-300 leading-snug">{result.title}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {result.authors.join(', ')} &middot; {result.journal} ({result.year})
                    </p>
                  </div>
                  <button
                    onClick={() => addArticle(result)}
                    className={`flex-shrink-0 text-xs px-2 py-1 rounded transition-colors ${
                      savedArticles.find((a) => a.pmid === result.pmid)
                        ? 'bg-teal-600/20 text-teal-500 cursor-default'
                        : 'bg-zinc-700 text-zinc-300 hover:bg-teal-600 hover:text-white'
                    }`}
                    disabled={!!savedArticles.find((a) => a.pmid === result.pmid)}
                  >
                    {savedArticles.find((a) => a.pmid === result.pmid) ? 'Added' : 'Add'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Saved Articles */}
          {savedArticles.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 font-medium mb-2">
                Saved References ({savedArticles.length})
              </p>
              <div className="space-y-1">
                {savedArticles.map((article) => (
                  <div
                    key={article.pmid}
                    className="flex items-center justify-between px-3 py-2 bg-zinc-900 border border-zinc-800 rounded"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-300 truncate">{article.title}</p>
                      <p className="text-xs text-zinc-600">
                        PMID: {article.pmid} &middot; {article.year}
                      </p>
                    </div>
                    <button
                      onClick={() => removeArticle(article.pmid)}
                      className="text-zinc-600 hover:text-red-400 text-xs ml-2 flex-shrink-0"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Section 3: Hypothesis */}
      <section>
        <SectionHeader number={3} title="Hypothesis" />
        <p className="text-xs text-zinc-500 mb-2">
          The effect you expect. e.g. &ldquo;FUdR upregulates <em>numr-1</em>.&rdquo;
        </p>
        <textarea
          value={hypothesis || existingHyp?.hypothesis || ''}
          onChange={(e) => setHypothesis(e.target.value)}
          placeholder="FUdR treatment increases numr-1 expression."
          rows={3}
          className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600/30 resize-none"
        />
      </section>

      {/* Section 4: Null Hypothesis (H0) */}
      <section>
        <SectionHeader number={4} title="Null Hypothesis (H&#x2080;)" />
        <p className="text-xs text-zinc-500 mb-2">
          The &ldquo;no effect&rdquo; version you&rsquo;re trying to reject.
        </p>
        <textarea
          value={nullH || existingHyp?.null_h || ''}
          onChange={(e) => setNullH(e.target.value)}
          placeholder="numr-1 expression does not differ between FUdR-treated and control."
          rows={2}
          className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600/30 resize-none"
        />
      </section>

      {/* Section 5: Prediction — what result would prove the hypothesis */}
      <section>
        <SectionHeader number={5} title="Prediction (H&#x2081;) — what result would prove it" />
        <p className="text-xs text-zinc-500 mb-2">
          The concrete, measurable outcome that would support the hypothesis over the null.
          e.g. &ldquo;24&nbsp;h FUdR-treated worms show higher <em>numr-1</em> expression than control.&rdquo;
        </p>
        <textarea
          value={altH || existingHyp?.alt_h || ''}
          onChange={(e) => setAltH(e.target.value)}
          placeholder="24 h treatment group shows significantly greater numr-1 expression than control."
          rows={2}
          className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600/30 resize-none"
        />
      </section>

      {/* Save Hypothesis Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSaveHypothesis}
          disabled={savingHypothesis}
          className="px-4 py-2 text-sm bg-teal-600 hover:bg-teal-500 disabled:bg-teal-800 disabled:text-teal-400 text-white rounded transition-colors font-medium"
        >
          {savingHypothesis ? 'Saving...' : existingHyp ? 'Update Hypothesis' : 'Save Hypothesis'}
        </button>
      </div>

      {/* Section 6: Reviewer Critique Checklist */}
      <section>
        <SectionHeader number={6} title="Reviewer Critique Checklist" />
        <p className="text-xs text-zinc-500 mb-3">
          Anticipate what a reviewer might attack. For each concern, note which experiment or data addresses it.
        </p>

        {/* Existing critiques */}
        {reviewerCritiques.length > 0 && (
          <div className="space-y-2 mb-4">
            {reviewerCritiques.map((critique, idx) => (
              <div
                key={critique.id}
                className="bg-zinc-900 border border-zinc-800 rounded-lg p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded">
                        #{idx + 1}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-300">{critique.text}</p>
                    {critique.addressed_by && (
                      <p className="text-xs text-teal-500/80 mt-1">
                        Addressed by: {critique.addressed_by}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => removeCritique(critique.id)}
                    className="text-zinc-600 hover:text-red-400 text-sm flex-shrink-0"
                  >
                    &times;
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add new critique */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 space-y-2">
          <textarea
            value={newCritiqueText}
            onChange={(e) => setNewCritiqueText(e.target.value)}
            placeholder="What would a reviewer attack?"
            rows={2}
            className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600 resize-none"
          />
          <input
            type="text"
            value={newCritiqueAddressedBy}
            onChange={(e) => setNewCritiqueAddressedBy(e.target.value)}
            placeholder="Which experiment / data addresses this? (optional)"
            className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600"
          />
          <div className="flex justify-end">
            <button
              onClick={addCritique}
              disabled={!newCritiqueText.trim()}
              className="px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 rounded transition-colors font-medium"
            >
              Add Critique
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SectionHeader({ number, title }: { number: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-2">
      <span className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[11px] font-mono text-zinc-400">
        {number}
      </span>
      <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
    </div>
  );
}
