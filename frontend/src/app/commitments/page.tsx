'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  CommitmentDto,
  CommitmentInstallmentDto,
  CommitmentKpiSummary,
  ContactDto,
} from '@sistema-contable/shared';
import {
  Plus,
  User,
  Users,
  Search,
  MoreVertical,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Banknote,
  Calendar,
  ShieldAlert,
  Eye,
  Handshake,
  CalendarOff,
  Clock,
  CheckCircle2,
  AlertCircle,
  ListChecks,
  Layers,
} from 'lucide-react';
import { api } from '../../services/api';
import { formatCurrency } from '../../lib/utils';
import { KpiCard } from '../../components/ui/KpiCard';
import {
  formatCommitmentDate,
  getOriginSummaryLabel,
  getStatusMeta,
} from '../../components/commitments/commitment-ui';
import ContactsModal from '../../components/commitments/ContactsModal';
import SettleInstallmentModal from '../../components/commitments/SettleInstallmentModal';
import RescheduleInstallmentModal from '../../components/commitments/RescheduleInstallmentModal';
import ForgiveInstallmentModal from '../../components/commitments/ForgiveInstallmentModal';
import type { AccountOption } from '../../types/account';

type DirectionFilter = 'ALL' | 'INFLOW' | 'OUTFLOW';
type ViewMode = 'COMMITMENTS' | 'AGENDA';
type StatusFilter = 'ACTIVE_PENDING' | 'OVERDUE' | 'PARTIAL' | 'NO_DATE' | 'PAID' | 'ALL';

const PAGE_SIZE = 10;

const DEFAULT_KPIS: CommitmentKpiSummary = {
  receivableTotal: 0,
  payableTotal: 0,
  netBalance: 0,
  receivableInstallmentsCount: 0,
  overdueReceivableCount: 0,
  overduePayableCount: 0,
  noDateCount: 0,
  payableInstallmentsCount: 0,
  nextPayableDueDate: null,
};

