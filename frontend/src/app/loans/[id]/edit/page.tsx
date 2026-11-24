'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LoanDto } from '@sistema-contable/shared';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { api } from '../../../../services/api';
import type { AccountOption } from '../../../../types/account';
import LoanPlanForm, { type CurrencyItem } from '../../../../components/loans/LoanPlanForm';

function EditLoanSkeleton() {
  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-4 w-36 rounded-lg bg-muted" />
        <div className="h-8 w-72 rounded-lg bg-muted" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 h-96 rounded-xl bg-muted border border-border" />
        <div className="lg:col-span-7 h-96 rounded-xl bg-muted border border-border" />
      </div>
    </div>
  );
}

export default function EditLoanPage() {
  const params = useParams();
  const loanId = String(params?.id || '');

  const [loan, setLoan] = useState<LoanDto | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    if (!loanId) return;
    try {
      setLoading(true);
      setError('');
      const [loanData, accountsRes, currenciesRes] = await Promise.all([
        api.loans.get(loanId),
        api.accounts.summary(),
        api.currencies.list(),
      ]);
      setLoan(loanData);
      setAccounts(Array.isArray(accountsRes) ? accountsRes : []);
      setCurrencies(Array.isArray(currenciesRes) ? currenciesRes : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el préstamo para edición.');
    } finally {
      setLoading(false);
    }
  }, [loanId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (loading) {
    return <EditLoanSkeleton />;
  }

  if (error || !loan) {
    return (
      <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-4">
        <Link
          href={loanId ? `/loans/${loanId}` : '/loans'}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al préstamo
        </Link>
        <div
          role="alert"
          className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-5 flex items-start justify-between gap-3 text-sm text-rose-700 dark:text-rose-300"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error || 'Préstamo no encontrado.'}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            className="text-xs font-semibold underline shrink-0 cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (loan.status === 'CANCELLED') {
    return (
      <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-4">
        <Link
          href={`/loans/${loan.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al detalle del préstamo
        </Link>
        <div className="rounded-xl border border-border bg-card p-6 space-y-2">
          <h1 className="text-lg font-bold tracking-tight text-foreground">Préstamo anulado</h1>
          <p className="text-sm text-muted-foreground">
            No se puede editar el plan de cuotas de un préstamo anulado.
          </p>
        </div>
      </div>
    );
  }

  return (
    <LoanPlanForm
      mode="edit"
      initialLoan={loan}
      accounts={accounts}
      currencies={currencies}
      onAccountsChanged={setAccounts}
    />
  );
}
