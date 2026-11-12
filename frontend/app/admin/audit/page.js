'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import Alert from '@/components/Alert';
import Spinner from '@/components/Spinner';
import { get } from '@/lib/api';

const ACTIONS = [
  '',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'PHASE_CHANGE',
  'NOMINATE',
  'COMMITTEE_PICK',
  'CONFLICT_DECLARED',
  'CUT_CONFIRMED',
  'CANDIDATE_REMOVED',
  'VOTE_CAST',
  'RESULTS_PUBLISHED',
  'EMPLOYEE_IMPORTED',
  'EMPLOYEE_UPDATED',
  'DEPARTMENT_CREATED',
  'DEPARTMENT_ASSIGNED',
];

function Audit() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    get(`/admin/audit?page=${page}&pageSize=50${action ? `&action=${action}` : ''}`)
      .then(setData)
      .catch((loadError) => setError(loadError.message));
  }, [page, action]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <AppShell title="Audit log" description="Every write action is recorded. Vote entries never include the candidate." minRole="ADMIN">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600" htmlFor="action">
          Action
        </label>
        <select
          id="action"
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={action}
          onChange={(event) => {
            setPage(1);
            setAction(event.target.value);
          }}
        >
          {ACTIONS.map((item) => (
            <option key={item} value={item}>
              {item || 'All actions'}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">{data ? `${data.total} entries` : ''}</span>
      </div>

      <Alert tone="error" className="mb-3">{error}</Alert>
      {!data && !error && <Spinner />}

      {data && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">Actor</th>
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Details</th>
                <th className="py-2 pr-3">IP</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-100 last:border-0 align-top">
                  <td className="whitespace-nowrap py-2 pr-3 text-slate-600">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3">{entry.actorName}</td>
                  <td className="py-2 pr-3 font-medium">{entry.action}</td>
                  <td className="py-2 pr-3">
                    <code className="text-xs text-slate-600">{entry.details ? JSON.stringify(entry.details) : '—'}</code>
                  </td>
                  <td className="py-2 pr-3 text-xs text-slate-500">{entry.ip || '—'}</td>
                </tr>
              ))}
              {data.entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-500">
                    No entries.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-sm">
        <button type="button" className="btn-secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
          Previous
        </button>
        <span className="text-slate-500">
          Page {page} of {pages}
        </span>
        <button type="button" className="btn-secondary" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>
          Next
        </button>
      </div>
    </AppShell>
  );
}

export default Audit;
