'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import Alert from '@/components/Alert';
import ConfirmDialog from '@/components/ConfirmDialog';
import Spinner from '@/components/Spinner';
import StatusPill from '@/components/StatusPill';
import { get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

function Vote() {
  const { phase } = useAuth();
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // { [categoryId]: candidateId } for categories not yet voted in
  const [selections, setSelections] = useState({});
  const [confirm, setConfirm] = useState(null); // { categoryId, candidateId, name }
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await get('/shortlist');
      setCategories(data.categories);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submitVote = async () => {
    if (!confirm) return;
    setBusy(true);
    setError('');
    try {
      await post('/votes', { categoryId: confirm.categoryId, candidateId: confirm.candidateId });
      setConfirm(null);
      setSelections((current) => {
        const next = { ...current };
        delete next[confirm.categoryId];
        return next;
      });
      await load();
    } catch (voteError) {
      setError(voteError.message);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const votedCount = categories.filter((category) => category.hasVoted).length;
  const selectedCount = categories.filter((category) => !category.hasVoted && selections[category.id]).length;

  return (
    <AppShell
      title="Final vote"
      description="One vote per category, 1 point each. Your vote is confidential and cannot be changed."
    >
      {phase !== 'PHASE_3' && (
        <Alert tone="warning" className="mb-4">
          Voting is not open right now. This page works during Phase 3 only.
        </Alert>
      )}

      <section className="card mb-5 !p-4 sm:!p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusPill tone={votedCount === categories.length && categories.length > 0 ? 'green' : 'brand'}>
              {votedCount} of {categories.length} votes submitted
            </StatusPill>
            <StatusPill tone="slate">{selectedCount} selection{selectedCount === 1 ? '' : 's'} ready</StatusPill>
          </div>
          <span className="text-xs text-slate-500">Votes are confidential and final once submitted.</span>
        </div>
      {categories.length > 0 && (
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label="Voting progress"
          aria-valuemin={0}
          aria-valuemax={categories.length}
          aria-valuenow={votedCount}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-600 to-emerald-500 transition-all"
            style={{ width: `${(votedCount / categories.length) * 100}%` }}
          />
        </div>
      )}
      </section>

      <Alert tone="error" className="mb-4">{error}</Alert>
      {loading && <Spinner label="Loading the shortlist…" />}
      {!loading && categories.length === 0 && !error && (
        <Alert tone="warning">No final-vote shortlist is available yet. Please check back when voting opens.</Alert>
      )}

      <div className="space-y-6">
        {categories.map((category) => (
          <section key={category.id} className="card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900">{category.name}</h2>
              {category.hasVoted ? (
                <StatusPill tone="green">Vote recorded</StatusPill>
              ) : (
                <StatusPill tone="amber">Not voted yet</StatusPill>
              )}
            </div>

            <fieldset disabled={category.hasVoted || phase !== 'PHASE_3' || busy} className="space-y-2">
              <legend className="sr-only">{category.name}</legend>
              {category.candidates.map((candidate) => {
                const selected = selections[category.id] === candidate.id;
                return (
                  <label
                    key={candidate.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-sm transition ${selected ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100' : 'border-slate-200 hover:border-brand-200 hover:bg-slate-50'
                      } ${category.hasVoted ? 'cursor-not-allowed opacity-70' : ''}`}
                  >
                    <input
                      type="radio"
                      name={`category-${category.id}`}
                      className="mt-0.5"
                      checked={selected}
                      onChange={() => setSelections((current) => ({ ...current, [category.id]: candidate.id }))}
                    />
                    <span>
                      <span className="font-medium">{candidate.name}</span>
                      {candidate.department && <span className="block text-xs text-slate-500">{candidate.department}</span>}
                      {candidate.kind === 'team' && <span className="block text-xs text-slate-500">Team</span>}
                    </span>
                  </label>
                );
              })}
            </fieldset>

            {!category.hasVoted && (
              <button
                type="button"
                className="btn-primary mt-3 w-full sm:w-auto"
                disabled={!selections[category.id] || phase !== 'PHASE_3' || busy}
                onClick={() => {
                  const candidate = category.candidates.find((item) => item.id === selections[category.id]);
                  setConfirm({ categoryId: category.id, candidateId: candidate.id, name: candidate.name, categoryName: category.name });
                }}
              >
                Submit vote for {category.name}
              </button>
            )}
          </section>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(confirm)}
        title="Confirm your vote"
        confirmLabel="Cast my vote"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={submitVote}
      >
        <p>
          You are voting for <strong>{confirm?.name}</strong> in <strong>{confirm?.categoryName}</strong>. This is worth
          1 point.
        </p>
        <p className="mt-2 font-medium text-red-700">This cannot be changed or undone.</p>
      </ConfirmDialog>
    </AppShell>
  );
}

export default Vote;
