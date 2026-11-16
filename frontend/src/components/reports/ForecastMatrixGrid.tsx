'use client';

import React, { useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  File,
  TrendingUp,
  TrendingDown,
  Wallet,
  Building2,
  ShieldCheck,
} from 'lucide-react';
import type { VirtualContactSubRow } from '@sistema-contable/shared';
import { formatCurrency } from '../../lib/utils';

export interface AccountForecastItem {
  accountId: string;
  accountName: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  systemRole?: string | null;
  parentId: string | null;
  values: { [periodId: string]: number };
  inflowValues?: { [periodId: string]: number };
  outflowValues?: { [periodId: string]: number };
  contactBreakdown?: VirtualContactSubRow[];
}

export interface MonthForecastItem {
  periodId: string;
  periodName: string;
  status?: string;
  isReal: boolean;
  isCurrent?: boolean;
  periodStatus?: 'REAL' | 'ACTUAL' | 'PROYECTADO';
  // Cash flow fields
  initialCash?: number;
  ingresosOperativos?: number;
  entradasActivoPasivo?: number;
  totalEntradas?: number;
  egresosOperativos?: number;
  salidasActivoPasivo?: number;
  totalSalidas?: number;
  netFlow?: number;
  finalCash?: number;
  // Income statement fields
  income?: number;
  expense?: number;
  netProfit?: number;
}

export interface ForecastMatrixGridProps {
  type: 'CASH_FLOW' | 'INCOME_STATEMENT';
  months: MonthForecastItem[];
  accounts: AccountForecastItem[];
  baseCurrency?: any;
}

const SPANISH_MONTHS_SHORT = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];

function formatMonthHeader(periodName: string): { label: string; year: string } {
  const match = periodName.match(/^(\d{4})-(\d{2})/);
  if (!match) return { label: periodName, year: '' };
  const year = match[1];
  const monthIdx = parseInt(match[2], 10) - 1;
  const label = SPANISH_MONTHS_SHORT[monthIdx] || periodName;
  return { label, year };
}

