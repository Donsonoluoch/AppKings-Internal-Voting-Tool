const TONES = {
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-900',
  red: 'bg-red-100 text-red-800',
  slate: 'bg-slate-100 text-slate-700',
  brand: 'bg-brand-100 text-brand-800',
};

export default function StatusPill({ tone = 'slate', children }) {
  return <span className={`badge ${TONES[tone] || TONES.slate}`}>{children}</span>;
}
