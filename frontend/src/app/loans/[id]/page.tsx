'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  DeleteLoanResponse,
  LoanChargeColumnDto,
  LoanDto,
  LoanInstallmentDto,
} from '@sistema-contable/shared';
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CreditCard,
  Landmark,
  Pencil,
  RotateCcw,
  Trash2,
  Wallet,
} from 'lucide-react';
import { cn, formatCurrency } from '../../../lib/utils';
import { api } from '../../../services/api';
import type { AccountOption } from '../../../types/account';
import { KpiCard } from '../../../components/ui/KpiCard';
import PayLoanInstallmentModal from '../../../components/loans/PayLoanInstallmentModal';
import ReverseLoanPaymentModal from '../../../components/loans/ReverseLoanPaymentModal';
import DeleteLoanModal from '../../../components/loans/DeleteLoanModal';
import LoanToast, { LoanToastData } from '../../../components/loans/LoanToast';
import {
  formatLoanBadgeDate,
  formatLoanShortDate,
  getLoanInstallmentStatusMeta,
  getLoanStatusMeta,
} from '../../../components/loans/loan-ui';

type ScheduleFilter = 'PENDING' | 'PAID' | 'ALL';

function LoanDetailSkeleton() {
  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-4 w-36 rounded-lg bg-muted" />
        <div className="h-8 w-72 rounded-lg bg-muted" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[0, 1, 2, 3].map((idx) => (
          <div key={idx} className="h-28 rounded-xl bg-muted border border-border" />
        ))}
      </div>
      <div className="h-24 rounded-xl bg-muted border border-border" />
      <div className="h-80 rounded-xl bg-muted border border-border" />
    </div>
  );
}

