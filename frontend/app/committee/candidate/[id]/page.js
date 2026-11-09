'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import Alert from '@/components/Alert';
import Spinner from '@/components/Spinner';
import StatusPill from '@/components/StatusPill';
import { get, post } from '@/lib/api';

function CandidateDetail({ id }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [conflictReason, setConflictReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    get(`/committee/candidates/${id}`)
      .then(setData)
      .catch((loadError) => setError(loadError.message));
  };

  useEffect(load, [id]);

  const declareConflict = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await post('/committee/conflicts', { candidateId: id, reason: conflictReason.trim() || null });
      setSuccess('Conflict of interest recorded. You can no longer pick this candidate.');
      load();
    } catch (conflictError) {
      setError(conflictError.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <AppShell minRole="COMMITTEE">
        <Alert tone="error">{error}</Alert>
        {!error && <Spinner />}
      </AppShell>
    );
  }

  const { candidate, justifications } = data;

  return (
    <AppShell minRole="COMMITTEE">
      <Link href="/committee" className="text-sm text-slate-500 hover:text-slate-800">
        ← Back to the committee portal
      </Link>

      <div className="mt-3 card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">{candidate.name}</h1>
            <p className="text-sm text-slate-500">
              {candidate.category.name}
              {candidate.department ? ` · ${candidate.department}` : candidate.kind === 'team' ? ' · Team' : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {candidate.eligible ? (
              <StatusPill tone="green">Eligible</StatusPill>
            ) : (
              <StatusPill tone="red">Not eligible</StatusPill>
            )}
            <StatusPill tone="brand">{candidate.nominationPoints} nominations</StatusPill>
            {candidate.myPick && <StatusPill tone="green">Your pick</StatusPill>}
          </div>
        </div>
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <strong>Category criteria:</strong> {candidate.category.criteria}
        </p>
      </div>

      <section className="mt-4 card">
        <h2 className="text-base font-semibold">Justifications & evidence</h2>
        {justifications.length === 0 && <p className="text-sm text-slate-500">No nominations recorded.</p>}
        <ul className="mt-2 space-y-2">
          {justifications.map((item, index) => (
            <li key={index} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <p className="text-slate-700">{item.justification}</p>
              <p className="mt-1 text-xs text-slate-500">
                — {item.nominator}
                {item.isSelf && ' (self-nomination)'}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-4 card">
        <h2 className="text-base font-semibold">Conflict of interest</h2>
        {candidate.hasConflict ? (
          <p className="mt-2 text-sm text-slate-600">
            Recorded. You cannot pick this candidate
            {candidate.conflictReason && <span className="block mt-1 text-xs">Reason: {candidate.conflictReason}</span>}
          </p>
        ) : (
          <form onSubmit={declareConflict} className="mt-2 space-y-3">
            <p className="text-sm text-slate-600">
              Declare a conflict if you have a personal or financial relationship with this candidate. Any pick you
              already made for them will be removed.
            </p>
            <div>
              <label className="label" htmlFor="reason">
                Reason (optional)
              </label>
              <input
                id="reason"
                className="input"
                maxLength={300}
                value={conflictReason}
                onChange={(event) => setConflictReason(event.target.value)}
              />
            </div>
            <Alert tone="error">{error}</Alert>
            <Alert tone="success">{success}</Alert>
            <button type="submit" className="btn-secondary w-full" disabled={busy}>
              Declare conflict
            </button>
          </form>
        )}
      </section>

      <p className="mt-4 text-sm">
        <Link href="/committee/vote" className="link">
          Go to your picks →
        </Link>
      </p>
    </AppShell>
  );
}

export default function CandidatePage({ params }) {
  const resolved = use(params);
  return <CandidateDetail id={resolved.id} />;
}
