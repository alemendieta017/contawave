'use client';

import React, { useEffect, useState } from 'react';
import { DeleteLoanResponse, LoanDto } from '@sistema-contable/shared';
import { AlertCircle, Trash2, X } from 'lucide-react';
import { api } from '../../services/api';

interface DeleteLoanModalProps {
  isOpen: boolean;
  onClose: () => void;
  loan: LoanDto;
  onDeleted: (res: DeleteLoanResponse) => Promise<void> | void;
}

export default function DeleteLoanModal({
  isOpen,
  onClose,
  loan,
  onDeleted,
}: DeleteLoanModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
  }, [isOpen, loan.id]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) return null;

  const isBlocked = loan.deleteActionPreview === 'BLOCKED' || loan.activeMovementsCount > 0;
  const isCancel = loan.deleteActionPreview === 'CANCEL';

  const titleMessage = isBlocked
    ? `No se puede eliminar todavía (${loan.activeMovementsCount} movimiento${
        loan.activeMovementsCount === 1 ? '' : 's'
      } activo${loan.activeMovementsCount === 1 ? '' : 's'})`
    : isCancel
      ? 'Confirmar anulación del préstamo'
      : 'Confirmar eliminación del préstamo';

  const bodyMessage = isBlocked
    ? 'Para proteger el Libro Diario y el saldo de tus bancos, revertí primero los pagos o ajustes activos registrados en este préstamo.'
    : isCancel
      ? 'Este préstamo tiene historial previo revertido. Para preservar la inmutabilidad del Libro Diario, se revertirá el asiento inicial, se marcará el préstamo como Anulado y se desactivará su cuenta de Pasivo.'
      : 'Al no tener pagos ni ajustes previos, se eliminarán el préstamo, su asiento de apertura y su cuenta de Pasivo vinculada.';

  const handleConfirm = async () => {
    try {
      setSubmitting(true);
      setError('');
      const res = await api.loans.delete(loan.id);
      await onDeleted(res);
      onClose();
    } catch (err: any) {
      setError(err.message || 'No se pudo eliminar/anular el préstamo.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-loan-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-lg max-h-dvh overflow-y-auto p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h2 id="delete-loan-modal-title" className="text-base font-bold text-foreground">
                Eliminar / Anular préstamo
              </h2>
              <p className="text-xs text-muted-foreground">{loan.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="min-h-11 min-w-11 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="p-3.5 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 space-y-1">
          <p className="text-xs font-bold text-rose-700 dark:text-rose-300">{titleMessage}</p>
          <p className="text-xs text-foreground">{bodyMessage}</p>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 pt-2">
          <span className="text-xs text-muted-foreground">Integridad contable garantizada</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 sm:flex-initial px-4 py-2.5 min-h-11 rounded-xl border border-border bg-card text-xs font-bold text-foreground hover:bg-muted cursor-pointer transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cerrar
            </button>
            {!isBlocked && (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting}
                className="flex-1 sm:flex-initial px-5 py-2.5 min-h-11 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {submitting
                  ? 'Procesando...'
                  : isCancel
                    ? 'Confirmar anulación'
                    : 'Confirmar eliminación'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
