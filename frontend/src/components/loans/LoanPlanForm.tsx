'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AccountType,
  LoanCapitalAdjustmentType,
  LoanDto,
  LoanInstallmentStatus,
  LoanOpeningMode,
} from '@sistema-contable/shared';
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  Landmark,
  Lock,
  Plus,
  RotateCcw,
  Tag,
  Undo2,
  Wallet,
  X,
} from 'lucide-react';
import { cn, formatCurrency, type CurrencyInfo } from '../../lib/utils';
import { api } from '../../services/api';
import type { AccountOption } from '../../types/account';
import AccountPickerSheet from '../transactions/AccountPickerSheet';
import AccountModal from '../AccountModal';
import LoanColumnDrawer, { DraftLoanColumn } from './LoanColumnDrawer';
import LoanToast, { LoanToastData } from './LoanToast';
import {
  LoanColumnFillMode,
  addMonthsIso,
  calculateClientFrenchSchedule,
  computeColumnFillAmount,
  formatAmountInput,
  formatLoanShortDate,
  getTodayLocalIso,
  normalizeAmountInput,
  parseNumericInput,
  pickDefaultInterestExpenseAccount,
  resolveLiabilityAccountPreview,
  roundToCurrencyDecimals,
} from './loan-ui';

export interface CurrencyItem extends CurrencyInfo {
  id: string;
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
  isBase?: boolean;
}

interface DraftLoanRow {
  id?: string;
  clientRowKey: string;
  installmentNumber: number;
  dueDate: string;
  principalAmount: number;
  charges: Record<string, number>;
  paidPrincipal: number;
  paidCharges: Record<string, number>;
  isPaid: boolean;
  isPartial: boolean;
  hasAllocations: boolean;
  status: LoanInstallmentStatus;
}

interface CalculatorSnapshot {
  principal: number;
  rate: number;
  count: number;
  date: string;
  startNum: number;
  mode: LoanOpeningMode;
}

interface EditUndoSnapshot {
  columns: DraftLoanColumn[];
  rows: DraftLoanRow[];
  annualRate: number;
  lastCalc: CalculatorSnapshot;
}

interface CreateUndoSnapshot {
  rows: DraftLoanRow[];
  lastCalc: CalculatorSnapshot;
  manuallyEdited: boolean;
}

interface LoanPlanFormProps {
  mode: 'create' | 'edit';
  initialLoan?: LoanDto;
  accounts: AccountOption[];
  currencies: CurrencyItem[];
  onAccountsChanged?: (accounts: AccountOption[]) => void;
}

function buildInitialCreateData(
  accounts: AccountOption[],
  currencies: CurrencyItem[],
): {
  currencyId: string;
  currency: CurrencyItem;
  disbursementId: string;
  columns: DraftLoanColumn[];
  rows: DraftLoanRow[];
  calcSnapshot: CalculatorSnapshot;
} {
  const baseCur = currencies.find((c) => c.isBase) ||
    currencies[0] || {
      id: '',
      code: 'PYG',
      name: 'Guaraní Paraguayo',
      symbol: '₲',
      decimalPlaces: 0,
      isBase: true,
    };

  const firstBank = accounts.find(
    (a) => a.status !== 'INACTIVE' && a.isCashOrBank && !a.isControlAccount,
  );
  const interestExp = pickDefaultInterestExpenseAccount(accounts);
  const defaultPrincipal = baseCur.decimalPlaces === 0 ? 12000000 : 10000;
  const firstDueDate = addMonthsIso(getTodayLocalIso(), 1);

  const columns: DraftLoanColumn[] = [
    {
      clientKey: 'interest',
      name: 'Interés',
      expenseAccountId: interestExp?.id || '',
      isActive: true,
      locked: true,
      hasAllocations: false,
      rule: 'CALC',
      ruleVal: 0,
      refColKey: '',
    },
  ];

  const schedule = calculateClientFrenchSchedule({
    principal: defaultPrincipal,
    annualRate: 13.5,
    count: 12,
    firstDueDate,
    startInstallmentNumber: 1,
    decimalPlaces: baseCur.decimalPlaces,
  });

  const rows: DraftLoanRow[] = schedule.map((r) => ({
    clientRowKey: `new_${r.installmentNumber}`,
    installmentNumber: r.installmentNumber,
    dueDate: r.dueDate,
    principalAmount: r.principalAmount,
    charges: { interest: r.interestAmount },
    paidPrincipal: 0,
    paidCharges: {},
    isPaid: false,
    isPartial: false,
    hasAllocations: false,
    status: 'PENDING',
  }));

  return {
    currencyId: baseCur.id,
    currency: baseCur,
    disbursementId: firstBank?.id || '',
    columns,
    rows,
    calcSnapshot: {
      principal: defaultPrincipal,
      rate: 13.5,
      count: 12,
      date: firstDueDate,
      startNum: 1,
      mode: 'NEW',
    },
  };
}

function buildInitialEditData(loan: LoanDto): {
  columns: DraftLoanColumn[];
  rows: DraftLoanRow[];
  calcSnapshot: CalculatorSnapshot;
  baselineMetrics: {
    pendingPrincipal: number;
    avgPmt: number;
    totalAllCharges: number;
    pendingCount: number;
    paidCount: number;
  };
} {
  const columns: DraftLoanColumn[] = loan.chargeColumns.map((col, idx) => ({
    id: col.id,
    clientKey: col.id,
    name: col.name,
    expenseAccountId: col.expenseAccountId,
    isActive: col.isActive,
    locked: idx === 0,
    hasAllocations: col.hasAllocations,
    rule: idx === 0 ? 'CALC' : 'FIXED',
    ruleVal: 0,
    refColKey: '',
  }));

  const rows: DraftLoanRow[] = loan.installments.map((inst) => ({
    id: inst.id,
    clientRowKey: inst.id,
    installmentNumber: inst.installmentNumber,
    dueDate: inst.dueDate,
    principalAmount: inst.principalAmount,
    charges: { ...inst.charges },
    paidPrincipal: inst.paidPrincipal,
    paidCharges: { ...inst.paidCharges },
    isPaid: inst.status === 'PAID',
    isPartial: inst.status === 'PARTIAL',
    hasAllocations: inst.allocations.length > 0,
    status: inst.status,
  }));

  const pendingRows = rows.filter((r) => !r.isPaid);
  const paidRows = rows.filter((r) => r.isPaid);
  const activeCols = columns.filter((c) => c.isActive);

  let pendingPrincipalSum = 0;
  let totalPendPmtSum = 0;
  let totalPendCharges = 0;

  for (const r of pendingRows) {
    const pendCap = Math.max(0, r.principalAmount - r.paidPrincipal);
    pendingPrincipalSum += pendCap;
    let rowPendCharges = 0;
    for (const c of activeCols) {
      const chPend = Math.max(0, (r.charges[c.clientKey] || 0) - (r.paidCharges[c.clientKey] || 0));
      rowPendCharges += chPend;
    }
    totalPendCharges += rowPendCharges;
    totalPendPmtSum += pendCap + rowPendCharges;
  }

  const nextDue = loan.nextDueDate || pendingRows[0]?.dueDate || getTodayLocalIso();
  const decimals = loan.decimalPlaces ?? 0;

  return {
    columns,
    rows,
    calcSnapshot: {
      principal: roundToCurrencyDecimals(pendingPrincipalSum, decimals),
      rate: loan.annualRate,
      count: Math.max(1, pendingRows.length),
      date: nextDue,
      startNum: pendingRows[0]?.installmentNumber || paidRows.length + 1,
      mode: 'NEW',
    },
    baselineMetrics: {
      pendingPrincipal: roundToCurrencyDecimals(pendingPrincipalSum, decimals),
      avgPmt: pendingRows.length ? Math.round(totalPendPmtSum / pendingRows.length) : 0,
      totalAllCharges: roundToCurrencyDecimals(totalPendCharges, decimals),
      pendingCount: pendingRows.length,
      paidCount: paidRows.length,
    },
  };
}

