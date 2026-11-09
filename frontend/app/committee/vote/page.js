'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import Alert from '@/components/Alert';
import ConfirmDialog from '@/components/ConfirmDialog';
import Spinner from '@/components/Spinner';
import StatusPill from '@/components/StatusPill';
import { get, put } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

function CommitteeVote() {
  const { phase } = useAuth();
  const [categories, setCategories] = useState(null);
  const [myPicks, setMyPicks] = useState({});
  const [maxPicks, setMaxPicks] = useState(1);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    Promise.all([get('/committee/candidates'), get('/committee/picks')])
      .then(([candidateData, pickData]) => {
        setCategories(candidateData.categories);
        setMyPicks(pickData.picks || {});
        setMaxPicks(pickData.picksPerCategory ?? 1);
      })
      .catch((loadError) => setError(loadError.message));
  };

  useEffect(() => {
    if (phase === 'PHASE_2') load();
  }, [phase]);

  const toggle = (categoryId, candidateId) => {
    setMyPicks((current) => {
      const list = current[categoryId] || [];
      const has = list.includes(candidateId);
      if (!has && list.length >= maxPicks) return current;
      return {
        ...current,
        [categoryId]: has ? list.filter((id) => id !== candidateId) : [...list, candidateId],
      };
    });
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await put('/committee/picks', {
        categoryId: confirm.categoryId,
        candidateIds: myPicks[confirm.categoryId] || [],
      });
      setSuccess(`Picks saved for ${confirm.name}.`);
      setConfirm(null);
      load();
    } catch (saveError) {
      setError(saveError.message);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Committee picks"
      description={`Up to ${maxPicks} pick${maxPicks === 1 ? '' : 's'} per category, 1 point each. Picks can be changed until Phase 2 closes.`}
      minRole="COMMITTEE"
    >
      {phase !== 'PHASE_2' && (
        <Alert tone="warning" className="mb-4">
          Picks are only possible during Phase 2. Current phase: {phase}.
        </Alert>
      )}
      <Alert tone="error" className="mb-4">{error}</Alert>
      <Alert tone="success" className="mb-4">{success}</Alert>
      {!categories && !error && phase === 'PHASE_2' && <Spinner />}

      <div className="space-y-5">
        {(categories || []).map((category) => {
          const list = myPicks[category.id] || [];
          const ready = list.length > 0;
          return (
            <section key={category.id} className="card">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">{category.name}</h2>
                <StatusPill tone={ready ? 'green' : 'amber'}>
                  {list.length} / {maxPicks} picked
                </StatusPill>
              </div>
              {category.candidates.length === 0 ? (
                <p className="text-sm text-slate-500">No candidates in this category.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {category.candidates.map((candidate) => {
                    const checked = list.includes(candidate.id);
                    const full = !checked && list.length >= maxPicks;
                    return (
                      <li key={candidate.id}>
                        <label
                          className={`flex items-center justify-between gap-3 py-2 text-sm ${candidate.hasConflict || full ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                            }`}
                        >
                          <span className="flex items-center gap-3">
                            <input
                              type={maxPicks === 1 ? 'radio' : 'checkbox'}
                              name={`pick-${category.id}`}
                              checked={checked}
                              disabled={candidate.hasConflict || full || phase !== 'PHASE_2'}
                              onChange={() =>
                                maxPicks === 1
                                  ? setMyPicks((current) => ({ ...current, [category.id]: [candidate.id] }))
                                  : toggle(category.id, candidate.id)
                              }
                            />
                            <span>
                              <span className="font-medium">{candidate.name}</span>
                              {candidate.department && (
                                <span className="ml-2 text-xs text-slate-500">{candidate.department}</span>
                              )}
                            </span>
                          </span>
                          <span className="text-xs text-slate-500">
                            {candidate.hasConflict ? (
                              <span className="text-red-700">conflict — excluded</span>
                            ) : (
                              <Link href={`/committee/candidate/${candidate.id}`} className="link">
                                details
                              </Link>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}

              <button
                type="button"
                className="btn-primary mt-3 w-full sm:w-auto"
                disabled={!ready || busy || phase !== 'PHASE_2'}
                onClick={() => setConfirm({ categoryId: category.id, name: category.name, count: list.length })}
              >
                Save picks
              </button>
            </section>
          );
        })}
      </div>

      <ConfirmDialog
        open={Boolean(confirm)}
        title="Save your picks?"
        confirmLabel="Save picks"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={submit}
      >
        <p>
          <strong>{confirm?.count}</strong> pick{confirm?.count === 1 ? '' : 's'} will be recorded for{' '}
          <strong>{confirm?.name}</strong>. Picks can still be changed until Phase 2 closes.
        </p>
      </ConfirmDialog>
    </AppShell>
  );
}

export default CommitteeVote;
