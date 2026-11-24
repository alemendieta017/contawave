'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { LoanDto, LoanInstallmentDto, LoansKpiSummary, LoanStatus } from '@sistema-contable/shared';
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Landmark,
  Layers,
  ListChecks,
  Plus,
  Search,
  Wallet,
} from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
import { api } from '../../services/api';
import type { AccountOption } from '../../types/account';
import { KpiCard } from '../../components/ui/KpiCard';
import type { CurrencyItem } from '../../components/loans/LoanPlanForm';
import PayLoanInstallmentModal from '../../components/loans/PayLoanInstallmentModal';
import LoanToast, { LoanToastData } from '../../components/loans/LoanToast';
import {
  formatLoanBadgeDate,
  formatLoanShortDate,
  getLoanInstallmentStatusMeta,
  getLoanStatusMeta,
} from '../../components/loans/loan-ui';

type StatusFilter = 'ALL' | 'ACTIVE' | 'SETTLED' | 'CANCELLED';
type PortfolioViewMode = 'BY_LOAN' | 'AGENDA';

interface AgendaRow {
  loan: LoanDto;
  installment: LoanInstallmentDto;
  pendingChargesTotal: number;
}

const DEFAULT_KPIS: LoansKpiSummary = {
  totalPendingPrincipalBase: 0,
  monthlyLoadBase: 0,
  activeLoansCount: 0,
  settledLoansCount: 0,
  pendingInstallmentsCount: 0,
  paidInstallmentsCount: 0,
  nextInstallment: null,
};

function LoanSkeleton() {
  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6 animate-pulse">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-56 rounded-lg bg-muted" />
          <div className="h-4 w-80 max-w-full rounded-lg bg-muted" />
        </div>
        <div className="h-11 w-40 rounded-lg bg-muted" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[0, 1, 2, 3].map((idx) => (
          <div key={idx} className="h-28 rounded-xl bg-muted border border-border" />
        ))}
      </div>
      <div className="h-14 rounded-xl bg-muted border border-border" />
      <div className="space-y-4">
        <div className="h-44 rounded-xl bg-muted border border-border" />
        <div className="h-44 rounded-xl bg-muted border border-border" />
      </div>
    </div>
  );
}

function findNextPayableInstallment(loan: LoanDto): LoanInstallmentDto | null {
  if (loan.status === 'CANCELLED') return null;
  return (
    loan.installments.find((inst) => inst.status !== 'PAID' && inst.pendingTotal > 0) ||
    loan.installments.find((inst) => inst.status !== 'PAID') ||
    null
  );
}

