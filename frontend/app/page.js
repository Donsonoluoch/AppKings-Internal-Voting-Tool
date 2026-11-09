'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { roleHome } from '@/lib/api';

export default function IndexPage() {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated') router.replace(roleHome(user.role));
    if (status === 'anonymous') router.replace('/login');
  }, [status, user, router]);

  return (
    <div className="grid min-h-screen place-items-center">
      <p className="animate-pulse text-sm text-slate-500">Loading…</p>
    </div>
  );
}
