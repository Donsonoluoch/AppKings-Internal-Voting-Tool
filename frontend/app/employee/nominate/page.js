'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import Alert from '@/components/Alert';
import Spinner from '@/components/Spinner';
import StatusPill from '@/components/StatusPill';
import { get, put } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

function Nominate() {
  const { phase, rules } = useAuth();
  const [categories, setCategories] = useState([]);
  const [colleagues, setColleagues] = useState([]);
  const [teams, setTeams] = useState([]);
  const [summary, setSummary] = useState(null);
  const [mine, setMine] = useState([]);

  const [categoryId, setCategoryId] = useState('');
  const [nomineeId, setNomineeId] = useState('');
  const [nomineeDeptId, setNomineeDeptId] = useState('');
  const [justification, setJustification] = useState('');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null); // the nomination being replaced

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const minLength = rules?.minJustification ?? 20;

  const load = async () => {
    setLoading(true);
    try {
      const [categoryData, colleagueData, summaryData, mineData] = await Promise.all([
        get('/categories'),
        get('/colleagues'),
        get('/nominations/summary'),
        get('/nominations/mine'),
      ]);
      setCategories(categoryData.categories);
      setColleagues(colleagueData.colleagues);
      setTeams(colleagueData.teams);
      setSummary(summaryData);
      setMine(mineData.nominations);
      const first = categoryData.categories[0];
      if (first && !categoryId) {
        const existing = mineData.nominations.find((nomination) => nomination.categoryId === first.id);
        setCategoryId(first.id);
        setEditingId(existing ? existing.id : null);
        setJustification(existing?.justification ?? '');
        if (first.forTeams) setNomineeDeptId(existing?.nomineeDeptId || '');
        else setNomineeId(existing?.nomineeId || '');
      }
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const category = categories.find((item) => item.id === categoryId);
  const isTeamCategory = Boolean(category?.forTeams);

  const filteredColleagues = useMemo(() => {
    const query = search.trim().toLowerCase();
    return colleagues.filter(
      (colleague) =>
        !query ||
        colleague.fullName.toLowerCase().includes(query) ||
        (colleague.department || '').toLowerCase().includes(query)
    );
  }, [colleagues, search]);

  const existingInCategory = mine.find((nomination) => nomination.categoryId === categoryId);

  const selectingSelf = !isTeamCategory && colleagues.find((c) => c.id === nomineeId)?.isSelf;

  // One nomination per category: loading a category fills the form with the existing pick.
  const fillFrom = (list, id) => {
    const existing = list.find((nomination) => nomination.categoryId === id);
    setEditingId(existing ? existing.id : null);
    setJustification(existing?.justification ?? '');
    setSearch('');
    const target = categories.find((item) => item.id === id);
    if (target?.forTeams) {
      setNomineeDeptId(existing?.nomineeDeptId || '');
      setNomineeId('');
    } else {
      setNomineeId(existing?.nomineeId || '');
      setNomineeDeptId('');
    }
  };

  const selectCategory = (id) => {
    setCategoryId(id);
    fillFrom(mine, id);
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await put('/nominations', {
        categoryId,
        ...(isTeamCategory ? { nomineeDeptId } : { nomineeId }),
        justification,
      });
      const saved = {
        ...result.nomination,
        categoryName: category.name,
        nomineeId: isTeamCategory ? null : nomineeId,
        nomineeDeptId: isTeamCategory ? nomineeDeptId : null,
      };
      setMine((current) => [saved, ...current.filter((item) => item.categoryId !== categoryId)]);
      setSummary((current) => current && ({
        ...current,
        total: current.total + (editingId ? 0 : 1),
        selfNominationsRemaining: current.selfNominationsRemaining
          + Number(Boolean(existingInCategory?.isSelf))
          - Number(Boolean(saved.isSelf)),
      }));
      setEditingId(saved.id);
      setSearch('');
      setSuccess(`${editingId ? 'Nomination updated' : 'Nomination saved'} for ${category.name}.`);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    categoryId && justification.trim().length >= minLength && (isTeamCategory ? nomineeDeptId : nomineeId);

  return (
    <AppShell title="Nominate a colleague" description="One nomination per colleague per category. Justify every nomination." minRole="EMPLOYEE">
      {phase !== 'PHASE_1' && (
        <Alert tone="warning" className="mb-4">
          Nominations are not open right now (current phase: {phase}). You can review what you have already submitted.
        </Alert>
      )}

      {summary && (
        <section className="card mb-4 !p-4 sm:!p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-900">Your nomination progress</p>
              <p className="mt-1 text-xs text-slate-500">Each category is one opportunity to recognize a colleague.</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <StatusPill tone="brand">{summary.total} of {categories.length} completed</StatusPill>
              <StatusPill tone={summary.selfNominationsRemaining > 0 ? 'green' : 'slate'}>
                Self-nomination: {summary.selfNominationsRemaining} of {summary.selfNominationLimit} left
              </StatusPill>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-600 to-emerald-500 transition-all"
              style={{ width: `${categories.length ? Math.min(100, (summary.total / categories.length) * 100) : 0}%` }}
            />
          </div>
        </section>
      )}

      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{success}</Alert>

      {loading && <Spinner label="Loading nominations…" />}

      {!loading && categories.length > 0 && (
        <nav className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Nomination categories">
          {categories.map((item, index) => {
            const saved = mine.some((nomination) => nomination.categoryId === item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectCategory(item.id)}
                aria-current={item.id === categoryId ? 'step' : undefined}
                className={`rounded-xl border p-3.5 text-left shadow-sm transition hover:-translate-y-px ${
                  item.id === categoryId
                    ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100'
                    : 'border-slate-200 bg-white hover:border-brand-300 hover:shadow-md'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-500">{index + 1}</span>
                  <span className={`text-xs font-medium ${saved ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {saved ? 'Saved' : 'To do'}
                  </span>
                </span>
                <span className="mt-1 block text-sm font-medium">{item.name}</span>
              </button>
            );
          })}
        </nav>
      )}

      {!loading && categories.length === 0 && (
        <Alert tone="warning">No nomination categories are available right now.</Alert>
      )}

      {!loading && category && (
      <form className="card space-y-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <div>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">{category.name}</h2>
            {existingInCategory && <StatusPill tone="green">Nomination saved</StatusPill>}
          </div>
          <p className="mt-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">{category.criteria}</p>
          {existingInCategory && (
            <p className="mt-2 text-xs text-amber-700">
              You can update this nomination until Phase 1 closes.
            </p>
          )}
        </div>

        {isTeamCategory ? (
          <div>
            <p className="label">Choose a team or department</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  aria-pressed={nomineeDeptId === team.id}
                  className={`rounded-xl border p-3.5 text-left text-sm font-medium shadow-sm transition ${
                    nomineeDeptId === team.id ? 'border-brand-400 bg-brand-50 text-brand-900 ring-2 ring-brand-100' : 'border-slate-200 hover:border-brand-200 hover:bg-brand-50/50'
                  }`}
                  onClick={() => setNomineeDeptId(team.id)}
                  disabled={phase !== 'PHASE_1'}
                >
                  {team.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="colleague">
              Colleague
            </label>
            <input
              id="colleague"
              className="input mb-2"
              placeholder="Search by name or department"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={phase !== 'PHASE_1'}
            />
            <fieldset disabled={phase !== 'PHASE_1'} className="max-h-72 space-y-2 overflow-y-auto">
              <legend className="sr-only">Choose a colleague</legend>
              {filteredColleagues.map((colleague) => (
                <label
                  key={colleague.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                    nomineeId === colleague.id ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100' : 'border-slate-200 hover:border-brand-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="nominee"
                    className="mt-1"
                    checked={nomineeId === colleague.id}
                    onChange={() => setNomineeId(colleague.id)}
                  />
                  <span className="text-sm">
                    <span className="block font-medium">{colleague.fullName}{colleague.isSelf ? ' (you)' : ''}</span>
                    {colleague.department && <span className="text-xs text-slate-500">{colleague.department}</span>}
                  </span>
                </label>
              ))}
              {filteredColleagues.length === 0 && (
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No colleagues match that search.</p>
              )}
            </fieldset>
            {selectingSelf && (
              <p className="mt-1 text-xs text-amber-700">
                You are nominating yourself. Only one self-nomination is allowed across all categories.
              </p>
            )}
          </div>
        )}

        <div>
          <label className="label" htmlFor="justification">
            Justification
          </label>
          <textarea
            id="justification"
            className="input min-h-[120px]"
            placeholder="Give examples: what did they do, when, and what was the outcome? Include links to evidence if useful."
            value={justification}
            onChange={(event) => setJustification(event.target.value)}
            maxLength={1000}
            disabled={phase !== 'PHASE_1'}
          />
          <p className={`mt-1 text-xs ${justification.trim().length < minLength ? 'text-slate-500' : 'text-emerald-700'}`}>
            {justification.trim().length} / {minLength} characters minimum
          </p>
        </div>

        <button type="submit" className="btn-primary w-full sm:w-auto" disabled={!canSubmit || phase !== 'PHASE_1' || busy}>
          {busy ? 'Saving…' : existingInCategory ? 'Save changes' : 'Save nomination'}
        </button>
      </form>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-bold tracking-tight text-slate-900">Your nominations</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-slate-500">You have not nominated anyone yet.</p>
        ) : (
          <ul className="space-y-2">
            {mine.map((nomination) => (
              <li key={nomination.id}>
                <button
                  type="button"
                  onClick={() => selectCategory(nomination.categoryId)}
                  className="card card-interactive w-full text-left"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {nomination.nominee}
                      {nomination.isSelf && <span className="ml-2 text-xs font-medium text-amber-700">self</span>}
                    </p>
                    <StatusPill tone="brand">{nomination.categoryName}</StatusPill>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{nomination.justification}</p>
                  <span className="mt-2 block text-xs font-medium text-brand-700">Edit nomination</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-xs text-slate-500">
        Every pick is worth 1 point. After Phase 1 the top 5 per category become finalists and the top 15 people
        overall go forward to the committee.{' '}
        <Link href="/employee" className="link">
          Back to dashboard
        </Link>
      </p>
    </AppShell>
  );
}

export default Nominate;
