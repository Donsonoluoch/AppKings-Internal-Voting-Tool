'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import Alert from '@/components/Alert';
import ConfirmDialog from '@/components/ConfirmDialog';
import ResultsTable from '@/components/ResultsTable';
import Spinner from '@/components/Spinner';
import { get, post } from '@/lib/api';

function AdminResults() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmStage, setConfirmStage] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    get('/admin/results')
      .then(setData)
      .catch((loadError) => setError(loadError.message));
  };

  useEffect(load, []);

  const publish = async (stage, acknowledgeTies = false) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await post('/admin/publish', { stage, acknowledgeTies });
      setSuccess(`${stage.replace('_', ' ')} results are published to employees.`);
      setConfirmStage(null);
      load();
    } catch (publishError) {
      setError(publishError.message);
      setConfirmStage(null);
    } finally {
      setBusy(false);
    }
  };

  const hasTies = data?.results?.some((category) => category.tiebreakRequired);
  const phases = [
    {
      stage: 'PHASE_1',
      key: 'phase1',
      title: 'Phase 1 — Nominations',
      label: 'nominations',
      scoreKey: 'nominationPoints',
      canPublish: ['PHASE_2', 'PHASE_3', 'CLOSED', 'PUBLISHED'].includes(data?.phase),
      results: data?.phaseResults?.phase1,
    },
    {
      stage: 'PHASE_2',
      key: 'phase2',
      title: 'Phase 2 — Committee picks',
      label: 'committee picks',
      scoreKey: 'committeePoints',
      canPublish: ['PHASE_3', 'CLOSED', 'PUBLISHED'].includes(data?.phase),
      results: data?.phaseResults?.phase2,
    },
    {
      stage: 'PHASE_3',
      key: 'phase3',
      title: 'Phase 3 — Final vote',
      label: 'final votes',
      scoreKey: 'finalPoints',
      canPublish: ['CLOSED', 'PUBLISHED'].includes(data?.phase),
      results: data?.results,
    },
  ];
  const stageToPublish = phases.find((phase) => phase.stage === confirmStage);

  return (
    <AppShell title="Results & publishing" description="Review each phase and publish its results to employees after it closes." minRole="ADMIN">
      <Alert tone="error" className="mb-3">{error}</Alert>
      <Alert tone="success" className="mb-3">{success}</Alert>

      {!data && !error && <Spinner label="Computing results…" />}
      {hasTies && (
        <Alert tone="warning" className="mb-3">
          At least one final category is still tied after the earlier-phase tie-break. Confirm before publishing the final results.
        </Alert>
      )}
      {data && (
        <div className="space-y-5">
          {phases.map((phase) => {
            const published = data.publications?.[phase.key] ?? false;
            const disabled = !phase.canPublish || published || busy;

            return (
              <section key={phase.stage} className="card">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{phase.title}</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {published
                        ? 'Published to employees'
                        : phase.canPublish
                          ? 'Closed — ready to publish'
                          : 'Available to publish after this phase closes'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={published ? 'btn-secondary' : 'btn-primary'}
                    onClick={() => setConfirmStage(phase.stage)}
                    disabled={disabled}
                  >
                    {published ? 'Published' : `Publish ${phase.stage.replace('_', ' ')}`}
                  </button>
                </div>
                <ResultsTable
                  results={phase.results}
                  showBreakdown={phase.stage === 'PHASE_3'}
                  scoreKey={phase.scoreKey}
                  scoreLabel={phase.label}
                />
              </section>
            );
          })}
          <p className="text-xs text-slate-500">
            Votes remain confidential. Published tables show points only, never voter identities.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmStage)}
        title={`Publish ${confirmStage?.replace('_', ' ')} results?`}
        confirmLabel={confirmStage === 'PHASE_3' && hasTies ? 'Publish anyway' : 'Publish'}
        requireText="publish"
        busy={busy}
        onCancel={() => setConfirmStage(null)}
        onConfirm={() => publish(confirmStage, Boolean(confirmStage === 'PHASE_3' && hasTies))}
      >
        <p>
          {stageToPublish?.title} results will become visible to all employees. This release cannot be undone from the UI.
          {confirmStage === 'PHASE_3' ? ' The final release also completes the cycle.' : ''}
        </p>
      </ConfirmDialog>
    </AppShell>
  );
}

export default AdminResults;
