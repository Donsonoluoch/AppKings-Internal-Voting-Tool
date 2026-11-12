'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import Alert from '@/components/Alert';
import ResultsTable from '@/components/ResultsTable';
import Spinner from '@/components/Spinner';
import { get } from '@/lib/api';

function MyPoints() {
  const [mine, setMine] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/results/me')
      .then(setMine)
      .catch((loadError) => setError(loadError.message));
  }, []);

  if (error) return <Alert tone="info">{error}</Alert>;
  if (!mine) return null;

  if (mine.categories.length === 0) {
    return (
      <section className="card mt-6">
        <h2 className="text-base font-semibold">Your points</h2>
        <p className="mt-1 text-sm text-slate-600">You were not a candidate in any category this year.</p>
      </section>
    );
  }

  return (
    <section className="card mt-6 overflow-x-auto">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Your points</h2>
        <p className="text-sm font-semibold">
          {mine.totals.totalPoints} overall ({mine.totals.nominationPoints} + {mine.totals.committeePoints} +{' '}
          {mine.totals.finalPoints})
        </p>
      </div>
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3">Category</th>
            <th className="py-2 pr-3">Phase 1</th>
            <th className="py-2 pr-3">Phase 2</th>
            <th className="py-2 pr-3">Phase 3</th>
            <th className="py-2 pr-3">Total</th>
          </tr>
        </thead>
        <tbody>
          {mine.categories.map((row) => (
            <tr key={row.categoryId} className="border-b border-slate-100 last:border-0">
              <td className="py-2 pr-3 font-medium">{row.categoryName}</td>
              <td className="py-2 pr-3">{row.nominationPoints}</td>
              <td className="py-2 pr-3">{row.committeePoints}</td>
              <td className="py-2 pr-3">{row.finalPoints}</td>
              <td className="py-2 pr-3 font-semibold">{row.totalPoints}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">Points only — nothing is shown as a percentage.</p>
    </section>
  );
}

function Results() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/results')
      .then(setData)
      .catch((loadError) => setError(loadError.message));
  }, []);

  const phases = [
    {
      key: 'phase1',
      title: 'Phase 1 — Nominations',
      scoreKey: 'nominationPoints',
      scoreLabel: 'nominations',
      results: data?.phaseResults?.phase1,
    },
    {
      key: 'phase2',
      title: 'Phase 2 — Committee picks',
      scoreKey: 'committeePoints',
      scoreLabel: 'committee picks',
      results: data?.phaseResults?.phase2,
    },
    {
      key: 'phase3',
      title: 'Phase 3 — Final vote',
      scoreKey: 'finalPoints',
      scoreLabel: 'final votes',
      results: data?.results,
    },
  ];

  return (
    <AppShell title="2026 Awards results" description="Track published outcomes across all three phases. Each phase stays here once released.">
      {!data && !error && <Spinner label="Loading results…" />}
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      {data && phases.map((item) => {
        const published = data.publications?.[item.key] ?? false;
        return (
          <section key={item.key} className="card mb-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{item.title}</h2>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${published
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-slate-100 text-slate-600'
                }`}>
                {published ? 'Published' : 'Awaiting publication'}
              </span>
            </div>
            {published ? (
              <ResultsTable
                results={item.results}
                showBreakdown={item.key === 'phase3'}
                scoreKey={item.scoreKey}
                scoreLabel={item.scoreLabel}
              />
            ) : (
              <p className="text-sm text-slate-600">
                Results will appear here after this phase closes and the administrator publishes them.
              </p>
            )}
          </section>
        );
      })}
      {data?.publications?.phase3 && (
        <MyPoints />
      )}
    </AppShell>
  );
}

export default Results;
