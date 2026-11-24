'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { LoanDto, LoanInstallmentDto } from '@sistema-contable/shared';
import { AlertCircle, RotateCcw, X } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { api } from '../../services/api';
import { formatLoanShortDate } from './loan-ui';

interface ReverseLoanPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  loan: LoanDto;
  installment: LoanInstallmentDto;
  onSuccess: (updated: LoanDto) => Promise<void> | void;
}

export default function ReverseLoanPaymentModal({
  isOpen,
  onClose,
  loan,
  installment,
  onSuccess,
}: ReverseLoanPaymentModalProps) {
  const allocations = installment.allocations || [];
  const [selectedAllocationId, setSelectedAllocationId] = useState(
    allocations[allocations.length - 1]?.id || '',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const currencyInfo = useMemo(
    () => ({
      code: loan.currencyCode,
      symbol: loan.currencySymbol,
      decimalPlaces: loan.decimalPlaces,
    }),
    [loan.currencyCode, loan.currencySymbol, loan.decimalPlaces],
  );

  useEffect(() => {
    if (!isOpen) return;
    const latest = allocations[allocations.length - 1]?.id || '';
    setSelectedAllocationId(latest);
    setError('');
  }, [isOpen, installment.id, allocations]);

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

  if (!isOpen || allocations.length === 0) return null;

  const selectedAlloc =
    allocations.find((a) => a.id === selectedAllocationId) || allocations[allocations.length - 1];

  const handleConfirm = async () => {
    if (!selectedAlloc) return;
    try {
      setSubmitting(true);
      setError('');
      const updated = await api.loans.reverseAllocation(selectedAlloc.id);
      await onSuccess(updated);
      onClose();
    } catch (err: any) {
      setError(err.message || 'No se pudo revertir el pago.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reverse-loan-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-lg max-h-dvh overflow-y-auto p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h2 id="reverse-loan-modal-title" className="text-base font-bold text-foreground">
                Revertir pago de cuota
              </h2>
              <p className="text-xs text-muted-foreground">
                {loan.name} · Cuota #{installment.installmentNumber}
              </p>
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

        {selectedAlloc && (
          <div className="p-3.5 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 space-y-1">
            <p className="text-xs font-bold text-rose-700 dark:text-rose-300">
              Vas a revertir el pago de {formatCurrency(selectedAlloc.totalAmount, currencyInfo)} (
              {formatLoanShortDate(selectedAlloc.paidAt)})
            </p>
            <p className="text-xs text-foreground">
              El importe se devolverá al saldo de{' '}
              <strong>
                {selectedAlloc.paymentAccountName ||
                  loan.defaultPaymentAccountName ||
                  'la cuenta bancaria'}
              </strong>{' '}
              y se recalculará el estado de la cuota #{installment.installmentNumber}.
            </p>
          </div>
        )}

        {allocations.length > 1 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-foreground">Elegí qué pago querés revertir:</p>
            <div className="space-y-1.5">
              {allocations.map((alloc) => (
                <label
                  key={alloc.id}
                  className="flex items-center justify-between gap-2 p-3 min-h-11 rounded-xl border border-border bg-card hover:bg-muted/40 cursor-pointer text-xs"
                >
                  <span className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="reverse-loan-alloc"
                      checked={selectedAlloc?.id === alloc.id}
                      onChange={() => setSelectedAllocationId(alloc.id)}
                      className="accent-indigo-600"
                    />
                    <span className="text-foreground">
                      {formatLoanShortDate(alloc.paidAt)} ·{' '}
                      {alloc.paymentAccountName || 'Cuenta bancaria'}
                    </span>
                  </span>
                  <span className="font-bold tracking-tight tabular-nums text-foreground">
                    {formatCurrency(alloc.totalAmount, currencyInfo)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 pt-2">
          <span className="text-xs text-muted-foreground">
            El historial contable quedará compensado.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 sm:flex-initial px-4 py-2.5 min-h-11 rounded-xl border border-border bg-card text-xs font-bold text-foreground hover:bg-muted cursor-pointer transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="flex-1 sm:flex-initial px-5 py-2.5 min-h-11 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {submitting ? 'Revirtiendo...' : 'Confirmar reversión'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
