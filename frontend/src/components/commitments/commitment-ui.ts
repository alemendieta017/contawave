import { CommitmentDto, CommitmentStatus } from '@sistema-contable/shared';

const SPANISH_MONTHS_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

export function getTodayLocalIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatCommitmentDate(isoDate: string | null | undefined): string {
  if (!isoDate) return 'Sin fecha';
  const match = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(isoDate);
  const year = match[1];
  const monthIdx = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  const monthLabel = SPANISH_MONTHS_SHORT[monthIdx] || match[2];
  return `${day} ${monthLabel} ${year}`;
}

export function addFrequencyDate(
  startIso: string,
  index: number,
  frequency: 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY',
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startIso)) return startIso;
  const [y, m, d] = startIso.split('-').map(Number);
  if (frequency === 'MONTHLY') {
    const targetMonth = m - 1 + index;
    const base = new Date(y, targetMonth, 1);
    const maxDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const safeDay = Math.min(d, maxDay);
    const yr = base.getFullYear();
    const mo = String(base.getMonth() + 1).padStart(2, '0');
    const dy = String(safeDay).padStart(2, '0');
    return `${yr}-${mo}-${dy}`;
  }
  const daysStep = frequency === 'BIWEEKLY' ? 15 * index : 7 * index;
  const dt = new Date(y, m - 1, d + daysStep);
  const yr = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const dy = String(dt.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

export function splitAmountEvenly(total: number, count: number, decimals: number): number[] {
  if (count <= 0) return [];
  const factor = Math.pow(10, decimals);
  const totalUnits = Math.round(total * factor);
  const baseUnit = Math.floor(totalUnits / count);
  const remainder = totalUnits - baseUnit * count;
  return Array.from({ length: count }, (_, idx) => {
    const units = idx === count - 1 ? baseUnit + remainder : baseUnit;
    return units / factor;
  });
}

export function getStatusMeta(status: CommitmentStatus): {
  label: string;
  badgeClass: string;
  dotClass: string;
} {
  switch (status) {
    case 'OVERDUE':
      return {
        label: 'Vencido',
        badgeClass:
          'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60',
        dotClass: 'bg-rose-500',
      };
    case 'PARTIAL':
      return {
        label: 'Parcial',
        badgeClass:
          'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60',
        dotClass: 'bg-amber-500',
      };
    case 'PAID':
      return {
        label: 'Saldado',
        badgeClass:
          'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60',
        dotClass: 'bg-emerald-500',
      };
    case 'PENDING':
    default:
      return {
        label: 'Pendiente',
        badgeClass:
          'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/60',
        dotClass: 'bg-indigo-500',
      };
  }
}

export function getOriginSummaryLabel(c: CommitmentDto): string {
  if (c.originBadgeText) return c.originBadgeText;
  if (c.originType === 'CASH_TRANSFER') {
    const acct = c.cashAccountName || 'Cuenta líquida';
    return c.direction === 'INFLOW' ? `Préstamo desde ${acct}` : `Recibido en ${acct}`;
  }
  if (c.originType === 'CATEGORY') {
    const cat = c.categoryAccountName || 'Categoría';
    return c.direction === 'INFLOW' ? `Ingreso: ${cat}` : `Gasto: ${cat}`;
  }
  return 'Ajuste / saldo previo';
}

export function normalizeAmountInput(rawInput: string, decimals: number): string {
  if (decimals === 0) {
    return rawInput.replace(/\D/g, '');
  }

  // Strip thousand separator dots (es-PY format uses '.' for thousands and ',' for decimals)
  const stripped = rawInput.replace(/\./g, '').replace(',', '.');
  const cleaned = stripped.replace(/[^\d.]/g, '');
  const dotIndex = cleaned.indexOf('.');
  if (dotIndex === -1) return cleaned;

  const intPart = cleaned.slice(0, dotIndex);
  const decPart = cleaned
    .slice(dotIndex + 1)
    .replace(/\./g, '')
    .slice(0, decimals);
  return `${intPart}.${decPart}`;
}

export function formatAmountInput(rawNumeric: string | number, decimals: number): string {
  const str = typeof rawNumeric === 'number' ? String(rawNumeric) : rawNumeric;
  if (!str) return '';

  if (decimals === 0) {
    const digits = str.replace(/\D/g, '');
    if (!digits) return '';
    return Number(digits).toLocaleString('es-PY');
  }

  const normalized = normalizeAmountInput(str, decimals);
  if (!normalized) return '';
  const hasDot = normalized.includes('.');
  const [intPart, decPart] = normalized.split('.');
  const formattedInt = intPart ? Number(intPart).toLocaleString('es-PY') : '0';
  return hasDot ? `${formattedInt},${decPart ?? ''}` : formattedInt;
}

export function parseNumericInput(raw: string, decimals: number): number {
  if (decimals === 0) {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return 0;
    const num = Number(digits);
    return isNaN(num) ? 0 : Math.round(num);
  }
  const normalized = normalizeAmountInput(raw, decimals);
  const num = parseFloat(normalized);
  if (isNaN(num)) return 0;
  return Number(num.toFixed(decimals));
}
