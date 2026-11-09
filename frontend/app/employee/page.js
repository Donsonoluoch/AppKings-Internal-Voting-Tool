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

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold sm:text-2xl">Karibu, {user.fullName.split(' ')[0]} 👋</h1>
      <p className="mb-5 text-sm text-slate-600">{user.department ? `Department: ${user.department}` : '\u00a0'}</p>
      <div className="grid gap-4 md:grid-cols-3">
        <section className="card md:col-span-2">
          <h2 className="text-base font-semibold">What to do now</h2>
          <p className="mt-1 text-sm text-slate-600">{step.text}</p>
          {step.href && (
            <Link href={step.href} className="btn-primary mt-4">
              {step.label}
            </Link>
          )}

          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <dt className="text-xs text-slate-500">Nominations you have made</dt>
              <dd className="text-lg font-semibold">{summary?.total ?? '—'}</dd>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <dt className="text-xs text-slate-500">Self-nominations left</dt>
              <dd className="text-lg font-semibold">{summary?.selfNominationsRemaining ?? '—'}</dd>
            </div>
          </dl>

          {phase === 'PHASE_3' && (
            <p className="mt-3 text-sm text-slate-600">
              Voted in <strong>{votedCount}</strong> of <strong>{categories.length}</strong> categories.
            </p>
          )}
        </section>

        <section className="card">
          <h2 className="text-base font-semibold">Award categories</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {categories.map((category) => (
              <li key={category.id} className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2 last:border-0">
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
