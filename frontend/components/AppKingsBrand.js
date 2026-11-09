export default function AppKingsBrand({ compact = false }) {
  return (
    <img
      src="/appkings-logo.png"
      alt="AppKings Solutions — Viable enterprise solutions"
      className={`shrink-0 rounded-full bg-white object-cover ${
        compact ? 'h-11 w-11 ring-1 ring-white/70' : 'mx-auto h-40 w-40 shadow-lg shadow-black/10 ring-1 ring-slate-200'
      }`}
    />
  );
}
