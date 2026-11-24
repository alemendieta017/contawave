'use client';

import React, { useEffect, useState } from 'react';
import { AccountType } from '@sistema-contable/shared';
import { cn, type CurrencyInfo } from '../../lib/utils';
import type { AccountOption } from '../../types/account';
import AccountPickerSheet from '../transactions/AccountPickerSheet';
import {
  LoanColumnFillMode,
  formatAmountInput,
  normalizeAmountInput,
  parseNumericInput,
  pickSuggestedExpenseAccount,
} from './loan-ui';

export interface DraftLoanColumn {
  id?: string;
  clientKey: string;
  name: string;
  expenseAccountId: string;
  isActive: boolean;
  locked: boolean;
  hasAllocations: boolean;
  rule: 'CALC' | LoanColumnFillMode;
  ruleVal: number;
  refColKey: string;
}

interface LoanColumnDrawerProps {
  isOpen: boolean;
  isEditMode: boolean;
  columns: DraftLoanColumn[];
  accounts: AccountOption[];
  currency: CurrencyInfo;
  onClose: () => void;
  onApply: (col: {
    name: string;
    expenseAccountId: string;
    mode: LoanColumnFillMode;
    value: number;
    refColKey: string;
  }) => void;
  onQuickCreateExpense: (
    initialName: string,
    suggestedType?: AccountType,
    callback?: (createdAccountId: string) => void,
  ) => void;
}