export default function CommitmentsPage() {
  const [commitments, setCommitments] = useState<CommitmentDto[]>([]);
  const [kpis, setKpis] = useState<CommitmentKpiSummary>(DEFAULT_KPIS);
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters & view state
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('ALL');
  const [viewMode, setViewMode] = useState<ViewMode>('COMMITMENTS');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ACTIVE_PENDING');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Modals
  const [contactsModalOpen, setContactsModalOpen] = useState(false);
  const [settleTarget, setSettleTarget] = useState<{
    commitment: CommitmentDto;
    installment: CommitmentInstallmentDto;
  } | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<{
    commitment: CommitmentDto;
    installment: CommitmentInstallmentDto;
  } | null>(null);
  const [forgiveTarget, setForgiveTarget] = useState<{
    commitment: CommitmentDto;
    installment: CommitmentInstallmentDto;
  } | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [listRes, contactsRes, accountsRes, currenciesRes] = await Promise.all([
        api.commitments.list(),
        api.contacts.list(),
        api.accounts.list(),
        api.currencies.list(),
      ]);
      setCommitments(listRes.commitments || []);
      setKpis(listRes.kpis || DEFAULT_KPIS);
      setContacts(contactsRes || []);
      setAccounts(accountsRes || []);
      setCurrencies(currenciesRes || []);
    } catch (err: any) {
      setError(err.message || 'Error al cargar Pagos y Cobros.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!openMenuId) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(`[data-commitment-menu="${openMenuId}"]`)) {
        setOpenMenuId(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuId]);

  const baseCurrency = useMemo(
    () => currencies.find((c) => c.isBase) || { code: 'PYG', symbol: '₲', decimalPlaces: 0 },
    [currencies],
  );

  const matchesSearch = useCallback(
    (c: CommitmentDto) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        c.contactName.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        (c.notes || '').toLowerCase().includes(q)
      );
    },
    [search],
  );

  const filteredCommitments = useMemo(() => {
    return commitments.filter((c) => {
      if (directionFilter !== 'ALL' && c.direction !== directionFilter) return false;
      if (!matchesSearch(c)) return false;
      switch (statusFilter) {
        case 'ACTIVE_PENDING':
          return c.status !== 'PAID';
        case 'OVERDUE':
          return c.status === 'OVERDUE' || c.installments.some((i) => i.status === 'OVERDUE');
        case 'PARTIAL':
          return c.status === 'PARTIAL' || c.installments.some((i) => i.status === 'PARTIAL');
        case 'NO_DATE':
          return c.installments.some((i) => i.dueDate === null && i.pendingAmount > 0);
        case 'PAID':
          return c.status === 'PAID';
        case 'ALL':
        default:
          return true;
      }
    });
  }, [commitments, directionFilter, statusFilter, matchesSearch]);

  const agendaInstallments = useMemo(() => {
    const rows: Array<{
      commitment: CommitmentDto;
      installment: CommitmentInstallmentDto;
    }> = [];
    for (const c of commitments) {
      if (directionFilter !== 'ALL' && c.direction !== directionFilter) continue;
      if (!matchesSearch(c)) continue;
      for (const inst of c.installments) {
        if (statusFilter === 'ACTIVE_PENDING' && inst.status === 'PAID') continue;
        if (statusFilter === 'OVERDUE' && inst.status !== 'OVERDUE') continue;
        if (statusFilter === 'PARTIAL' && inst.status !== 'PARTIAL') continue;
        if (statusFilter === 'NO_DATE' && (inst.dueDate !== null || inst.pendingAmount <= 0))
          continue;
        if (statusFilter === 'PAID' && inst.status !== 'PAID') continue;
        rows.push({ commitment: c, installment: inst });
      }
    }
    const scheduled = rows
      .filter((r) => r.installment.dueDate !== null)
      .sort((a, b) => (a.installment.dueDate || '').localeCompare(b.installment.dueDate || ''));
    const unscheduled = rows.filter((r) => r.installment.dueDate === null);
    return { scheduled, unscheduled };
  }, [commitments, directionFilter, statusFilter, matchesSearch]);

  useEffect(() => {
    setCurrentPage(1);
  }, [directionFilter, statusFilter, search, viewMode]);

  const totalCommitmentPages = Math.max(1, Math.ceil(filteredCommitments.length / PAGE_SIZE));
  const safeCommitmentPage = Math.min(currentPage, totalCommitmentPages);
  const paginatedCommitments = useMemo(() => {
    const start = (safeCommitmentPage - 1) * PAGE_SIZE;
    return filteredCommitments.slice(start, start + PAGE_SIZE);
  }, [filteredCommitments, safeCommitmentPage]);

  const totalAgendaPages = Math.max(1, Math.ceil(agendaInstallments.scheduled.length / PAGE_SIZE));
  const safeAgendaPage = Math.min(currentPage, totalAgendaPages);
  const paginatedScheduled = useMemo(() => {
    const start = (safeAgendaPage - 1) * PAGE_SIZE;
    return agendaInstallments.scheduled.slice(start, start + PAGE_SIZE);
  }, [agendaInstallments.scheduled, safeAgendaPage]);

  const getNextPendingInstallment = (c: CommitmentDto): CommitmentInstallmentDto | null => {
    return c.installments.find((i) => i.pendingAmount > 0.0001) || null;
  };

  const toggleExpandCard = (id: string) => {
    setExpandedCards((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            Pagos y Cobros
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Gestiona tus cuentas por cobrar y cuentas por pagar desde un solo lugar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setContactsModalOpen(true)}
            className="px-4 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer transition"
          >
            <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Contactos ({contacts.length})</span>
          </button>
          <Link
            href="/commitments/new"
            className="px-4 py-2.5 min-h-11 rounded-xl bg-brand-gradient text-white text-xs font-bold shadow-brand-glow-sm hover:opacity-95 flex items-center gap-2 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo Compromiso</span>
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 3 KPI Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 sm:gap-4">
        <KpiCard
          variant="hero"
          className="col-span-2 md:col-span-1"
          label="Balance Pagos y Cobros"
          value={formatCurrency(kpis.netBalance, baseCurrency)}
          valueClassName="text-xl sm:text-2xl"
          icon={
            <div className="p-1.5 rounded-lg bg-white/20 backdrop-blur-xs">
              <Handshake className="w-4 h-4 text-white" />
            </div>
          }
          footer={
            <p className="text-xs text-white/80">Cuentas por cobrar menos cuentas por pagar</p>
          }
        />

        <KpiCard
          variant="emerald"
          label="Cuentas por Cobrar"
          value={formatCurrency(kpis.receivableTotal, baseCurrency)}
          valueClassName="text-base sm:text-2xl"
          badge={
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 shrink-0 tabular-nums">
              {kpis.receivableInstallmentsCount} cuotas
            </span>
          }
          footer={
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {kpis.overdueReceivableCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300">
                  {kpis.overdueReceivableCount} vencida
                  {kpis.overdueReceivableCount === 1 ? '' : 's'}
                </span>
              )}
              {kpis.noDateCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
                  {kpis.noDateCount} sin fecha
                </span>
              )}
              {kpis.overdueReceivableCount === 0 && kpis.noDateCount === 0 && (
                <span className="text-xs text-muted-foreground">Al día</span>
              )}
            </div>
          }
        />

        <KpiCard
          variant="rose"
          label="Cuentas por Pagar"
          value={formatCurrency(kpis.payableTotal, baseCurrency)}
          valueClassName="text-base sm:text-2xl"
          badge={
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 shrink-0 tabular-nums">
              {kpis.payableInstallmentsCount} cuotas
            </span>
          }
          footer={
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {kpis.overduePayableCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300">
                  {kpis.overduePayableCount} vencida{kpis.overduePayableCount === 1 ? '' : 's'}
                </span>
              )}
              {kpis.nextPayableDueDate ? (
                <span className="text-xs text-muted-foreground">
                  Próx.: {formatCommitmentDate(kpis.nextPayableDueDate)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Sin vencimientos</span>
              )}
            </div>
          }
        />
      </div>

      {/* Filter Toolbar */}
      <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Direction tabs */}
          <div className="grid grid-cols-3 sm:flex sm:flex-nowrap gap-1 bg-slate-100 dark:bg-slate-950 p-1 rounded-2xl">
            {(
              [
                { id: 'ALL', label: 'Todos' },
                { id: 'INFLOW', label: 'Cuentas por Cobrar' },
                { id: 'OUTFLOW', label: 'Cuentas por Pagar' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDirectionFilter(tab.id)}
                className={`px-2 sm:px-3.5 py-2 min-h-11 rounded-xl text-xs font-bold text-center leading-tight flex items-center justify-center sm:whitespace-nowrap transition cursor-pointer ${
                  directionFilter === tab.id
                    ? 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            {/* Search */}
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar contacto o concepto..."
                className="w-full pl-10 pr-3.5 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
            </div>

            {/* View mode switcher */}
            <div className="flex justify-center bg-slate-100 dark:bg-slate-950 p-1 rounded-2xl">
              <button
                type="button"
                onClick={() => setViewMode('COMMITMENTS')}
                className={`flex-1 justify-center sm:flex-initial px-3 py-2 min-h-11 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition ${
                  viewMode === 'COMMITMENTS'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Por Compromiso</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('AGENDA')}
                className={`flex-1 justify-center sm:flex-initial px-3 py-2 min-h-11 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition ${
                  viewMode === 'AGENDA'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <ListChecks className="w-3.5 h-3.5" />
                <span>Agenda de Cuotas</span>
              </button>
            </div>
          </div>
        </div>

        {/* Status chips */}
        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          {(
            [
              { id: 'ACTIVE_PENDING', label: 'Pendientes activos' },
              { id: 'OVERDUE', label: 'Vencidos' },
              { id: 'PARTIAL', label: 'Pagos parciales' },
              { id: 'NO_DATE', label: 'Sin fecha / Abiertos' },
              { id: 'PAID', label: 'Saldados' },
              { id: 'ALL', label: 'Ver todos' },
            ] as const
          ).map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setStatusFilter(chip.id)}
              className={`px-3 py-1.5 min-h-9 rounded-full text-xs font-semibold border transition cursor-pointer ${
                statusFilter === chip.id
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="h-28 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 animate-pulse"
            />
          ))}
        </div>
      ) : viewMode === 'COMMITMENTS' ? (
        filteredCommitments.length === 0 ? (
          <div className="p-10 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto">
              <Handshake className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              No hay compromisos con este filtro
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Registra acuerdos por cobrar o pagar en cuotas y ContaWave proyectará automáticamente
              cada vencimiento.
            </p>
            <div className="pt-2">
              <Link
                href="/commitments/new"
                className="inline-flex items-center gap-2 px-5 py-2.5 min-h-11 rounded-xl bg-brand-gradient text-white text-xs font-bold shadow-brand-glow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Nuevo Compromiso</span>
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {paginatedCommitments.map((c) => {
              const statusMeta = getStatusMeta(c.status);
              const nextInst = getNextPendingInstallment(c);
              const isExpanded = Boolean(expandedCards[c.id]);
              const pct =
                c.totalAmount > 0
                  ? Math.min(100, Math.round((c.settledAmount / c.totalAmount) * 100))
                  : 0;
              const isInflow = c.direction === 'INFLOW';

              return (
                <div
                  key={c.id}
                  className={`rounded-xl sm:rounded-2xl bg-card border border-border border-l-4 ${
                    isInflow ? 'border-l-emerald-500' : 'border-l-rose-500'
                  } shadow-xs overflow-visible`}
                >
                  <div className="p-3.5 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
                    <div className="flex-1 min-w-0 space-y-1.5 sm:space-y-2">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                            isInflow
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                          }`}
                        >
                          {isInflow ? 'Por cobrar' : 'Por pagar'}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-foreground">
                          <User
                            aria-hidden="true"
                            className="w-3.5 h-3.5 text-muted-foreground shrink-0"
                          />
                          <span className="truncate max-w-36 sm:max-w-none">{c.contactName}</span>
                        </span>
                        <span className="hidden sm:inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                          {getOriginSummaryLabel(c)}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-bold border ${statusMeta.badgeClass}`}
                        >
                          {statusMeta.label}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <Link
                          href={`/commitments/${c.id}`}
                          className="text-sm sm:text-base font-bold tracking-tight text-foreground hover:text-indigo-600 dark:hover:text-indigo-400 transition truncate"
                        >
                          {c.description}
                        </Link>
                        {c.hasNoDateInstallments && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground">
                            <CalendarOff className="w-3 h-3" />
                            <span>Sin fecha definida</span>
                          </span>
                        )}
                        {!c.hasNoDateInstallments && c.nextDueDate && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="w-3.5 h-3.5" />
                            <span>Próx.: {formatCommitmentDate(c.nextDueDate)}</span>
                          </span>
                        )}
                      </div>

                      {/* Progress bar */}
                      <div className="flex items-center gap-2.5 sm:gap-3 max-w-md">
                        <div className="flex-1 h-1.5 sm:h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              isInflow ? 'bg-emerald-500' : 'bg-indigo-500'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-muted-foreground tabular-nums shrink-0">
                          {pct}% ({c.installments.filter((i) => i.status === 'PAID').length}/
                          {c.installments.length})
                        </span>
                      </div>
                    </div>

                    {/* Right balance & quick actions */}
                    <div className="flex flex-row items-center justify-between lg:justify-end gap-3 sm:gap-4 shrink-0 pt-2 sm:pt-0 border-t border-border/60 lg:border-t-0">
                      <div className="text-left sm:text-right min-w-0">
                        <div className="text-xs text-muted-foreground">Saldo pendiente</div>
                        <div className="text-base sm:text-lg font-bold tracking-tight text-foreground tabular-nums truncate">
                          {formatCurrency(c.pendingAmount, baseCurrency)}
                        </div>
                        <div className="text-xs text-muted-foreground tabular-nums truncate">
                          de {formatCurrency(c.totalAmount, baseCurrency)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 relative shrink-0">
                        {nextInst && (
                          <button
                            type="button"
                            onClick={() =>
                              setSettleTarget({ commitment: c, installment: nextInst })
                            }
                            className={`px-3.5 sm:px-4 py-2.5 min-h-11 rounded-lg sm:rounded-xl text-xs font-bold text-white shadow-xs flex items-center gap-1.5 cursor-pointer transition ${
                              isInflow
                                ? 'bg-emerald-600 hover:bg-emerald-700'
                                : 'bg-brand-gradient hover:opacity-95'
                            }`}
                          >
                            <Banknote className="w-4 h-4" />
                            <span>{isInflow ? 'Cobrar' : 'Pagar'}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => toggleExpandCard(c.id)}
                          aria-expanded={isExpanded}
                          aria-label="Ver cuotas"
                          className="p-2.5 min-h-11 min-w-11 rounded-lg sm:rounded-xl border border-border text-muted-foreground hover:bg-muted flex items-center justify-center cursor-pointer"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>

                        <div data-commitment-menu={c.id} className="relative">
                          <button
                            type="button"
                            onClick={() => setOpenMenuId(openMenuId === c.id ? null : c.id)}
                            aria-label="Más acciones"
                            aria-expanded={openMenuId === c.id}
                            className="p-2.5 min-h-11 min-w-11 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center cursor-pointer"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {openMenuId === c.id && (
                            <div className="absolute right-0 top-12 z-30 w-60 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl py-1.5 text-xs">
                              <Link
                                href={`/commitments/${c.id}`}
                                onClick={() => setOpenMenuId(null)}
                                className="w-full px-4 py-2.5 min-h-11 flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold"
                              >
                                <Eye className="w-4 h-4 text-indigo-500" />
                                <span>Ver plan de pagos y datos</span>
                              </Link>
                              {nextInst && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      setRescheduleTarget({ commitment: c, installment: nextInst });
                                    }}
                                    className="w-full px-4 py-2.5 min-h-11 flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold cursor-pointer text-left"
                                  >
                                    <Calendar className="w-4 h-4 text-slate-500" />
                                    <span>
                                      {nextInst.dueDate
                                        ? 'Reprogramar o quitar fecha'
                                        : 'Asignar fecha esperada'}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      setForgiveTarget({ commitment: c, installment: nextInst });
                                    }}
                                    className="w-full px-4 py-2.5 min-h-11 flex items-center gap-2 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 font-semibold cursor-pointer text-left"
                                  >
                                    <ShieldAlert className="w-4 h-4" />
                                    <span>Condonar saldo</span>
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded installments accordion */}
                  {isExpanded && (
                    <div className="px-4 sm:px-5 pb-4 pt-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 rounded-b-3xl">
                      {/* Mobile card rows (320px+) */}
                      <div className="space-y-2.5 sm:hidden">
                        {c.installments.map((inst) => {
                          const instMeta = getStatusMeta(inst.status);
                          return (
                            <div
                              key={inst.id}
                              className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-2 text-xs"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-slate-800 dark:text-slate-200">
                                  Cuota #{inst.installmentNumber} ·{' '}
                                  {formatCommitmentDate(inst.dueDate)}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-xs font-bold border ${instMeta.badgeClass}`}
                                >
                                  {instMeta.label}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                                  Total: {formatCurrency(inst.amount, baseCurrency)}
                                </span>
                                <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                                  Pendiente: {formatCurrency(inst.pendingAmount, baseCurrency)}
                                </span>
                              </div>
                              {inst.pendingAmount > 0 ? (
                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSettleTarget({ commitment: c, installment: inst })
                                    }
                                    className="flex-1 px-3 py-2 min-h-11 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold cursor-pointer"
                                  >
                                    {isInflow ? 'Cobrar' : 'Pagar'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRescheduleTarget({
                                        commitment: c,
                                        installment: inst,
                                      })
                                    }
                                    className="px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold cursor-pointer"
                                  >
                                    Fecha
                                  </button>
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Saldada
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Desktop table */}
                      <div className="hidden sm:block overflow-x-auto">
                        <table className="w-full text-xs text-left">
                          <thead>
                            <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-200/70 dark:border-slate-800">
                              <th className="py-2 pr-3 font-semibold">Cuota</th>
                              <th className="py-2 pr-3 font-semibold">Vencimiento</th>
                              <th className="py-2 pr-3 font-semibold">Estado</th>
                              <th className="py-2 px-3 text-right font-semibold">Monto</th>
                              <th className="py-2 px-3 text-right font-semibold">Pendiente</th>
                              <th className="py-2 pl-3 text-right font-semibold">Acciones</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200/50 dark:divide-slate-800">
                            {c.installments.map((inst) => {
                              const instMeta = getStatusMeta(inst.status);
                              return (
                                <tr key={inst.id}>
                                  <td className="py-2.5 pr-3 font-bold text-slate-800 dark:text-slate-200">
                                    #{inst.installmentNumber}
                                  </td>
                                  <td className="py-2.5 pr-3 text-slate-600 dark:text-slate-300">
                                    {formatCommitmentDate(inst.dueDate)}
                                  </td>
                                  <td className="py-2.5 pr-3">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-xs font-bold border ${instMeta.badgeClass}`}
                                    >
                                      {instMeta.label}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                                    {formatCurrency(inst.amount, baseCurrency)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right tabular-nums font-bold text-slate-900 dark:text-slate-100">
                                    {formatCurrency(inst.pendingAmount, baseCurrency)}
                                  </td>
                                  <td className="py-2.5 pl-3 text-right">
                                    <div className="inline-flex items-center gap-1.5">
                                      {inst.pendingAmount > 0 && (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setSettleTarget({ commitment: c, installment: inst })
                                            }
                                            className="px-2.5 py-1.5 min-h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold hover:bg-indigo-100 cursor-pointer"
                                          >
                                            {isInflow ? 'Cobrar' : 'Pagar'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setRescheduleTarget({
                                                commitment: c,
                                                installment: inst,
                                              })
                                            }
                                            className="px-2.5 py-1.5 min-h-9 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold hover:bg-white cursor-pointer"
                                          >
                                            Fecha
                                          </button>
                                        </>
                                      )}
                                      {inst.pendingAmount === 0 && (
                                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                                          <CheckCircle2 className="w-3.5 h-3.5" />
                                          Saldada
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {filteredCommitments.length > PAGE_SIZE && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs">
                <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                  Mostrando {(safeCommitmentPage - 1) * PAGE_SIZE + 1}–
                  {Math.min(safeCommitmentPage * PAGE_SIZE, filteredCommitments.length)} de{' '}
                  {filteredCommitments.length} compromisos
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={safeCommitmentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Anterior</span>
                  </button>
                  <span className="px-2 font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                    Página {safeCommitmentPage} de {totalCommitmentPages}
                  </span>
                  <button
                    type="button"
                    disabled={safeCommitmentPage >= totalCommitmentPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalCommitmentPages, p + 1))}
                    className="px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                  >
                    <span>Siguiente</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      ) : (
        /* AGENDA DE CUOTAS */
        <div className="space-y-6">
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                  Vencimientos programados ({agendaInstallments.scheduled.length})
                </h2>
              </div>
            </div>

            {agendaInstallments.scheduled.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No hay cuotas con fecha definida bajo el filtro actual.
              </div>
            ) : (
              <>
                {/* Mobile scheduled cards (320px+) */}
                <div className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
                  {paginatedScheduled.map(({ commitment: c, installment: inst }) => {
                    const instMeta = getStatusMeta(inst.status);
                    const isInflow = c.direction === 'INFLOW';
                    return (
                      <div key={inst.id} className="p-4 space-y-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {formatCommitmentDate(inst.dueDate)} · Cuota {inst.installmentNumber}/
                            {c.installments.length}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-bold border ${instMeta.badgeClass}`}
                          >
                            {instMeta.label}
                          </span>
                        </div>
                        <Link
                          href={`/commitments/${c.id}`}
                          className="font-bold text-sm text-slate-900 dark:text-slate-100 hover:text-indigo-600 flex items-center gap-1.5"
                        >
                          <User
                            aria-hidden="true"
                            className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0"
                          />
                          <span className="truncate">
                            {c.contactName} — {c.description}
                          </span>
                        </Link>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500 dark:text-slate-400">
                            {isInflow ? 'Por cobrar' : 'Por pagar'}
                          </span>
                          <span className="text-sm font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
                            {formatCurrency(inst.pendingAmount, baseCurrency)}
                          </span>
                        </div>
                        {inst.pendingAmount > 0 && (
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setSettleTarget({ commitment: c, installment: inst })}
                              className="flex-1 px-3 py-2 min-h-11 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 cursor-pointer"
                            >
                              {isInflow ? 'Cobrar' : 'Pagar'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setRescheduleTarget({ commitment: c, installment: inst })
                              }
                              className="px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
                            >
                              Fecha
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Desktop scheduled table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200/70 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-bold">Fecha</th>
                        <th className="px-4 py-3 font-bold">Contacto / Compromiso</th>
                        <th className="px-4 py-3 font-bold">Cuota</th>
                        <th className="px-4 py-3 font-bold">Estado</th>
                        <th className="px-4 py-3 text-right font-bold">Pendiente</th>
                        <th className="px-4 py-3 text-right font-bold">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {paginatedScheduled.map(({ commitment: c, installment: inst }) => {
                        const instMeta = getStatusMeta(inst.status);
                        const isInflow = c.direction === 'INFLOW';
                        return (
                          <tr
                            key={inst.id}
                            className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                          >
                            <td className="px-4 py-3 font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                              {formatCommitmentDate(inst.dueDate)}
                            </td>
                            <td className="px-4 py-3">
                              <Link
                                href={`/commitments/${c.id}`}
                                className="font-bold text-slate-900 dark:text-slate-100 hover:text-indigo-600 inline-flex items-center gap-1.5"
                              >
                                <User
                                  aria-hidden="true"
                                  className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0"
                                />
                                <span>
                                  {c.contactName} — {c.description}
                                </span>
                              </Link>
                              <div className="text-slate-500 dark:text-slate-400">
                                {isInflow ? 'Por cobrar' : 'Por pagar'} · {getOriginSummaryLabel(c)}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">
                              Cuota {inst.installmentNumber}/{c.installments.length}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-xs font-bold border ${instMeta.badgeClass}`}
                              >
                                {instMeta.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-extrabold tabular-nums text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {formatCurrency(inst.pendingAmount, baseCurrency)}
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              {inst.pendingAmount > 0 && (
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSettleTarget({ commitment: c, installment: inst })
                                    }
                                    className="px-3 py-2 min-h-11 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 cursor-pointer"
                                  >
                                    {isInflow ? 'Cobrar' : 'Pagar'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRescheduleTarget({ commitment: c, installment: inst })
                                    }
                                    className="px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
                                  >
                                    Fecha
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {agendaInstallments.scheduled.length > PAGE_SIZE && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                    <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                      Mostrando {(safeAgendaPage - 1) * PAGE_SIZE + 1}–
                      {Math.min(safeAgendaPage * PAGE_SIZE, agendaInstallments.scheduled.length)} de{' '}
                      {agendaInstallments.scheduled.length} vencimientos
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={safeAgendaPage <= 1}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        className="px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        <span>Anterior</span>
                      </button>
                      <span className="px-2 font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                        Página {safeAgendaPage} de {totalAgendaPages}
                      </span>
                      <button
                        type="button"
                        disabled={safeAgendaPage >= totalAgendaPages}
                        onClick={() => setCurrentPage((p) => Math.min(totalAgendaPages, p + 1))}
                        className="px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                      >
                        <span>Siguiente</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Sin fecha / Abiertos */}
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CalendarOff className="w-4 h-4 text-slate-500" />
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                  Sin fecha / Abiertos ({agendaInstallments.unscheduled.length})
                </h2>
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Visibles en Balance General; no proyectan caja mensual hasta asignar fecha
              </span>
            </div>
            {agendaInstallments.unscheduled.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No hay cuotas abiertas sin fecha.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {agendaInstallments.unscheduled.map(({ commitment: c, installment: inst }) => {
                  const isInflow = c.direction === 'INFLOW';
                  return (
                    <div
                      key={inst.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <Link
                          href={`/commitments/${c.id}`}
                          className="text-sm font-bold text-slate-900 dark:text-slate-100 hover:text-indigo-600 inline-flex items-center gap-1.5"
                        >
                          <User
                            aria-hidden="true"
                            className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0"
                          />
                          <span>
                            {c.contactName} — {c.description}
                          </span>
                        </Link>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Cuota {inst.installmentNumber} · {isInflow ? 'Por cobrar' : 'Por pagar'} ·
                          Sin vencimiento
                        </div>
                      </div>
                      <div className="flex items-center gap-3 self-end sm:self-center">
                        <span className="text-sm font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
                          {formatCurrency(inst.pendingAmount, baseCurrency)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setRescheduleTarget({ commitment: c, installment: inst })}
                          className="px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 cursor-pointer"
                        >
                          Asignar fecha
                        </button>
                        {inst.pendingAmount > 0 && (
                          <button
                            type="button"
                            onClick={() => setSettleTarget({ commitment: c, installment: inst })}
                            className="px-3 py-2 min-h-11 rounded-xl bg-brand-gradient text-white text-xs font-bold cursor-pointer"
                          >
                            {isInflow ? 'Cobrar' : 'Pagar'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      <ContactsModal
        isOpen={contactsModalOpen}
        onClose={() => setContactsModalOpen(false)}
        contacts={contacts}
        onUpdated={loadData}
      />

      {settleTarget && (
        <SettleInstallmentModal
          isOpen={true}
          onClose={() => setSettleTarget(null)}
          commitment={settleTarget.commitment}
          installment={settleTarget.installment}
          cashAccounts={accounts}
          baseCurrency={baseCurrency}
          onSuccess={loadData}
        />
      )}

      {rescheduleTarget && (
        <RescheduleInstallmentModal
          isOpen={true}
          onClose={() => setRescheduleTarget(null)}
          commitment={rescheduleTarget.commitment}
          installment={rescheduleTarget.installment}
          baseCurrency={baseCurrency}
          onSuccess={loadData}
        />
      )}

      {forgiveTarget && (
        <ForgiveInstallmentModal
          isOpen={true}
          onClose={() => setForgiveTarget(null)}
          commitment={forgiveTarget.commitment}
          installment={forgiveTarget.installment}
          accounts={accounts}
          baseCurrency={baseCurrency}
          onSuccess={loadData}
        />
      )}
    </div>
  );
}
