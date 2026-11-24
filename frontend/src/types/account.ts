import type { AccountType } from '@sistema-contable/shared';

export interface AccountOption {
  id: string;
  name: string;
  type: AccountType;
  currencyId?: string;
  currencyCode?: string;
  currencySymbol?: string;
  decimalPlaces?: number;
  parentId?: string | null;
  systemRole?: string | null;
  isControlAccount?: boolean;
  controlType?: string | null;
  linkedLoanId?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
  balance?: number;
  isCashOrBank?: boolean;
}
