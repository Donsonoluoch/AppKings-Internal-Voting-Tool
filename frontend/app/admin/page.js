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
import { PHASE_META, PHASES } from '@appkings/shared';

function AdminHome() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [confirmNewSession, setConfirmNewSession] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    get('/admin/dashboard')
      .then(setData)
      .catch((loadError) => setError(loadError.message));
  };

  useEffect(load, []);

  const changePhase = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await post('/admin/phase', { phase: confirm, confirm: true });
      setSuccess(`Phase moved to ${confirm}.`);
      setConfirm(null);
      load();
    } catch (phaseError) {
      setError(phaseError.message);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const startNewSession = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await post('/admin/reset-cycle', { confirm: 'RESET' });
      setConfirmNewSession(false);
      setSuccess('Voting progress reset. The cycle is ready to start Phase 1.');
      load();
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <AppShell minRole="ADMIN">
        <Alert tone="error">{error}</Alert>
        {!error && <Spinner />}
      </AppShell>
    );
  }

  const currentIndex = PHASES.indexOf(data.phase);
  const next = PHASES[currentIndex + 1];

  return (
    <AppShell title="Administrator" description="Phase control, progress and the road to go live." minRole="ADMIN">
      {user && <p className="mb-4 text-sm text-slate-600">Welcome back, <strong className="text-slate-900">{user.fullName}</strong>.</p>}
      <div className="grid gap-4 md:grid-cols-3">
        <section className="card md:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">Control center</p>
              <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900">Phase control</h2>
            </div>
            <StatusPill tone={data.phase === 'PUBLISHED' ? 'green' : 'brand'}>{PHASE_META[data.phase]?.label ?? data.phase}</StatusPill>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Phases move forward in order. Review readiness before opening the next stage.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {PHASES.map((phase, index) => (
              <span
                key={phase}
                className={`badge ${index < currentIndex
                    ? 'bg-slate-200 text-slate-600'
                    : index === currentIndex
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-400'
                  }`}
              >
                {phase.replace('_', ' ')}
              </span>
            ))}
          </div>

          {/* Readiness preview: what the next move will actually do. The checks
              come from the API and are the ones the transition itself runs, so
              a blocked move is explained here rather than refused on click. */}
          {next && data.readiness ? (
            <div className="mt-4 rounded-xl border border-slate-200/80 bg-slate-50/80 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  Before moving to {PHASE_META[next]?.label ?? next}
                </h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${data.readiness.canAdvance
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {data.readiness.canAdvance ? 'Ready' : 'Blocked'}
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {(data.readiness.steps ?? []).map((step, index) => (
                  <li key={`${index}-${step.label}`} className="flex gap-2">
                    <span aria-hidden="true" className={step.ok ? 'text-emerald-600' : 'text-amber-600'}>
                      {step.ok ? '\u2713' : '\u2022'}
                    </span>
                    <span className={step.ok ? 'text-slate-700' : 'text-amber-900'}>{step.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-4">
            {next ? (
              <button type="button" className="btn-primary" onClick={() => setConfirm(next)}>
                {data.phase === 'NOT_STARTED'
                  ? `Start ${PHASE_META[next]?.label ?? next}`
                  : `Move to ${PHASE_META[next]?.label ?? next}`}
              </button>
            ) : (
              <p className="text-sm text-slate-600">The cycle is complete.</p>
            )}
          </div>
          <button
            type="button"
            className="btn-secondary mt-4"
            onClick={() => setConfirmNewSession(true)}
            disabled={busy}
          >
            Reset voting progress
          </button>
          <Alert tone="error" className="mt-3">{error}</Alert>
          <Alert tone="success" className="mt-3">{success}</Alert>
        </section>

        <section className="card">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">Overview</p>
          <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900">At a glance</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-3">
              <dt className="text-slate-500">Active employees</dt>
              <dd className="text-lg font-bold text-slate-900">{data.activeEmployees}</dd>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-3">
              <dt className="text-slate-500">Departments to confirm</dt>
              <dd className="text-lg font-bold text-slate-900">{data.employeesMissingDepartment}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-col gap-2 text-sm">
            {['PHASE_1', 'PHASE_2'].includes(data.phase) && (
              <Link href="/admin/tally" className="link">
                Tallies, ties and the cut →
              </Link>
            )}
            <Link href="/admin/employees" className="link">Employees & departments →</Link>
            <Link href="/admin/results" className="link">Results & publishing →</Link>
            <Link href="/admin/audit" className="link">Audit log →</Link>
          </div>
        </section>
      </div>

      <section className="mt-6 card overflow-x-auto">
        <h2 className="mb-4 text-lg font-bold tracking-tight text-slate-900">Category progress</h2>
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="table-head py-3 pr-3">Category</th>
              <th className="table-head py-3 pr-3">Candidates</th>
              <th className="table-head py-3 pr-3">Phase 2 (top {data.rules.phase1Finalists} + coverage)</th>
              <th className="table-head py-3 pr-3">
                Shortlist ({data.rules.phase2FinalistsMin}–{data.rules.phase2FinalistsMax} + coverage)
              </th>
              <th className="table-head py-3 pr-3">Voted</th>
            </tr>
          </thead>
          <tbody>
            {data.categories.map((category) => (
              <tr key={category.id} className="table-row">
                <td className="py-3 pr-3 font-semibold text-slate-800">{category.name}</td>
                <td className="py-3 pr-3">
                  <StatusPill tone={category.candidates >= data.rules.minCandidatesPerCategory ? 'green' : 'slate'}>
                    {category.candidates}
                  </StatusPill>
                </td>
                <td className="py-3 pr-3">
                  <StatusPill tone={category.inPhase2 ? 'green' : 'slate'}>{category.inPhase2}</StatusPill>
                </td>
                <td className="py-3 pr-3">
                  <StatusPill
                    tone={
                      category.inPhase3 >= data.rules.minCandidatesPerCategory
                        ? 'green'
                        : category.inPhase3
                          ? 'amber'
                          : 'slate'
                    }
                  >
                    {category.inPhase3}
                  </StatusPill>
                </td>
                <td className="py-3 pr-3 text-slate-600">
                  {category.voters}/{data.activeEmployees}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={`${confirm === 'PHASE_1' ? 'Start' : 'Move to'} ${confirm ? PHASE_META[confirm]?.label ?? confirm : ''}?`}
        confirmLabel={confirm === 'PHASE_1' ? 'Start Phase 1' : 'Move phase'}
        requireText={confirm}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={changePhase}
      >
        <p>{confirm ? PHASE_META[confirm]?.tagline : ''}</p>
        <p className="mt-2">
          The system checks that the cut is confirmed, no tie is unresolved and every category keeps at least{' '}
          {data.rules.minCandidatesPerCategory} candidates. Phases only move forward. Resetting returns the cycle to
          NOT_STARTED; start Phase 1 separately when you are ready.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmNewSession}
        title="Reset voting progress?"
        confirmLabel="Reset voting progress"
        requireText="RESET"
        busy={busy}
        onCancel={() => setConfirmNewSession(false)}
        onConfirm={startNewSession}
      >
        <p>
          This permanently clears all nominations, votes, committee picks, conflicts, candidate cuts and published
          results. It does not delete employee accounts or change their roles or departments.
        </p>
        <p className="mt-2">Type RESET to return the cycle to NOT_STARTED.</p>
      </ConfirmDialog>
    </AppShell>
  );
}

export default AdminHome;
