'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import StatusPill from '@/components/StatusPill';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const NEXT_STEP = {
  NOT_STARTED: { text: 'Nominations have not opened yet. Check back soon.', href: null, label: null },
  PHASE_1: { text: 'Nominations are open. Make one nomination per category (1 point each).', href: '/employee/nominate', label: 'Nominate a colleague' },
  PHASE_2: { text: 'The committee is reviewing the top 15. Nothing for you to do right now.', href: null, label: null },
  PHASE_3: { text: 'Final voting is open. One vote per category — your vote is confidential and final.', href: '/employee/vote', label: 'Cast your vote' },
  CLOSED: { text: 'Voting has closed. Results will be published soon.', href: null, label: null },
  PUBLISHED: { text: 'The 2026 winners are published.', href: '/employee/results', label: 'See results' },
};

function Dashboard() {
  const { user, phase, rules } = useAuth();
  const [summary, setSummary] = useState(null);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([get('/nominations/summary'), get('/categories'), get('/votes/status').catch(() => ({ voted: [] }))])
      .then(([summaryData, categoryData, voteData]) => {
        if (!active) return;
        setSummary({ ...summaryData, voted: voteData.voted });
        setCategories(categoryData.categories);
      })
      .catch((loadError) => active && setError(loadError.message));
    return () => {
      active = false;
    };
  }, []);

  const step = NEXT_STEP[phase] || NEXT_STEP.NOT_STARTED;
  const votedCount = summary?.voted?.length ?? 0;
  const completed = phase === 'PHASE_3' ? votedCount : summary?.total ?? 0;
  const completion = categories.length ? (completed / categories.length) * 100 : 0;

  return (
    <div>
      <section className="relative mb-5 overflow-hidden rounded-[1.75rem] bg-[#0b2448] p-6 text-white shadow-[0_18px_45px_rgba(11,36,72,0.18)] sm:p-8">
        <div className="pointer-events-none absolute -right-14 -top-24 h-72 w-72 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -right-2 -top-12 h-48 w-48 rounded-full border border-white/10" />
        <div className="relative max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-200/80">Your awards portal</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Welcome, {user?.fullName?.split(' ')[0] ?? 'there'}.
          </h1>
          <p className="mt-2 text-sm text-blue-100/75">
            {user.department ? `Department · ${user.department}` : 'Your voice helps recognize our best.'}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {step.href ? (
              <Link href={step.href} className="btn-primary">
                {step.label}<span aria-hidden="true">→</span>
              </Link>
            ) : (
              <span className="badge border border-white/15 bg-white/10 text-white">{phase.replace('_', ' ')}</span>
            )}
            <p className="text-sm leading-6 text-blue-100/80">{step.text}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Your participation</h2>
              <p className="mt-1 text-sm text-slate-500">
                {phase === 'PHASE_3' ? 'Votes submitted' : 'Nominations submitted'}
              </p>
            </div>
            <p className="text-sm font-semibold text-slate-700">
              {completed} <span className="font-normal text-slate-400">/ {categories.length || '—'}</span>
            </p>
          </div>
          <div
            className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={categories.length}
            aria-valuenow={completed}
            aria-label="Participation progress"
          >
            <div className="h-full rounded-full bg-gradient-to-r from-brand-600 to-emerald-500 transition-all" style={{ width: `${Math.min(100, completion)}%` }} />
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <dt className="text-xs text-slate-500">Nominations you have made</dt>
              <dd className="mt-1 text-xl font-bold tracking-tight text-slate-900">{summary?.total ?? '—'}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <dt className="text-xs text-slate-500">Self-nominations left</dt>
              <dd className="mt-1 text-xl font-bold tracking-tight text-slate-900">{summary?.selfNominationsRemaining ?? '—'}</dd>
            </div>
          </dl>
          {phase === 'PHASE_3' && (
            <p className="mt-4 text-sm text-slate-600">
              Voted in <strong>{votedCount}</strong> of <strong>{categories.length}</strong> categories.
            </p>
          )}
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Award categories</h2>
            <span className="badge bg-brand-50 text-brand-800">{categories.length}</span>
          </div>
          <ul className="space-y-1 text-sm">
            {categories.map((category) => (
              <li key={category.id} className="flex items-start justify-between gap-2 rounded-lg px-2 py-2 hover:bg-slate-50">
                <span className="text-slate-700">{category.name}</span>
                {category.forTeams && <StatusPill tone="brand">Team</StatusPill>}
              </li>
            ))}
            {categories.length === 0 && <li className="text-slate-500">Loading…</li>}
          </ul>
        </section>
      </div>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      <p className="mt-6 text-xs text-slate-500">
        One pick per category, 1 point each. Self-nomination limit: {rules?.selfNominationLimit ?? 1} in total across
        all categories. Justifications need at least {rules?.minJustification ?? 20} characters.
      </p>
    </div>
  );
}

export default function EmployeeDashboard() {
  return (
    <AppShell hideBanner>
      <Dashboard />
    </AppShell>
  );
}
