'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CommitmentDto, CommitmentInstallmentDto } from '@sistema-contable/shared';
import { X, Banknote, ArrowRight, AlertCircle } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { api } from '../../services/api';
import {
  formatAmountInput,
  getTodayLocalIso,
  normalizeAmountInput,
  parseNumericInput,
} from './commitment-ui';
import type { AccountOption } from '../../types/account';

interface SettleInstallmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  commitment: CommitmentDto;
  installment: CommitmentInstallmentDto;
  cashAccounts: AccountOption[];
  baseCurrency?: any;
  onSuccess: (updated: CommitmentDto) => Promise<void> | void;
}

export default function SettleInstallmentModal({
  isOpen,
  onClose,
  commitment,
  installment,
  cashAccounts,
  baseCurrency,
  onSuccess,
}: SettleInstallmentModalProps) {
  const decimals = baseCurrency?.decimalPlaces ?? 0;
  const activeCash = useMemo(
    () => cashAccounts.filter((a) => a.type === 'ASSET' && a.isCashOrBank && a.status === 'ACTIVE'),
    [cashAccounts],
  );

  const defaultCashId =
    commitment.cashAccountId && activeCash.some((a) => a.id === commitment.cashAccountId)
      ? commitment.cashAccountId
      : activeCash[0]?.id || '';

  const [amountInput, setAmountInput] = useState(String(installment.pendingAmount));
  const [cashAccountId, setCashAccountId] = useState(defaultCashId);
  const [settledAt, setSettledAt] = useState(getTodayLocalIso());
  const [leaveNoDateRemainder, setLeaveNoDateRemainder] = useState(installment.dueDate === null);
  const [remainderDueDate, setRemainderDueDate] = useState(installment.dueDate || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setAmountInput(String(installment.pendingAmount));
    setCashAccountId(defaultCashId);
    setSettledAt(getTodayLocalIso());
    setLeaveNoDateRemainder(installment.dueDate === null);
    setRemainderDueDate(installment.dueDate || '');
    setError('');
  }, [isOpen, installment.id, installment.pendingAmount, installment.dueDate, defaultCashId]);

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

  const numericAmount = parseNumericInput(amountInput, decimals);
  const isPartial = numericAmount > 0 && numericAmount < installment.pendingAmount - 0.0001;
  const remainder = Math.max(
    0,
    Number((installment.pendingAmount - numericAmount).toFixed(decimals)),
  );
  const selectedCash = activeCash.find((a) => a.id === cashAccountId);

  const actionVerb = commitment.direction === 'INFLOW' ? 'Cobro' : 'Pago';
  const controlName =
    commitment.direction === 'INFLOW' ? 'Cuentas por Cobrar' : 'Cuentas por Pagar';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cashAccountId) {
      setError('Selecciona una cuenta de Caja o Banco.');
      return;
    }
    if (numericAmount <= 0 || numericAmount > installment.pendingAmount + 0.0001) {
      setError('Ingresa un monto mayor a 0 y no superior al saldo pendiente.');
      return;
    }

    try {
      setSubmitting(true);
      setError('');
      const updated = await api.commitments.settleInstallment(installment.id, {
        cashAccountId,
        amount: numericAmount,
        settledAt,
        newDueDateForRemainder: isPartial
          ? leaveNoDateRemainder
            ? null
            : remainderDueDate || installment.dueDate || null
          : undefined,
      });
      await onSuccess(updated);
      onClose();
    } catch (err: any) {
      setError(err.message || `No se pudo registrar el ${actionVerb.toLowerCase()}.`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settle-modal-title"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-lg max-h-dvh overflow-y-auto">
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div
              className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center ${
                commitment.direction === 'INFLOW'
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
                  : 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400'
              }`}
            >
              <Banknote className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2
                id="settle-modal-title"
                className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate"
              >
                Registrar {actionVerb} — Cuota {installment.installmentNumber}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {commitment.contactName} · {commitment.description}
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

          {/* Pending banner */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              Saldo pendiente de la cuota
            </span>
            <button
              type="button"
              onClick={() => setAmountInput(String(installment.pendingAmount))}
              className="text-sm font-bold tracking-tight text-indigo-600 dark:text-indigo-400 tabular-nums hover:underline cursor-pointer"
            >
              {formatCurrency(installment.pendingAmount, baseCurrency)}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Cuenta líquida (Caja / Banco)
              </label>
              <select
                value={cashAccountId}
                onChange={(e) => setCashAccountId(e.target.value)}
                className="w-full px-3.5 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {activeCash.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Fecha de {actionVerb.toLowerCase()}
              </label>
              <input
                type="date"
                value={settledAt}
                onChange={(e) => setSettledAt(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Monto a {commitment.direction === 'INFLOW' ? 'cobrar' : 'pagar'}
              </label>
              <button
                type="button"
                onClick={() => setAmountInput(String(installment.pendingAmount))}
                className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
              >
                Usar total pendiente
              </button>
            </div>
            <input
              type="text"
              inputMode={decimals === 0 ? 'numeric' : 'decimal'}
              value={formatAmountInput(amountInput, decimals)}
              onChange={(e) => setAmountInput(normalizeAmountInput(e.target.value, decimals))}
              className="w-full px-3.5 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-right text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
          </div>

          {isPartial && (
            <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-amber-800 dark:text-amber-200">
                  Entrega parcial — Saldo restante:
                </span>
                <span className="font-bold tracking-tight text-amber-900 dark:text-amber-100 tabular-nums">
                  {formatCurrency(remainder, baseCurrency)}
                </span>
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-amber-900 dark:text-amber-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={leaveNoDateRemainder}
                  onChange={(e) => setLeaveNoDateRemainder(e.target.checked)}
                  className="rounded border-amber-400"
                />
                <span>Dejar saldo restante sin fecha definida (Abierto)</span>
              </label>
              {!leaveNoDateRemainder && (
                <div>
                  <label className="block text-xs font-semibold text-amber-800 dark:text-amber-300 mb-1">
                    Fecha esperada para el saldo restante
                  </label>
                  <input
                    type="date"
                    value={remainderDueDate}
                    onChange={(e) => setRemainderDueDate(e.target.value)}
                    className="w-full px-3 py-2 min-h-11 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
              )}
            </div>
          )}

          {/* Accounting preview */}
          <div className="p-3.5 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200/70 dark:border-indigo-900/50 space-y-1.5 text-xs">
            <div className="font-bold text-indigo-800 dark:text-indigo-300">
              Transacción automática a registrar
            </div>
            <div className="flex items-center justify-between text-slate-700 dark:text-slate-300">
              <span>
                <span className="font-semibold">DEBE:</span>{' '}
                {commitment.direction === 'INFLOW'
                  ? selectedCash?.name || 'Caja/Banco'
                  : controlName}
              </span>
              <span className="font-bold tabular-nums">
                {formatCurrency(numericAmount, baseCurrency)}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-1">
                <ArrowRight className="w-3 h-3 text-slate-400" />
                <span className="font-semibold">HABER:</span>{' '}
                {commitment.direction === 'INFLOW'
                  ? controlName
                  : selectedCash?.name || 'Caja/Banco'}
              </span>
              <span className="font-bold tabular-nums">
                {formatCurrency(numericAmount, baseCurrency)}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 min-h-11 rounded-xl bg-brand-gradient text-white text-xs font-bold shadow-brand-glow-sm hover:opacity-95 disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Registrando...' : `Confirmar ${actionVerb}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
