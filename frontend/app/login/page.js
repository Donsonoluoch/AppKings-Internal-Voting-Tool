'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Alert from '@/components/Alert';
import AppKingsBrand from '@/components/AppKingsBrand';
import { roleHome } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

function LoginForm() {
  const { status, user, login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');

  const [phone, setPhone] = useState('');
  const [departments, setDepartments] = useState([]);
  const [departmentId, setDepartmentId] = useState('');
  const [needsDepartment, setNeedsDepartment] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && user) {
      router.replace(next && next.startsWith('/') ? next : roleHome(user.role));
    }
  }, [status, user, router, next]);

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await login(phone.trim(), departmentId || undefined);
      if (result.requiresDepartment) {
        setDepartments(result.departments);
        setNeedsDepartment(true);
        return;
      }
      router.replace(next && next.startsWith('/') ? next : roleHome(result.user.role));
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-backdrop relative grid min-h-screen place-items-center overflow-hidden px-4 py-8 sm:py-12">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[min(90vw,36rem)] w-[min(90vw,36rem)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-300/20 after:absolute after:inset-3 after:rounded-full after:border after:border-white/10" />
      <div className="relative w-full max-w-[28rem]">
        <section className="rounded-[2rem] border border-white/70 bg-white p-6 shadow-[0_30px_90px_rgba(0,0,0,0.3)] sm:p-9">
          <div className="mb-7">
            <AppKingsBrand />
            <div className="mt-6 border-t border-slate-100 pt-5 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent-600">AppKings Solutions</p>
              <h1 className="mt-2 text-2xl font-bold leading-snug tracking-tight text-brand-900">
                2026 Employee Awards
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Employee Recognition and Voting Portal
              </p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <label className="label" htmlFor="phone">
              Phone number
            </label>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+254 712 345 678"
              className="input"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
              disabled={needsDepartment}
            />
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Enter the phone number registered by your administrator.
            </p>
          </div>

          {needsDepartment && (
            <div>
              <label className="label" htmlFor="department">
                Choose your department
              </label>
              <select
                id="department"
                className="input"
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
                required
              >
                <option value="">Select a department…</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                This is saved to your employee profile. Contact Steve if it needs changing later.
              </p>
              <button
                type="button"
                className="mt-2 text-sm font-medium text-brand-700 hover:text-brand-900"
                onClick={() => {
                  setNeedsDepartment(false);
                  setDepartments([]);
                  setDepartmentId('');
                }}
              >
                Use a different phone number
              </button>
            </div>
          )}

          <Alert tone="error">{error}</Alert>

          <button type="submit" className="btn-primary w-full" disabled={busy || (needsDepartment && !departmentId)}>
            {busy ? 'Signing in…' : needsDepartment ? 'Save department and sign in' : 'Continue'}
          </button>
          </form>

          <p className="mt-5 text-center text-xs leading-relaxed text-slate-500">
            Sign in with your registered phone number. Your name and department appear after sign-in.
          </p>
        </section>
        <p className="mt-6 text-center text-xs tracking-wide text-blue-100/75">
          Celebrating the people behind our success
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-slate-500">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
