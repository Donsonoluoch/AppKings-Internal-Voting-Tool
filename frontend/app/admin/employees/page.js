'use client';

import { useEffect, useRef, useState } from 'react';
import AppShell from '@/components/AppShell';
import Alert from '@/components/Alert';
import Spinner from '@/components/Spinner';
import { get, patch, post } from '@/lib/api';

const CSV_TEMPLATE = `fullName,phone,department,role
Otieno Peter,0712345678,Technical,EMPLOYEE
Grace Wanjiru,0722000001,Operations,COMMITTEE`;

function Employees() {
  const [employees, setEmployees] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [teams, setTeams] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [csv, setCsv] = useState(CSV_TEMPLATE);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = () => {
    Promise.all([
      get(`/admin/employees${search ? `?search=${encodeURIComponent(search)}` : ''}`),
      get('/admin/departments'),
      get('/admin/teams'),
    ])
      .then(([employeeData, departmentData, teamData]) => {
        setEmployees(employeeData.employees);
        setDepartments(departmentData.departments);
        setTeams(teamData.teams);
      })
      .catch((loadError) => setError(loadError.message));
  };

  /** Make the database departments/teams match packages/shared/constants.js. */
  const syncTaxonomy = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await post('/admin/taxonomy/sync', {});
      setSuccess(
        `Lists synced: ${result.departments} departments, ${result.teams} teams. `
          + `${result.departments.created + result.teams.created} added, `
          + `${result.departments.removed + result.teams.removed} unused removed.`
      );
      load();
    } catch (syncError) {
      setError(syncError.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(load, [search]);

  const importCsv = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    setReport(null);
    try {
      const result = await post('/admin/employees/import', { csv });
      setReport(result);
      setSuccess(`Import finished: ${result.created} created, ${result.updated} updated.`);
      load();
    } catch (importError) {
      setError(importError.message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ''));
    reader.readAsText(file);
  };

  const saveEmployee = async (employee, changes) => {
    setError('');
    setSuccess('');
    try {
      const result = await patch(`/admin/employees/${employee.id}`, changes);
      setEmployees((current) => current.map((item) => (item.id === employee.id ? result.employee : item)));
      setSuccess(`${result.employee.fullName} updated.`);
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  return (
    <AppShell title="Employees" description="Import the roster and manage roles, departments, teams, eligibility and account access." minRole="ADMIN">
      <Alert tone="error" className="mb-3">{error}</Alert>
      <Alert tone="success" className="mb-3">{success}</Alert>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Import from CSV</h2>
          <button type="button" className="btn-secondary text-xs" onClick={syncTaxonomy} disabled={busy}>
            Sync departments &amp; teams
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          The department and team lists come from <code>packages/shared/constants.js</code> (seeded on
          setup). Sync creates any missing value and removes unused extras; a value still assigned to
          someone is kept.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Columns: <code>fullName, phone, department, role</code>. Existing phone numbers are updated. Departments that do
          not exist are created.
        </p>
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="mt-3 block text-sm" />
        <textarea
          className="input mt-3 min-h-[140px] font-mono text-xs"
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          spellCheck={false}
        />
        <button type="button" className="btn-primary mt-3" onClick={importCsv} disabled={busy || !csv.trim()}>
          {busy ? 'Importing…' : 'Import employees'}
        </button>

        {report && (
          <div className="mt-3 text-sm">
            <p>
              Created {report.created}, updated {report.updated}, skipped {report.skipped.length}.
            </p>
            {report.departmentsCreated.length > 0 && (
              <p className="text-xs text-slate-500">New departments: {report.departmentsCreated.join(', ')}</p>
            )}
            {report.skipped.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs text-red-700">
                {report.skipped.map((row, index) => (
                  <li key={index}>
                    Line {row.line}: {row.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="card mt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Employees ({employees?.length ?? '…'})</h2>
          <input
            className="input max-w-xs"
            placeholder="Search name or phone"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {!employees && <Spinner />}

        {employees && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Phone</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Department</th>
                  <th className="py-2 pr-3">Team</th>
                  <th className="py-2 pr-3">Eligible</th>
                  <th className="py-2 pr-3">Access</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id} className="border-b border-slate-100 last:border-0 align-middle">
                    <td className="py-2 pr-3 font-medium">
                      {employee.fullName}
                      {!employee.active && <span className="ml-2 text-xs text-red-700">inactive</span>}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{employee.phone}</td>
                    <td className="py-2 pr-3">
                      <select
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                        value={employee.role}
                        onChange={(event) => saveEmployee(employee, { role: event.target.value })}
                      >
                        <option value="EMPLOYEE">EMPLOYEE</option>
                        <option value="COMMITTEE">COMMITTEE</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                        value={employee.departmentId || ''}
                        onChange={(event) => saveEmployee(employee, { departmentId: event.target.value || null })}
                      >
                        <option value="">—</option>
                        {departments.map((department) => (
                          <option key={department.id} value={department.id}>
                            {department.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                        value={employee.teamId || ''}
                        onChange={(event) => saveEmployee(employee, { teamId: event.target.value || null })}
                      >
                        <option value="">—</option>
                        {teams.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={employee.eligible}
                        onChange={(event) => saveEmployee(employee, { eligible: event.target.checked })}
                        aria-label={`Eligible to be nominated: ${employee.fullName}`}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        className="ml-2 text-xs text-slate-500 hover:underline"
                        onClick={() => saveEmployee(employee, { active: !employee.active })}
                      >
                        {employee.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}

export default Employees;
