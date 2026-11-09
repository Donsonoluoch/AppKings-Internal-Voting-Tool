'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import Alert from '@/components/Alert';
import ConfirmDialog from '@/components/ConfirmDialog';
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const minLength = rules?.minJustification ?? 20;

  const load = () => {
    Promise.all([get('/categories'), get('/colleagues'), get('/nominations/summary'), get('/nominations/mine')])
      .then(([categoryData, colleagueData, summaryData, mineData]) => {
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
      })
      .catch((loadError) => setError(loadError.message));
  };

  useEffect(load, []);

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

  const selectedNominee = isTeamCategory
    ? teams.find((team) => team.id === nomineeDeptId)?.name
    : colleagues.find((colleague) => colleague.id === nomineeId)?.fullName;

  const existingInCategory = mine.find((nomination) => nomination.categoryId === categoryId);

  const selectingSelf = !isTeamCategory && colleagues.find((c) => c.id === nomineeId)?.isSelf;

  const resetForm = () => {
    setNomineeId('');
    setNomineeDeptId('');
    setJustification('');
    setSearch('');
  };

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
      await put('/nominations', {
        categoryId,
        ...(isTeamCategory ? { nomineeDeptId } : { nomineeId }),
        justification,
      });
      setSuccess(
        `${editingId ? 'Nomination updated' : 'Nomination saved'}: ${selectedNominee} for ${category.name}.`
      );
      setConfirmOpen(false);
      resetForm();
      // Reload first, then rebuild the form from the saved nomination.
      const fresh = await get('/nominations/mine');
      setMine(fresh.nominations);
      fillFrom(fresh.nominations, categoryId);
      load();
    } catch (submitError) {
      setError(submitError.message);
      setConfirmOpen(false);
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
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          <StatusPill tone="brand">{summary.total} of {categories.length} categories nominated</StatusPill>
          <StatusPill tone={summary.selfNominationsRemaining > 0 ? 'green' : 'slate'}>
            Self-nomination: {summary.selfNominationsRemaining} of {summary.selfNominationLimit} left
          </StatusPill>
        </div>
      )}

      <form
        className="card space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setConfirmOpen(true);
        }}
      >
        <div>
          <label className="label" htmlFor="category">
            Category
          </label>
          <select
            id="category"
            className="input"
            value={categoryId}
            onChange={(event) => selectCategory(event.target.value)}
            disabled={phase !== 'PHASE_1'}
          >
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {category && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{category.criteria}</p>}
          {existingInCategory && (
            <p className="mt-2 text-xs text-amber-700">
              You already nominated someone here. Saving replaces that nomination — you still get one pick per
              category.
            </p>
          )}
        </div>

        {isTeamCategory ? (
          <div>
            <label className="label" htmlFor="team">
              Team / department
            </label>
            <select
              id="team"
              className="input"
              value={nomineeDeptId}
              onChange={(event) => setNomineeDeptId(event.target.value)}
              disabled={phase !== 'PHASE_1'}
            >
              <option value="">Select a team…</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
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
            <select
              id="colleague-select"
              aria-label="Colleague"
              className="input"
              size={Math.min(8, Math.max(3, filteredColleagues.length))}
              value={nomineeId}
              onChange={(event) => setNomineeId(event.target.value)}
              disabled={phase !== 'PHASE_1'}
            >
              {filteredColleagues.map((colleague) => (
                <option key={colleague.id} value={colleague.id}>
                  {colleague.fullName}
                  {colleague.department ? ` — ${colleague.department}` : ''}
                  {colleague.isSelf ? ' (you)' : ''}
                </option>
              ))}
            </select>
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

        <Alert tone="error">{error}</Alert>
        <Alert tone="success">{success}</Alert>

        <button type="submit" className="btn-primary w-full sm:w-auto" disabled={!canSubmit || phase !== 'PHASE_1'}>
          {existingInCategory ? 'Replace nomination' : 'Submit nomination'}
        </button>
      </form>

      <section className="mt-8">
        <h2 className="mb-2 text-base font-semibold">Your nominations</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-slate-500">You have not nominated anyone yet.</p>
        ) : (
          <ul className="space-y-2">
            {mine.map((nomination) => (
              <li key={nomination.id} className="card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {nomination.nominee}
                    {nomination.isSelf && <span className="ml-2 text-xs font-medium text-amber-700">self</span>}
                  </p>
                  <StatusPill tone="brand">{nomination.categoryName}</StatusPill>
                </div>
                <p className="mt-1 text-sm text-slate-600">{nomination.justification}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirmOpen}
        title={existingInCategory ? 'Replace this nomination?' : 'Submit this nomination?'}
        confirmLabel={existingInCategory ? 'Replace' : 'Submit'}
        busy={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={submit}
      >
        <p>
          You are nominating <strong>{selectedNominee || '—'}</strong> for <strong>{category?.name}</strong>. You make
          one pick per category, and each pick is worth 1 point.
        </p>
        {selectingSelf && <p className="mt-2 text-amber-800">This will use your only self-nomination.</p>}
      </ConfirmDialog>

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
