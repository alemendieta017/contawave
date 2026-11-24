import { LoanInstallmentStatus, LoanStatus } from '@sistema-contable/shared';
import type { AccountOption } from '../../types/account';
import {
  formatAmountInput,
  getTodayLocalIso,
  normalizeAmountInput,
  parseNumericInput,
} from '../commitments/commitment-ui';

export { formatAmountInput, getTodayLocalIso, normalizeAmountInput, parseNumericInput };

export type LoanColumnFillMode = 'ZERO' | 'FIXED' | 'PCT_CAPITAL' | 'PCT_COL';

export interface ClientScheduleRow {
  installmentNumber: number;
  dueDate: string;
  principalAmount: number;
  interestAmount: number;
  balanceBefore: number;
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

const FINANCIAL_EXPENSE_KEYWORDS = [
  'interés',
  'interes',
  'financ',
  'seguro',
  'iva',
  'impuesto',
  'comisi',
  'banco',
  'bancari',
  'mora',
  'cargo',
  'administrativ',
  'préstamo',
  'prestamo',
  'solidaridad',
  'tarjeta',
];

export function addMonthsIso(startIso: string, monthsToAdd: number): string {
  const match = String(startIso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return startIso;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const base = new Date(Date.UTC(year, month - 1 + monthsToAdd, 1));
  const maxDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  const safeDay = Math.min(day, maxDay);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(
    safeDay,
  ).padStart(2, '0')}`;
}

export function formatLoanShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(iso);
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatLoanBadgeDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(iso);
  const d = parseInt(match[3], 10);
  const mIdx = Math.max(0, parseInt(match[2], 10) - 1);
  return `${d} ${SPANISH_MONTHS_SHORT[mIdx] || match[2]}`;
}

export function roundToCurrencyDecimals(value: number, decimals: number): number {
  const safeDec = Math.max(0, Math.min(4, decimals));
  return Number(Number(value || 0).toFixed(safeDec));
}

export function calculateClientFrenchSchedule(params: {
  principal: number;
  annualRate: number;
  count: number;
  firstDueDate: string;
  startInstallmentNumber?: number;
  decimalPlaces?: number;
}): ClientScheduleRow[] {
  const count = Math.max(1, Math.min(240, Math.floor(params.count || 1)));
  const decimals = Math.max(0, Math.min(4, params.decimalPlaces ?? 0));
  const factor = Math.pow(10, decimals);
  const principal = Math.max(1 / factor, roundToCurrencyDecimals(params.principal || 0, decimals));
  const annualRate = Math.max(0, Number(params.annualRate || 0));
  const startNum = Math.max(1, Math.floor(params.startInstallmentNumber ?? 1));

  const monthlyRate = annualRate / 100 / 12;
  const pmt =
    monthlyRate > 0
      ? (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -count))
      : principal / count;

  let remainingUnits = Math.round(principal * factor);
  const rows: ClientScheduleRow[] = [];

  for (let i = 0; i < count; i++) {
    const balanceBefore = roundToCurrencyDecimals(remainingUnits / factor, decimals);
    const interestAmount = roundToCurrencyDecimals(balanceBefore * monthlyRate, decimals);

    let principalUnits: number;
    if (i === count - 1) {
      principalUnits = Math.max(1, remainingUnits);
    } else {
      const remainingAfter = count - 1 - i;
      const maxAllowedUnits = Math.max(1, remainingUnits - remainingAfter);
      const rawUnits = Math.round((pmt - interestAmount) * factor);
      principalUnits = Math.min(maxAllowedUnits, Math.max(1, rawUnits));
    }

    remainingUnits = Math.max(0, remainingUnits - principalUnits);

    rows.push({
      installmentNumber: startNum + i,
      dueDate: addMonthsIso(params.firstDueDate, i),
      principalAmount: roundToCurrencyDecimals(principalUnits / factor, decimals),
      interestAmount,
      balanceBefore,
    });
  }

  return rows;
}

export function computeColumnFillAmount(
  mode: LoanColumnFillMode,
  val: number,
  refColKey: string,
  balanceBefore: number,
  rowCharges: Record<string, number>,
  decimals: number,
): number {
  if (mode === 'ZERO') return 0;
  if (mode === 'FIXED') return roundToCurrencyDecimals(Math.max(0, val), decimals);
  if (mode === 'PCT_CAPITAL') {
    return roundToCurrencyDecimals(Math.max(0, balanceBefore * (val / 100)), decimals);
  }
  if (mode === 'PCT_COL') {
    const baseAmt = Number(rowCharges[refColKey] || 0);
    return roundToCurrencyDecimals(Math.max(0, baseAmt * (val / 100)), decimals);
  }
  return 0;
}

export function isFinancialExpenseName(name: string): boolean {
  const lower = (name || '').toLowerCase();
  return FINANCIAL_EXPENSE_KEYWORDS.some((kw) => lower.includes(kw));
}

export function pickDefaultInterestExpenseAccount(
  accounts: AccountOption[],
): AccountOption | undefined {
  const activeExpenses = accounts.filter(
    (a) =>
      a.status !== 'INACTIVE' && a.type === 'EXPENSE' && !a.isCashOrBank && !a.isControlAccount,
  );
  return (
    activeExpenses.find((a) => a.name.toLowerCase().includes('intereses y cargos')) ||
    activeExpenses.find((a) => a.name.toLowerCase().includes('interés')) ||
    activeExpenses.find((a) => a.name.toLowerCase().includes('interes')) ||
    activeExpenses.find((a) => isFinancialExpenseName(a.name)) ||
    activeExpenses[0]
  );
}

export function pickSuggestedExpenseAccount(
  accounts: AccountOption[],
  columnName: string,
): AccountOption | undefined {
  const activeExpenses = accounts.filter(
    (a) =>
      a.status !== 'INACTIVE' && a.type === 'EXPENSE' && !a.isCashOrBank && !a.isControlAccount,
  );
  const lower = columnName.toLowerCase();
  if (lower.includes('seguro')) {
    const match = activeExpenses.find((a) => a.name.toLowerCase().includes('seguro'));
    if (match) return match;
  }
  if (lower.includes('iva') || lower.includes('impuesto')) {
    const match = activeExpenses.find(
      (a) => a.name.toLowerCase().includes('iva') || a.name.toLowerCase().includes('impuesto'),
    );
    if (match) return match;
  }
  if (lower.includes('gasto') || lower.includes('adm') || lower.includes('comis')) {
    const match = activeExpenses.find(
      (a) =>
        a.name.toLowerCase().includes('administrativ') || a.name.toLowerCase().includes('comis'),
    );
    if (match) return match;
  }
  return pickDefaultInterestExpenseAccount(accounts);
}

export function resolveLiabilityAccountPreview(
  name: string,
  existingAccounts: AccountOption[],
  excludeAccountId?: string,
): { previewName: string; hasCollision: boolean } {
  const trimmed = (name || '').trim() || 'Nuevo Préstamo';
  const base = trimmed.slice(0, 120);
  const existingNames = new Set(
    existingAccounts
      .filter((a) => !excludeAccountId || a.id !== excludeAccountId)
      .map((a) => a.name.trim().toLowerCase()),
  );

  if (!existingNames.has(base.toLowerCase())) {
    return { previewName: base, hasCollision: false };
  }

  let suffix = 2;
  while (suffix < 1000) {
    const tag = ` (${suffix})`;
    const candidate = `${base.slice(0, 120 - tag.length).trimEnd()}${tag}`;
    if (!existingNames.has(candidate.toLowerCase())) {
      return { previewName: candidate, hasCollision: true };
    }
    suffix += 1;
  }

  return { previewName: base, hasCollision: true };
}

export function getLoanInstallmentStatusMeta(
  status: LoanInstallmentStatus,
  isOverdue: boolean,
): { label: string; badgeClass: string } {
  if (status === 'PAID') {
    return {
      label: 'Pagada',
      badgeClass:
        'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60',
    };
  }
  if (status === 'PARTIAL' && isOverdue) {
    return {
      label: 'Parcial · Vencida',
      badgeClass:
        'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60',
    };
  }
  if (status === 'PARTIAL') {
    return {
      label: 'Parcial',
      badgeClass:
        'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60',
    };
  }
  if (status === 'OVERDUE' || isOverdue) {
    return {
      label: 'Vencida',
      badgeClass:
        'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60',
    };
  }
  return {
    label: 'Pendiente',
    badgeClass:
      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60',
  };
}

export function getLoanStatusMeta(status: LoanStatus): { label: string; badgeClass: string } {
  if (status === 'SETTLED') {
    return {
      label: 'Saldado',
      badgeClass:
        'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60',
    };
  }
  if (status === 'CANCELLED') {
    return {
      label: 'Anulado',
      badgeClass:
        'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60',
    };
  }
  return {
    label: 'Activo',
    badgeClass:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60',
  };
}