export const ForecastMatrixGrid: React.FC<ForecastMatrixGridProps> = ({
  type,
  months,
  accounts,
  baseCurrency,
}) => {
  // Collapsible section state
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    income: false,
    expenses: false,
    assetInflow: false,
    assetOutflow: false,
  });

  // Account tree node expansion state
  const [expandedAccounts, setExpandedAccounts] = useState<Record<string, boolean>>({});

  const toggleSection = (sectionKey: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  const toggleAccount = (accId: string) => {
    setExpandedAccounts((prev) => ({
      ...prev,
      [accId]: !prev[accId],
    }));
  };

  const hasChildren = (accId: string) => {
    return accounts.some((a) => a.parentId === accId);
  };

  const isAccountVisible = (acc: AccountForecastItem) => {
    let parentId = acc.parentId;
    while (parentId) {
      if (!expandedAccounts[parentId]) {
        return false;
      }
      const parent = accounts.find((a) => a.accountId === parentId);
      parentId = parent ? parent.parentId : null;
    }
    return true;
  };

  const getAccountDepth = (acc: AccountForecastItem) => {
    let depth = 0;
    let parentId = acc.parentId;
    while (parentId) {
      depth++;
      const parent = accounts.find((a) => a.accountId === parentId);
      parentId = parent ? parent.parentId : null;
    }
    return depth;
  };

  const getContactSubRows = (
    acc: AccountForecastItem,
    flowFilter: 'CASH_IN' | 'CASH_OUT' | 'DEFAULT',
  ) => {
    const raw = acc.contactBreakdown ?? [];
    if (raw.length === 0) return [];
    if (flowFilter === 'CASH_IN' && acc.systemRole === 'ACCOUNTS_PAYABLE') return [];
    if (flowFilter === 'CASH_OUT' && acc.systemRole === 'ACCOUNTS_RECEIVABLE') return [];
    return raw.filter((sub) => {
      if (sub.valuesByPeriod) {
        return months.some((m) => Math.abs(sub.valuesByPeriod?.[m.periodId] ?? 0) !== 0);
      }
      return Math.abs(sub.amount ?? 0) !== 0;
    });
  };

  // Roll-up values recursively for trees
  const getSubtreeValue = (
    accId: string,
    periodId: string,
    flowFilter: 'CASH_IN' | 'CASH_OUT' | 'DEFAULT',
  ): number => {
    const acc = accounts.find((a) => a.accountId === accId);
    if (!acc) return 0;

    let val = acc.values[periodId] || 0;

    if (flowFilter === 'CASH_IN') {
      if (acc.systemRole === 'ACCOUNTS_PAYABLE') return 0;
      if (acc.accountType === 'ASSET' || acc.accountType === 'LIABILITY') {
        val = acc.inflowValues !== undefined ? acc.inflowValues[periodId] || 0 : val > 0 ? val : 0;
      }
    } else if (flowFilter === 'CASH_OUT') {
      if (acc.systemRole === 'ACCOUNTS_RECEIVABLE') return 0;
      if (acc.accountType === 'ASSET' || acc.accountType === 'LIABILITY') {
        val =
          acc.outflowValues !== undefined
            ? Math.abs(acc.outflowValues[periodId] || 0)
            : val < 0
              ? Math.abs(val)
              : 0;
      }
    }

    const children = accounts.filter((a) => a.parentId === accId);
    let childrenSum = 0;
    children.forEach((child) => {
      childrenSum += getSubtreeValue(child.accountId, periodId, flowFilter);
    });

    return val + childrenSum;
  };

  const hasNonZeroFlow = (
    accId: string,
    flowFilter: 'CASH_IN' | 'CASH_OUT' | 'DEFAULT',
  ): boolean => {
    return months.some((m) => getSubtreeValue(accId, m.periodId, flowFilter) !== 0);
  };

  const getSubtreeRowTotal = (
    accId: string,
    flowFilter: 'CASH_IN' | 'CASH_OUT' | 'DEFAULT',
  ): number => {
    return months.reduce((acc, m) => acc + getSubtreeValue(accId, m.periodId, flowFilter), 0);
  };

  // Render Account Row
  const renderAccountRow = (
    acc: AccountForecastItem,
    flowFilter: 'CASH_IN' | 'CASH_OUT' | 'DEFAULT',
  ) => {
    if (!isAccountVisible(acc)) return null;

    const depth = getAccountDepth(acc);
    const childrenPresent = hasChildren(acc.accountId);
    const contactSubRows = getContactSubRows(acc, flowFilter);
    const expandable = childrenPresent || contactSubRows.length > 0;
    const isExpanded = expandedAccounts[acc.accountId];
    const rowTotal = getSubtreeRowTotal(acc.accountId, flowFilter);

    // Recursively render child accounts if expanded
    const directChildren = accounts
      .filter((a) => a.parentId === acc.accountId)
      .filter((child) =>
        flowFilter === 'DEFAULT' ? true : hasNonZeroFlow(child.accountId, flowFilter),
      );

    return (
      <React.Fragment key={acc.accountId}>
        <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors h-9">
          {/* Sticky left Account Name */}
          <td
            className="px-3 py-1.5 border-r border-slate-200 dark:border-slate-800 sticky left-0 z-10 bg-white dark:bg-slate-900 truncate"
            style={{ paddingLeft: `${Math.max(12, depth * 20 + 12)}px` }}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {expandable ? (
                <button
                  type="button"
                  onClick={() => toggleAccount(acc.accountId)}
                  className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer shrink-0 text-slate-500 dark:text-slate-400"
                  title={isExpanded ? 'Colapsar' : 'Expandir'}
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
              ) : (
                <span className="w-4 h-4 shrink-0 flex items-center justify-center text-slate-400">
                  <File className="w-3 h-3" />
                </span>
              )}
              <span
                className={`truncate block text-xs font-medium ${
                  expandable
                    ? 'text-slate-900 dark:text-slate-100'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {acc.accountName}
              </span>
            </div>
          </td>

          {/* Month Columns */}
          {months.map((m) => {
            const rawVal = getSubtreeValue(acc.accountId, m.periodId, flowFilter);
            const val =
              acc.accountType === 'EXPENSE' || flowFilter === 'CASH_OUT'
                ? Math.abs(rawVal)
                : rawVal;
            return (
              <td
                key={m.periodId}
                className={`p-2 text-right border-r border-slate-200/60 dark:border-slate-800/60 text-xs tabular-nums whitespace-nowrap ${
                  val !== 0
                    ? 'font-medium text-slate-800 dark:text-slate-200'
                    : 'text-slate-400 dark:text-slate-600'
                }`}
              >
                {val === 0 ? '—' : formatCurrency(val, baseCurrency)}
              </td>
            );
          })}

          {/* Row Total */}
          {(() => {
            const absRowTotal =
              acc.accountType === 'EXPENSE' || flowFilter === 'CASH_OUT'
                ? Math.abs(rowTotal)
                : rowTotal;
            return (
              <td className="p-2 text-right text-xs font-semibold text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-900/80 tabular-nums truncate">
                {absRowTotal === 0 ? '—' : formatCurrency(absRowTotal, baseCurrency)}
              </td>
            );
          })()}
        </tr>

        {isExpanded &&
          contactSubRows.map((sub, idx) => {
            const prefix = idx === contactSubRows.length - 1 ? '└─ ' : '├─ ';
            const subRowTotal = months.reduce(
              (sum, m) => sum + Math.abs(sub.valuesByPeriod?.[m.periodId] ?? 0),
              0,
            );
            return (
              <tr
                key={`${acc.accountId}-contact-${sub.contactId ?? 'none'}-${idx}`}
                className="bg-slate-50/40 dark:bg-slate-900/40 h-8 text-xs"
              >
                <td
                  className="px-3 py-1 border-r border-slate-200 dark:border-slate-800 sticky left-0 z-10 bg-slate-50 dark:bg-slate-900/95 truncate"
                  style={{ paddingLeft: `${Math.max(24, (depth + 1) * 20 + 12)}px` }}
                >
                  <span className="truncate block text-xs font-normal text-slate-600 dark:text-slate-400">
                    {prefix}
                    {sub.contactName}
                  </span>
                </td>
                {months.map((m) => {
                  const subVal = Math.abs(sub.valuesByPeriod?.[m.periodId] ?? 0);
                  return (
                    <td
                      key={m.periodId}
                      className={`p-2 text-right border-r border-slate-200/60 dark:border-slate-800/60 text-xs tabular-nums whitespace-nowrap ${
                        subVal !== 0
                          ? 'font-normal text-slate-700 dark:text-slate-300'
                          : 'text-slate-400 dark:text-slate-600'
                      }`}
                    >
                      {subVal === 0 ? '—' : formatCurrency(subVal, baseCurrency)}
                    </td>
                  );
                })}
                <td className="p-2 text-right text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/80 tabular-nums truncate">
                  {subRowTotal === 0 ? '—' : formatCurrency(subRowTotal, baseCurrency)}
                </td>
              </tr>
            );
          })}

        {isExpanded && directChildren.map((child) => renderAccountRow(child, flowFilter))}
      </React.Fragment>
    );
  };

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs text-left border-collapse table-fixed min-w-full">
          {/* Table Header */}
          <thead className="bg-slate-100/90 dark:bg-slate-950 sticky top-0 z-20 font-sans border-b border-slate-200 dark:border-slate-800 backdrop-blur-xs">
            <tr>
              <th className="p-3 w-56 sm:w-72 font-bold text-slate-800 dark:text-slate-200 border-r border-slate-200/60 dark:border-slate-800/60 sticky left-0 bg-slate-100 dark:bg-slate-950 z-30 truncate">
                Concepto / Partida
              </th>
              {months.map((m) => {
                const { label, year } = formatMonthHeader(m.periodName);
                const status =
                  m.periodStatus ?? (m.isReal ? 'REAL' : m.isCurrent ? 'ACTUAL' : 'PROYECTADO');
                const badgeClass =
                  status === 'REAL'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                    : status === 'ACTUAL'
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                      : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30';
                const badgeLabel =
                  status === 'REAL' ? 'Real' : status === 'ACTUAL' ? 'Actual' : 'Proyectado';
                return (
                  <th
                    key={m.periodId}
                    className="p-2.5 w-28 sm:w-36 text-right font-bold text-slate-800 dark:text-slate-200 border-r border-slate-200/60 dark:border-slate-800/60"
                  >
                    <div className="flex flex-col items-end justify-center space-y-1">
                      <div className="flex items-center space-x-1">
                        <span className="text-xs font-bold">{label}</span>
                        {year && (
                          <span className="text-2xs text-slate-400 font-medium">{year}</span>
                        )}
                      </div>
                      <span
                        className={`text-2xs px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border ${badgeClass}`}
                      >
                        {badgeLabel}
                      </span>
                    </div>
                  </th>
                );
              })}
              <th className="p-3 w-28 sm:w-36 text-right font-bold text-slate-900 dark:text-slate-100 bg-slate-100/60 dark:bg-slate-900 truncate">
                Total
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {type === 'CASH_FLOW' ? (
              /* ========================================================================= */
              /* --- FLUXO DE CAJA PROYECTADO --- */
              /* ========================================================================= */
              <>
                {/* 1. Saldo Inicial de Caja */}
                <tr className="bg-slate-50/50 dark:bg-slate-950/60 font-bold border-b border-slate-200 dark:border-slate-800 h-9">
                  <td className="px-3 py-2 border-r border-slate-200 dark:border-slate-800 font-sans text-slate-800 dark:text-slate-200 sticky left-0 bg-slate-50/95 dark:bg-slate-950 z-10 truncate">
                    <div className="flex items-center space-x-1.5">
                      <Building2 className="w-3.5 h-3.5 text-slate-500" />
                      <span>Saldo Inicial de Caja</span>
                    </div>
                  </td>
                  {months.map((m) => (
                    <td
                      key={m.periodId}
                      className="p-2 text-right border-r border-slate-200/60 dark:border-slate-800/60 text-slate-800 dark:text-slate-200 tabular-nums whitespace-nowrap"
                    >
                      {formatCurrency(m.initialCash || 0, baseCurrency)}
                    </td>
                  ))}
                  <td className="p-2 text-right text-slate-500 bg-slate-50/80 dark:bg-slate-900/80">
                    —
                  </td>
                </tr>

                {/* 2. Sección: Ingresos */}
                <tr className="bg-slate-100/70 dark:bg-slate-950 font-bold border-t border-b border-slate-200 dark:border-slate-800">
                  <td
                    colSpan={months.length + 2}
                    onClick={() => toggleSection('income')}
                    className="p-0 font-sans bg-slate-100/90 dark:bg-slate-950 cursor-pointer select-none"
                  >
                    <div className="sticky left-0 px-4 py-2.5 flex items-center space-x-2 w-max">
                      <span className="px-2 py-0.5 rounded-lg text-xs font-bold border bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                        Ingresos
                      </span>
                      <span className="text-slate-400">
                        {collapsedSections.income ? (
                          <ChevronRight className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </span>
                    </div>
                  </td>
                </tr>

                {/* Sub-árbol de Ingresos */}
                {!collapsedSections.income &&
                  accounts
                    .filter((a) => a.accountType === 'INCOME' && a.parentId === null)
                    .map((acc) => renderAccountRow(acc, 'DEFAULT'))}

                {/* 3. Sección: Entradas de Activo / Pasivo */}
                <tr className="bg-slate-100/70 dark:bg-slate-950 font-bold border-t border-b border-slate-200 dark:border-slate-800">
                  <td
                    colSpan={months.length + 2}
                    onClick={() => toggleSection('assetInflow')}
                    className="p-0 font-sans bg-slate-100/90 dark:bg-slate-950 cursor-pointer select-none"
                  >
                    <div className="sticky left-0 px-4 py-2.5 flex items-center space-x-2 w-max">
                      <span className="px-2 py-0.5 rounded-lg text-xs font-bold border bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30">
                        Entradas Activo / Pasivo
                      </span>
                      <span className="text-slate-400">
                        {collapsedSections.assetInflow ? (
                          <ChevronRight className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </span>
                    </div>
                  </td>
                </tr>

                {/* Sub-árbol de Entradas Activo/Pasivo */}
                {!collapsedSections.assetInflow &&
                  accounts
                    .filter(
                      (a) =>
                        (a.accountType === 'ASSET' || a.accountType === 'LIABILITY') &&
                        a.parentId === null &&
                        hasNonZeroFlow(a.accountId, 'CASH_IN'),
                    )
                    .map((acc) => renderAccountRow(acc, 'CASH_IN'))}

                {/* 4. Subtotal: Total Entradas */}
                <tr className="bg-emerald-50/40 dark:bg-emerald-950/20 font-bold border-t border-b border-emerald-200/60 dark:border-emerald-900/60 h-9">
                  <td className="px-3 py-2 border-r border-emerald-200/60 dark:border-emerald-900/60 font-sans text-emerald-800 dark:text-emerald-300 sticky left-0 bg-emerald-50 dark:bg-slate-950 truncate">
                    <div className="flex items-center space-x-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Total Entradas</span>
                    </div>
                  </td>
                  {months.map((m) => (
                    <td
                      key={m.periodId}
                      className="p-2 text-right border-r border-emerald-200/60 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300 tabular-nums whitespace-nowrap"
                    >
                      {formatCurrency(m.totalEntradas || 0, baseCurrency)}
                    </td>
                  ))}
                  <td className="p-2 text-right text-emerald-800 dark:text-emerald-200 bg-emerald-100/40 dark:bg-slate-900 tabular-nums font-extrabold truncate">
                    {formatCurrency(
                      months.reduce((acc, m) => acc + (m.totalEntradas || 0), 0),
                      baseCurrency,
                    )}
                  </td>
                </tr>

                {/* 5. Sección: Egresos */}
                <tr className="bg-slate-100/70 dark:bg-slate-950 font-bold border-t border-b border-slate-200 dark:border-slate-800">
                  <td
                    colSpan={months.length + 2}
                    onClick={() => toggleSection('expenses')}
                    className="p-0 font-sans bg-slate-100/90 dark:bg-slate-950 cursor-pointer select-none"
                  >
                    <div className="sticky left-0 px-4 py-2.5 flex items-center space-x-2 w-max">
                      <span className="px-2 py-0.5 rounded-lg text-xs font-bold border bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30">
                        Egresos
                      </span>
                      <span className="text-slate-400">
                        {collapsedSections.expenses ? (
                          <ChevronRight className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </span>
                    </div>
                  </td>
                </tr>

                {/* Sub-árbol de Gastos */}
                {!collapsedSections.expenses &&
                  accounts
                    .filter((a) => a.accountType === 'EXPENSE' && a.parentId === null)
                    .map((acc) => renderAccountRow(acc, 'DEFAULT'))}

                {/* 6. Sección: Salidas de Activo / Pasivo */}
                <tr className="bg-slate-100/70 dark:bg-slate-950 font-bold border-t border-b border-slate-200 dark:border-slate-800">
                  <td
                    colSpan={months.length + 2}
                    onClick={() => toggleSection('assetOutflow')}
                    className="p-0 font-sans bg-slate-100/90 dark:bg-slate-950 cursor-pointer select-none"
                  >
                    <div className="sticky left-0 px-4 py-2.5 flex items-center space-x-2 w-max">
                      <span className="px-2 py-0.5 rounded-lg text-xs font-bold border bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30">
                        Salidas Activo / Pasivo
                      </span>
                      <span className="text-slate-400">
                        {collapsedSections.assetOutflow ? (
                          <ChevronRight className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </span>
                    </div>
                  </td>
                </tr>

                {/* Sub-árbol de Salidas Activo/Pasivo */}
                {!collapsedSections.assetOutflow &&
                  accounts
                    .filter(
                      (a) =>
                        (a.accountType === 'ASSET' || a.accountType === 'LIABILITY') &&
                        a.parentId === null &&
                        hasNonZeroFlow(a.accountId, 'CASH_OUT'),
                    )
                    .map((acc) => renderAccountRow(acc, 'CASH_OUT'))}

                {/* 7. Subtotal: Total Salidas */}
                <tr className="bg-rose-50/40 dark:bg-rose-950/20 font-bold border-t border-b border-rose-200/60 dark:border-rose-900/60 h-9">
                  <td className="px-3 py-2 border-r border-rose-200/60 dark:border-rose-900/60 font-sans text-rose-800 dark:text-rose-300 sticky left-0 bg-rose-50 dark:bg-slate-950 truncate">
                    <div className="flex items-center space-x-1.5">
                      <TrendingDown className="w-3.5 h-3.5 text-rose-600" />
                      <span>Total Salidas</span>
                    </div>
                  </td>
                  {months.map((m) => (
                    <td
                      key={m.periodId}
                      className="p-2 text-right border-r border-rose-200/60 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 tabular-nums whitespace-nowrap"
                    >
                      {formatCurrency(Math.abs(m.totalSalidas || 0), baseCurrency)}
                    </td>
                  ))}
                  <td className="p-2 text-right text-rose-800 dark:text-rose-200 bg-rose-100/40 dark:bg-slate-900 tabular-nums font-extrabold truncate">
                    {formatCurrency(
                      Math.abs(months.reduce((acc, m) => acc + (m.totalSalidas || 0), 0)),
                      baseCurrency,
                    )}
                  </td>
                </tr>

                {/* 8. Flujo Neto del Período */}
                <tr className="bg-slate-100/60 dark:bg-slate-950/70 font-bold border-t border-b border-slate-300 dark:border-slate-700 h-9">
                  <td className="px-3 py-2 border-r border-slate-200 dark:border-slate-800 font-sans text-slate-900 dark:text-slate-100 sticky left-0 bg-slate-100 dark:bg-slate-950 truncate">
                    <div className="flex items-center space-x-1.5">
                      <Wallet className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Flujo Neto</span>
                    </div>
                  </td>
                  {months.map((m) => {
                    const net = m.netFlow || 0;
                    return (
                      <td
                        key={m.periodId}
                        className={`p-2 text-right border-r border-slate-200 dark:border-slate-800 font-bold tabular-nums whitespace-nowrap ${
                          net >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {net > 0 ? '+' : ''}
                        {formatCurrency(net, baseCurrency)}
                      </td>
                    );
                  })}
                  <td className="p-2 text-right font-extrabold text-slate-900 dark:text-slate-100 bg-slate-200/40 dark:bg-slate-950 tabular-nums truncate">
                    {formatCurrency(
                      months.reduce((acc, m) => acc + (m.netFlow || 0), 0),
                      baseCurrency,
                    )}
                  </td>
                </tr>

                {/* 9. SALDO FINAL DE CAJA */}
                <tr className="bg-indigo-50/70 dark:bg-indigo-950/40 font-extrabold border-t-2 border-indigo-200 dark:border-indigo-800 h-10">
                  <td className="px-3 py-2 border-r border-indigo-200 dark:border-indigo-800 font-sans text-indigo-900 dark:text-indigo-200 sticky left-0 bg-indigo-50 dark:bg-slate-950 truncate">
                    <div className="flex items-center space-x-1.5">
                      <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      <span className="tracking-tight">SALDO FINAL DE CAJA</span>
                    </div>
                  </td>
                  {months.map((m) => {
                    const final = m.finalCash || 0;
                    return (
                      <td
                        key={m.periodId}
                        className={`p-2 text-right border-r border-indigo-200 dark:border-indigo-800 font-bold text-xs tabular-nums whitespace-nowrap ${
                          final >= 0
                            ? 'text-indigo-950 dark:text-indigo-100'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {formatCurrency(final, baseCurrency)}
                      </td>
                    );
                  })}
                  <td className="p-2 text-right font-black text-indigo-950 dark:text-indigo-100 bg-indigo-100/60 dark:bg-indigo-900/60 tabular-nums truncate">
                    {months.length > 0
                      ? formatCurrency(months[months.length - 1].finalCash || 0, baseCurrency)
                      : '—'}
                  </td>
                </tr>
              </>
            ) : (
              /* ========================================================================= */
              /* --- ESTADO DE RESULTADOS (P&L) PROYECTADO --- */
              /* ========================================================================= */
              <>
                {/* 1. Sección: Ingresos */}
                <tr className="bg-slate-100/70 dark:bg-slate-950 font-bold border-t border-b border-slate-200 dark:border-slate-800">
                  <td
                    colSpan={months.length + 2}
                    onClick={() => toggleSection('income')}
                    className="p-0 font-sans bg-slate-100/90 dark:bg-slate-950 cursor-pointer select-none"
                  >
                    <div className="sticky left-0 px-4 py-2.5 flex items-center space-x-2 w-max">
                      <span className="px-2 py-0.5 rounded-lg text-xs font-bold border bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                        Ingresos
                      </span>
                      <span className="text-slate-400">
                        {collapsedSections.income ? (
                          <ChevronRight className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </span>
                    </div>
                  </td>
                </tr>

                {/* Sub-árbol de Ingresos */}
                {!collapsedSections.income &&
                  accounts
                    .filter((a) => a.accountType === 'INCOME' && a.parentId === null)
                    .map((acc) => renderAccountRow(acc, 'DEFAULT'))}

                {/* Subtotal Ingresos */}
                <tr className="bg-emerald-50/40 dark:bg-emerald-950/20 font-bold border-t border-b border-emerald-200/60 dark:border-emerald-900/60 h-9">
                  <td className="px-3 py-2 border-r border-emerald-200/60 dark:border-emerald-900/60 font-sans text-emerald-800 dark:text-emerald-300 sticky left-0 bg-emerald-50 dark:bg-slate-950 truncate">
                    <div className="flex items-center space-x-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Total Ingresos</span>
                    </div>
                  </td>
                  {months.map((m) => (
                    <td
                      key={m.periodId}
                      className="p-2 text-right border-r border-emerald-200/60 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300 tabular-nums whitespace-nowrap"
                    >
                      {formatCurrency(m.income || 0, baseCurrency)}
                    </td>
                  ))}
                  <td className="p-2 text-right text-emerald-800 dark:text-emerald-200 bg-emerald-100/40 dark:bg-slate-900 tabular-nums font-extrabold truncate">
                    {formatCurrency(
                      months.reduce((acc, m) => acc + (m.income || 0), 0),
                      baseCurrency,
                    )}
                  </td>
                </tr>

                {/* 2. Sección: Gastos */}
                <tr className="bg-slate-100/70 dark:bg-slate-950 font-bold border-t border-b border-slate-200 dark:border-slate-800">
                  <td
                    colSpan={months.length + 2}
                    onClick={() => toggleSection('expenses')}
                    className="p-0 font-sans bg-slate-100/90 dark:bg-slate-950 cursor-pointer select-none"
                  >
                    <div className="sticky left-0 px-4 py-2.5 flex items-center space-x-2 w-max">
                      <span className="px-2 py-0.5 rounded-lg text-xs font-bold border bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30">
                        Gastos
                      </span>
                      <span className="text-slate-400">
                        {collapsedSections.expenses ? (
                          <ChevronRight className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </span>
                    </div>
                  </td>
                </tr>

                {/* Sub-árbol de Gastos */}
                {!collapsedSections.expenses &&
                  accounts
                    .filter((a) => a.accountType === 'EXPENSE' && a.parentId === null)
                    .map((acc) => renderAccountRow(acc, 'DEFAULT'))}

                {/* Subtotal Gastos */}
                <tr className="bg-rose-50/40 dark:bg-rose-950/20 font-bold border-t border-b border-rose-200/60 dark:border-rose-900/60 h-9">
                  <td className="px-3 py-2 border-r border-rose-200/60 dark:border-rose-900/60 font-sans text-rose-800 dark:text-rose-300 sticky left-0 bg-rose-50 dark:bg-slate-950 truncate">
                    <div className="flex items-center space-x-1.5">
                      <TrendingDown className="w-3.5 h-3.5 text-rose-600" />
                      <span>Total Gastos</span>
                    </div>
                  </td>
                  {months.map((m) => (
                    <td
                      key={m.periodId}
                      className="p-2 text-right border-r border-rose-200/60 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 tabular-nums whitespace-nowrap"
                    >
                      {formatCurrency(Math.abs(m.expense || 0), baseCurrency)}
                    </td>
                  ))}
                  <td className="p-2 text-right text-rose-800 dark:text-rose-200 bg-rose-100/40 dark:bg-slate-900 tabular-nums font-extrabold truncate">
                    {formatCurrency(
                      Math.abs(months.reduce((acc, m) => acc + (m.expense || 0), 0)),
                      baseCurrency,
                    )}
                  </td>
                </tr>

                {/* 3. RESULTADO NETO (P&L) */}
                <tr className="bg-indigo-50/70 dark:bg-indigo-950/40 font-extrabold border-t-2 border-indigo-200 dark:border-indigo-800 h-10">
                  <td className="px-3 py-2 border-r border-indigo-200 dark:border-indigo-800 font-sans text-indigo-900 dark:text-indigo-200 sticky left-0 bg-indigo-50 dark:bg-slate-950 truncate">
                    <div className="flex items-center space-x-1.5">
                      <Wallet className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      <span className="tracking-tight">Resultado Neto (P&L)</span>
                    </div>
                  </td>
                  {months.map((m) => {
                    const net = m.netProfit || 0;
                    return (
                      <td
                        key={m.periodId}
                        className={`p-2 text-right border-r border-indigo-200 dark:border-indigo-800 font-bold text-xs tabular-nums whitespace-nowrap ${
                          net >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {formatCurrency(net, baseCurrency)}
                      </td>
                    );
                  })}
                  <td className="p-2 text-right font-black text-indigo-950 dark:text-indigo-100 bg-indigo-100/60 dark:bg-indigo-900/60 tabular-nums truncate">
                    {formatCurrency(
                      months.reduce((acc, m) => acc + (m.netProfit || 0), 0),
                      baseCurrency,
                    )}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
