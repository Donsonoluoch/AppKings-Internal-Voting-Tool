'use client';

import { PHASE_META, PHASES } from '@appkings/shared';

const STYLES = {
  NOT_STARTED: 'bg-slate-100 text-slate-700 border-slate-200',
  PHASE_1: 'bg-brand-50 text-brand-800 border-brand-200',
  PHASE_2: 'bg-amber-50 text-amber-900 border-amber-200',
  PHASE_3: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  CLOSED: 'bg-slate-100 text-slate-700 border-slate-200',
  PUBLISHED: 'bg-purple-50 text-purple-900 border-purple-200',
};

/** §12 — a phase banner at the top of every page: current phase + what is allowed. */
export default function PhaseBanner({ phase, audience = 'employee' }) {
  if (!phase) return null;
  const meta = PHASE_META[phase] || PHASE_META.NOT_STARTED;
  const progressIndex = Math.max(0, Math.min(PHASES.indexOf(phase) - 1, 3));

  return (
    <div className={`mb-6 rounded-2xl border px-4 py-3.5 shadow-sm sm:px-5 ${STYLES[phase] || STYLES.NOT_STARTED}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-60">Election status</p>
          <p className="mt-0.5 text-sm font-bold">{meta.label}</p>
        </div>
        <div className="flex gap-1.5" aria-hidden="true">
          {PHASES.slice(1, 5).map((step, stepIndex) => (
            <span
              key={step}
              className={`h-1.5 w-8 rounded-full transition-opacity ${stepIndex < progressIndex ? 'bg-current opacity-70' : stepIndex === progressIndex ? 'bg-current opacity-90' : 'bg-current opacity-20'}`}
            />
          ))}
        </div>
      </div>
      <p className="mt-1 text-sm leading-5 opacity-80">{audience === 'employee' ? meta.employee : meta.tagline}</p>
    </div>
  );
}
