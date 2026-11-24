'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AccountType, LoanDto, LoanInstallmentDto } from '@sistema-contable/shared';
import { AlertCircle, Banknote, X } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
import { api } from '../../services/api';
import type { AccountOption } from '../../types/account';
import AccountPickerSheet from '../transactions/AccountPickerSheet';
import AccountModal from '../AccountModal';
import {
  formatAmountInput,
  getTodayLocalIso,
  normalizeAmountInput,
  parseNumericInput,
} from './loan-ui';

interface PayLoanInstallmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  loan: LoanDto;
  installment: LoanInstallmentDto;
  accounts: AccountOption[];
  onSuccess: (updated: LoanDto) => Promise<void> | void;
  onAccountsChanged?: (newAccounts: AccountOption[]) => void;
}

export default function PayLoanInstallmentModal({
  isOpen,
  onClose,
  loan,
  installment,
  accounts,
  onSuccess,
  onAccountsChanged,
}: PayLoanInstallmentModalProps) {
  const currencyInfo = useMemo(
    () => ({
      code: loan.currencyCode,
      symbol: loan.currencySymbol,
      decimalPlaces: loan.decimalPlaces,
    }),
    [loan.currencyCode, loan.currencySymbol, loan.decimalPlaces],
  );
  const decimals = loan.decimalPlaces ?? 0;

  const activeChargeColumns = useMemo(
    () => loan.chargeColumns.filter((c) => c.isActive),
    [loan.chargeColumns],
  );

  const defaultPaymentAccountId = useMemo(() => {
    const activeLiquid = accounts.filter(
      (a) => a.status !== 'INACTIVE' && a.isCashOrBank && !a.isControlAccount,
    );
    if (
      loan.defaultPaymentAccountId &&
      activeLiquid.some((a) => a.id === loan.defaultPaymentAccountId)
    ) {
      return loan.defaultPaymentAccountId;
    }
    return activeLiquid[0]?.id || '';
  }, [accounts, loan.defaultPaymentAccountId]);

  const [paymentAccountId, setPaymentAccountId] = useState(defaultPaymentAccountId);
  const [paidAt, setPaidAt] = useState(getTodayLocalIso());
  const [principalRaw, setPrincipalRaw] = useState(String(installment.pendingPrincipal || 0));
  const [chargesRaw, setChargesRaw] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [quickCreateOpen, setQuickCreateOpen] = useState<{
    initialName: string;
    initialType: AccountType;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPaymentAccountId(defaultPaymentAccountId);
    setPaidAt(getTodayLocalIso());
    setPrincipalRaw(installment.pendingPrincipal > 0 ? String(installment.pendingPrincipal) : '0');
    const nextCharges: Record<string, string> = {};
    for (const col of activeChargeColumns) {
      const pending = installment.pendingCharges[col.id] ?? 0;
      nextCharges[col.id] = pending > 0 ? String(pending) : '0';
    }
    setChargesRaw(nextCharges);
    setError('');
  }, [isOpen, installment, defaultPaymentAccountId, activeChargeColumns]);

  const principalAmount = parseNumericInput(principalRaw, decimals);
  const chargeAmounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const col of activeChargeColumns) {
      map[col.id] = parseNumericInput(chargesRaw[col.id] || '0', decimals);
    }
    return map;
  }, [activeChargeColumns, chargesRaw, decimals]);

  const totalToPay = useMemo(() => {
    const chargesSum = Object.values(chargeAmounts).reduce((sum, v) => sum + v, 0);
    return Number((principalAmount + chargesSum).toFixed(decimals));
  }, [principalAmount, chargeAmounts, decimals]);

  const selectedPaymentAccount = useMemo(
    () => accounts.find((a) => a.id === paymentAccountId),
    [accounts, paymentAccountId],
  );

  const submitPayment = useCallback(async () => {
    if (submitting) return;
    if (!paymentAccountId) {
      setError('Debe seleccionar una cuenta de pago.');
      return;
    }
    if (principalAmount > installment.pendingPrincipal + 0.0001) {
      setError(
        `El capital no puede superar el saldo pendiente (${formatCurrency(
          installment.pendingPrincipal,
          currencyInfo,
        )}). Para adelantos de capital usá "Editar préstamo".`,
      );
      return;
    }
    if (totalToPay <= 0) {
      setError('El total a pagar debe ser mayor a 0.');
      return;
    }

    try {
      setSubmitting(true);
      setError('');
      const updated = await api.loans.payInstallment(installment.id, {
        paymentAccountId,
        paidAt,
        allocatedPrincipal: principalAmount,
        allocatedCharges: chargeAmounts,
      });
      await onSuccess(updated);
      onClose();
    } catch (err: any) {
      setError(err.message || 'No se pudo registrar el pago de la cuota.');
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting,
    paymentAccountId,
    principalAmount,
    installment.id,
    installment.pendingPrincipal,
    currencyInfo,
    totalToPay,
    paidAt,
    chargeAmounts,
    onSuccess,
    onClose,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting && !quickCreateOpen) {
        onClose();
      }
      if (e.ctrlKey && e.key === 'Enter' && !submitting && !quickCreateOpen) {
        e.preventDefault();
        void submitPayment();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, submitting, quickCreateOpen, onClose, submitPayment]);

  if (!isOpen) return null;

  const gridColsClass =
    activeChargeColumns.length === 0
      ? 'grid-cols-1'
      : activeChargeColumns.length === 1
        ? 'grid-cols-1 sm:grid-cols-2'
        : 'grid-cols-1 sm:grid-cols-3';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pay-loan-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-xl max-h-dvh overflow-y-auto p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-secondary text-accent-foreground flex items-center justify-center shrink-0">
              <Banknote className="w-5 h-5" />
            </div>
            <div>
              <h2 id="pay-loan-modal-title" className="text-base font-bold text-foreground">
                Pagar cuota #{installment.installmentNumber}
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

        <div className="p-3.5 rounded-2xl bg-card-tint border border-border flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-muted-foreground">
            Saldo previsto pendiente de la cuota
          </span>
          <span className="text-sm font-bold tracking-tight tabular-nums text-foreground">
            {formatCurrency(installment.pendingTotal, currencyInfo)}
          </span>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitPayment();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <AccountPickerSheet
                label="Cuenta de pago"
                accounts={accounts}
                selectedAccountId={paymentAccountId}
                onSelect={(acc) => setPaymentAccountId(acc.id)}
                filterMode="CASH_BANK"
                baseCurrency={currencyInfo}
                placeholder="Seleccionar cuenta líquida..."
                onQuickCreateAccount={(initialName, suggestedType) =>
                  setQuickCreateOpen({
                    initialName,
                    initialType: suggestedType || AccountType.ASSET,
                  })
                }
              />
            </div>

            <div>
              <label
                className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1"
                htmlFor="pay-loan-date"
              >
                Fecha de pago
              </label>
              <input
                id="pay-loan-date"
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                required
                className="w-full min-h-11 px-3.5 py-2.5 rounded-xl border border-input bg-card text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          <div className={cn('grid gap-3', gridColsClass)}>
            <div>
              <label
                className="block text-xs font-bold text-foreground mb-1"
                htmlFor="pay-loan-principal"
              >
                Capital ({loan.currencySymbol})
              </label>
              <input
                id="pay-loan-principal"
                type="text"
                inputMode={decimals === 0 ? 'numeric' : 'decimal'}
                value={formatAmountInput(principalRaw, decimals)}
                onChange={(e) => setPrincipalRaw(normalizeAmountInput(e.target.value, decimals))}
                className="w-full min-h-11 px-3 py-2 rounded-xl border border-input bg-card text-sm text-right font-bold tracking-tight tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {activeChargeColumns.map((col) => (
              <div key={col.id}>
                <label
                  className="block text-xs font-bold text-foreground mb-1 truncate"
                  htmlFor={`pay-loan-charge-${col.id}`}
                >
                  {col.name} ({loan.currencySymbol})
                </label>
                <input
                  id={`pay-loan-charge-${col.id}`}
                  type="text"
                  inputMode={decimals === 0 ? 'numeric' : 'decimal'}
                  value={formatAmountInput(chargesRaw[col.id] ?? '0', decimals)}
                  onChange={(e) =>
                    setChargesRaw((prev) => ({
                      ...prev,
                      [col.id]: normalizeAmountInput(e.target.value, decimals),
                    }))
                  }
                  className="w-full min-h-11 px-3 py-2 rounded-xl border border-input bg-card text-sm text-right font-bold tracking-tight tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 pt-3 border-t border-border text-xs text-muted-foreground">
            <span className="truncate">
              Se debitará de {selectedPaymentAccount?.name || 'cuenta seleccionada'} (
              {loan.currencySymbol})
            </span>
            <span className="text-base font-bold tracking-tight tabular-nums text-foreground shrink-0">
              {formatCurrency(totalToPay, currencyInfo)}
            </span>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <span className="text-xs text-muted-foreground">Ctrl+Enter para confirmar</span>
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
                type="submit"
                disabled={submitting}
                className="flex-1 sm:flex-initial px-5 py-2.5 min-h-11 rounded-xl bg-brand-gradient text-white text-xs font-bold shadow-brand-glow-sm hover:opacity-95 disabled:opacity-50 cursor-pointer transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {submitting ? 'Registrando...' : 'Confirmar pago'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {quickCreateOpen && (
        <AccountModal
          onClose={() => setQuickCreateOpen(null)}
          initialName={quickCreateOpen.initialName}
          initialType={quickCreateOpen.initialType}
          initialIsCashOrBank={true}
          parentCandidates={accounts}
          onSuccess={async (created) => {
            try {
              const summaryRes = await api.accounts.summary();
              const fresh = summaryRes?.accounts || accounts;
              onAccountsChanged?.(fresh);
            } catch {
              // ignore refresh error
            }
            if (created?.id) {
              setPaymentAccountId(created.id);
            }
            setQuickCreateOpen(null);
          }}
        />
      )}
    </div>
  );
}
