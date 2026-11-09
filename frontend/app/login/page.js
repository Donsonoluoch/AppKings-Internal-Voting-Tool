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
      const result = await login(`+254${phone.replace(/\D/g, '')}`);
      router.replace(next && next.startsWith('/') ? next : roleHome(result.user.role));
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-backdrop relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[min(90vw,34rem)] w-[min(90vw,34rem)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-300/20 after:absolute after:inset-2 after:rounded-full after:border after:border-white/10" />
      <div className="relative w-full max-w-md">
        <section className="rounded-[1.75rem] border border-white/50 bg-white p-6 shadow-2xl shadow-black/30 sm:p-9">
          <div className="mb-6">
            <AppKingsBrand />
            <div className="mt-6 border-t border-slate-100 pt-5 text-center">
              <h1 className="text-xl font-bold leading-snug text-brand-900">
                2026 Employee Awards
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Employee Recognition and Voting Portal
              </p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="phone">
              Phone number
            </label>
            <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-300 bg-white transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-200">
              <span className="grid place-items-center border-r border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-600">
                +254
              </span>
              <input
                id="phone"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="712 345 678"
                className="w-full border-0 px-3 py-2.5 text-base focus:outline-none focus:ring-0"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Use the number your administrator registered. Use one browser — do not use incognito mode.
            </p>
          </div>

          <Alert tone="error">{error}</Alert>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
          </form>

          <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
            Your first sign-in registers this device. A second device is blocked for security.
          </p>
        </section>
        <p className="mt-5 text-center text-xs tracking-wide text-blue-100/70">
          A better way to celebrate the people behind our success
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