export default function LoanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const loanId = String(params?.id || '');

  const [loan, setLoan] = useState<LoanDto | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>('ALL');

  const [payInstallment, setPayInstallment] = useState<LoanInstallmentDto | null>(null);
  const [reverseInstallment, setReverseInstallment] = useState<LoanInstallmentDto | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toast, setToast] = useState<LoanToastData | null>(null);

  const loadData = useCallback(async () => {
    if (!loanId) return;
    try {
      setError('');
      const [loanData, accountsRes] = await Promise.all([
        api.loans.get(loanId),
        api.accounts.summary(),
      ]);
      setLoan(loanData);
      setAccounts(Array.isArray(accountsRes) ? accountsRes : []);
      setScheduleFilter((prev) => {
        if (prev !== 'ALL') return prev;
        return loanData.status === 'ACTIVE' && loanData.pendingInstallmentsCount > 0
          ? 'PENDING'
          : 'ALL';
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el detalle del préstamo.');
    } finally {
      setLoading(false);
    }
  }, [loanId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loanCurrency = useMemo(
    () =>
      loan
        ? {
            code: loan.currencyCode,
            symbol: loan.currencySymbol,
            decimalPlaces: loan.decimalPlaces,
          }
        : { code: 'PYG', symbol: '₲', decimalPlaces: 0 },
    [loan],
  );

  const visibleColumns = useMemo<LoanChargeColumnDto[]>(() => {
    if (!loan) return [];
    return loan.chargeColumns.filter((col) => {
      if (col.isActive) return true;
      if (col.hasAllocations) return true;
      return loan.installments.some(
        (inst) =>
          Number(inst.charges?.[col.id] ?? 0) > 0 || Number(inst.paidCharges?.[col.id] ?? 0) > 0,
      );
    });
  }, [loan]);

  const pendingInstallments = useMemo(
    () => (loan ? loan.installments.filter((i) => i.status !== 'PAID') : []),
    [loan],
  );

  const paidInstallments = useMemo(
    () => (loan ? loan.installments.filter((i) => i.status === 'PAID') : []),
    [loan],
  );

  const visibleInstallments = useMemo(() => {
    if (!loan) return [];
    if (scheduleFilter === 'PENDING') return pendingInstallments;
    if (scheduleFilter === 'PAID') return paidInstallments;
    return loan.installments;
  }, [loan, scheduleFilter, pendingInstallments, paidInstallments]);

  const overdueCount = useMemo(
    () => pendingInstallments.filter((i) => i.isOverdue).length,
    [pendingInstallments],
  );

  const nextPayableInstallment = useMemo(() => {
    if (!loan || loan.status !== 'ACTIVE') return null;
    return pendingInstallments[0] || null;
  }, [loan, pendingInstallments]);

  const scheduleTotals = useMemo(() => {
    let principal = 0;
    let scheduledTotal = 0;
    let paidTotal = 0;
    let pendingTotal = 0;
    const chargesByCol: Record<string, number> = {};

    for (const col of visibleColumns) {
      chargesByCol[col.id] = 0;
    }

    for (const inst of visibleInstallments) {
      principal += Number(inst.principalAmount || 0);
      scheduledTotal += Number(inst.scheduledTotal || 0);
      paidTotal += Number(inst.paidTotal || 0);
      pendingTotal += Number(inst.pendingTotal || 0);
      for (const col of visibleColumns) {
        chargesByCol[col.id] = (chargesByCol[col.id] || 0) + Number(inst.charges?.[col.id] ?? 0);
      }
    }

    return {
      principal,
      chargesByCol,
      scheduledTotal,
      paidTotal,
      pendingTotal,
    };
  }, [visibleColumns, visibleInstallments]);

  const handlePaymentSuccess = async () => {
    await loadData();
    setToast({
      id: Date.now(),
      message: 'Pago de cuota registrado correctamente.',
    });
  };

  const handleReverseSuccess = async () => {
    await loadData();
    setToast({
      id: Date.now(),
      message: 'Pago revertido y saldos actualizados.',
    });
  };

  const handleDeleted = async (res: DeleteLoanResponse) => {
    if (res.action === 'DELETED') {
      router.push('/loans');
      return;
    }
    await loadData();
    setToast({
      id: Date.now(),
      message: 'Préstamo anulado y asiento inicial revertido.',
    });
  };

  if (loading) {
    return <LoanDetailSkeleton />;
  }

  if (error || !loan) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-4">
        <Link
          href="/loans"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a Préstamos
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

  const loanStatusMeta = getLoanStatusMeta(loan.status);
  const clampedPct = Math.min(100, Math.max(0, Number(loan.progressPercent || 0)));

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6">
      {/* Back navigation */}
      <div>
        <Link
          href="/loans"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a Préstamos
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="space-y-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground truncate">
              {loan.name}
            </h1>
            <span
              className={cn(
                'inline-flex items-center px-2.5 py-0.5 rounded-full text-3xs font-semibold border',
                loanStatusMeta.badgeClass,
              )}
            >
              {loanStatusMeta.label}
            </span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-3xs font-semibold bg-muted text-muted-foreground border border-border">
              {loan.currencyCode}
            </span>
            {loan.nextDueDate && loan.status === 'ACTIVE' && (
              <span
                className={cn(
                  'inline-flex items-center px-2.5 py-0.5 rounded-full text-3xs font-semibold border',
                  loan.isNextOverdue
                    ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60'
                    : 'bg-muted text-foreground border-border',
                )}
              >
                {loan.isNextOverdue
                  ? `Vencida · ${formatLoanBadgeDate(loan.nextDueDate)}`
                  : `Próx. vto. ${formatLoanBadgeDate(loan.nextDueDate)}`}
              </span>
            )}
          </div>

          <p className="text-sm text-muted-foreground tabular-nums">
            Apertura: {formatLoanShortDate(loan.openingDate)} ·{' '}
            {loan.annualRate > 0 ? `${loan.annualRate}% TNA` : 'Tasa base 0%'} · Plan de{' '}
            {loan.totalInstallmentsCount} cuotas
          </p>
        </div>

        {/* Actions */}
        {loan.status !== 'CANCELLED' && (
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 min-h-11 px-3.5 py-2 rounded-lg border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="w-4 h-4" />
              Eliminar / Anular
            </button>

            <Link
              href={`/loans/${loan.id}/edit`}
              className="inline-flex items-center justify-center gap-1.5 min-h-11 px-4 py-2 rounded-lg border border-border bg-card text-foreground hover:bg-muted text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pencil className="w-4 h-4" />
              Editar préstamo
            </Link>

            {nextPayableInstallment && (
              <button
                type="button"
                onClick={() => setPayInstallment(nextPayableInstallment)}
                className="inline-flex items-center justify-center gap-1.5 min-h-11 px-4 py-2 rounded-lg bg-brand-gradient text-white text-xs font-semibold shadow-brand-glow-sm hover:opacity-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {nextPayableInstallment.status === 'PARTIAL'
                  ? `Pagar resto cuota #${nextPayableInstallment.installmentNumber}`
                  : `Pagar cuota #${nextPayableInstallment.installmentNumber}`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          variant="hero"
          label="Capital Pendiente"
          value={formatCurrency(loan.pendingPrincipal, loanCurrency)}
          badge={
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-3xs font-semibold bg-white/15 text-white border border-white/20 shrink-0 tabular-nums">
              {clampedPct.toFixed(0)}% pagado
            </span>
          }
          footer={
            <div className="space-y-1.5 pt-1">
              <div className="w-full h-1.5 rounded-full bg-white/20 overflow-hidden">
                <div
                  className="h-full bg-emerald-400 rounded-full transition-all"
                  style={{ width: `${clampedPct}%` }}
                />
              </div>
              <span className="text-xs text-white/85 tabular-nums block">
                de {formatCurrency(loan.initialPrincipal, loanCurrency)} inicial
              </span>
            </div>
          }
        />

        <KpiCard
          variant="emerald"
          label="Total Ya Pagado"
          value={formatCurrency(loan.totalPaid, loanCurrency)}
          footer={
            <span className="text-xs text-muted-foreground tabular-nums">
              Capital {formatCurrency(loan.paidPrincipal, loanCurrency)} + Cargos{' '}
              {formatCurrency(loan.paidChargesTotal, loanCurrency)}
            </span>
          }
        />

        <KpiCard
          variant="default"
          label="Cuotas del Préstamo"
          value={`${loan.paidInstallmentsCount} / ${loan.totalInstallmentsCount}`}
          icon={<CreditCard className="w-4 h-4 text-muted-foreground" />}
          footer={
            <span className="text-xs text-muted-foreground tabular-nums">
              {loan.pendingInstallmentsCount} pendientes
              {overdueCount > 0 ? ` · ${overdueCount} vencidas` : ''}
            </span>
          }
        />

        <KpiCard
          variant={loan.isNextOverdue ? 'rose' : 'default'}
          label="Próximo Vencimiento"
          value={
            loan.nextDueDate
              ? formatLoanShortDate(loan.nextDueDate)
              : loan.status === 'SETTLED'
                ? 'Saldado'
                : 'Sin pendientes'
          }
          icon={<CalendarClock className="w-4 h-4 text-muted-foreground" />}
          footer={
            <span className="text-xs text-muted-foreground tabular-nums">
              {loan.nextInstallmentNumber
                ? `Cuota #${loan.nextInstallmentNumber} · ${formatCurrency(
                    loan.nextInstallmentPendingTotal,
                    loanCurrency,
                  )}`
                : 'No hay cuotas pendientes'}
            </span>
          }
        />
      </div>

      {/* Linked Accounting & Origin Info */}
      <div className="bg-card border border-border rounded-xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div className="flex items-start gap-2.5">
          <Landmark className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-muted-foreground uppercase tracking-wider text-3xs">
              Cuenta Pasivo Vinculada
            </div>
            <div className="text-sm font-semibold text-foreground mt-0.5">
              {loan.liabilityAccountName}
            </div>
            <div className="text-muted-foreground mt-0.5">Protegida por el módulo Préstamos</div>
          </div>
        </div>

        <div className="flex items-start gap-2.5">
          <Wallet className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-muted-foreground uppercase tracking-wider text-3xs">
              Cuenta Habitual de Pago
            </div>
            <div className="text-sm font-semibold text-foreground mt-0.5">
              {loan.defaultPaymentAccountName || 'Sin cuenta predeterminada'}
            </div>
            <div className="text-muted-foreground mt-0.5">Sugerida al registrar cada cuota</div>
          </div>
        </div>

        <div className="flex items-start gap-2.5">
          <CalendarClock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-muted-foreground uppercase tracking-wider text-3xs">
              Asiento de Apertura
            </div>
            <div className="text-sm font-semibold text-foreground mt-0.5">
              {loan.initialTransaction?.description || `Apertura · ${loan.name}`}
            </div>
            <div className="text-muted-foreground mt-0.5 tabular-nums">
              Fecha contable: {formatLoanShortDate(loan.openingDate)}
            </div>
          </div>
        </div>
      </div>

      {/* Installments Schedule Table */}
      <section className="bg-card border border-border rounded-xl overflow-hidden shadow-xs">
        <div className="p-4 sm:p-5 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold tracking-tight text-foreground">
              Tabla de Cuotas y Pagos
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Seguimiento completo de amortización de capital y rubros financieros asociados.
            </p>
          </div>

          <div className="inline-flex rounded-lg bg-muted p-1 border border-border self-start">
            {(
              [
                { id: 'PENDING', label: `Pendientes (${pendingInstallments.length})` },
                { id: 'PAID', label: `Pagadas (${paidInstallments.length})` },
                { id: 'ALL', label: `Todas (${loan.installments.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setScheduleFilter(tab.id)}
                className={cn(
                  'min-h-9 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  scheduleFilter === tab.id
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {visibleInstallments.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No hay cuotas para mostrar en este filtro.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                  <th className="py-3 px-4 text-left font-semibold">#</th>
                  <th className="py-3 px-3 text-left font-semibold">Vencimiento</th>
                  <th className="py-3 px-3 text-right font-semibold">Capital</th>
                  {visibleColumns.map((col) => (
                    <th
                      key={col.id}
                      className="py-3 px-3 text-right font-semibold whitespace-nowrap"
                    >
                      <span>{col.name}</span>
                      {!col.isActive && (
                        <span className="block text-4xs font-normal text-muted-foreground">
                          (archivada)
                        </span>
                      )}
                    </th>
                  ))}
                  <th className="py-3 px-3 text-right font-semibold">Total Cuota</th>
                  <th className="py-3 px-3 text-right font-semibold">Pagado</th>
                  <th className="py-3 px-3 text-right font-semibold">Pendiente</th>
                  <th className="py-3 px-3 text-left font-semibold">Estado</th>
                  <th className="py-3 px-4 text-right font-semibold">Acciones</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border/70">
                {visibleInstallments.map((inst) => {
                  const statusMeta = getLoanInstallmentStatusMeta(inst.status, inst.isOverdue);
                  const hasAllocations = Boolean(inst.allocations && inst.allocations.length > 0);
                  return (
                    <tr key={inst.id} className="hover:bg-muted/30">
                      <td className="py-3 px-4 font-semibold tabular-nums text-foreground">
                        #{inst.installmentNumber}
                      </td>
                      <td className="py-3 px-3 tabular-nums text-muted-foreground whitespace-nowrap">
                        {formatLoanShortDate(inst.dueDate)}
                      </td>
                      <td className="py-3 px-3 text-right font-bold tracking-tight tabular-nums text-foreground whitespace-nowrap">
                        <div>{formatCurrency(inst.principalAmount, loanCurrency)}</div>
                        {inst.paidPrincipal > 0 && inst.status !== 'PAID' && (
                          <div className="text-4xs font-normal text-emerald-700 dark:text-emerald-400">
                            Pagado: {formatCurrency(inst.paidPrincipal, loanCurrency)}
                          </div>
                        )}
                      </td>

                      {visibleColumns.map((col) => {
                        const scheduledCol = Number(inst.charges?.[col.id] ?? 0);
                        const paidCol = Number(inst.paidCharges?.[col.id] ?? 0);
                        return (
                          <td
                            key={col.id}
                            className="py-3 px-3 text-right tabular-nums text-muted-foreground whitespace-nowrap"
                          >
                            <div>{formatCurrency(scheduledCol, loanCurrency)}</div>
                            {paidCol > 0 && (
                              <div className="text-4xs text-emerald-700 dark:text-emerald-400">
                                Pagado: {formatCurrency(paidCol, loanCurrency)}
                              </div>
                            )}
                          </td>
                        );
                      })}

                      <td className="py-3 px-3 text-right font-bold tracking-tight tabular-nums text-foreground whitespace-nowrap">
                        {formatCurrency(inst.scheduledTotal, loanCurrency)}
                      </td>

                      <td className="py-3 px-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400 whitespace-nowrap font-semibold">
                        {formatCurrency(inst.paidTotal, loanCurrency)}
                      </td>

                      <td className="py-3 px-3 text-right font-bold tracking-tight tabular-nums text-foreground whitespace-nowrap">
                        {formatCurrency(inst.pendingTotal, loanCurrency)}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-3xs font-semibold border',
                            statusMeta.badgeClass,
                          )}
                        >
                          {statusMeta.label}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {loan.status !== 'CANCELLED' && (
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {inst.status !== 'PAID' && (
                              <button
                                type="button"
                                onClick={() => setPayInstallment(inst)}
                                className="inline-flex items-center justify-center min-h-9 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {inst.status === 'PARTIAL' ? 'Pagar resto' : 'Pagar'}
                              </button>
                            )}
                            {hasAllocations && (
                              <button
                                type="button"
                                onClick={() => setReverseInstallment(inst)}
                                className="inline-flex items-center justify-center gap-1 min-h-9 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Revertir
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              <tfoot>
                <tr className="border-t-2 border-border bg-muted/50 font-bold text-foreground">
                  <td colSpan={2} className="py-3 px-4 text-left">
                    Totales visibles ({visibleInstallments.length})
                  </td>
                  <td className="py-3 px-3 text-right font-bold tracking-tight tabular-nums whitespace-nowrap">
                    {formatCurrency(scheduleTotals.principal, loanCurrency)}
                  </td>
                  {visibleColumns.map((col) => (
                    <td
                      key={col.id}
                      className="py-3 px-3 text-right font-bold tracking-tight tabular-nums whitespace-nowrap"
                    >
                      {formatCurrency(scheduleTotals.chargesByCol[col.id] || 0, loanCurrency)}
                    </td>
                  ))}
                  <td className="py-3 px-3 text-right font-bold tracking-tight tabular-nums whitespace-nowrap">
                    {formatCurrency(scheduleTotals.scheduledTotal, loanCurrency)}
                  </td>
                  <td className="py-3 px-3 text-right font-bold tracking-tight tabular-nums text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                    {formatCurrency(scheduleTotals.paidTotal, loanCurrency)}
                  </td>
                  <td className="py-3 px-3 text-right font-bold tracking-tight tabular-nums whitespace-nowrap">
                    {formatCurrency(scheduleTotals.pendingTotal, loanCurrency)}
                  </td>
                  <td colSpan={2} className="py-3 px-4" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* Modals */}
      {payInstallment && (
        <PayLoanInstallmentModal
          isOpen={Boolean(payInstallment)}
          onClose={() => setPayInstallment(null)}
          loan={loan}
          installment={payInstallment}
          accounts={accounts}
          onSuccess={handlePaymentSuccess}
          onAccountsChanged={setAccounts}
        />
      )}

      {reverseInstallment && (
        <ReverseLoanPaymentModal
          isOpen={Boolean(reverseInstallment)}
          onClose={() => setReverseInstallment(null)}
          loan={loan}
          installment={reverseInstallment}
          onSuccess={handleReverseSuccess}
        />
      )}

      <DeleteLoanModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        loan={loan}
        onDeleted={handleDeleted}
      />

      <LoanToast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
