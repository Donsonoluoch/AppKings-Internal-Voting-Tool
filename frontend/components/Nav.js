'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import AppKingsBrand from './AppKingsBrand';

const LINKS = [
  { href: '/employee', label: 'Home', roles: ['EMPLOYEE'] },
  { href: '/employee/nominate', label: 'Nominate', roles: ['EMPLOYEE'], phases: ['PHASE_1'] },
  { href: '/employee/vote', label: 'Vote', roles: ['EMPLOYEE'], phases: ['PHASE_3'] },
  { href: '/employee/results', label: 'Results', roles: ['EMPLOYEE'], phases: ['PUBLISHED'] },
  { href: '/committee', label: 'Committee', roles: ['COMMITTEE', 'ADMIN'], phases: ['PHASE_2'] },
  { href: '/committee/vote', label: 'Picks', roles: ['COMMITTEE', 'ADMIN'], phases: ['PHASE_2'] },
  { href: '/admin', label: 'Admin', roles: ['ADMIN'] },
  { href: '/admin/tally', label: 'Tally', roles: ['ADMIN'], phases: ['PHASE_1', 'PHASE_2'] },
  { href: '/admin/employees', label: 'Employees', roles: ['ADMIN'] },
  { href: '/admin/audit', label: 'Audit', roles: ['ADMIN'] },
  { href: '/admin/results', label: 'Results', roles: ['ADMIN'] },
];

export default function Nav() {
  const { user, phase, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  const links = LINKS.filter((link) => {
    if (!link.roles.includes(user.role)) return false;
    if (link.phases && !link.phases.includes(phase)) return false;
    return true;
  });

  const onLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#071a3b]/95 text-white shadow-lg shadow-[#071a3b]/10 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/employee" className="flex min-w-0 items-center gap-3">
          <AppKingsBrand compact />
          <span className="hidden h-8 border-l border-white/20 sm:block" />
          <span className="min-w-0 text-sm font-semibold leading-tight">
            <span className="block">2026 Awards</span>
            <span className="block truncate text-xs font-normal text-blue-200">{user.fullName}</span>
          </span>
        </Link>

        <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${pathname === link.href
                  ? 'bg-white/10 text-white shadow-[inset_0_-2px_0_#ff542e]'
                  : 'text-blue-100/80 hover:bg-white/10 hover:text-white'
                }`}
            >
              {link.label}
            </Link>
          ))}
          <button type="button" onClick={onLogout} className="ml-2 rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-blue-100 transition hover:border-white/40 hover:bg-white/10 hover:text-white">
            Sign out
          </button>
        </nav>

        <button
          type="button"
          className="rounded-lg border border-white/25 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 md:hidden"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </div>

      {open && (
        <div className="border-t border-white/10 bg-[#0a2149] px-4 py-2 md:hidden">
          <div className="mx-auto flex max-w-5xl flex-col">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`rounded-lg px-3 py-2.5 text-sm font-medium transition ${pathname === link.href ? 'bg-white/10 text-white' : 'text-blue-100 hover:bg-white/10'}`}
              >
                {link.label}
              </Link>
            ))}
            <button type="button" onClick={onLogout} className="px-3 py-2.5 text-left text-sm text-blue-200">
              Sign out
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
