'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CommitmentDto, CommitmentInstallmentDto } from '@sistema-contable/shared';
import { X, ShieldAlert, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { api } from '../../services/api';
import { getTodayLocalIso } from './commitment-ui';
import type { AccountOption } from '../../types/account';

interface ForgiveInstallmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  commitment: CommitmentDto;
  installment: CommitmentInstallmentDto;
  accounts: AccountOption[];
  baseCurrency?: any;
  onSuccess: (updated: CommitmentDto) => Promise<void> | void;
}

export default function ForgiveInstallmentModal({
  isOpen,
  onClose,
  commitment,
  installment,
  accounts,
  baseCurrency,
  onSuccess,
}: ForgiveInstallmentModalProps) {
  const adjustmentOptions = useMemo(
    () =>
      accounts.filter((a) => {
        if (a.status !== 'ACTIVE') return false;
        return commitment.direction === 'INFLOW'
          ? a.type === 'EXPENSE'
          : a.type === 'INCOME' || a.type === 'EQUITY';
      }),
    [accounts, commitment.direction],
  );

  const defaultAdj =
    adjustmentOptions.find((a) => a.name.toLowerCase().includes('intereses')) ||
    adjustmentOptions.find((a) => a.systemRole === 'CAPITAL') ||
    adjustmentOptions[0];
  const defaultAdjId = defaultAdj?.id || '';

  const [adjustmentAccountId, setAdjustmentAccountId] = useState(defaultAdjId);
  const [forgivenAt, setForgivenAt] = useState(getTodayLocalIso());
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setAdjustmentAccountId(defaultAdjId);
    setForgivenAt(getTodayLocalIso());
    setNotes('');
    setError('');
  }, [isOpen, installment.id, defaultAdjId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (installment.pendingAmount <= 0) {
      setError('Esta cuota no tiene saldo pendiente por condonar.');
      return;
    }

    try {
      setSubmitting(true);
      setError('');
      const updated = await api.commitments.forgiveInstallment(installment.id, {
        settledAt: forgivenAt,
        expenseAccountId: adjustmentAccountId || null,
        reason: notes.trim() || undefined,
      });
      await onSuccess(updated);
      onClose();
    } catch (err: any) {
      setError(err.message || 'No se pudo condonar el saldo.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="forgive-modal-title"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md max-h-dvh overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="forgive-modal-title"
                className="text-base font-bold text-slate-900 dark:text-slate-100"
              >
                Condonar / Dar por incobrable
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Cuota {installment.installmentNumber} ·{' '}
                <span className="tabular-nums">
                  {formatCurrency(installment.pendingAmount, baseCurrency)}
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 min-h-11 min-w-11 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Esta acción salda la cuota <strong>sin mover tu Caja ni tu Banco</strong>. Genera un
              asiento de ajuste contable en el Libro Diario.
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Monto a condonar (saldo pendiente)
              </label>
              <div className="w-full px-3.5 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-end text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {formatCurrency(installment.pendingAmount, baseCurrency)}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Fecha de ajuste
              </label>
              <input
                type="date"
                value={forgivenAt}
                onChange={(e) => setForgivenAt(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
          </div>

          {adjustmentOptions.length > 0 && (
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Cuenta de contrapartida contable
              </label>
              <select
                value={adjustmentAccountId}
                onChange={(e) => setAdjustmentAccountId(e.target.value)}
                className="w-full px-3.5 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                {adjustmentOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
              Motivo (opcional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. Acuerdo de quita / incobrable"
              className="w-full px-3.5 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 min-h-11 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Procesando...' : 'Condonar saldo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
