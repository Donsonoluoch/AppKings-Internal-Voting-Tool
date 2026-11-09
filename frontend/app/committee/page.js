'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import Alert from '@/components/Alert';
import Spinner from '@/components/Spinner';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

function CommitteeHome() {
  const { phase } = useAuth();
  const [categories, setCategories] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (phase !== 'PHASE_2') return;
    get('/committee/candidates')
      .then((data) => setCategories(data.categories))
      .catch((loadError) => setError(loadError.message));
  }, [phase]);

  return (
    <AppShell
      title="Committee portal"
      description="Review the top 15, read the justifications and evidence, and pick the strongest candidate per category."
      minRole="COMMITTEE"
    >
      <Alert tone="error" className="mb-4">{error}</Alert>

      {phase === 'PHASE_2' && (
        <div className="space-y-4">
          <Alert tone="info">
            Each pick is worth 1 point. A member who declares a conflict of interest cannot pick that candidate.
          </Alert>

          {!categories && !error && <Spinner />}

          {(categories || []).map((category) => (
            <section key={category.id} className="card">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">{category.name}</h2>
                <span className="text-xs text-slate-500">{category.candidates.length} candidates</span>
              </div>
              <p className="mb-3 text-xs text-slate-500">{category.criteria}</p>
              {category.candidates.length === 0 ? (
                <p className="text-sm text-slate-500">No candidates in this category.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {category.candidates.map((candidate) => (
                    <li key={candidate.id}>
                      <Link
                        href={`/committee/candidate/${candidate.id}`}
                        className="flex items-center justify-between gap-3 py-2 text-sm hover:text-brand-700"
                      >
                        <span>
                          <span className="font-medium">{candidate.name}</span>
                          {candidate.department && (
                            <span className="ml-2 text-xs text-slate-500">{candidate.department}</span>
                          )}
                          {candidate.hasConflict && (
                            <span className="ml-2 text-xs font-semibold text-red-700">conflict</span>
                          )}
                        </span>
                        <span className="text-xs text-slate-500">
                          {candidate.nominationPoints} nomination
                          {candidate.nominationPoints === 1 ? '' : 's'}
                          {candidate.myPick && <span className="ml-2 font-semibold text-emerald-700">your pick</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          <Link href="/committee/vote" className="btn-primary">
            Make your picks
          </Link>
        </div>
      )}

      {phase === 'PHASE_1' && (
        <Alert tone="info">
          Nominations are still open. The admin confirms the top 5 per category and the top 15 people overall once
          Phase 1 closes — the committee workspace opens in Phase 2.
        </Alert>
      )}

      {!['PHASE_1', 'PHASE_2'].includes(phase) && (
        <Alert tone="info">The committee workspace opens in Phase 2.</Alert>
      )}
    </AppShell>
  );
}

export default CommitteeHome;
