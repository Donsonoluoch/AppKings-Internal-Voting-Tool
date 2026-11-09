'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import Alert from '@/components/Alert';
import ConfirmDialog from '@/components/ConfirmDialog';
import Spinner from '@/components/Spinner';
import StatusPill from '@/components/StatusPill';
import { get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

function Ranking({ rows, cut, label }) {
  if (!rows || rows.length === 0) return <p className="text-sm text-slate-500">Nothing to rank yet.</p>;
  return (
    <ol className="divide-y divide-slate-100">
      {rows.map((row, index) => {
        const onCutLine = index === cut - 1 || index === cut;
        return (
          <li
            key={row.id || row.candidateId || row.departmentId}
            className={`flex items-center justify-between gap-3 py-2 text-sm ${
              onCutLine ? 'bg-amber-50' : ''
            }`}
          >
            <span>
              <span className="mr-2 text-slate-400">#{index + 1}</span>
              <span className="font-medium">{row.name}</span>
              {row.department && <span className="ml-2 text-xs text-slate-500">{row.department}</span>}
              {row.advances && (
                <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                  advances
                </span>
              )}
              {index === cut - 1 && (
                <span className="ml-2 text-xs font-semibold text-brand-700">{label}</span>
              )}
            </span>
            <span className="font-semibold">{row.points} pts</span>
          </li>
        );
      })}
    </ol>
  );
}

function Tally() {
  const { phase, rules } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    get('/admin/tally')
      .then(setData)
      .catch((loadError) => setError(loadError.message));
  };

  useEffect(load, [phase]);

  const confirmCut = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await post('/admin/candidates/confirm', { resolveTies: true });
      setSuccess(
        `Cut saved: ${result.people.length} people advance${result.teams?.length ? `, ${result.teams.length} team(s)` : ''}.`
      );
      setConfirm(null);
      load();
    } catch (saveError) {
      setError(saveError.message);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const tally = data?.tally;
  const problems = data?.problems || [];
  const isPhase1 = tally?.phase === 'PHASE_1';
  const peopleCut = isPhase1 ? rules?.phase1Finalists ?? 15 : rules?.phase2FinalistsMax ?? 10;

  return (
    <AppShell
      title="Tally & cuts"
      description="Tallies are only visible here, and only once the phase is being closed. Confirm the cut before moving on."
      minRole="ADMIN"
    >
      <Alert tone="error" className="mb-3">{error}</Alert>
      <Alert tone="success" className="mb-3">{success}</Alert>

      {!data && !error && <Spinner />}
      {data && !tally && (
        <Alert tone="info">
          {data.message || 'Tallies are available while Phase 1 or Phase 2 is open.'}
        </Alert>
      )}

      {tally && (
        <>
          <section className="card mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">
                  {isPhase1 ? 'Phase 1 — top 5 per category, then the top 15 people' : 'Phase 2 — top 6–10 people'}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Every category keeps at least {rules?.minCandidatesPerCategory ?? 2} candidates. A tie across a cut
                  line is never resolved automatically.
                </p>
              </div>
              <button type="button" className="btn-primary" onClick={() => setConfirm(true)} disabled={busy}>
                Confirm this cut
              </button>
            </div>

            {problems.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-semibold">This cut needs your decision:</p>
                <ul className="mt-1 list-inside list-disc">
                  {problems.map((problem, index) => (
                    <li key={index}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="card mb-4">
            <h2 className="mb-2 text-base font-semibold">People ranking (pooled)</h2>
            <p className="mb-2 text-xs text-slate-500">
              Each person&apos;s total is the sum of their points across the categories where they made the top 5.
              The pooled limit advances, with extra category finalists added when needed to preserve each category&apos;s minimum.
            </p>
            <Ranking rows={tally.people} cut={peopleCut} label="cut line" />
            {tally.peopleTiedAtCutoff && (
              <p className="mt-2 text-xs font-semibold text-amber-800">
                A tie sits on the cut line — you decide who advances.
              </p>
            )}
          </section>

          {!isPhase1 && tally.teams?.length > 0 && (
            <section className="card mb-4">
              <h2 className="mb-2 text-base font-semibold">Team of the Year</h2>
              <Ranking rows={tally.teams} cut={rules?.teamFinalists ?? 3} label="cut line" />
            </section>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {tally.categories.map((category) => (
              <section key={category.categoryId} className="card">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold">{category.categoryName}</h2>
                  {category.tiedAtCutoff && <StatusPill tone="amber">tie on cut line</StatusPill>}
                  {category.shortOfMinimum && <StatusPill tone="red">below minimum</StatusPill>}
                </div>
                <Ranking rows={category.rows} cut={rules?.topPerCategory ?? 5} label="top 5" />
              </section>
            ))}
          </div>

          <p className="mt-4 text-xs text-slate-500">
            Once confirmed, the points are saved on each candidate row. Then move the phase forward from the{' '}
            <Link href="/admin" className="link">
              admin dashboard
            </Link>
            .
          </p>
        </>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        title="Confirm this cut?"
        confirmLabel={problems.length > 0 ? 'Confirm and resolve the ties' : 'Confirm cut'}
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={confirmCut}
      >
        <p>
          The points are saved on each candidate row so results can&apos;t change later. Ties across a cut line are
          treated as resolved by you.
        </p>
      </ConfirmDialog>
    </AppShell>
  );
}

export default Tally;