export default function LoanColumnDrawer({
  isOpen,
  isEditMode,
  columns,
  accounts,
  currency,
  onClose,
  onApply,
  onQuickCreateExpense,
}: LoanColumnDrawerProps) {
  const decimals = currency.decimalPlaces ?? 0;
  const symbol = currency.symbol || '₲';

  const activeColumns = columns.filter((c) => c.isActive);
  const interestCol = activeColumns.find((c) => c.locked) || activeColumns[0];
  const insuranceCol = activeColumns.find((c) => c.name.toLowerCase().includes('seguro'));

  const [colName, setColName] = useState(isEditMode ? 'IVA s/ Interés' : 'Seguro de Vida');
  const [expenseAccountId, setExpenseAccountId] = useState('');
  const [mode, setMode] = useState<LoanColumnFillMode>(isEditMode ? 'PCT_COL' : 'FIXED');
  const [refColKey, setRefColKey] = useState(interestCol?.clientKey || 'interest');
  const [fixedInput, setFixedInput] = useState(isEditMode ? '' : '45000');
  const [pctInput, setPctInput] = useState(isEditMode ? '10' : '0.12');

  useEffect(() => {
    if (!isOpen) return;
    const defaultName = isEditMode ? 'IVA s/ Interés' : 'Seguro de Vida';
    setColName(defaultName);
    setMode(isEditMode ? 'PCT_COL' : 'FIXED');
    setRefColKey(interestCol?.clientKey || activeColumns[0]?.clientKey || 'interest');
    setFixedInput(isEditMode ? '' : '45000');
    setPctInput(isEditMode ? '10' : '0.12');
    const suggested = pickSuggestedExpenseAccount(accounts, defaultName);
    if (suggested) {
      setExpenseAccountId(suggested.id);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!expenseAccountId && accounts.length > 0) {
      const suggested = pickSuggestedExpenseAccount(accounts, colName);
      if (suggested) setExpenseAccountId(suggested.id);
    }
  }, [accounts, colName, expenseAccountId]);

  if (!isOpen) return null;

  const applyPreset = (
    presetName: string,
    presetMode: LoanColumnFillMode,
    presetVal: string,
    preferredRefKey?: string,
  ) => {
    setColName(presetName);
    setMode(presetMode);
    if (preferredRefKey) {
      setRefColKey(preferredRefKey);
    }
    if (presetMode === 'FIXED') {
      setFixedInput(presetVal);
    } else if (presetMode !== 'ZERO') {
      setPctInput(presetVal);
    }
    const suggested = pickSuggestedExpenseAccount(accounts, presetName);
    if (suggested) {
      setExpenseAccountId(suggested.id);
    }
  };

  const handleSubmit = () => {
    const trimmedName = colName.trim() || 'Cargo Extra';
    const fallbackExp = expenseAccountId || pickSuggestedExpenseAccount(accounts, trimmedName)?.id;
    if (!fallbackExp) return;

    const numericVal =
      mode === 'ZERO'
        ? 0
        : mode === 'FIXED'
          ? parseNumericInput(fixedInput, decimals)
          : parseFloat(String(pctInput).replace(',', '.')) || 0;

    onApply({
      name: trimmedName,
      expenseAccountId: fallbackExp,
      mode,
      value: numericVal,
      refColKey: refColKey || activeColumns[0]?.clientKey || 'interest',
    });
  };

  return (
    <div className="mb-4 p-4 rounded-2xl bg-card-tint border border-border space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-foreground">
          {isEditMode ? 'Agregar columna a cuotas pendientes' : 'Agregar columna al plan'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cerrar
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-bold text-foreground mb-1.5" htmlFor="loan-col-name">
            Nombre de la columna
          </label>
          <input
            id="loan-col-name"
            type="text"
            value={colName}
            onChange={(e) => setColName(e.target.value)}
            placeholder="Ej. Seguro, IVA s/ Seguro, etc."
            className="w-full min-h-11 px-3 py-2 rounded-xl border border-input bg-card text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div>
          <AccountPickerSheet
            label="Categoría de gasto *"
            accounts={accounts}
            selectedAccountId={expenseAccountId}
            onSelect={(acc) => setExpenseAccountId(acc.id)}
            filterMode="EXPENSES"
            prioritizeFinancialExpenses={true}
            baseCurrency={currency}
            placeholder="Seleccionar categoría de gasto..."
            onQuickCreateAccount={(initialName, suggestedType) =>
              onQuickCreateExpense(initialName, suggestedType, (newId) =>
                setExpenseAccountId(newId),
              )
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-card border border-border items-end">
        <div>
          <label className="block text-xs font-bold text-foreground mb-1.5" htmlFor="loan-col-mode">
            Cómo autorellenar
          </label>
          <select
            id="loan-col-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as LoanColumnFillMode)}
            className="w-full min-h-11 px-3 py-2 rounded-xl border border-input bg-card text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="ZERO">En blanco ({symbol} 0 para editar a mano)</option>
            <option value="FIXED">
              {isEditMode
                ? `Monto fijo en pendientes (${symbol})`
                : `Monto fijo en todas (${symbol})`}
            </option>
            <option value="PCT_CAPITAL">% sobre capital pendiente</option>
            <option value="PCT_COL">% sobre otra columna</option>
          </select>
        </div>

        <div>
          <label
            className="block text-xs font-bold text-foreground mb-1.5"
            htmlFor="loan-col-value"
          >
            {mode === 'ZERO'
              ? 'Valor inicial'
              : mode === 'FIXED'
                ? `Monto fijo por cuota (${symbol})`
                : mode === 'PCT_CAPITAL'
                  ? 'Porcentaje (%) sobre capital'
                  : 'Columna base y porcentaje (%)'}
          </label>

          {mode === 'ZERO' ? (
            <div className="min-h-11 px-3 rounded-xl border border-dashed border-border bg-muted/40 text-xs text-muted-foreground flex items-center">
              Se agregará en {symbol} 0 para editar a mano
            </div>
          ) : mode === 'FIXED' ? (
            <input
              id="loan-col-value"
              type="text"
              inputMode={decimals === 0 ? 'numeric' : 'decimal'}
              value={formatAmountInput(fixedInput, decimals)}
              onChange={(e) => setFixedInput(normalizeAmountInput(e.target.value, decimals))}
              className="w-full min-h-11 px-3 py-2 rounded-xl border border-input bg-card text-sm text-right font-bold tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : mode === 'PCT_CAPITAL' ? (
            <input
              id="loan-col-value"
              type="text"
              inputMode="decimal"
              value={pctInput}
              onChange={(e) => setPctInput(e.target.value)}
              placeholder="Ej. 0.12"
              className="w-full min-h-11 px-3 py-2 rounded-xl border border-input bg-card text-sm text-right font-bold tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : (
            <div className="flex items-center gap-2">
              <select
                aria-label="Columna base"
                value={refColKey}
                onChange={(e) => setRefColKey(e.target.value)}
                className="flex-1 min-w-0 min-h-11 px-3 py-2 rounded-xl border border-input bg-card text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {activeColumns.map((col) => (
                  <option key={col.clientKey} value={col.clientKey}>
                    s/ {col.name}
                  </option>
                ))}
              </select>
              <input
                id="loan-col-value"
                type="text"
                inputMode="decimal"
                value={pctInput}
                onChange={(e) => setPctInput(e.target.value)}
                className="w-24 shrink-0 min-h-11 px-3 py-2 rounded-xl border border-input bg-card text-sm text-right font-bold tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Atajos sugeridos:</span>
        <button
          type="button"
          onClick={() => applyPreset('Seguro de Vida', 'PCT_CAPITAL', '0.12')}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-indigo-400 bg-card text-xs font-semibold text-foreground hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:border-indigo-500 cursor-pointer transition',
          )}
        >
          Seguro de vida (% s/ capital)
        </button>
        {interestCol && (
          <button
            type="button"
            onClick={() => applyPreset('IVA s/ Interés', 'PCT_COL', '10', interestCol.clientKey)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-indigo-400 bg-card text-xs font-semibold text-foreground hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:border-indigo-500 cursor-pointer transition"
          >
            IVA 10% s/ interés
          </button>
        )}
        {insuranceCol && (
          <button
            type="button"
            onClick={() => applyPreset('IVA s/ Seguro', 'PCT_COL', '10', insuranceCol.clientKey)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-indigo-400 bg-card text-xs font-semibold text-foreground hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:border-indigo-500 cursor-pointer transition"
          >
            IVA 10% s/ Seguro
          </button>
        )}
        <button
          type="button"
          onClick={() => applyPreset('Gastos Adm.', 'FIXED', '25000')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-indigo-400 bg-card text-xs font-semibold text-foreground hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:border-indigo-500 cursor-pointer transition"
        >
          Gasto fijo mensual
        </button>
        <button
          type="button"
          onClick={() => applyPreset('Otro cargo', 'ZERO', '0')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-indigo-400 bg-card text-xs font-semibold text-foreground hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:border-indigo-500 cursor-pointer transition"
        >
          En blanco (a mano)
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-border">
        <span className="text-xs text-muted-foreground">
          {isEditMode
            ? 'Solo se agrega sobre las cuotas pendientes; tus cuotas ya pagadas quedan intactas.'
            : 'Nombrala como te cobre tu banco. Después podés ajustar cualquier celda manualmente.'}
        </span>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!expenseAccountId && !pickSuggestedExpenseAccount(accounts, colName)}
          className="px-4 py-2.5 min-h-11 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
        >
          Aplicar columna
        </button>
      </div>
    </div>
  );
}
