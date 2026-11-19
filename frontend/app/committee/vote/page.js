'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
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
  const [savedPicks, setSavedPicks] = useState({}); // what the server currently holds
  const [maxPicks, setMaxPicks] = useState(1);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const sectionRefs = useRef({});

  const load = () =>
    Promise.all([get('/committee/candidates'), get('/committee/picks')])
      .then(([candidateData, pickData]) => {
        setCategories(candidateData.categories);
        setMyPicks(pickData.picks || {});
        setSavedPicks(pickData.picks || {});
        setMaxPicks(pickData.picksPerCategory ?? 1);
      })
      .catch((loadError) => setError(loadError.message));

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

  const pickFor = (categoryId, candidateId) => {
    setMyPicks((current) => ({ ...current, [categoryId]: [candidateId] }));
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const saved = confirm;
      await put('/committee/picks', {
        categoryId: saved.categoryId,
        candidateIds: myPicks[saved.categoryId] || [],
      });

      // Drop this category's selection and jump to the next category that still has
      // nobody picked, so the committee can work straight through the list.
      setMyPicks((current) => {
        const next = { ...current };
        delete next[saved.categoryId];
        return next;
      });
      setSavedPicks((current) => ({ ...current, [saved.categoryId]: myPicks[saved.categoryId] || [] }));
      setConfirm(null);
      setSuccess(`Picks saved for ${saved.name}.`);

      const pending = (categories || []).filter(
        (category) =>
          category.id !== saved.categoryId &&
          category.candidates.length > 0 &&
          !(myPicks[category.id] || []).length
      );
      if (pending.length === 0) {
        setSuccess(`Picks saved for ${saved.name}. You have picked in every category.`);
      } else {
        sectionRefs.current[pending[0].id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
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
          const saved = savedPicks[category.id] || [];
          const dirty = [...list].sort().join() !== [...saved].sort().join();
          const ready = list.length > 0 && dirty;
          return (
            <section
              key={category.id}
              id={`committee-category-${category.id}`}
              ref={(node) => {
                sectionRefs.current[category.id] = node;
              }}
              className="card scroll-mt-24"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-bold text-slate-900">{category.name}</h2>
                <div className="flex flex-wrap items-center gap-2">
                  {list.length > 0 && !dirty && <StatusPill tone="green">saved</StatusPill>}
                  <StatusPill tone={list.length ? 'green' : 'amber'}>
                    {list.length} / {maxPicks} picked
                  </StatusPill>
                </div>
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
                          className={`flex items-center justify-between gap-3 rounded-lg px-2.5 py-2.5 text-sm transition hover:bg-slate-50 ${candidate.hasConflict || full ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
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
                                  ? pickFor(category.id, candidate.id)
                                  : toggle(category.id, candidate.id)
                              }
                            />
                            <span>
                              <span className="font-medium">{candidate.name}</span>
                              {candidate.department && (
                                <span className="ml-2 text-xs text-slate-500">{candidate.department}</span>
                              )}
                              {candidate.kind === 'team' && (
                                <span className="ml-2 text-xs text-slate-500">Team</span>
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
                {saved.length > 0 && !dirty ? 'Picks saved' : 'Save picks'}
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
