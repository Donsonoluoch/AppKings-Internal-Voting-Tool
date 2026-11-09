/** Shared results view for the admin screen and the published employee results page. */
export default function ResultsTable({
  results,
  showBreakdown = false,
  scoreKey = 'finalPoints',
  scoreLabel = 'final votes',
}) {
  if (!results || results.length === 0) {
    return <p className="text-sm text-slate-600">No results to show yet.</p>;
  }

  return (
    <div className="space-y-6">
      {results.map((category) => (
        <section key={category.categoryId} className="card">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">{category.categoryName}</h2>
            <p className="text-xs text-slate-500">
              {category.results.length} candidate{category.results.length === 1 ? '' : 's'} · points only
            </p>
          </div>

          {category.tiebreakRequired && (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              The top positions are tied after the earlier phases. The admin must decide this one.
            </p>
          )}

          <div className="space-y-2">
            {category.results.map((row, index) => {
              const isWinner = row.id === category.winnerId && !category.tiebreakRequired;
              const score = row[scoreKey] ?? 0;
              const max = Math.max(1, ...category.results.map((item) => item[scoreKey] ?? 0));
              return (
                <div
                  key={row.id}
                  className={`rounded-lg border px-3 py-2 ${isWinner ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        <span className="mr-2 text-slate-400">#{index + 1}</span>
                        {row.name}
                        {isWinner && <span className="ml-2 text-xs font-semibold text-emerald-700">Winner</span>}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {row.department || (row.kind === 'team' ? 'Team' : '\u00a0')}
                        {showBreakdown && (
                          <>
                            {' · '}
                            Phase 1 {row.nominationPoints} · Phase 2 {row.committeePoints} · Phase 3{' '}
                            {row.finalPoints}
                          </>
                        )}
                        {!showBreakdown && ` · ${score} ${scoreLabel}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">{row.totalPoints} pts</p>
                      <p className="text-[11px] text-slate-500">
                        {showBreakdown ? 'overall' : scoreLabel}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full ${isWinner ? 'bg-emerald-500' : 'bg-slate-400'}`}
                      style={{ width: `${Math.min(100, (score / max) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
