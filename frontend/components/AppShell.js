'use client';

import Nav from './Nav';
import PhaseBanner from './PhaseBanner';
import { useRequireRole } from '@/lib/auth-context';

/** Page frame for every signed-in route: nav, mobile-first container, phase banner. */
export default function AppShell({ children, minRole = 'EMPLOYEE', title, description, hideBanner = false }) {
  const auth = useRequireRole(minRole);

  if (auth.status !== 'authenticated') {
    return (
      <div className="grid min-h-screen place-items-center">
        <p className="animate-pulse text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-9 lg:px-8">
        {!hideBanner && <PhaseBanner phase={auth.phase} audience={minRole === 'EMPLOYEE' ? 'employee' : 'other'} />}
        {(title || description) && (
          <div className="mb-6 border-b border-slate-200/80 pb-5">
            {title && <h1 className="page-title">{title}</h1>}
            {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