export default function LoansPage() {
  const [loans, setLoans] = useState<LoanDto[]>([]);
  const [kpis, setKpis] = useState<LoansKpiSummary>(DEFAULT_KPIS);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<PortfolioViewMode>('BY_LOAN');
  const [expandedLoanIds, setExpandedLoanIds] = useState<Record<string, boolean>>({});

  const [payTarget, setPayTarget] = useState<{
    loan: LoanDto;
    installment: LoanInstallmentDto;
  } | null>(null);
  const [toast, setToast] = useState<LoanToastData | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError('');
      const [loansRes, accountsRes, currenciesRes] = await Promise.all([
        api.loans.list(),
        api.accounts.summary(),
        api.currencies.list(),
      ]);
      const loadedLoans = Array.isArray(loansRes?.loans) ? loansRes.loans : [];
      setLoans(loadedLoans);
      setKpis(loansRes?.kpis || DEFAULT_KPIS);
      setAccounts(Array.isArray(accountsRes) ? accountsRes : []);
      setCurrencies(Array.isArray(currenciesRes) ? currenciesRes : []);

      // Expand the first active loan by default on initial load
      setExpandedLoanIds((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        const firstActive = loadedLoans.find((l) => l.status === 'ACTIVE') || loadedLoans[0];
        return firstActive ? { [firstActive.id]: true } : {};
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los préstamos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const baseCurrency = useMemo(() => {
    const found = currencies.find((c) => c.isBase) || currencies[0];
    return found
      ? { code: found.code, symbol: found.symbol, decimalPlaces: found.decimalPlaces }
      : { code: 'PYG', symbol: '₲', decimalPlaces: 0 };
  }, [currencies]);

  const statusCounts = useMemo(() => {
    const counts: Record<LoanStatus | 'ALL', number> = {
      ALL: loans.length,
      ACTIVE: 0,
      SETTLED: 0,
      CANCELLED: 0,
    };
    for (const loan of loans) {
      counts[loan.status] = (counts[loan.status] || 0) + 1;
    }
    return counts;
  }, [loans]);

  const filteredLoans = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return loans.filter((loan) => {
      if (statusFilter !== 'ALL' && loan.status !== statusFilter) {
        return false;
      }
      if (!query) return true;
      return (
        loan.name.toLowerCase().includes(query) ||
        loan.liabilityAccountName.toLowerCase().includes(query) ||
        (loan.defaultPaymentAccountName || '').toLowerCase().includes(query) ||
        loan.currencyCode.toLowerCase().includes(query)
      );
    });
  }, [loans, statusFilter, searchQuery]);

  const agendaRows = useMemo<AgendaRow[]>(() => {
    const rows: AgendaRow[] = [];
    for (const loan of filteredLoans) {
      if (loan.status === 'CANCELLED') continue;
      for (const installment of loan.installments) {
        if (installment.status === 'PAID') continue;
        const pendingChargesTotal = Object.values(installment.pendingCharges || {}).reduce(
          (sum, val) => sum + Number(val || 0),
          0,
        );
        rows.push({
          loan,
          installment,
          pendingChargesTotal,
        });
      }
    }
    rows.sort((a, b) => {
      const cmp = a.installment.dueDate.localeCompare(b.installment.dueDate);
      if (cmp !== 0) return cmp;
      return a.installment.installmentNumber - b.installment.installmentNumber;
    });
    return rows;
  }, [filteredLoans]);

  const toggleExpand = (loanId: string) => {
    setExpandedLoanIds((prev) => ({ ...prev, [loanId]: !prev[loanId] }));
  };

  const handlePaymentSuccess = async (updatedLoan: LoanDto) => {
    await loadData();
    setToast({
      id: Date.now(),
      message: `Pago registrado en ${updatedLoan.name}.`,
    });
  };

  if (loading) {
    return <LoanSkeleton />;
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Cartera de Préstamos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Seguimiento de tus préstamos vigentes, próximas cuotas y amortizaciones de capital.
          </p>
        </div>

        <Link
          href="/loans/new"
          className={cn(
            'inline-flex items-center justify-center gap-2 min-h-11 px-5 py-2.5 rounded-lg',
            'bg-brand-gradient text-white text-sm font-semibold shadow-brand-glow-sm',
            'hover:opacity-95 transition-opacity shrink-0',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <Plus className="w-4 h-4" />
          Nuevo Préstamo
        </Link>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 flex items-start justify-between gap-3 text-sm text-rose-700 dark:text-rose-300"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            className="text-xs font-semibold underline shrink-0 cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          variant="hero"
          label="Capital Pendiente"
          value={formatCurrency(kpis.totalPendingPrincipalBase, baseCurrency)}
          icon={<Landmark className="w-4 h-4 text-white/80" />}
          footer={
            <span className="text-xs text-white/85 tabular-nums">
              {kpis.activeLoansCount}{' '}
              {kpis.activeLoansCount === 1 ? 'préstamo activo' : 'préstamos activos'}
              {kpis.settledLoansCount > 0 ? ` · ${kpis.settledLoansCount} saldado(s)` : ''}
            </span>
          }
        />

        <KpiCard
          variant={kpis.nextInstallment?.isOverdue ? 'rose' : 'default'}
          label="Próxima Cuota"
          value={
            kpis.nextInstallment
              ? formatCurrency(kpis.nextInstallment.pendingTotal, {
                  code: kpis.nextInstallment.currencyCode,
                  symbol: kpis.nextInstallment.currencySymbol,
                  decimalPlaces: kpis.nextInstallment.decimalPlaces,
                })
              : 'Sin vencimientos'
          }
          badge={
            kpis.nextInstallment ? (
              <span
                className={cn(
                  'inline-flex items-center px-2 py-0.5 rounded-full text-3xs font-semibold border shrink-0',
                  kpis.nextInstallment.isOverdue
                    ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60'
                    : 'bg-muted text-foreground border-border',
                )}
              >
                {kpis.nextInstallment.isOverdue
                  ? `Vencida · ${formatLoanBadgeDate(kpis.nextInstallment.dueDate)}`
                  : formatLoanBadgeDate(kpis.nextInstallment.dueDate)}
              </span>
            ) : undefined
          }
          footer={
            kpis.nextInstallment ? (
              <Link
                href={`/loans/${kpis.nextInstallment.loanId}`}
                className="text-xs text-muted-foreground hover:text-foreground truncate block transition-colors"
              >
                {kpis.nextInstallment.loanName} · Cuota #{kpis.nextInstallment.installmentNumber}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">Todo al día</span>
            )
          }
        />

        <KpiCard
          variant="default"
          label="Carga Mensual"
          value={formatCurrency(kpis.monthlyLoadBase, baseCurrency)}
          icon={<CalendarClock className="w-4 h-4 text-muted-foreground" />}
          footer={
            <span className="text-xs text-muted-foreground">Cuotas con vencimiento a 30 días</span>
          }
        />

        <KpiCard
          variant={kpis.activeLoansCount > 0 ? 'emerald' : 'default'}
          label="Créditos Activos"
          value={kpis.activeLoansCount}
          icon={<CreditCard className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
          footer={
            <span className="text-xs text-muted-foreground tabular-nums">
              {kpis.pendingInstallmentsCount} cuotas pendientes · {kpis.paidInstallmentsCount}{' '}
              pagadas
            </span>
          }
        />
      </div>

      {/* Empty State or Filter + Content */}
      {loans.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 sm:p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-muted border border-border flex items-center justify-center mx-auto text-muted-foreground">
            <Landmark className="w-6 h-6" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h2 className="text-lg font-bold tracking-tight text-foreground">
              Todavía no tenés préstamos cargados
            </h2>
            <p className="text-sm text-muted-foreground">
              Registrá un préstamo nuevo o en curso, definí tus columnas de interés y cargos
              bancarios y seguí tu capital pendiente cuota por cuota.
            </p>
          </div>
          <Link
            href="/loans/new"
            className={cn(
              'inline-flex items-center justify-center gap-2 min-h-11 px-5 py-2.5 rounded-lg',
              'bg-brand-gradient text-white text-sm font-semibold shadow-brand-glow-sm',
              'hover:opacity-95 transition-opacity',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <Plus className="w-4 h-4" />
            Nuevo Préstamo
          </Link>
        </div>
      ) : (
        <>
          {/* Filter Toolbar */}
          <div className="bg-card border border-border rounded-xl p-3 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Status tabs */}
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'ALL', label: `Todos (${statusCounts.ALL})` },
                  { id: 'ACTIVE', label: `Activos (${statusCounts.ACTIVE})` },
                  { id: 'SETTLED', label: `Saldados (${statusCounts.SETTLED})` },
                  ...(statusCounts.CANCELLED > 0
                    ? [{ id: 'CANCELLED' as const, label: `Anulados (${statusCounts.CANCELLED})` }]
                    : []),
                ] as const
              ).map((tab) => {
                const active = statusFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    className={cn(
                      'min-h-11 sm:min-h-9 px-3.5 py-2 sm:py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted',
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Search + View Toggle */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar préstamo o cuenta..."
                  aria-label="Buscar préstamo"
                  className="w-full min-h-11 sm:min-h-9 pl-9 pr-3 py-2 sm:py-1.5 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div className="inline-flex rounded-lg bg-muted p-1 border border-border shrink-0">
                <button
                  type="button"
                  onClick={() => setViewMode('BY_LOAN')}
                  className={cn(
                    'flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-9 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    viewMode === 'BY_LOAN'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Por Préstamo
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('AGENDA')}
                  className={cn(
                    'flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-9 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    viewMode === 'AGENDA'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <ListChecks className="w-3.5 h-3.5" />
                  Agenda de Cuotas
                </button>
              </div>
            </div>
          </div>

          {filteredLoans.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center space-y-3">
              <p className="text-sm font-semibold text-foreground">
                No hay préstamos que coincidan con el filtro aplicado.
              </p>
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('ALL');
                  setSearchQuery('');
                }}
                className="inline-flex items-center justify-center min-h-11 px-4 py-2 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted cursor-pointer"
              >
                Limpiar filtros
              </button>
            </div>
          ) : viewMode === 'BY_LOAN' ? (
            <div className="space-y-4">
              {filteredLoans.map((loan) => {
                const loanCurrency = {
                  code: loan.currencyCode,
                  symbol: loan.currencySymbol,
                  decimalPlaces: loan.decimalPlaces,
                };
                const statusMeta = getLoanStatusMeta(loan.status);
                const nextInst = findNextPayableInstallment(loan);
                const activeCols = loan.chargeColumns.filter((c) => c.isActive);
                const upcomingInstallments = loan.installments
                  .filter((inst) => inst.status !== 'PAID')
                  .slice(0, 3);
                const isExpanded = Boolean(expandedLoanIds[loan.id]);
                const clampedPct = Math.min(100, Math.max(0, Number(loan.progressPercent || 0)));

                return (
                  <article
                    key={loan.id}
                    className="bg-card border border-border rounded-xl overflow-hidden shadow-xs"
                  >
                    <div className="p-4 sm:p-5 space-y-4">
                      {/* Card Header */}
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/loans/${loan.id}`}
                              className="text-base sm:text-lg font-bold tracking-tight text-foreground hover:underline truncate"
                            >
                              {loan.name}
                            </Link>
                            <span
                              className={cn(
                                'inline-flex items-center px-2.5 py-0.5 rounded-full text-3xs font-semibold border',
                                statusMeta.badgeClass,
                              )}
                            >
                              {statusMeta.label}
                            </span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-3xs font-semibold bg-muted text-muted-foreground border border-border">
                              {loan.currencyCode}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="tabular-nums">
                              {loan.annualRate > 0 ? `${loan.annualRate}% TNA · ` : ''}
                              {loan.paidInstallmentsCount}/{loan.totalInstallmentsCount} cuotas
                              pagadas
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Landmark className="w-3.5 h-3.5" />
                              Pasivo: {loan.liabilityAccountName}
                            </span>
                            {loan.defaultPaymentAccountName && (
                              <span className="inline-flex items-center gap-1">
                                <Wallet className="w-3.5 h-3.5" />
                                Débito: {loan.defaultPaymentAccountName}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="md:text-right shrink-0">
                          <div className="text-3xs font-bold uppercase tracking-wider text-muted-foreground">
                            Capital Pendiente
                          </div>
                          <div className="text-xl sm:text-2xl font-bold tracking-tight tabular-nums text-foreground">
                            {formatCurrency(loan.pendingPrincipal, loanCurrency)}
                          </div>
                          <div className="text-xs text-muted-foreground tabular-nums">
                            de {formatCurrency(loan.initialPrincipal, loanCurrency)} inicial ·{' '}
                            {clampedPct.toFixed(0)}% amortizado
                          </div>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${clampedPct}%` }}
                        />
                      </div>

                      {/* Card Action Strip */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleExpand(loan.id)}
                            aria-expanded={isExpanded}
                            className="inline-flex items-center gap-1.5 min-h-11 sm:min-h-9 px-3 py-2 sm:py-1.5 rounded-lg border border-border bg-background text-xs font-semibold text-foreground hover:bg-muted cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUp className="w-3.5 h-3.5" />
                                Ocultar cuotas
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3.5 h-3.5" />
                                Próximas cuotas ({loan.pendingInstallmentsCount})
                              </>
                            )}
                          </button>

                          {nextInst && (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              Próxima: #{nextInst.installmentNumber} el{' '}
                              <span
                                className={cn(
                                  'font-semibold',
                                  nextInst.isOverdue
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : 'text-foreground',
                                )}
                              >
                                {formatLoanShortDate(nextInst.dueDate)}
                              </span>{' '}
                              ({formatCurrency(nextInst.pendingTotal, loanCurrency)})
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {loan.status === 'ACTIVE' && nextInst && (
                            <button
                              type="button"
                              onClick={() => setPayTarget({ loan, installment: nextInst })}
                              className="inline-flex items-center justify-center min-h-11 sm:min-h-9 px-3.5 py-2 sm:py-1.5 rounded-lg bg-brand-gradient text-white text-xs font-semibold shadow-brand-glow-sm hover:opacity-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {nextInst.status === 'PARTIAL'
                                ? `Pagar resto #${nextInst.installmentNumber}`
                                : `Pagar cuota #${nextInst.installmentNumber}`}
                            </button>
                          )}

                          <Link
                            href={`/loans/${loan.id}`}
                            className="inline-flex items-center justify-center gap-1.5 min-h-11 sm:min-h-9 px-3.5 py-2 sm:py-1.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Ver detalle
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </div>
                    </div>

                    {/* Expandable Upcoming 3 Installments */}
                    {isExpanded && (
                      <div className="border-t border-border bg-muted/20">
                        {upcomingInstallments.length === 0 ? (
                          <div className="px-4 py-4 text-xs text-muted-foreground">
                            {loan.status === 'CANCELLED'
                              ? 'Préstamo anulado con historial revertido.'
                              : 'Todas las cuotas de este préstamo están saldadas.'}
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                  <th className="py-2.5 px-4 text-left font-semibold">Cuota</th>
                                  <th className="py-2.5 px-3 text-left font-semibold">
                                    Vencimiento
                                  </th>
                                  <th className="py-2.5 px-3 text-right font-semibold">
                                    Capital Pend.
                                  </th>
                                  {activeCols.map((col) => (
                                    <th
                                      key={col.id}
                                      className="py-2.5 px-3 text-right font-semibold whitespace-nowrap"
                                    >
                                      {col.name}
                                    </th>
                                  ))}
                                  <th className="py-2.5 px-3 text-right font-semibold">
                                    Total Pendiente
                                  </th>
                                  <th className="py-2.5 px-3 text-left font-semibold">Estado</th>
                                  <th className="py-2.5 px-4 text-right font-semibold">Acción</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/70">
                                {upcomingInstallments.map((inst) => {
                                  const instMeta = getLoanInstallmentStatusMeta(
                                    inst.status,
                                    inst.isOverdue,
                                  );
                                  return (
                                    <tr key={inst.id} className="hover:bg-muted/30">
                                      <td className="py-2.5 px-4 font-semibold tabular-nums text-foreground">
                                        #{inst.installmentNumber}
                                      </td>
                                      <td className="py-2.5 px-3 tabular-nums text-muted-foreground whitespace-nowrap">
                                        {formatLoanShortDate(inst.dueDate)}
                                      </td>
                                      <td className="py-2.5 px-3 text-right font-bold tracking-tight tabular-nums text-foreground whitespace-nowrap">
                                        {formatCurrency(inst.pendingPrincipal, loanCurrency)}
                                      </td>
                                      {activeCols.map((col) => {
                                        const colVal = Number(inst.pendingCharges?.[col.id] ?? 0);
                                        return (
                                          <td
                                            key={col.id}
                                            className="py-2.5 px-3 text-right tabular-nums text-muted-foreground whitespace-nowrap"
                                          >
                                            {formatCurrency(colVal, loanCurrency)}
                                          </td>
                                        );
                                      })}
                                      <td className="py-2.5 px-3 text-right font-bold tracking-tight tabular-nums text-foreground whitespace-nowrap">
                                        {formatCurrency(inst.pendingTotal, loanCurrency)}
                                      </td>
                                      <td className="py-2.5 px-3 whitespace-nowrap">
                                        <span
                                          className={cn(
                                            'inline-flex items-center px-2 py-0.5 rounded-full text-3xs font-semibold border',
                                            instMeta.badgeClass,
                                          )}
                                        >
                                          {instMeta.label}
                                        </span>
                                      </td>
                                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                                        {loan.status === 'ACTIVE' && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setPayTarget({ loan, installment: inst })
                                            }
                                            className="inline-flex items-center justify-center min-h-9 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                          >
                                            {inst.status === 'PARTIAL' ? 'Pagar resto' : 'Pagar'}
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            /* Agenda de Cuotas (Chronological) */
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-xs">
              {agendaRows.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No hay cuotas pendientes en los préstamos filtrados.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                        <th className="py-3 px-4 text-left font-semibold">Vencimiento</th>
                        <th className="py-3 px-3 text-left font-semibold">Préstamo</th>
                        <th className="py-3 px-3 text-left font-semibold">Cuota</th>
                        <th className="py-3 px-3 text-right font-semibold">Capital Pend.</th>
                        <th className="py-3 px-3 text-right font-semibold">Cargos Pend.</th>
                        <th className="py-3 px-3 text-right font-semibold">Total Pendiente</th>
                        <th className="py-3 px-3 text-left font-semibold">Estado</th>
                        <th className="py-3 px-4 text-right font-semibold">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {agendaRows.map(({ loan, installment, pendingChargesTotal }) => {
                        const loanCurrency = {
                          code: loan.currencyCode,
                          symbol: loan.currencySymbol,
                          decimalPlaces: loan.decimalPlaces,
                        };
                        const meta = getLoanInstallmentStatusMeta(
                          installment.status,
                          installment.isOverdue,
                        );
                        return (
                          <tr key={installment.id} className="hover:bg-muted/30">
                            <td className="py-3 px-4 tabular-nums font-semibold text-foreground whitespace-nowrap">
                              {formatLoanShortDate(installment.dueDate)}
                            </td>
                            <td className="py-3 px-3">
                              <Link
                                href={`/loans/${loan.id}`}
                                className="font-semibold text-foreground hover:underline"
                              >
                                {loan.name}
                              </Link>
                              <div className="text-3xs text-muted-foreground">
                                {loan.currencyCode}
                              </div>
                            </td>
                            <td className="py-3 px-3 tabular-nums text-muted-foreground whitespace-nowrap">
                              Cuota #{installment.installmentNumber} / {loan.totalInstallmentsCount}
                            </td>
                            <td className="py-3 px-3 text-right font-bold tracking-tight tabular-nums text-foreground whitespace-nowrap">
                              {formatCurrency(installment.pendingPrincipal, loanCurrency)}
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                              {formatCurrency(pendingChargesTotal, loanCurrency)}
                            </td>
                            <td className="py-3 px-3 text-right font-bold tracking-tight tabular-nums text-foreground whitespace-nowrap">
                              {formatCurrency(installment.pendingTotal, loanCurrency)}
                            </td>
                            <td className="py-3 px-3 whitespace-nowrap">
                              <span
                                className={cn(
                                  'inline-flex items-center px-2 py-0.5 rounded-full text-3xs font-semibold border',
                                  meta.badgeClass,
                                )}
                              >
                                {meta.label}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => setPayTarget({ loan, installment })}
                                className="inline-flex items-center justify-center min-h-9 px-3 py-1.5 rounded-lg bg-brand-gradient text-white text-xs font-semibold shadow-brand-glow-sm hover:opacity-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {installment.status === 'PARTIAL' ? 'Pagar resto' : 'Pagar'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Pay Installment Modal */}
      {payTarget && (
        <PayLoanInstallmentModal
          isOpen={Boolean(payTarget)}
          onClose={() => setPayTarget(null)}
          loan={payTarget.loan}
          installment={payTarget.installment}
          accounts={accounts}
          onSuccess={handlePaymentSuccess}
          onAccountsChanged={setAccounts}
        />
      )}

      <LoanToast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
