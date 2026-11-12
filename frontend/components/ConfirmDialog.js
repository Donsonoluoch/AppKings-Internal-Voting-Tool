'use client';

import { useEffect, useState } from 'react';

/**
 * Confirmation dialog (§12). `requireText` forces a typed confirmation for
 * irreversible actions such as moving between phases.
 */
export default function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', requireText, onConfirm, onCancel, busy }) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  if (!open) return null;

  const canConfirm = !requireText || typed.trim().toUpperCase() === requireText.toUpperCase();

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="w-full max-w-md rounded-2xl border border-white/70 bg-white p-5 shadow-[0_24px_70px_rgba(0,0,0,0.28)] sm:p-6">
        <h2 id="confirm-title" className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
        <div className="mt-2 text-sm text-slate-600">{children}</div>

        {requireText && (
          <div className="mt-4">
            <label className="label" htmlFor="confirm-text">
              Type <span className="font-mono font-semibold">{requireText}</span> to confirm
            </label>
            <input
              id="confirm-text"
              className="input"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={onConfirm} disabled={!canConfirm || busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
