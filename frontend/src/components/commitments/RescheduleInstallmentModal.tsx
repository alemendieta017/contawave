'use client';

import React, { useState } from 'react';
import { CommitmentDto, CommitmentInstallmentDto } from '@sistema-contable/shared';
import { X, Calendar, CalendarOff, AlertCircle } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { api } from '../../services/api';
import { getTodayLocalIso } from './commitment-ui';

interface RescheduleInstallmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  commitment: CommitmentDto;
  installment: CommitmentInstallmentDto;
  baseCurrency?: any;
  onSuccess: (updated: CommitmentDto) => Promise<void> | void;
}

export default function RescheduleInstallmentModal({
  isOpen,
  onClose,
  commitment,
  installment,
  baseCurrency,
  onSuccess,
}: RescheduleInstallmentModalProps) {
  const [noDate, setNoDate] = useState(installment.dueDate === null);
  const [dueDate, setDueDate] = useState(installment.dueDate || getTodayLocalIso());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noDate && !dueDate) {
      setError('Selecciona una fecha o elige "Sin fecha definida".');
      return;
    }
    try {
      setSubmitting(true);
      setError('');
      const updated = await api.commitments.rescheduleInstallment(installment.id, {
        dueDate: noDate ? null : dueDate,
      });
      await onSuccess(updated);
      onClose();
    } catch (err: any) {
      setError(err.message || 'No se pudo actualizar la fecha.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-modal-title"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md max-h-dvh overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="reschedule-modal-title"
                className="text-base font-bold text-slate-900 dark:text-slate-100"
              >
                Reprogramar Cuota {installment.installmentNumber}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {commitment.contactName} ·{' '}
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
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setNoDate(false)}
              className={`p-3 min-h-11 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition ${
                !noDate
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>Fecha específica</span>
            </button>
            <button
              type="button"
              onClick={() => setNoDate(true)}
              className={`p-3 min-h-11 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition ${
                noDate
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              <CalendarOff className="w-4 h-4" />
              <span>Sin fecha definida</span>
            </button>
          </div>

          {!noDate ? (
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Nueva fecha de vencimiento
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>
          ) : (
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
              Las cuotas sin fecha no generan alertas de vencimiento ni se proyectan en Caja
              Proyectada hasta asignarles una fecha. Siguen visibles en Balance General.
            </div>
          )}

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
              className="px-5 py-2.5 min-h-11 rounded-xl bg-brand-gradient text-white text-xs font-bold shadow-brand-glow-sm hover:opacity-95 disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Guardando...' : 'Guardar fecha'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
