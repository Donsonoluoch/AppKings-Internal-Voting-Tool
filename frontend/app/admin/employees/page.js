'use client';

import { useEffect, useRef, useState } from 'react';
import AppShell from '@/components/AppShell';
import Alert from '@/components/Alert';
import Spinner from '@/components/Spinner';
import StatusPill from '@/components/StatusPill';
import { get, patch, post } from '@/lib/api';

const CSV_TEMPLATE = `fullName,phone,department,role
Otieno Peter,0712345678,Engineering,EMPLOYEE
Grace Wanjiru,0722000001,Operations,COMMITTEE`;

function Employees() {
  const [employees, setEmployees] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [csv, setCsv] = useState(CSV_TEMPLATE);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = () => {
    Promise.all([get(`/admin/employees${search ? `?search=${encodeURIComponent(search)}` : ''}`), get('/admin/departments')])
      .then(([employeeData, departmentData]) => {
        setEmployees(employeeData.employees);
        setDepartments(departmentData.departments);
      })
      .catch((loadError) => setError(loadError.message));
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

  const resetDevice = async (employee) => {
    if (!window.confirm(`Reset the registered device for ${employee.fullName}? This can only be done once.`)) return;
    setError('');
    setSuccess('');
    try {
      await post(`/admin/devices/${employee.id}/reset`);
      setSuccess(`${employee.fullName} can now register a new device on their next login.`);
      load();
    } catch (resetError) {
      setError(resetError.message);
    }
  };

  return (
    <AppShell title="Employees & devices" description="Import the team, manage eligibility, departments and device resets." minRole="ADMIN">
      <Alert tone="error" className="mb-3">{error}</Alert>
      <Alert tone="success" className="mb-3">{success}</Alert>

      <section className="card">
        <h2 className="text-base font-semibold">Import from CSV</h2>
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
          <h2 className="text-base font-semibold">Team ({employees?.length ?? '…'})</h2>
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
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Phone</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Department</th>
                  <th className="py-2 pr-3">Eligible</th>
                  <th className="py-2 pr-3">Device</th>
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
                      <input
                        type="checkbox"
                        checked={employee.eligible}
                        onChange={(event) => saveEmployee(employee, { eligible: event.target.checked })}
                        aria-label={`Eligible to be nominated: ${employee.fullName}`}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      {employee.hasDevice ? (
                        <div className="flex items-center gap-2">
                          <StatusPill tone={employee.deviceResetCount >= 1 ? 'amber' : 'green'}>
                            {employee.deviceResetCount >= 1 ? 'reset used' : 'registered'}
                          </StatusPill>
                          <button
                            type="button"
                            className="text-xs font-medium text-brand-700 hover:underline disabled:text-slate-400 disabled:no-underline"
                            onClick={() => resetDevice(employee)}
                            disabled={employee.deviceResetCount >= 1}
                          >
                            Reset
                          </button>
                        </div>
                      ) : (
                        <StatusPill tone="slate">not yet</StatusPill>
                      )}
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