export default function LoanPlanForm({
  mode,
  initialLoan,
  accounts,
  currencies,
  onAccountsChanged,
}: LoanPlanFormProps) {
  const router = useRouter();
  const isEdit = mode === 'edit' && Boolean(initialLoan);

  const createInit = useMemo(
    () => (isEdit ? null : buildInitialCreateData(accounts, currencies)),
    [],
  );
  const editInit = useMemo(
    () => (isEdit && initialLoan ? buildInitialEditData(initialLoan) : null),
    [initialLoan?.id],
  );

  const [localAccounts, setLocalAccounts] = useState<AccountOption[]>(accounts);
  useEffect(() => {
    setLocalAccounts(accounts);
  }, [accounts]);

  // Step 1 Metadata State
  const [name, setName] = useState(isEdit && initialLoan ? initialLoan.name : '');
  const [currencyId, setCurrencyId] = useState(
    isEdit && initialLoan ? initialLoan.currencyId : createInit?.currencyId || '',
  );
  const [openingMode, setOpeningMode] = useState<LoanOpeningMode>('NEW');
  const [openingDate, setOpeningDate] = useState(
    isEdit && initialLoan ? initialLoan.openingDate : getTodayLocalIso(),
  );
  const [disbursementAccountId, setDisbursementAccountId] = useState(
    createInit?.disbursementId || '',
  );
  const [defaultPaymentAccountId, setDefaultPaymentAccountId] = useState(
    isEdit && initialLoan
      ? initialLoan.defaultPaymentAccountId || ''
      : createInit?.disbursementId || '',
  );

  // Calculator State
  const initCalc = isEdit ? editInit!.calcSnapshot : createInit!.calcSnapshot;
  const [calcPrincipalRaw, setCalcPrincipalRaw] = useState(String(initCalc.principal));
  const [calcRateRaw, setCalcRateRaw] = useState(String(initCalc.rate));
  const [calcCountRaw, setCalcCountRaw] = useState(String(initCalc.count));
  const [calcDate, setCalcDate] = useState(initCalc.date);
  const [calcStartNum, setCalcStartNum] = useState(initCalc.startNum);
  const [lastAppliedCalc, setLastAppliedCalc] = useState<CalculatorSnapshot>(initCalc);

  // Columns & Rows State
  const [columns, setColumns] = useState<DraftLoanColumn[]>(
    isEdit ? editInit!.columns : createInit!.columns,
  );
  const [rows, setRows] = useState<DraftLoanRow[]>(isEdit ? editInit!.rows : createInit!.rows);
  const [tableManuallyEdited, setTableManuallyEdited] = useState(false);

  // Edit-specific filter & reconciliation state
  const [editRowFilter, setEditRowFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const [adjType, setAdjType] = useState<LoanCapitalAdjustmentType>('CASH_TRANSFER');
  const [adjCashAccountId, setAdjCashAccountId] = useState(() => {
    if (initialLoan?.defaultPaymentAccountId) return initialLoan.defaultPaymentAccountId;
    return (
      accounts.find((a) => a.status !== 'INACTIVE' && a.isCashOrBank && !a.isControlAccount)?.id ||
      ''
    );
  });
  const [adjCategoryAccountId, setAdjCategoryAccountId] = useState('');
  const [adjDate, setAdjDate] = useState(getTodayLocalIso());

  // Undo & UI helpers
  const [addColOpen, setAddColOpen] = useState(false);
  const [createUndoSnapshot, setCreateUndoSnapshot] = useState<CreateUndoSnapshot | null>(null);
  const [editUndoSnapshot, setEditUndoSnapshot] = useState<EditUndoSnapshot | null>(null);
  const [toast, setToast] = useState<LoanToastData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Quick account creation modal state
  const [quickCreateState, setQuickCreateState] = useState<{
    initialName: string;
    initialType: AccountType;
    isCashOrBank: boolean;
    onCreated: (createdId: string) => void;
  } | null>(null);

  const showToast = useCallback((message: string, onUndo?: () => void) => {
    setToast({ id: Date.now(), message, onUndo });
  }, []);

  // Ensure default interest expense account gets populated if accounts loaded asynchronously
  useEffect(() => {
    if (isEdit) return;
    setColumns((prev) =>
      prev.map((col) => {
        if (col.clientKey === 'interest' && !col.expenseAccountId) {
          const def = pickDefaultInterestExpenseAccount(localAccounts);
          if (def) return { ...col, expenseAccountId: def.id };
        }
        return col;
      }),
    );
    if (!disbursementAccountId) {
      const firstLiquid = localAccounts.find(
        (a) => a.status !== 'INACTIVE' && a.isCashOrBank && !a.isControlAccount,
      );
      if (firstLiquid) {
        setDisbursementAccountId(firstLiquid.id);
        setDefaultPaymentAccountId((prev) => prev || firstLiquid.id);
      }
    }
  }, [isEdit, localAccounts, disbursementAccountId]);

  const activeCurrency: CurrencyInfo = useMemo(() => {
    if (isEdit && initialLoan) {
      return {
        code: initialLoan.currencyCode,
        symbol: initialLoan.currencySymbol,
        decimalPlaces: initialLoan.decimalPlaces,
      };
    }
    const found = currencies.find((c) => c.id === currencyId) || currencies.find((c) => c.isBase);
    return (
      found || {
        code: 'PYG',
        symbol: '₲',
        decimalPlaces: 0,
      }
    );
  }, [isEdit, initialLoan, currencies, currencyId]);

  const decimals = activeCurrency.decimalPlaces ?? 0;

  const currentCalcParams = useMemo<CalculatorSnapshot>(() => {
    const countNum = Math.max(1, Math.min(240, parseInt(calcCountRaw || '1', 10) || 1));
    const rateNum = Math.max(0, parseFloat(String(calcRateRaw).replace(',', '.')) || 0);
    const principalNum = parseNumericInput(calcPrincipalRaw, decimals);
    const safeStart =
      !isEdit && openingMode === 'ONGOING' ? Math.max(1, Math.min(countNum, calcStartNum)) : 1;
    return {
      principal: principalNum,
      rate: rateNum,
      count: countNum,
      date: calcDate || getTodayLocalIso(),
      startNum: safeStart,
      mode: openingMode,
    };
  }, [
    calcPrincipalRaw,
    calcRateRaw,
    calcCountRaw,
    calcDate,
    calcStartNum,
    decimals,
    isEdit,
    openingMode,
  ]);

  const isCalcPending = useMemo(() => {
    return (
      currentCalcParams.principal !== lastAppliedCalc.principal ||
      currentCalcParams.rate !== lastAppliedCalc.rate ||
      currentCalcParams.count !== lastAppliedCalc.count ||
      currentCalcParams.date !== lastAppliedCalc.date ||
      currentCalcParams.startNum !== lastAppliedCalc.startNum ||
      (!isEdit && currentCalcParams.mode !== lastAppliedCalc.mode)
    );
  }, [currentCalcParams, lastAppliedCalc, isEdit]);

  const isEditCalcStructuralPending = useMemo(() => {
    if (!isEdit) return isCalcPending;
    return (
      currentCalcParams.principal !== lastAppliedCalc.principal ||
      currentCalcParams.count !== lastAppliedCalc.count ||
      currentCalcParams.date !== lastAppliedCalc.date
    );
  }, [isEdit, isCalcPending, currentCalcParams, lastAppliedCalc]);

  const runCreateScheduleRecalc = useCallback(
    (params: CalculatorSnapshot, targetCols: DraftLoanColumn[], curDecimals: number) => {
      const schedule = calculateClientFrenchSchedule({
        principal: Math.max(1, params.principal),
        annualRate: params.rate,
        count: params.count,
        firstDueDate: params.date,
        startInstallmentNumber: 1,
        decimalPlaces: curDecimals,
      });

      const filtered =
        params.mode === 'ONGOING'
          ? schedule.filter((r) => r.installmentNumber >= params.startNum)
          : schedule;

      const rebuiltRows: DraftLoanRow[] = filtered.map((r) => {
        const charges: Record<string, number> = { interest: r.interestAmount };
        for (const col of targetCols) {
          if (col.clientKey !== 'interest' && col.isActive) {
            const ruleMode: LoanColumnFillMode = col.rule === 'CALC' ? 'ZERO' : col.rule;
            charges[col.clientKey] = computeColumnFillAmount(
              ruleMode,
              col.ruleVal,
              col.refColKey,
              r.balanceBefore,
              charges,
              curDecimals,
            );
          }
        }
        return {
          clientRowKey: `new_${r.installmentNumber}_${Date.now()}`,
          installmentNumber: r.installmentNumber,
          dueDate: r.dueDate,
          principalAmount: r.principalAmount,
          charges,
          paidPrincipal: 0,
          paidCharges: {},
          isPaid: false,
          isPartial: false,
          hasAllocations: false,
          status: 'PENDING',
        };
      });

      setRows(rebuiltRows);
      setLastAppliedCalc(params);
      setTableManuallyEdited(false);
    },
    [],
  );

  const handleModeSwitch = (nextMode: LoanOpeningMode) => {
    if (isEdit || openingMode === nextMode) return;
    setOpeningMode(nextMode);
    const nextParams: CalculatorSnapshot = {
      ...currentCalcParams,
      mode: nextMode,
      startNum:
        nextMode === 'ONGOING' ? Math.max(1, Math.min(currentCalcParams.count, calcStartNum)) : 1,
    };
    if (!tableManuallyEdited) {
      runCreateScheduleRecalc(nextParams, columns, decimals);
    }
  };

  const handleApplyCalculator = () => {
    if (currentCalcParams.principal <= 0) {
      setError('El capital de la calculadora debe ser mayor a 0.');
      return;
    }
    setError('');

    if (!isEdit) {
      const snap: CreateUndoSnapshot = {
        rows: JSON.parse(JSON.stringify(rows)),
        lastCalc: { ...lastAppliedCalc },
        manuallyEdited: tableManuallyEdited,
      };
      setCreateUndoSnapshot(snap);
      runCreateScheduleRecalc(currentCalcParams, columns, decimals);
      showToast('Tabla recalculada desde la calculadora.', () => {
        setRows(snap.rows);
        setLastAppliedCalc(snap.lastCalc);
        setTableManuallyEdited(snap.manuallyEdited);
        setCreateUndoSnapshot(null);
        showToast('Se restauró la tabla anterior.');
      });
      return;
    }

    // Edit mode: preserve PAID rows & PARTIAL allocations cleanly
    const snap: EditUndoSnapshot = {
      columns: JSON.parse(JSON.stringify(columns)),
      rows: JSON.parse(JSON.stringify(rows)),
      annualRate: parseFloat(String(calcRateRaw).replace(',', '.')) || 0,
      lastCalc: { ...lastAppliedCalc },
    };
    setEditUndoSnapshot(snap);

    const paidRows = rows.filter((r) => r.isPaid);
    const existingPendingRows = rows.filter((r) => !r.isPaid);
    const partialRows = existingPendingRows.filter((r) => r.hasAllocations);
    const effectiveCount = Math.max(partialRows.length || 1, currentCalcParams.count);
    const nextStartNum = (paidRows[paidRows.length - 1]?.installmentNumber || 0) + 1;

    const schedule = calculateClientFrenchSchedule({
      principal: Math.max(1, currentCalcParams.principal),
      annualRate: currentCalcParams.rate,
      count: effectiveCount,
      firstDueDate: currentCalcParams.date,
      startInstallmentNumber: nextStartNum,
      decimalPlaces: decimals,
    });

    const interestCol = columns.find((c) => c.locked) || columns[0];
    const newPendingRows: DraftLoanRow[] = schedule.map((sched, i) => {
      const preserved = i < partialRows.length ? partialRows[i] : null;
      const charges: Record<string, number> = {};
      if (interestCol) {
        charges[interestCol.clientKey] = sched.interestAmount;
      }
      for (const col of columns) {
        if (!col.isActive) {
          charges[col.clientKey] = 0;
          continue;
        }
        if (interestCol && col.clientKey === interestCol.clientKey) continue;
        const ruleMode: LoanColumnFillMode = col.rule === 'CALC' ? 'ZERO' : col.rule;
        const computed = computeColumnFillAmount(
          ruleMode,
          col.ruleVal,
          col.refColKey,
          sched.balanceBefore,
          charges,
          decimals,
        );
        const alreadyPaidCharge = preserved ? preserved.paidCharges[col.clientKey] || 0 : 0;
        charges[col.clientKey] = Math.max(computed, alreadyPaidCharge);
      }
      if (preserved && interestCol) {
        const alreadyPaidInt = preserved.paidCharges[interestCol.clientKey] || 0;
        if ((charges[interestCol.clientKey] || 0) < alreadyPaidInt) {
          charges[interestCol.clientKey] = alreadyPaidInt;
        }
      }

      const paidCap = preserved ? preserved.paidPrincipal : 0;
      return {
        id: preserved?.id,
        clientRowKey: preserved?.clientRowKey || `edit_new_${i}_${Date.now()}`,
        installmentNumber: preserved ? preserved.installmentNumber : sched.installmentNumber,
        dueDate: sched.dueDate,
        principalAmount: roundToCurrencyDecimals(paidCap + sched.principalAmount, decimals),
        charges,
        paidPrincipal: paidCap,
        paidCharges: preserved ? { ...preserved.paidCharges } : {},
        isPaid: false,
        isPartial: preserved ? preserved.isPartial : false,
        hasAllocations: Boolean(preserved),
        status: preserved ? preserved.status : 'PENDING',
      };
    });

    setRows([...paidRows, ...newPendingRows]);
    setCalcCountRaw(String(effectiveCount));
    setLastAppliedCalc({ ...currentCalcParams, count: effectiveCount });
    showToast('Tabla recalculada. Los pagos registrados quedaron protegidos.', () => {
      setColumns(snap.columns);
      setRows(snap.rows);
      setCalcRateRaw(String(snap.annualRate));
      setLastAppliedCalc(snap.lastCalc);
      setEditUndoSnapshot(null);
      showToast('Se deshizo el recálculo.');
    });
  };

  // Keep reference to avoid unused state warning on snapshots
  void createUndoSnapshot;
  void editUndoSnapshot;

  const handleAddColumn = (colData: {
    name: string;
    expenseAccountId: string;
    mode: LoanColumnFillMode;
    value: number;
    refColKey: string;
  }) => {
    const clientKey = `col_${Date.now()}`;
    const newCol: DraftLoanColumn = {
      clientKey,
      name: colData.name,
      expenseAccountId: colData.expenseAccountId,
      isActive: true,
      locked: false,
      hasAllocations: false,
      rule: colData.mode,
      ruleVal: colData.value,
      refColKey: colData.refColKey,
    };

    const nextCols = [...columns, newCol];
    const pendRows = rows.filter((r) => !r.isPaid);
    let bal = pendRows.reduce(
      (sum, r) => sum + Math.max(0, r.principalAmount - r.paidPrincipal),
      0,
    );

    const nextRows = rows.map((r) => {
      if (r.isPaid) return r;
      const amt = computeColumnFillAmount(
        colData.mode,
        colData.value,
        colData.refColKey,
        bal,
        r.charges,
        decimals,
      );
      bal = Math.max(0, bal - Math.max(0, r.principalAmount - r.paidPrincipal));
      return {
        ...r,
        charges: { ...r.charges, [clientKey]: amt },
      };
    });

    setColumns(nextCols);
    setRows(nextRows);
    setTableManuallyEdited(true);
    setAddColOpen(false);
    const expName =
      localAccounts.find((a) => a.id === colData.expenseAccountId)?.name || 'Categoría de gasto';
    showToast(`Columna "${colData.name}" vinculada a "${expName}".`);
  };

  const handleRemoveColumn = (clientKey: string) => {
    const col = columns.find((c) => c.clientKey === clientKey);
    if (!col || col.locked) return;

    setTableManuallyEdited(true);
    if (col.hasAllocations) {
      setColumns((prev) =>
        prev.map((c) => (c.clientKey === clientKey ? { ...c, isActive: false } : c)),
      );
      setRows((prev) =>
        prev.map((r) => (r.isPaid ? r : { ...r, charges: { ...r.charges, [clientKey]: 0 } })),
      );
      showToast(`Columna "${col.name}" archivada hacia adelante (historial pagado intacto).`);
    } else {
      setColumns((prev) => prev.filter((c) => c.clientKey !== clientKey));
      setRows((prev) =>
        prev.map((r) => {
          const nextCharges = { ...r.charges };
          delete nextCharges[clientKey];
          return { ...r, charges: nextCharges };
        }),
      );
      showToast(`Columna "${col.name}" eliminada.`);
    }
  };

  const handleChangeColExpense = (clientKey: string, expenseAccountId: string) => {
    const col = columns.find((c) => c.clientKey === clientKey);
    if (!col) return;
    if (col.hasAllocations) {
      showToast('Esta columna ya tiene pagos imputados; no se puede cambiar su categoría.');
      return;
    }
    setColumns((prev) =>
      prev.map((c) => (c.clientKey === clientKey ? { ...c, expenseAccountId } : c)),
    );
  };

  const handleAddRow = () => {
    setTableManuallyEdited(true);
    const last = rows[rows.length - 1];
    const nextNum = last ? last.installmentNumber + 1 : 1;
    const nextDate = last ? addMonthsIso(last.dueDate, 1) : getTodayLocalIso();
    const charges: Record<string, number> = {};
    for (const c of columns) {
      if (c.isActive) {
        charges[c.clientKey] =
          c.rule === 'FIXED' ? roundToCurrencyDecimals(c.ruleVal, decimals) : 0;
      }
    }
    setRows((prev) => [
      ...prev,
      {
        clientRowKey: `row_${nextNum}_${Date.now()}`,
        installmentNumber: nextNum,
        dueDate: nextDate,
        principalAmount: last ? last.principalAmount : decimals === 0 ? 1000000 : 1000,
        charges,
        paidPrincipal: 0,
        paidCharges: {},
        isPaid: false,
        isPartial: false,
        hasAllocations: false,
        status: 'PENDING',
      },
    ]);
    showToast(`Cuota #${nextNum} agregada al final del plan.`);
  };

  const handleRemoveRow = (clientRowKey: string) => {
    const target = rows.find((r) => r.clientRowKey === clientRowKey);
    if (!target) return;
    if (target.hasAllocations || target.isPaid) {
      showToast('Esta cuota tiene pagos registrados y no puede quitarse.');
      return;
    }
    const pendingCount = rows.filter((r) => !r.isPaid).length;
    if (pendingCount <= 1) {
      showToast('Debe quedar al menos 1 cuota pendiente.');
      return;
    }
    setTableManuallyEdited(true);
    setRows((prev) => prev.filter((r) => r.clientRowKey !== clientRowKey));
    showToast(`Cuota #${target.installmentNumber} quitada del plan.`);
  };

  const handleCellDateChange = (clientRowKey: string, dueDate: string) => {
    setTableManuallyEdited(true);
    setRows((prev) => prev.map((r) => (r.clientRowKey === clientRowKey ? { ...r, dueDate } : r)));
  };

  const handleCellNumericChange = (clientRowKey: string, key: string, rawInput: string) => {
    setTableManuallyEdited(true);
    const cleaned = normalizeAmountInput(rawInput, decimals);
    const num = parseNumericInput(cleaned, decimals);

    setRows((prev) =>
      prev.map((r) => {
        if (r.clientRowKey !== clientRowKey) return r;
        if (key === 'principal') {
          const minAllowed = r.hasAllocations
            ? Math.max(1 / Math.pow(10, decimals), r.paidPrincipal)
            : 0;
          const clamped = r.hasAllocations && num < minAllowed ? minAllowed : num;
          return { ...r, principalAmount: clamped };
        }
        return { ...r, charges: { ...r.charges, [key]: num } };
      }),
    );
  };

  const handleResetEditToInitial = () => {
    if (!isEdit || !initialLoan || !editInit) return;
    setName(initialLoan.name);
    setDefaultPaymentAccountId(initialLoan.defaultPaymentAccountId || '');
    setColumns(editInit.columns);
    setRows(editInit.rows);
    setCalcPrincipalRaw(String(editInit.calcSnapshot.principal));
    setCalcRateRaw(String(editInit.calcSnapshot.rate));
    setCalcCountRaw(String(editInit.calcSnapshot.count));
    setCalcDate(editInit.calcSnapshot.date);
    setLastAppliedCalc(editInit.calcSnapshot);
    setTableManuallyEdited(false);
    setAddColOpen(false);
    showToast('Se restauraron los valores iniciales del préstamo.');
  };

  // Summary / Impact Calculations
  const activeCols = useMemo(() => columns.filter((c) => c.isActive), [columns]);
  const visibleCols = useMemo(
    () =>
      columns.filter((c) => c.isActive || (isEdit && editRowFilter === 'ALL' && c.hasAllocations)),
    [columns, isEdit, editRowFilter],
  );
  const visibleRows = useMemo(
    () => (isEdit && editRowFilter === 'PENDING' ? rows.filter((r) => !r.isPaid) : rows),
    [rows, isEdit, editRowFilter],
  );

  const summaryMetrics = useMemo(() => {
    const pendRows = rows.filter((r) => !r.isPaid);
    const interestKey = (columns.find((c) => c.locked) || columns[0])?.clientKey || 'interest';

    let pendingCap = 0;
    let totalInterest = 0;
    let totalAllCharges = 0;
    let totalPendSum = 0;

    for (const r of pendRows) {
      const pendCap = isEdit ? Math.max(0, r.principalAmount - r.paidPrincipal) : r.principalAmount;
      pendingCap += pendCap;
      let rowCharges = 0;
      for (const c of activeCols) {
        const ch = isEdit
          ? Math.max(0, (r.charges[c.clientKey] || 0) - (r.paidCharges[c.clientKey] || 0))
          : r.charges[c.clientKey] || 0;
        rowCharges += ch;
        if (c.clientKey === interestKey) {
          totalInterest += ch;
        }
      }
      totalAllCharges += rowCharges;
      totalPendSum += pendCap + rowCharges;
    }

    const avgPmt = pendRows.length ? Math.round(totalPendSum / pendRows.length) : 0;
    const otherCharges = Math.max(
      0,
      roundToCurrencyDecimals(totalAllCharges - totalInterest, decimals),
    );
    const firstNum = pendRows[0]?.installmentNumber ?? 1;
    const lastNum = pendRows[pendRows.length - 1]?.installmentNumber ?? firstNum;

    return {
      pendingCap: roundToCurrencyDecimals(pendingCap, decimals),
      avgPmt,
      totalInterest: roundToCurrencyDecimals(totalInterest, decimals),
      otherCharges,
      totalAllCharges: roundToCurrencyDecimals(totalAllCharges, decimals),
      count: pendRows.length,
      firstNum,
      lastNum,
    };
  }, [rows, columns, activeCols, isEdit, decimals]);

  const editDelta = useMemo(() => {
    if (!isEdit || !editInit) {
      return { capDiff: 0, pmtDiff: 0, chargesDiff: 0 };
    }
    return {
      capDiff: roundToCurrencyDecimals(
        summaryMetrics.pendingCap - editInit.baselineMetrics.pendingPrincipal,
        decimals,
      ),
      pmtDiff: summaryMetrics.avgPmt - editInit.baselineMetrics.avgPmt,
      chargesDiff: roundToCurrencyDecimals(
        summaryMetrics.totalAllCharges - editInit.baselineMetrics.totalAllCharges,
        decimals,
      ),
    };
  }, [isEdit, editInit, summaryMetrics, decimals]);

  const hasCapitalDelta = isEdit && Math.abs(editDelta.capDiff) > 0.0001;
  const isCapDecrease = editDelta.capDiff < 0;

  // Auto-select appropriate default category when capital delta sign flips
  useEffect(() => {
    if (!hasCapitalDelta) return;
    const targetType = isCapDecrease ? AccountType.INCOME : AccountType.EXPENSE;
    const currentAcc = localAccounts.find((a) => a.id === adjCategoryAccountId);
    if (!currentAcc || currentAcc.type !== targetType) {
      const candidate =
        targetType === AccountType.EXPENSE
          ? pickDefaultInterestExpenseAccount(localAccounts)
          : localAccounts.find(
              (a) =>
                a.status !== 'INACTIVE' &&
                a.type === AccountType.INCOME &&
                !a.isCashOrBank &&
                !a.isControlAccount,
            );
      setAdjCategoryAccountId(candidate?.id || '');
    }
  }, [hasCapitalDelta, isCapDecrease, localAccounts, adjCategoryAccountId]);

  const isEditDirty = useMemo(() => {
    if (!isEdit || !initialLoan || !editInit) return false;
    if (name.trim() !== initialLoan.name) return true;
    if ((defaultPaymentAccountId || '') !== (initialLoan.defaultPaymentAccountId || ''))
      return true;
    if (isCalcPending) return true;
    if (JSON.stringify(columns) !== JSON.stringify(editInit.columns)) return true;
    if (JSON.stringify(rows) !== JSON.stringify(editInit.rows)) return true;
    return false;
  }, [isEdit, initialLoan, editInit, name, defaultPaymentAccountId, isCalcPending, columns, rows]);

  const liabilityPreview = useMemo(
    () =>
      resolveLiabilityAccountPreview(
        name,
        localAccounts,
        isEdit ? initialLoan?.liabilityAccountId : undefined,
      ),
    [name, localAccounts, isEdit, initialLoan?.liabilityAccountId],
  );

  const isCellModified = useCallback(
    (row: DraftLoanRow, key: string): boolean => {
      if (!isEdit || !editInit) return false;
      const orig = editInit.rows.find((x) => x.installmentNumber === row.installmentNumber);
      if (!orig) return true;
      if (key === 'dueDate') return row.dueDate !== orig.dueDate;
      if (key === 'principal') return Number(row.principalAmount) !== Number(orig.principalAmount);
      return Number(row.charges[key] || 0) !== Number(orig.charges[key] || 0);
    },
    [isEdit, editInit],
  );

  const handleQuickCreateAccount = (
    initialName: string,
    suggestedType: AccountType | undefined,
    isCashOrBank: boolean,
    onCreated: (createdId: string) => void,
  ) => {
    setQuickCreateState({
      initialName,
      initialType: suggestedType || (isCashOrBank ? AccountType.ASSET : AccountType.EXPENSE),
      isCashOrBank,
      onCreated,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Ingresá un nombre para identificar el préstamo.');
      return;
    }

    if (!isEdit && openingMode === 'NEW' && !disbursementAccountId) {
      setError('Seleccioná la cuenta bancaria donde ingresó el desembolso.');
      return;
    }

    const activeMissingCat = activeCols.find((c) => !c.expenseAccountId);
    if (activeMissingCat) {
      setError(`Seleccioná una categoría de gasto para la columna "${activeMissingCat.name}".`);
      return;
    }

    const editableRows = isEdit ? rows.filter((r) => !r.isPaid) : rows;
    if (editableRows.some((r) => Number(r.principalAmount) <= 0)) {
      setError('Todas las cuotas deben tener Capital mayor a 0.');
      return;
    }

    if (hasCapitalDelta) {
      if (adjType === 'CASH_TRANSFER' && !adjCashAccountId) {
        setError('Seleccioná la cuenta bancaria o de efectivo para el ajuste de capital.');
        return;
      }
      if (adjType === 'CATEGORY' && !adjCategoryAccountId) {
        setError('Seleccioná la categoría de Ingreso o Gasto para el ajuste de capital.');
        return;
      }
    }

    try {
      setSubmitting(true);
      const colInputs = columns.map((c, idx) => ({
        ...(c.id ? { id: c.id } : {}),
        clientKey: c.clientKey,
        name: c.name,
        expenseAccountId: c.expenseAccountId,
        isActive: c.isActive,
        sortOrder: idx,
      }));

      const rowInputs = editableRows.map((r) => ({
        ...(r.id ? { id: r.id } : {}),
        installmentNumber: r.installmentNumber,
        dueDate: r.dueDate,
        principalAmount: r.principalAmount,
        charges: r.charges,
      }));

      if (!isEdit) {
        const created = await api.loans.create({
          name: trimmedName,
          currencyId: currencyId || undefined,
          openingMode,
          openingDate,
          disbursementAccountId: openingMode === 'NEW' ? disbursementAccountId : null,
          defaultPaymentAccountId:
            openingMode === 'NEW' ? disbursementAccountId : defaultPaymentAccountId || null,
          annualRate: currentCalcParams.rate,
          startInstallmentNumber: rows[0]?.installmentNumber || 1,
          totalInstallmentsCount:
            openingMode === 'ONGOING'
              ? Math.max(currentCalcParams.count, rows[rows.length - 1]?.installmentNumber || 1)
              : rows.length,
          chargeColumns: colInputs,
          installments: rowInputs,
        });
        router.push(`/loans/${created.id}`);
      } else if (initialLoan) {
        const updated = await api.loans.updatePlan(initialLoan.id, {
          name: trimmedName,
          annualRate: currentCalcParams.rate,
          defaultPaymentAccountId: defaultPaymentAccountId || null,
          chargeColumns: colInputs,
          installments: rowInputs,
          capitalAdjustment: hasCapitalDelta
            ? {
                type: adjType,
                cashAccountId: adjType === 'CASH_TRANSFER' ? adjCashAccountId : null,
                categoryAccountId: adjType === 'CATEGORY' ? adjCategoryAccountId : null,
                adjustmentDate: adjDate,
              }
            : null,
        });
        router.push(`/loans/${updated.id}`);
      }
    } catch (err: any) {
      setError(err.message || 'No se pudo guardar el préstamo.');
    } finally {
      setSubmitting(false);
    }
  };

  // Totals for sticky table footer
  const footerTotals = useMemo(() => {
    const capSum = visibleRows.reduce((s, r) => s + (Number(r.principalAmount) || 0), 0);
    const colSums = visibleCols.map((c) =>
      visibleRows.reduce((s, r) => s + (Number(r.charges[c.clientKey]) || 0), 0),
    );
    const grand = capSum + colSums.reduce((a, b) => a + b, 0);
    return { capSum, colSums, grand };
  }, [visibleRows, visibleCols]);

  const disbursementAccount = localAccounts.find((a) => a.id === disbursementAccountId);
  const startOptions = useMemo(() => {
    const term = Math.max(1, Math.min(240, currentCalcParams.count));
    return Array.from({ length: term }, (_, i) => i + 1);
  }, [currentCalcParams.count]);

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <header className="space-y-2">
        <Link
          href={isEdit && initialLoan ? `/loans/${initialLoan.id}` : '/loans'}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground min-h-11 py-2 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>
            {isEdit && initialLoan ? `Volver a ${initialLoan.name}` : 'Volver a Préstamos'}
          </span>
        </Link>

        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            {isEdit ? 'Editar Préstamo' : 'Nuevo Préstamo'}
          </h1>
          {isEdit && editInit && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 tabular-nums">
              {editInit.baselineMetrics.paidCount} cuotas pagadas protegidas
            </span>
          )}
          {isEdit && isEditDirty && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
              Cambios sin guardar
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {isEdit
            ? 'Actualizá los datos del préstamo, recalculá el plan o ajustá tus cuotas pendientes guaraní por guaraní.'
            : 'Definí los datos base, armá tu plan de pagos con la calculadora o a mano y revisá el resumen antes de guardar.'}
        </p>
      </header>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* =================================================================
          BLOQUE 1: 1. Datos del préstamo
         ================================================================= */}
      <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <h2 className="text-base font-bold text-foreground">1. Datos del préstamo</h2>

        {!isEdit ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  className="block text-xs font-bold text-foreground mb-1.5"
                  htmlFor="loan-name"
                >
                  Nombre del préstamo *
                </label>
                <input
                  id="loan-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Préstamo Auto Itaú"
                  required
                  className="w-full min-h-11 px-3.5 py-2 rounded-xl border border-input bg-card text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {liabilityPreview.hasCollision ? (
                    <>
                      <span className="font-semibold text-amber-700 dark:text-amber-300">
                        Ya existe una cuenta con ese nombre:
                      </span>{' '}
                      se creará la cuenta de pasivo «{liabilityPreview.previewName}».
                    </>
                  ) : (
                    <>Se creará la cuenta de pasivo «{liabilityPreview.previewName}».</>
                  )}
                </p>
              </div>

              <div>
                <label
                  className="block text-xs font-bold text-foreground mb-1.5"
                  htmlFor="loan-currency"
                >
                  Moneda *
                </label>
                <select
                  id="loan-currency"
                  value={currencyId}
                  onChange={(e) => {
                    const nextCurId = e.target.value;
                    setCurrencyId(nextCurId);
                    const nextCur = currencies.find((c) => c.id === nextCurId);
                    if (!tableManuallyEdited && nextCur) {
                      runCreateScheduleRecalc(
                        currentCalcParams,
                        columns,
                        nextCur.decimalPlaces ?? 0,
                      );
                    }
                  }}
                  className="w-full min-h-11 px-3.5 py-2 rounded-xl border border-input bg-card text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {currencies.map((cur) => (
                    <option key={cur.id} value={cur.id}>
                      {cur.code} ({cur.symbol}) — {cur.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Moneda de la cuenta de pasivo.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-bold text-foreground">
                ¿Es un préstamo nuevo o ya lo venías pagando?
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleModeSwitch('NEW')}
                  className={cn(
                    'p-4 rounded-2xl border-2 text-left transition cursor-pointer flex flex-col gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    openingMode === 'NEW'
                      ? 'border-indigo-500 bg-card-tint'
                      : 'border-border bg-card hover:bg-muted/40',
                  )}
                >
                  <span className="text-sm font-bold text-foreground">Es un préstamo nuevo</span>
                  <span className="text-xs text-muted-foreground">
                    El dinero se acredita en tu cuenta bancaria en la fecha de desembolso.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleModeSwitch('ONGOING')}
                  className={cn(
                    'p-4 rounded-2xl border-2 text-left transition cursor-pointer flex flex-col gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    openingMode === 'ONGOING'
                      ? 'border-indigo-500 bg-card-tint'
                      : 'border-border bg-card hover:bg-muted/40',
                  )}
                >
                  <span className="text-sm font-bold text-foreground">Ya lo venía pagando</span>
                  <span className="text-xs text-muted-foreground">
                    Empezás desde tu próxima cuota sin alterar tus saldos bancarios de hoy.
                  </span>
                </button>
              </div>
            </div>

            {openingMode === 'NEW' ? (
              <div className="p-4 rounded-2xl bg-card-tint border border-border space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <AccountPickerSheet
                    label="Cuenta de acreditación *"
                    accounts={localAccounts}
                    selectedAccountId={disbursementAccountId}
                    onSelect={(acc) => setDisbursementAccountId(acc.id)}
                    filterMode="CASH_BANK"
                    baseCurrency={activeCurrency}
                    placeholder="Seleccionar cuenta líquida..."
                    onQuickCreateAccount={(initialName, suggestedType) =>
                      handleQuickCreateAccount(initialName, suggestedType, true, (newId) =>
                        setDisbursementAccountId(newId),
                      )
                    }
                  />
                  <div>
                    <label
                      className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1"
                      htmlFor="loan-opening-date-new"
                    >
                      Fecha del desembolso *
                    </label>
                    <input
                      id="loan-opening-date-new"
                      type="date"
                      value={openingDate}
                      onChange={(e) => setOpeningDate(e.target.value)}
                      required
                      className="w-full min-h-11 px-3.5 py-2.5 rounded-xl border border-input bg-card text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Acreditará el monto en esa cuenta en la fecha indicada y registrará el pasivo en
                  tu Balance.
                </p>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-card-tint border border-border space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1"
                      htmlFor="loan-opening-date-ongoing"
                    >
                      Fecha de apertura en Balance *
                    </label>
                    <input
                      id="loan-opening-date-ongoing"
                      type="date"
                      value={openingDate}
                      onChange={(e) => setOpeningDate(e.target.value)}
                      required
                      className="w-full min-h-11 px-3.5 py-2.5 rounded-xl border border-input bg-card text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <AccountPickerSheet
                    label="Cuenta bancaria habitual (opcional)"
                    accounts={localAccounts}
                    selectedAccountId={defaultPaymentAccountId}
                    onSelect={(acc) => setDefaultPaymentAccountId(acc.id)}
                    allowEmpty={true}
                    emptyLabel="Elegir al momento de pagar"
                    onClear={() => setDefaultPaymentAccountId('')}
                    filterMode="CASH_BANK"
                    baseCurrency={activeCurrency}
                    onQuickCreateAccount={(initialName, suggestedType) =>
                      handleQuickCreateAccount(initialName, suggestedType, true, (newId) =>
                        setDefaultPaymentAccountId(newId),
                      )
                    }
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Tu deuda pendiente se sumará al Balance contra Capital en la fecha de apertura,
                  sin alterar el saldo actual de tu banco.
                </p>
              </div>
            )}
          </>
        ) : (
          initialLoan && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label
                    className="block text-xs font-bold text-foreground mb-1.5"
                    htmlFor="edit-loan-name"
                  >
                    Nombre del préstamo *
                  </label>
                  <input
                    id="edit-loan-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full min-h-11 px-3.5 py-2 rounded-xl border border-input bg-card text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div>
                  <label
                    className="block text-xs font-bold text-foreground mb-1.5"
                    htmlFor="edit-liability-acc"
                  >
                    Cuenta de pasivo vinculada
                  </label>
                  <input
                    id="edit-liability-acc"
                    type="text"
                    disabled
                    value={`${liabilityPreview.previewName} (${initialLoan.currencyCode})`}
                    className="w-full min-h-11 px-3.5 py-2 rounded-xl border border-input bg-muted/60 text-sm font-semibold text-muted-foreground cursor-not-allowed"
                  />
                </div>

                <div>
                  <AccountPickerSheet
                    label="Cuenta de pago por defecto"
                    accounts={localAccounts}
                    selectedAccountId={defaultPaymentAccountId}
                    onSelect={(acc) => setDefaultPaymentAccountId(acc.id)}
                    allowEmpty={true}
                    emptyLabel="Elegir al momento de pagar"
                    onClear={() => setDefaultPaymentAccountId('')}
                    filterMode="CASH_BANK"
                    baseCurrency={activeCurrency}
                    onQuickCreateAccount={(initialName, suggestedType) =>
                      handleQuickCreateAccount(initialName, suggestedType, true, (newId) =>
                        setDefaultPaymentAccountId(newId),
                      )
                    }
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Se sugiere al pagar cuotas, pero podés pagar desde cualquier cuenta.
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-border text-xs text-muted-foreground tabular-nums">
                Monto original:{' '}
                <strong className="text-foreground">
                  {formatCurrency(initialLoan.initialPrincipal, activeCurrency)}
                </strong>{' '}
                · Ya amortizado:{' '}
                <strong className="text-foreground">
                  {formatCurrency(initialLoan.paidPrincipal, activeCurrency)}
                </strong>{' '}
                ({initialLoan.paidInstallmentsCount} pagadas) · Apertura:{' '}
                {formatLoanShortDate(initialLoan.openingDate)}
              </div>
            </>
          )
        )}
      </section>

      {/* =================================================================
          BLOQUE 2: 2. Plan de pagos (Calculadora + Tabla 100% Editable)
         ================================================================= */}
      <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-foreground">
            2. Plan de pagos{' '}
            <span className="text-sm font-medium text-muted-foreground tabular-nums">
              ({summaryMetrics.count} cuotas
              {summaryMetrics.count > 0
                ? ` #${summaryMetrics.firstNum} a #${summaryMetrics.lastNum}`
                : ''}
              )
            </span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isEdit
              ? 'Lo que queda en esta tabla es exactamente cómo quedará tu préstamo. Las cuotas pagadas no se modifican.'
              : 'Lo que queda en esta tabla es exactamente cómo quedará registrado tu préstamo.'}
          </p>
        </div>

        {/* Always-visible Calculator Panel */}
        <div
          className={cn(
            'p-4 rounded-xl bg-card-tint border space-y-3 transition-colors',
            isCalcPending ? 'border-indigo-500' : 'border-border',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-foreground">
                  Calculadora de plan de pagos
                </span>
                {isCalcPending && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                    Pendiente de aplicar
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {isCalcPending
                  ? 'Cambiaste los datos de la calculadora. Presioná «Recalcular tabla» para actualizar las cuotas.'
                  : isEdit
                    ? 'Usala si adelantaste capital, cambió tu tasa o refinanciaste. Solo recalcula las cuotas pendientes al presionar «Recalcular tabla».'
                    : 'Generá las cuotas automáticamente a partir de estos datos. Lo que edites después en la tabla se conserva a menos que vuelvas a recalcular.'}
              </p>
            </div>

            <button
              type="button"
              onClick={handleApplyCalculator}
              className={cn(
                'inline-flex items-center gap-1.5 px-3.5 py-2 min-h-11 rounded-xl text-xs font-bold cursor-pointer transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isCalcPending
                  ? 'bg-primary text-primary-foreground shadow-sm hover:opacity-90'
                  : 'bg-card border border-border text-foreground hover:bg-muted',
              )}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Recalcular tabla</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label
                className="block text-xs font-bold text-foreground mb-1"
                htmlFor="loan-calc-principal"
              >
                {isEdit
                  ? `Capital pendiente (${activeCurrency.symbol})`
                  : `Monto original (${activeCurrency.symbol})`}
              </label>
              <input
                id="loan-calc-principal"
                type="text"
                inputMode={decimals === 0 ? 'numeric' : 'decimal'}
                value={formatAmountInput(calcPrincipalRaw, decimals)}
                onChange={(e) =>
                  setCalcPrincipalRaw(normalizeAmountInput(e.target.value, decimals))
                }
                className="w-full min-h-11 px-3 py-2 rounded-xl border border-input bg-card text-sm text-right font-bold tracking-tight tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div>
              <label
                className="block text-xs font-bold text-foreground mb-1"
                htmlFor="loan-calc-rate"
              >
                Tasa ref. (%)
              </label>
              <input
                id="loan-calc-rate"
                type="text"
                inputMode="decimal"
                value={calcRateRaw}
                onChange={(e) => setCalcRateRaw(e.target.value)}
                className="w-full min-h-11 px-3 py-2 rounded-xl border border-input bg-card text-sm text-right tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div>
              <label
                className="block text-xs font-bold text-foreground mb-1"
                htmlFor="loan-calc-count"
              >
                {isEdit ? 'Cuotas pendientes' : 'Cuotas totales'}
              </label>
              <input
                id="loan-calc-count"
                type="number"
                min={1}
                max={240}
                value={calcCountRaw}
                onChange={(e) => setCalcCountRaw(e.target.value)}
                className="w-full min-h-11 px-3 py-2 rounded-xl border border-input bg-card text-sm text-right tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div>
              <label
                className="block text-xs font-bold text-foreground mb-1"
                htmlFor="loan-calc-date"
              >
                {isEdit ? 'Próximo vencimiento' : '1er vencimiento'}
              </label>
              <input
                id="loan-calc-date"
                type="date"
                value={calcDate}
                onChange={(e) => setCalcDate(e.target.value)}
                className="w-full min-h-11 px-3 py-2 rounded-xl border border-input bg-card text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {!isEdit && openingMode === 'ONGOING' && (
              <div className="sm:col-span-2 lg:col-span-4">
                <label
                  className="block text-xs font-bold text-foreground mb-1"
                  htmlFor="loan-calc-start-num"
                >
                  Registrar desde cuota
                </label>
                <select
                  id="loan-calc-start-num"
                  value={calcStartNum}
                  onChange={(e) => setCalcStartNum(Number(e.target.value) || 1)}
                  className="w-full sm:max-w-xs min-h-11 px-3 py-2 rounded-xl border border-input bg-card text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {startOptions.map((num) => (
                    <option key={num} value={num}>
                      Cuota {num} de {currentCalcParams.count}
                      {num === 1 ? ' (todas)' : ` (1 a ${num - 1} ya pagadas)`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Table Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {isEdit ? (
            <div className="inline-flex p-1 rounded-xl bg-muted gap-1" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={editRowFilter === 'PENDING'}
                onClick={() => setEditRowFilter('PENDING')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition',
                  editRowFilter === 'PENDING'
                    ? 'bg-card text-accent-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Solo pendientes
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={editRowFilter === 'ALL'}
                onClick={() => setEditRowFilter('ALL')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition',
                  editRowFilter === 'ALL'
                    ? 'bg-card text-accent-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Incluir pagadas
              </button>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              Editá cualquier cuota o fecha directamente, o sumá columnas de cargos de tu banco.
            </span>
          )}

          <button
            type="button"
            onClick={() => setAddColOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-11 rounded-xl border border-border bg-card text-xs font-bold text-foreground hover:bg-muted cursor-pointer transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isEdit ? 'Agregar columna' : 'Agregar columna de cargo'}</span>
          </button>
        </div>

        {/* Smart Column Helper Drawer */}
        <LoanColumnDrawer
          isOpen={addColOpen}
          isEditMode={isEdit}
          columns={columns}
          accounts={localAccounts}
          currency={activeCurrency}
          onClose={() => setAddColOpen(false)}
          onApply={handleAddColumn}
          onQuickCreateExpense={(initialName, suggestedType, cb) =>
            handleQuickCreateAccount(
              initialName,
              suggestedType || AccountType.EXPENSE,
              false,
              (id) => cb?.(id),
            )
          }
        />

        {/* Interactive Schedule Table */}
        <div className="w-full overflow-x-auto max-h-96 overflow-y-auto border border-border rounded-xl bg-card">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 bg-card-tint text-muted-foreground font-bold px-3 py-2.5 border-b border-border text-left whitespace-nowrap">
                  Cuota
                </th>
                {isEdit && editRowFilter === 'ALL' && (
                  <th className="sticky top-0 z-10 bg-card-tint text-muted-foreground font-bold px-3 py-2.5 border-b border-border text-left whitespace-nowrap">
                    Estado
                  </th>
                )}
                <th className="sticky top-0 z-10 bg-card-tint text-muted-foreground font-bold px-3 py-2.5 border-b border-border text-left whitespace-nowrap">
                  Vencimiento
                </th>
                <th className="sticky top-0 z-10 bg-card-tint text-muted-foreground font-bold px-3 py-2.5 border-b border-border text-right whitespace-nowrap">
                  <div>Capital</div>
                  <div className="text-2xs font-medium">→ Pasivo Préstamo</div>
                </th>

                {visibleCols.map((col) => {
                  const expName =
                    localAccounts.find((a) => a.id === col.expenseAccountId)?.name ||
                    'Categoría de gasto';
                  return (
                    <th
                      key={col.clientKey}
                      className="sticky top-0 z-10 bg-card-tint text-muted-foreground font-bold px-3 py-2.5 border-b border-border text-right whitespace-nowrap"
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>{col.name}</span>
                        {!col.isActive && (
                          <span className="px-1.5 py-0.5 rounded-full text-3xs bg-muted text-muted-foreground">
                            Archivada
                          </span>
                        )}
                        {!col.locked && col.isActive && (
                          <button
                            type="button"
                            onClick={() => handleRemoveColumn(col.clientKey)}
                            title={
                              col.hasAllocations
                                ? 'Archivar columna hacia adelante'
                                : 'Quitar columna'
                            }
                            aria-label={`Quitar columna ${col.name}`}
                            className="p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      <div className="mt-1 flex justify-end">
                        {col.hasAllocations ? (
                          <span
                            title="Categoría protegida: esta columna ya tiene pagos registrados"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border bg-muted/70 text-2xs font-medium text-muted-foreground max-w-44 truncate"
                          >
                            <Lock className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">→ {expName}</span>
                          </span>
                        ) : (
                          <AccountPickerSheet
                            accounts={localAccounts}
                            selectedAccountId={col.expenseAccountId}
                            onSelect={(acc) => handleChangeColExpense(col.clientKey, acc.id)}
                            filterMode="EXPENSES"
                            prioritizeFinancialExpenses={true}
                            label={`Categoría para ${col.name}`}
                            baseCurrency={activeCurrency}
                            onQuickCreateAccount={(initialName, suggestedType) =>
                              handleQuickCreateAccount(
                                initialName,
                                suggestedType || AccountType.EXPENSE,
                                false,
                                (newId) => handleChangeColExpense(col.clientKey, newId),
                              )
                            }
                            renderTrigger={({ open }) => (
                              <button
                                type="button"
                                onClick={open}
                                title="Cambiar categoría de gasto"
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border bg-card text-2xs font-medium text-foreground hover:border-ring cursor-pointer max-w-44"
                              >
                                <span className="truncate">→ {expName}</span>
                                <ChevronDown className="w-3 h-3 shrink-0 opacity-70" />
                              </button>
                            )}
                          />
                        )}
                      </div>
                    </th>
                  );
                })}

                <th className="sticky top-0 z-10 bg-card-tint text-muted-foreground font-bold px-3 py-2.5 border-b border-border text-right whitespace-nowrap">
                  Total cuota
                </th>
                <th className="sticky top-0 z-10 bg-card-tint px-3 py-2.5 border-b border-border w-10" />
              </tr>
            </thead>

            <tbody>
              {visibleRows.map((row) => {
                const rowChargesSum = visibleCols.reduce(
                  (sum, col) => sum + (Number(row.charges[col.clientKey]) || 0),
                  0,
                );
                const rowTotal = (Number(row.principalAmount) || 0) + rowChargesSum;

                if (row.isPaid) {
                  return (
                    <tr
                      key={row.clientRowKey}
                      className="bg-muted/35 text-muted-foreground border-b border-border"
                    >
                      <td className="px-3 py-2 font-semibold tabular-nums whitespace-nowrap">
                        #{row.installmentNumber}
                      </td>
                      {isEdit && editRowFilter === 'ALL' && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-full text-2xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                            Pagada · Protegida
                          </span>
                        </td>
                      )}
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                        {formatLoanShortDate(row.dueDate)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {formatCurrency(row.principalAmount, activeCurrency)}
                      </td>
                      {visibleCols.map((col) => {
                        const val = row.charges[col.clientKey];
                        return (
                          <td
                            key={col.clientKey}
                            className="px-3 py-2 text-right tabular-nums whitespace-nowrap"
                          >
                            {val === undefined ? '—' : formatCurrency(val, activeCurrency)}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right font-bold tracking-tight tabular-nums whitespace-nowrap">
                        {formatCurrency(rowTotal, activeCurrency)}
                      </td>
                      <td className="px-3 py-2 text-right" title="Cuota pagada protegida">
                        <Lock className="w-3.5 h-3.5 inline text-muted-foreground" />
                      </td>
                    </tr>
                  );
                }

                const pendingRowsCount = rows.filter((r) => !r.isPaid).length;
                const canRemove = !row.hasAllocations && pendingRowsCount > 1;

                return (
                  <tr key={row.clientRowKey} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 font-semibold tabular-nums whitespace-nowrap text-foreground">
                      #{row.installmentNumber}
                      {row.isPartial && editRowFilter !== 'ALL' && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-3xs font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300">
                          Parcial
                        </span>
                      )}
                    </td>

                    {isEdit && editRowFilter === 'ALL' && (
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full text-2xs font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300">
                          {row.isPartial ? 'Parcial' : 'Pendiente'}
                        </span>
                      </td>
                    )}

                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        aria-label={`Vencimiento cuota #${row.installmentNumber}`}
                        value={row.dueDate}
                        onChange={(e) => handleCellDateChange(row.clientRowKey, e.target.value)}
                        className={cn(
                          'min-w-32 px-2 py-1.5 rounded-lg border text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          isCellModified(row, 'dueDate')
                            ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30'
                            : 'border-input bg-card',
                        )}
                      />
                    </td>

                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="text"
                        aria-label={`Capital cuota #${row.installmentNumber}`}
                        inputMode={decimals === 0 ? 'numeric' : 'decimal'}
                        value={formatAmountInput(row.principalAmount, decimals)}
                        onChange={(e) =>
                          handleCellNumericChange(row.clientRowKey, 'principal', e.target.value)
                        }
                        className={cn(
                          'w-full min-w-24 px-2 py-1.5 rounded-lg border text-xs text-right tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          isCellModified(row, 'principal')
                            ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30'
                            : 'border-input bg-card',
                        )}
                      />
                      {row.isPartial && (
                        <div className="text-3xs text-muted-foreground tabular-nums mt-0.5">
                          Mín. {formatCurrency(row.paidPrincipal, activeCurrency)}
                        </div>
                      )}
                    </td>

                    {visibleCols.map((col) => {
                      if (!col.isActive) {
                        return (
                          <td
                            key={col.clientKey}
                            className="px-3 py-2 text-right text-muted-foreground tabular-nums"
                          >
                            —
                          </td>
                        );
                      }
                      return (
                        <td key={col.clientKey} className="px-2 py-1.5 text-right">
                          <input
                            type="text"
                            aria-label={`${col.name} cuota #${row.installmentNumber}`}
                            inputMode={decimals === 0 ? 'numeric' : 'decimal'}
                            value={formatAmountInput(row.charges[col.clientKey] ?? 0, decimals)}
                            onChange={(e) =>
                              handleCellNumericChange(
                                row.clientRowKey,
                                col.clientKey,
                                e.target.value,
                              )
                            }
                            className={cn(
                              'w-full min-w-24 px-2 py-1.5 rounded-lg border text-xs text-right tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              isCellModified(row, col.clientKey)
                                ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30'
                                : 'border-input bg-card',
                            )}
                          />
                        </td>
                      );
                    })}

                    <td className="px-3 py-2 text-right font-bold tracking-tight tabular-nums whitespace-nowrap text-foreground">
                      {formatCurrency(rowTotal, activeCurrency)}
                    </td>

                    <td className="px-2 py-1.5 text-right">
                      {canRemove ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.clientRowKey)}
                          title={`Quitar cuota #${row.installmentNumber}`}
                          aria-label={`Quitar cuota #${row.installmentNumber}`}
                          className="p-1.5 rounded-lg text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 cursor-pointer transition"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      ) : row.hasAllocations ? (
                        <span title="Tiene pagos registrados" className="text-muted-foreground">
                          <Lock className="w-3.5 h-3.5 inline" />
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              <tr>
                <td
                  colSpan={isEdit && editRowFilter === 'ALL' ? 3 : 2}
                  className="sticky bottom-0 z-10 bg-card-tint px-3 py-2.5 border-t border-border text-left font-bold text-foreground whitespace-nowrap"
                >
                  Totales ({visibleRows.length} cuotas)
                </td>
                <td className="sticky bottom-0 z-10 bg-card-tint px-3 py-2.5 border-t border-border text-right font-bold tracking-tight tabular-nums text-foreground whitespace-nowrap">
                  {formatCurrency(footerTotals.capSum, activeCurrency)}
                </td>
                {footerTotals.colSums.map((sum, idx) => (
                  <td
                    key={visibleCols[idx]?.clientKey || idx}
                    className="sticky bottom-0 z-10 bg-card-tint px-3 py-2.5 border-t border-border text-right font-bold tracking-tight tabular-nums text-foreground whitespace-nowrap"
                  >
                    {formatCurrency(sum, activeCurrency)}
                  </td>
                ))}
                <td className="sticky bottom-0 z-10 bg-card-tint px-3 py-2.5 border-t border-border text-right font-bold tracking-tight tabular-nums text-foreground whitespace-nowrap">
                  {formatCurrency(footerTotals.grand, activeCurrency)}
                </td>
                <td className="sticky bottom-0 z-10 bg-card-tint border-t border-border" />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleAddRow}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-11 rounded-xl text-xs font-bold text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Agregar cuota al final</span>
          </button>
          <span className="text-xs text-muted-foreground">
            {isEdit
              ? 'Cualquier cambio en celdas o columnas actualiza el impacto abajo en tiempo real.'
              : 'Podés agregar o quitar cuotas individuales sin recalcular toda la tabla.'}
          </span>
        </div>
      </section>

      {/* =================================================================
          BLOQUE 3: 3. Resumen / Efecto antes de guardar
         ================================================================= */}
      <section className="p-5 rounded-2xl bg-card-tint border border-indigo-500/30 space-y-4">
        <div>
          <h2 className="text-base font-bold text-foreground">
            {isEdit ? '3. Efecto de tus cambios antes de guardar' : '3. Resumen antes de guardar'}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isEdit
              ? 'Comparación automática entre tu plan guardado y el borrador de la tabla arriba.'
              : 'Calculado en vivo desde tu plan de pagos. Esto es exactamente lo que quedará asentado.'}
          </p>
        </div>

        {(isEdit ? isEditCalcStructuralPending : isCalcPending) && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span>
              <strong>Tenés cambios sin aplicar en la calculadora del paso 2.</strong> La tabla
              actual conserva los montos anteriores.
            </span>
            <button
              type="button"
              onClick={handleApplyCalculator}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-bold cursor-pointer hover:opacity-90"
            >
              Aplicar calculadora ahora
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-card border border-border flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">
              {isEdit ? 'Capital pendiente' : 'Capital a registrar (Balance)'}
            </span>
            <span className="text-base font-bold tracking-tight tabular-nums text-foreground">
              {formatCurrency(summaryMetrics.pendingCap, activeCurrency)}
            </span>
            {isEdit ? (
              <span
                className={cn(
                  'text-xs font-bold tabular-nums',
                  editDelta.capDiff === 0
                    ? 'text-muted-foreground font-normal'
                    : editDelta.capDiff < 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400',
                )}
              >
                {editDelta.capDiff === 0
                  ? 'Sin diferencia vs. saldo actual'
                  : `${editDelta.capDiff < 0 ? '- ' : '+ '}${formatCurrency(
                      Math.abs(editDelta.capDiff),
                      activeCurrency,
                    )} vs. saldo guardado`}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Suma exacta de la tabla</span>
            )}
          </div>

          <div className="p-3.5 rounded-xl bg-card border border-border flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">
              Cuota mensual promedio
            </span>
            <span className="text-base font-bold tracking-tight tabular-nums text-foreground">
              {formatCurrency(summaryMetrics.avgPmt, activeCurrency)}
            </span>
            {isEdit ? (
              <span
                className={cn(
                  'text-xs font-bold tabular-nums',
                  editDelta.pmtDiff === 0
                    ? 'text-muted-foreground font-normal'
                    : editDelta.pmtDiff < 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400',
                )}
              >
                {editDelta.pmtDiff === 0
                  ? 'Igual al plan guardado'
                  : `${editDelta.pmtDiff < 0 ? '- ' : '+ '}${formatCurrency(
                      Math.abs(editDelta.pmtDiff),
                      activeCurrency,
                    )} por mes`}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Incluye capital y cargos</span>
            )}
          </div>

          <div className="p-3.5 rounded-xl bg-card border border-border flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">
              {isEdit ? 'Intereses y cargos pendientes' : 'Intereses y cargos totales'}
            </span>
            <span className="text-base font-bold tracking-tight tabular-nums text-foreground">
              {formatCurrency(summaryMetrics.totalAllCharges, activeCurrency)}
            </span>
            {isEdit && (
              <span
                className={cn(
                  'text-xs font-bold tabular-nums',
                  editDelta.chargesDiff === 0
                    ? 'text-muted-foreground font-normal'
                    : editDelta.chargesDiff < 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400',
                )}
              >
                {editDelta.chargesDiff === 0
                  ? 'Igual al plan guardado'
                  : `${editDelta.chargesDiff < 0 ? '- ' : '+ '}${formatCurrency(
                      Math.abs(editDelta.chargesDiff),
                      activeCurrency,
                    )} de diferencia`}
              </span>
            )}
            <span className="text-xs text-muted-foreground tabular-nums">
              {summaryMetrics.otherCharges > 0
                ? `${formatCurrency(summaryMetrics.totalInterest, activeCurrency)} int. · ${formatCurrency(
                    summaryMetrics.otherCharges,
                    activeCurrency,
                  )} otros cargos`
                : `${formatCurrency(summaryMetrics.totalInterest, activeCurrency)} intereses`}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-card border border-border flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">
              {isEdit ? 'Cuotas restantes' : 'Cuotas del plan'}
            </span>
            <span className="text-base font-bold tracking-tight tabular-nums text-foreground">
              {summaryMetrics.count} cuotas
              {summaryMetrics.count > 0
                ? ` (#${summaryMetrics.firstNum}–#${summaryMetrics.lastNum})`
                : ''}
            </span>
            <span className="text-xs text-muted-foreground">
              {isEdit && editInit
                ? summaryMetrics.count === editInit.baselineMetrics.pendingCount
                  ? `${editInit.baselineMetrics.paidCount} pagadas quedan intactas`
                  : `Antes quedaban ${editInit.baselineMetrics.pendingCount} cuotas`
                : openingMode === 'ONGOING' && summaryMetrics.firstNum > 1
                  ? `Cuotas #1 a #${summaryMetrics.firstNum - 1} ya pagadas`
                  : 'Préstamo desde cuota #1'}
            </span>
          </div>
        </div>

        {/* Accounting Note in Create Mode */}
        {!isEdit && (
          <div className="p-3.5 rounded-xl bg-card border border-border text-xs text-muted-foreground">
            {openingMode === 'NEW' ? (
              <>
                Al guardar se creará la cuenta de pasivo{' '}
                <strong className="text-foreground">«{liabilityPreview.previewName}»</strong> por{' '}
                <strong className="text-foreground tabular-nums">
                  {formatCurrency(summaryMetrics.pendingCap, activeCurrency)}
                </strong>
                , acreditado en{' '}
                <strong className="text-foreground">
                  {disbursementAccount?.name || 'tu cuenta bancaria'}
                </strong>{' '}
                el {formatLoanShortDate(openingDate)}.
              </>
            ) : (
              <>
                Al guardar se creará la cuenta de pasivo{' '}
                <strong className="text-foreground">«{liabilityPreview.previewName}»</strong> por{' '}
                <strong className="text-foreground tabular-nums">
                  {formatCurrency(summaryMetrics.pendingCap, activeCurrency)}
                </strong>{' '}
                contra <strong className="text-foreground">Capital</strong> el{' '}
                {formatLoanShortDate(openingDate)}, sin alterar tus saldos bancarios.
              </>
            )}
          </div>
        )}

        {/* Capital Delta Reconciliation Panel (Edit Mode when capDiff !== 0) */}
        {hasCapitalDelta && (
          <div className="pt-4 border-t border-border space-y-3">
            <div>
              <p className="text-xs font-bold text-foreground">
                El capital pendiente cambió en {isCapDecrease ? '-' : '+'}{' '}
                {formatCurrency(Math.abs(editDelta.capDiff), activeCurrency)}
              </p>
              <p className="text-xs text-muted-foreground">
                Elegí cómo reflejar esta diferencia al guardar para mantener tu Balance al día.
              </p>
            </div>

            <div
              className="grid grid-cols-1 sm:grid-cols-3 gap-3"
              role="radiogroup"
              aria-label="Origen del ajuste de capital"
            >
              <button
                type="button"
                onClick={() => setAdjType('CASH_TRANSFER')}
                className={cn(
                  'p-3.5 rounded-2xl border-2 text-left transition cursor-pointer flex flex-col gap-1',
                  adjType === 'CASH_TRANSFER'
                    ? 'border-indigo-500 bg-card'
                    : 'border-border bg-card/70 hover:bg-card',
                )}
              >
                <Wallet className="w-4 h-4 text-indigo-600 dark:text-indigo-400 mb-0.5" />
                <span className="text-xs font-bold text-foreground">
                  {isCapDecrease ? 'Adelanté desde mi cuenta' : 'Ingresó dinero a mi cuenta'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {isCapDecrease
                    ? 'Salió de tu banco o efectivo para bajar la deuda.'
                    : 'Recibiste un desembolso o ampliación en tu banco.'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setAdjType('CATEGORY')}
                className={cn(
                  'p-3.5 rounded-2xl border-2 text-left transition cursor-pointer flex flex-col gap-1',
                  adjType === 'CATEGORY'
                    ? 'border-indigo-500 bg-card'
                    : 'border-border bg-card/70 hover:bg-card',
                )}
              >
                <Tag className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mb-0.5" />
                <span className="text-xs font-bold text-foreground">
                  {isCapDecrease ? 'Descuento o quita a favor' : 'Gasto sumado a la deuda'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {isCapDecrease
                    ? 'Imputa la rebaja a una categoría de Ingreso.'
                    : 'Imputa el recargo a una categoría de Gasto.'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setAdjType('CAPITAL_ADJUSTMENT')}
                className={cn(
                  'p-3.5 rounded-2xl border-2 text-left transition cursor-pointer flex flex-col gap-1',
                  adjType === 'CAPITAL_ADJUSTMENT'
                    ? 'border-indigo-500 bg-card'
                    : 'border-border bg-card/70 hover:bg-card',
                )}
              >
                <Landmark className="w-4 h-4 text-amber-600 dark:text-amber-400 mb-0.5" />
                <span className="text-xs font-bold text-foreground">Ajuste contra Capital</span>
                <span className="text-xs text-muted-foreground">
                  Corrección de saldo sin mover caja ni gastos.
                </span>
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              {adjType === 'CASH_TRANSFER' && (
                <div className="flex-1 min-w-0">
                  <AccountPickerSheet
                    label={
                      isCapDecrease
                        ? 'Cuenta desde donde pagaste *'
                        : 'Cuenta donde ingresó el dinero *'
                    }
                    accounts={localAccounts}
                    selectedAccountId={adjCashAccountId}
                    onSelect={(acc) => setAdjCashAccountId(acc.id)}
                    filterMode="CASH_BANK"
                    baseCurrency={activeCurrency}
                    onQuickCreateAccount={(initialName, suggestedType) =>
                      handleQuickCreateAccount(initialName, suggestedType, true, (newId) =>
                        setAdjCashAccountId(newId),
                      )
                    }
                  />
                </div>
              )}

              {adjType === 'CATEGORY' && (
                <div className="flex-1 min-w-0">
                  <AccountPickerSheet
                    label={isCapDecrease ? 'Categoría de Ingreso *' : 'Categoría de Gasto *'}
                    accounts={localAccounts}
                    selectedAccountId={adjCategoryAccountId}
                    onSelect={(acc) => setAdjCategoryAccountId(acc.id)}
                    filterMode={isCapDecrease ? 'INCOMES' : 'EXPENSES'}
                    prioritizeFinancialExpenses={!isCapDecrease}
                    baseCurrency={activeCurrency}
                    onQuickCreateAccount={(initialName, suggestedType) =>
                      handleQuickCreateAccount(
                        initialName,
                        suggestedType || (isCapDecrease ? AccountType.INCOME : AccountType.EXPENSE),
                        false,
                        (newId) => setAdjCategoryAccountId(newId),
                      )
                    }
                  />
                </div>
              )}

              {adjType === 'CAPITAL_ADJUSTMENT' && (
                <div className="flex-1 min-w-0 p-3 rounded-xl bg-card border border-border text-xs text-muted-foreground">
                  Se registrará automáticamente contra tu cuenta de{' '}
                  <strong className="text-foreground">Capital</strong> sin alterar tus saldos de
                  Caja ni el resultado del mes.
                </div>
              )}

              <div className="w-full sm:w-44 shrink-0">
                <label
                  className="block text-xs font-bold text-foreground mb-1"
                  htmlFor="edit-adj-date"
                >
                  Fecha del ajuste
                </label>
                <input
                  id="edit-adj-date"
                  type="date"
                  value={adjDate}
                  onChange={(e) => setAdjDate(e.target.value)}
                  className="w-full min-h-11 px-3 py-2 rounded-xl border border-input bg-card text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions (Clean inline footer, no sticky floating bar) */}
        <div className="pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            {isEdit ? (
              isEditDirty ? (
                <button
                  type="button"
                  onClick={handleResetEditToInitial}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-11 rounded-xl border border-border bg-card text-xs font-bold text-foreground hover:bg-muted cursor-pointer transition"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>Restaurar valores iniciales</span>
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">Sin modificaciones todavía.</span>
              )
            ) : (
              <span className="text-xs text-muted-foreground">
                Podrás editar cuotas o columnas más adelante en cualquier momento.
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href={isEdit && initialLoan ? `/loans/${initialLoan.id}` : '/loans'}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center px-4 py-2.5 min-h-11 rounded-xl border border-border bg-card text-xs font-bold text-foreground hover:bg-muted transition"
            >
              Cancelar
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 sm:flex-initial px-5 py-2.5 min-h-11 rounded-xl bg-brand-gradient text-white text-xs font-bold shadow-brand-glow-sm hover:opacity-95 disabled:opacity-50 cursor-pointer transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {submitting
                ? 'Guardando...'
                : isEdit
                  ? 'Guardar cambios del préstamo'
                  : 'Guardar Préstamo'}
            </button>
          </div>
        </div>
      </section>

      {quickCreateState && (
        <AccountModal
          onClose={() => setQuickCreateState(null)}
          initialName={quickCreateState.initialName}
          initialType={quickCreateState.initialType}
          initialIsCashOrBank={quickCreateState.isCashOrBank}
          parentCandidates={localAccounts}
          onSuccess={async (created) => {
            try {
              const summaryRes = await api.accounts.summary();
              const fresh = summaryRes?.accounts || localAccounts;
              setLocalAccounts(fresh);
              onAccountsChanged?.(fresh);
            } catch {
              // ignore refresh failure
            }
            if (created?.id) {
              quickCreateState.onCreated(created.id);
            }
            setQuickCreateState(null);
          }}
        />
      )}

      <LoanToast toast={toast} onDismiss={() => setToast(null)} />
    </form>
  );
}
