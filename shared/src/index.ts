import { z } from 'zod';

export enum AuthErrorCode {
  EMAIL_ALREADY_EXISTS = 'AUTH_EMAIL_ALREADY_EXISTS',
  INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  INVALID_CURRENT_PASSWORD = 'AUTH_INVALID_CURRENT_PASSWORD',
  EXPIRED_OR_INVALID_TOKEN = 'AUTH_EXPIRED_OR_INVALID_TOKEN',
  UNAUTHORIZED = 'AUTH_UNAUTHORIZED',
}

export const PASSWORD_REGEX = /^.{6,}$/;
export const PASSWORD_COMPLEXITY_MESSAGE = 'Password must be at least 6 characters long';

// Base User Schema
export const UserSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().min(1),
  email: z.string().email(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type User = z.infer<typeof UserSchema>;

export const RegisterRequestSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().regex(PASSWORD_REGEX, PASSWORD_COMPLEXITY_MESSAGE),
});

export type RegisterDto = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginDto = z.infer<typeof LoginRequestSchema>;
export type LoginRequest = LoginDto;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().regex(PASSWORD_REGEX, PASSWORD_COMPLEXITY_MESSAGE),
});

export type ChangePasswordDto = z.infer<typeof ChangePasswordRequestSchema>;

export const ForgotPasswordRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export type ForgotPasswordDto = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  newPassword: z.string().regex(PASSWORD_REGEX, PASSWORD_COMPLEXITY_MESSAGE),
});

export type ResetPasswordDto = z.infer<typeof ResetPasswordRequestSchema>;

export interface AuthResponse {
  access_token: string;
  user: {
    id: string;
    fullName: string;
    email: string;
    createdAt?: string;
  };
}

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  createdAt?: string;
}

// Account Types
export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}
export const AccountStatusSchema = z.nativeEnum(AccountStatus);

export const SystemRoleSchema = z.enum([
  'NET_INCOME',
  'RETAINED_EARNINGS',
  'CAPITAL',
  'ACCOUNTS_RECEIVABLE',
  'ACCOUNTS_PAYABLE',
]);
export type SystemRole = z.infer<typeof SystemRoleSchema>;

export const ControlAccountTypeSchema = z.enum(['RECEIVABLE', 'PAYABLE', 'LOAN', 'CREDIT_CARD']);
export type ControlAccountType = z.infer<typeof ControlAccountTypeSchema>;

export const TransactionOriginModuleSchema = z.enum([
  'MANUAL',
  'COMMITMENT',
  'LOAN',
  'CREDIT_CARD',
  'BALANCE_ADJUSTMENT',
]);
export type TransactionOriginModule = z.infer<typeof TransactionOriginModuleSchema>;

export const AccountType = {
  ASSET: 'ASSET',
  LIABILITY: 'LIABILITY',
  EQUITY: 'EQUITY',
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
} as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];
export const AccountTypeSchema = z.nativeEnum(AccountType);

// Create Account Request Schema
export const CreateAccountRequestSchema = z.object({
  name: z.string().min(1),
  type: AccountTypeSchema,
  currencyId: z.string().uuid(),
  parentId: z.string().uuid().optional().nullable(),
  isCashOrBank: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
  systemRole: SystemRoleSchema.nullable().optional(),
  initialBalance: z.number().optional(),
});

export type CreateAccountRequest = z.infer<typeof CreateAccountRequestSchema>;

// Adjust Account Balance Schema
export const AdjustAccountBalanceRequestSchema = z.object({
  targetBalance: z.number(),
  adjustmentType: z.enum(['CAPITAL', 'CATEGORY']),
  categoryId: z.string().uuid().optional().nullable(),
  description: z.string().optional(),
});

export type AdjustAccountBalanceRequest = z.infer<typeof AdjustAccountBalanceRequestSchema>;

// Update Account Request Schema
export const UpdateAccountRequestSchema = z.object({
  name: z.string().min(1).optional(),
  isCashOrBank: z.boolean().optional(),
  status: AccountStatusSchema.optional(),
});

export type UpdateAccountRequest = z.infer<typeof UpdateAccountRequestSchema>;

// Transaction entry modes
export enum TransactionMode {
  QUICK = 'QUICK',
  FREE_JOURNAL = 'FREE_JOURNAL',
}
export const TransactionModeSchema = z.nativeEnum(TransactionMode);

// Operation template for Quick Transaction
export enum QuickOperationType {
  EXPENSE = 'EXPENSE',
  INCOME = 'INCOME',
  TRANSFER = 'TRANSFER',
}
export const QuickOperationTypeSchema = z.nativeEnum(QuickOperationType);

// Journal Entry Request Schema
export const JournalEntryRequestSchema = z.object({
  accountId: z.string().uuid(),
  entryType: z.enum(['DEBIT', 'CREDIT']),
  amount: z.number().positive(),
});

export type JournalEntryRequest = z.infer<typeof JournalEntryRequestSchema>;

// Create Transaction Request Schema
export const CreateTransactionRequestSchema = z.object({
  accountingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format must be YYYY-MM-DD'),
  description: z.string().min(1),
  entries: z.array(JournalEntryRequestSchema).min(2),
});

export type CreateTransactionRequest = z.infer<typeof CreateTransactionRequestSchema>;

export const UpdateTransactionRequestSchema = CreateTransactionRequestSchema;
export type UpdateTransactionRequest = CreateTransactionRequest;

// Ensure Period Schema
export const EnsurePeriodRequestSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be in YYYY-MM format'),
});

export type EnsurePeriodRequest = z.infer<typeof EnsurePeriodRequestSchema>;

export interface EnsurePeriodResponse {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  userId: string;
  created: boolean;
}

export interface PeriodResponse {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  userId: string;
}

// Update Period Schema
export const UpdatePeriodRequestSchema = z.object({
  status: z.enum(['OPEN', 'CLOSED', 'PLANNING']),
});

export type UpdatePeriodRequest = z.infer<typeof UpdatePeriodRequestSchema>;

// Update Account Flags (isCashOrBank)
export const UpdateAccountFlagsRequestSchema = z.object({
  isCashOrBank: z.boolean(),
});

export type UpdateAccountFlagsRequest = z.infer<typeof UpdateAccountFlagsRequestSchema>;

// Update Budget Items
export const BudgetItemUpdateSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.number(),
});

export const UpdateBudgetItemsRequestSchema = z.object({
  items: z.array(BudgetItemUpdateSchema),
});

export type UpdateBudgetItemsRequest = z.infer<typeof UpdateBudgetItemsRequestSchema>;

// Replicate Budget Item to Fiscal Year
export const ReplicateBudgetItemRequestSchema = z.object({
  periodId: z.string().uuid(),
  accountId: z.string().uuid(),
  amount: z.number(),
});

export type ReplicateBudgetItemRequest = z.infer<typeof ReplicateBudgetItemRequestSchema>;

// Cash Flow Direction Enum
export enum CashFlowDirection {
  INGRESO_EFECTIVO = 'INGRESO_EFECTIVO',
  EGRESO_EFECTIVO = 'EGRESO_EFECTIVO',
}

export const CashFlowDirectionSchema = z.nativeEnum(CashFlowDirection);

// Budget Planning Matrix & Execution Control
export enum BudgetDriverType {
  FLAT_PRORATE = 'FLAT_PRORATE',
  WEIGHTED_HISTORICAL = 'WEIGHTED_HISTORICAL',
  PERCENTAGE_GROWTH = 'PERCENTAGE_GROWTH',
  FORWARD_FILL = 'FORWARD_FILL',
  PRIOR_YEAR_ACTUAL = 'PRIOR_YEAR_ACTUAL',
}

export const BudgetDriverTypeSchema = z.nativeEnum(BudgetDriverType);

export enum FlowIntention {
  PAY = 'PAY',
  RECEIVE = 'RECEIVE',
  INVEST = 'INVEST',
  SAVE = 'SAVE',
  DIVEST = 'DIVEST',
}

export const FlowIntentionSchema = z.nativeEnum(FlowIntention).nullable().optional();

export enum BudgetGaugeStatus {
  NORMAL = 'NORMAL',
  WARNING = 'WARNING',
  OVERBUDGET = 'OVERBUDGET',
}

export const BudgetGaugeStatusSchema = z.nativeEnum(BudgetGaugeStatus);

export { BudgetGaugeStatus as GaugeStatus };
export { BudgetGaugeStatusSchema as GaugeStatusSchema };

export enum BudgetMatrixSectionKey {
  INGRESOS = 'INGRESOS',
  GASTOS_VIDA = 'GASTOS_VIDA',
  AHORRO_INVERSIONES = 'AHORRO_INVERSIONES',
  DEUDAS_FINANCIACION = 'DEUDAS_FINANCIACION',
  // Deprecated legacy aliases for transitional compatibility
  EGRESOS = 'EGRESOS',
  FINANCIAMIENTO_AHORRO = 'FINANCIAMIENTO_AHORRO',
}

export const BudgetMatrixSectionKeySchema = z.nativeEnum(BudgetMatrixSectionKey);

export const MatrixCellUpdateSchema = z.object({
  periodId: z.string().uuid(),
  accountId: z.string().uuid(),
  subRowId: z.string().nullable().optional(),
  subRowLabel: z.string().nullable().optional(),
  amount: z.number().min(0),
  cashFlowDirection: CashFlowDirectionSchema.nullable().optional(),
  flowIntention: FlowIntentionSchema,
  isDeleted: z.boolean().optional(),
});

export type MatrixCellUpdate = z.infer<typeof MatrixCellUpdateSchema>;

export const UpdateBudgetMatrixRequestSchema = z.object({
  fiscalYearId: z.string().uuid().optional(),
  updates: z.array(MatrixCellUpdateSchema),
});

export type UpdateBudgetMatrixRequest = z.infer<typeof UpdateBudgetMatrixRequestSchema>;

export const BatchUpdateBudgetMatrixRequestSchema = z.object({
  updates: z.array(MatrixCellUpdateSchema),
});

export type BatchUpdateBudgetMatrixRequest = z.infer<typeof BatchUpdateBudgetMatrixRequestSchema>;

export interface BatchUpdateBudgetMatrixResponse {
  success: boolean;
  updatedCount: number;
}

export const ExtendBudgetMatrixRequestSchema = z.object({
  targetPeriod: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Target period must be in YYYY-MM format'),
  copyFromPrevious: z.boolean().optional().default(true),
});

export type ExtendBudgetMatrixRequest = z.infer<typeof ExtendBudgetMatrixRequestSchema>;

export interface ExtendBudgetMatrixResponse {
  success: boolean;
  provisionedPeriod: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    status: string;
  };
  itemsCopied: number;
}

export interface UpdateBudgetMatrixResponse {
  success: boolean;
  updatedCount: number;
}

export const ApplyBudgetDriverRequestSchema = z.object({
  fiscalYearId: z.string().uuid().optional(),
  accountId: z.string().uuid(),
  subRowId: z.string().nullable().optional(),
  driverType: BudgetDriverTypeSchema,
  annualTotal: z.number().optional().nullable(),
  growthPercentage: z.number().optional().nullable(),
  sourcePeriodId: z.string().uuid().optional().nullable(),
});

export type ApplyBudgetDriverRequest = z.infer<typeof ApplyBudgetDriverRequestSchema>;

export interface ApplyBudgetDriverResponse {
  success: boolean;
  accountId: string;
  monthlyAmounts: Record<string, number>;
}

export const BaselineActualsRequestSchema = z.object({
  fiscalYearId: z.string().uuid().optional(),
  adjustmentPercentage: z.number().default(0),
  accountIds: z.array(z.string().uuid()).optional(),
});

export type BaselineActualsRequest = z.infer<typeof BaselineActualsRequestSchema>;

export interface BaselineActualsResponse {
  success: boolean;
  matrix: Array<{
    accountId: string;
    amounts: Record<string, number>;
  }>;
}

export const TransferBudgetFundsRequestSchema = z.object({
  periodId: z.string().uuid(),
  sourceAccountId: z.string().uuid(),
  targetAccountId: z.string().uuid(),
  amount: z.number().positive(),
  reason: z.string().optional().nullable(),
});

export type TransferBudgetFundsRequest = z.infer<typeof TransferBudgetFundsRequestSchema>;

export interface TransferBudgetFundsResponse {
  success: boolean;
  reassignmentId: string;
  updatedSourceAvailable: number;
  updatedTargetAvailable: number;
}

export interface BudgetMatrixPeriod {
  id: string;
  name: string;
  friendlyName: string;
  status: string;
}

export interface BudgetMatrixRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  parentId?: string | null;
  isParent?: boolean;
  subRowId?: string | null;
  subRowLabel?: string | null;
  cashFlowDirection?: CashFlowDirection | null;
  amounts: Record<string, number>;
  flowIntentions?: Record<string, FlowIntention | null>;
  rowTotal: number;
}

export interface BudgetMatrixSection {
  sectionKey: BudgetMatrixSectionKey | string;
  sectionTitle: string;
  rows: BudgetMatrixRow[];
  sectionTotals: Record<string, number> & { total: number };
}

export const BudgetMatrixSummarySchema = z.object({
  totalInflows: z.record(z.string(), z.number()),
  totalOutflows: z.record(z.string(), z.number()),
  netMonthlyFlow: z.record(z.string(), z.number()),
  cumulativeNetFlow: z.record(z.string(), z.number()),
});

export interface BudgetMatrixSummary {
  totalInflows: Record<string, number> & { total: number };
  totalOutflows: Record<string, number> & { total: number };
  netMonthlyFlow: Record<string, number> & { total: number };
  cumulativeNetFlow: Record<string, number> & { total: number };
}

export interface RollingCashFlowSummary {
  totalInflows: Record<string, number> & { total: number };
  operatingExpenses: Record<string, number> & { total: number };
  operatingSurplus: Record<string, number> & { total: number };
  investmentsAndSavings: Record<string, number> & { total: number };
  debtFinancing: Record<string, number> & { total: number };
  netCashFlow: Record<string, number> & { total: number };
  openingCash: Record<string, number>;
  closingCash: Record<string, number>;
  shortfallAlerts: Record<string, { isNegative: boolean; shortfall: number }>;
}

export interface RollingBudgetMatrixResponse {
  startPeriod: string;
  monthsCount: number;
  periods: BudgetMatrixPeriod[];
  sections: BudgetMatrixSection[];
  cashFlowForecast: RollingCashFlowSummary;
}

export interface BudgetMatrixResponse {
  fiscalYearId?: string;
  fiscalYearName?: string;
  startPeriod?: string;
  monthsCount?: number;
  periods: BudgetMatrixPeriod[];
  sections?: BudgetMatrixSection[];
  summary?: BudgetMatrixSummary;
  rows?: BudgetMatrixRow[];
  categoryTotals?: Record<string, Record<string, number> & { total: number }>;
  cashFlowForecast?: RollingCashFlowSummary;
}

export interface BudgetControlItem {
  accountId: string;
  accountName: string;
  accountCode?: string;
  subRowId?: string | null;
  subRowLabel?: string | null;
  cashFlowDirection?: CashFlowDirection | null;
  budgeted: number;
  executed: number;
  committed: number;
  available: number;
  consumptionPercentage: number;
  gaugeStatus: BudgetGaugeStatus;
}

export interface BudgetControlSection {
  sectionKey: BudgetMatrixSectionKey | string;
  sectionTitle: string;
  budgeted: number;
  executed: number;
  committed: number;
  available: number;
  consumptionPercentage: number;
  gaugeStatus: BudgetGaugeStatus;
  items: BudgetControlItem[];
}

export interface BudgetControlCategory {
  categoryName: string;
  accountType: string;
  budgeted: number;
  executed: number;
  committed: number;
  available: number;
  consumptionPercentage: number;
  gaugeStatus: BudgetGaugeStatus;
  items: BudgetControlItem[];
}

export interface BudgetControlSummary {
  totalBudgeted: number;
  totalExecuted: number;
  totalCommitted: number;
  totalAvailable: number;
  overallConsumptionPercentage: number;
  overallGaugeStatus: BudgetGaugeStatus;
}

export interface BudgetControlResponse {
  periodId: string;
  periodName: string;
  friendlyName: string;
  isLocked: boolean;
  summary: BudgetControlSummary;
  sections?: BudgetControlSection[];
  categories?: BudgetControlCategory[];
}

export interface MobilePlanningState {
  activePeriodId: string;
  activePeriodIndex: number;
  expandedAccordionSections: Set<BudgetMatrixSectionKey>;
  deepDiveRow: BudgetMatrixRow | null;
  isDeepDiveOpen: boolean;
  isOptionsMenuOpen: boolean;
  activeMenuRow: BudgetMatrixRow | null;
}

export interface DeepDiveDistributionParams {
  type: 'FLAT' | 'COPY_JAN' | 'PRIOR_YEAR';
  annualTotal?: number;
  percentageAdjustment?: number;
}

// Danger Zone Actions & Schemas
export enum DangerZoneAction {
  FACTORY_RESET = 'FACTORY_RESET',
  DELETE_ACCOUNT = 'DELETE_ACCOUNT',
}

export const FACTORY_RESET_PHRASE = 'RESTABLECER DATOS';
export const DELETE_ACCOUNT_PHRASE = 'ELIMINAR MI CUENTA';

export const FactoryResetRequestSchema = z.object({
  confirmationPhrase: z.literal(FACTORY_RESET_PHRASE, {
    errorMap: () => ({ message: `Debe escribir exactamente "${FACTORY_RESET_PHRASE}"` }),
  }),
  currentPassword: z.string().min(1, 'La contraseña actual es requerida'),
});

export type FactoryResetRequest = z.infer<typeof FactoryResetRequestSchema>;

export const DeleteAccountRequestSchema = z.object({
  confirmationPhrase: z.string().refine((val) => val === DELETE_ACCOUNT_PHRASE, {
    message: `Debe escribir exactamente "${DELETE_ACCOUNT_PHRASE}"`,
  }),
  currentPassword: z.string().min(1, 'La contraseña actual es requerida'),
});

export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequestSchema>;

export const DangerZoneResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  action: z.nativeEnum(DangerZoneAction),
  timestamp: z.string().datetime(),
});

export type DangerZoneResponse = z.infer<typeof DangerZoneResponseSchema>;

export interface StarterAccountDefinition {
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  isCashOrBank?: boolean;
  systemRole?: SystemRole;
  isControlAccount?: boolean;
  controlType?: ControlAccountType;
}

export const DEFAULT_STARTER_ACCOUNTS: StarterAccountDefinition[] = [
  // Cuenta de Sistema obligatoria para patrimonio y saldos iniciales
  { name: 'Capital', type: 'EQUITY', systemRole: 'CAPITAL' },
  {
    name: 'Cuentas por Cobrar',
    type: AccountType.ASSET,
    isCashOrBank: false,
    systemRole: 'ACCOUNTS_RECEIVABLE',
    isControlAccount: true,
    controlType: 'RECEIVABLE',
  },
  {
    name: 'Cuentas por Pagar',
    type: AccountType.LIABILITY,
    isCashOrBank: false,
    systemRole: 'ACCOUNTS_PAYABLE',
    isControlAccount: true,
    controlType: 'PAYABLE',
  },
  {
    name: 'Intereses y Cargos Financieros',
    type: AccountType.EXPENSE,
    isCashOrBank: false,
  },
];

// Tactical Commitments & Recurring Schedules
export enum RecurringFrequency {
  MONTHLY = 'MONTHLY',
  BIWEEKLY = 'BIWEEKLY',
  ANNUALLY = 'ANNUALLY',
}
export const RecurringFrequencySchema = z.nativeEnum(RecurringFrequency);

export enum FlowType {
  INFLOW = 'INFLOW',
  OUTFLOW = 'OUTFLOW',
}
export const FlowTypeSchema = z.nativeEnum(FlowType);

export const CreateRecurringScheduleRequestSchema = z.object({
  name: z.string().min(1).max(100),
  flowType: FlowTypeSchema,
  estimatedAmount: z.number().positive(),
  frequency: RecurringFrequencySchema.default(RecurringFrequency.MONTHLY),
  dueDay: z.number().int().min(1).max(31),
  accountId: z.string().uuid(),
  categoryId: z.string().uuid(),
  metadata: z.record(z.any()).optional().nullable(),
});

export type CreateRecurringScheduleRequest = z.infer<typeof CreateRecurringScheduleRequestSchema>;

export const UpdateRecurringScheduleRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  flowType: FlowTypeSchema.optional(),
  estimatedAmount: z.number().positive().optional(),
  frequency: RecurringFrequencySchema.optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.any()).optional().nullable(),
});

export type UpdateRecurringScheduleRequest = z.infer<typeof UpdateRecurringScheduleRequestSchema>;

export interface RecurringScheduleDto {
  id: string;
  name: string;
  flowType: FlowType | 'INFLOW' | 'OUTFLOW';
  estimatedAmount: number;
  frequency: RecurringFrequency | 'MONTHLY' | 'BIWEEKLY' | 'ANNUALLY';
  dueDay: number;
  accountId: string;
  categoryId: string;
  accountName?: string;
  categoryName?: string;
  isActive: boolean;
  metadata?: Record<string, any> | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface VirtualCalendarEvent {
  scheduleId: string;
  name: string;
  flowType: FlowType | 'INFLOW' | 'OUTFLOW';
  date: string;
  estimatedAmount: number;
  accountId: string;
  accountName?: string;
  categoryId: string;
  categoryName?: string;
  isSettled: boolean;
}

export interface CalendarPreviewResponse {
  startDate: string;
  endDate: string;
  virtualEvents: VirtualCalendarEvent[];
  projectedNetCommitments: number;
}

export const SettleRecurringScheduleRequestSchema = z.object({
  occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format must be YYYY-MM-DD'),
  actualAmount: z.number().positive(),
  description: z.string().min(1),
});

export type SettleRecurringScheduleRequest = z.infer<typeof SettleRecurringScheduleRequestSchema>;

export interface SettleRecurringScheduleResponse {
  success: boolean;
  transactionId: string;
  settledDate: string;
  amount: number;
  balanceCascadeUpdated: boolean;
}

// Net Worth Evolution Time-Series
export interface NetWorthEvolutionPoint {
  period: string;
  date: string;
  assets: number;
  liabilities: number;
  netWorth: number;
}

export interface NetWorthEvolutionResponse {
  history: NetWorthEvolutionPoint[];
  latest: {
    assets: number;
    liabilities: number;
    netWorth: number;
  };
  change12Months: number;
  changePercentage: number;
}

// Spec 00: Contratos de Rolling Forecast & Fuentes de Flujo Programado
export const CommitmentFlowDirectionSchema = z.enum(['INFLOW', 'OUTFLOW']);
export type CommitmentFlowDirection = z.infer<typeof CommitmentFlowDirectionSchema>;

export const CommitmentSourceTypeSchema = z.enum(['COMMITMENT', 'LOAN', 'CREDIT_CARD']);
export type CommitmentSourceType = z.infer<typeof CommitmentSourceTypeSchema>;

export interface ScheduledCashFlowItem {
  dueDate: string; // YYYY-MM-DD
  periodName: string; // YYYY-MM
  amount: number; // Monto pendiente > 0 en moneda base
  direction: CommitmentFlowDirection;
  categoryAccountId: string; // Cuenta de ingreso/gasto o cuenta de activo/pasivo de control
  controlAccountId?: string; // Cuenta de control (Cuentas por Cobrar / Cuentas por Pagar)
  sourceType: CommitmentSourceType;
  sourceId: string; // ID de la cuota
  commitmentId?: string; // ID del compromiso padre
  loanId?: string; // ID del préstamo padre
  contactId?: string;
  contactName?: string;
  label: string;
}

export interface CashFlowCommitmentSource {
  getScheduledCashFlowItems(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<ScheduledCashFlowItem[]>;
}

export interface VirtualContactSubRow {
  contactId: string;
  contactName: string;
  amount: number;
  hasNoDate?: boolean;
  valuesByPeriod?: Record<string, number>;
}

// Spec 01: Contactos y Compromisos (Pagos y Cobros)
export const CreateContactRequestSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  notes: z.string().max(1000).optional().nullable(),
});
export type CreateContactRequest = z.infer<typeof CreateContactRequestSchema>;

export const UpdateContactRequestSchema = CreateContactRequestSchema.partial();
export type UpdateContactRequest = z.infer<typeof UpdateContactRequestSchema>;

export interface ContactDto {
  id: string;
  name: string;
  notes: string | null;
  createdAt: string;
  activeReceivable?: number;
  activePayable?: number;
  commitmentCount?: number;
}

export const CommitmentOriginTypeSchema = z.enum([
  'CATEGORY',
  'CASH_TRANSFER',
  'CAPITAL_ADJUSTMENT',
]);
export type CommitmentOriginType = z.infer<typeof CommitmentOriginTypeSchema>;

export const CommitmentStatusSchema = z.enum(['PENDING', 'PARTIAL', 'PAID', 'OVERDUE']);
export type CommitmentStatus = z.infer<typeof CommitmentStatusSchema>;

export const SettlementTypeSchema = z.enum(['CASH', 'FORGIVEN']);
export type SettlementType = z.infer<typeof SettlementTypeSchema>;

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const CommitmentInstallmentInputSchema = z.object({
  dueDate: z.string().regex(ISO_DATE_REGEX, 'Formato debe ser YYYY-MM-DD').nullable().optional(),
  amount: z.number().positive('El monto de la cuota debe ser mayor a 0'),
});
export type CommitmentInstallmentInput = z.infer<typeof CommitmentInstallmentInputSchema>;

export const CreateCommitmentRequestSchema = z
  .object({
    contactId: z.string().uuid('Contacto inválido'),
    direction: CommitmentFlowDirectionSchema,
    originType: CommitmentOriginTypeSchema,
    description: z.string().trim().min(1, 'La descripción es obligatoria').max(255),
    notes: z.string().max(2000).optional().nullable(),
    totalAmount: z.number().positive('El monto total debe ser mayor a 0'),
    categoryAccountId: z.string().uuid().optional().nullable(),
    cashAccountId: z.string().uuid().optional().nullable(),
    accountingDate: z.string().regex(ISO_DATE_REGEX, 'Formato debe ser YYYY-MM-DD').optional(),
    installments: z.array(CommitmentInstallmentInputSchema).min(1, 'Debe incluir al menos 1 cuota'),
  })
  .superRefine((data, ctx) => {
    const sum = data.installments.reduce((acc, item) => acc + item.amount, 0);
    if (Math.abs(sum - data.totalAmount) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La suma de las cuotas debe coincidir con el monto total del compromiso',
        path: ['installments'],
      });
    }
    if (data.originType === 'CATEGORY' && !data.categoryAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Debe seleccionar una categoría para el origen CATEGORY',
        path: ['categoryAccountId'],
      });
    }
    if (data.originType === 'CASH_TRANSFER' && !data.cashAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Debe seleccionar una cuenta de efectivo/banco para el origen CASH_TRANSFER',
        path: ['cashAccountId'],
      });
    }
  });
export type CreateCommitmentRequest = z.infer<typeof CreateCommitmentRequestSchema>;

export const UpdateCommitmentRequestSchema = z.object({
  contactId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(255).optional(),
  notes: z.string().max(2000).optional().nullable(),
  originType: CommitmentOriginTypeSchema.optional(),
  categoryAccountId: z.string().uuid().optional().nullable(),
  cashAccountId: z.string().uuid().optional().nullable(),
});
export type UpdateCommitmentRequest = z.infer<typeof UpdateCommitmentRequestSchema>;

export const AddCommitmentInstallmentRequestSchema = z.object({
  amount: z.number().positive('El monto debe ser mayor a 0'),
  dueDate: z.string().regex(ISO_DATE_REGEX, 'Formato debe ser YYYY-MM-DD').nullable().optional(),
});
export type AddCommitmentInstallmentRequest = z.infer<typeof AddCommitmentInstallmentRequestSchema>;

export const SettleCommitmentInstallmentRequestSchema = z.object({
  cashAccountId: z.string().uuid('Debe seleccionar una cuenta de efectivo o banco'),
  amount: z.number().positive('El monto debe ser mayor a 0'),
  settledAt: z.string().regex(ISO_DATE_REGEX, 'Formato debe ser YYYY-MM-DD'),
  newDueDateForRemainder: z
    .string()
    .regex(ISO_DATE_REGEX, 'Formato debe ser YYYY-MM-DD')
    .nullable()
    .optional(),
});
export type SettleCommitmentInstallmentRequest = z.infer<
  typeof SettleCommitmentInstallmentRequestSchema
>;

export const ForgiveCommitmentInstallmentRequestSchema = z.object({
  settledAt: z.string().regex(ISO_DATE_REGEX, 'Formato debe ser YYYY-MM-DD').optional(),
  expenseAccountId: z.string().uuid().optional().nullable(),
  reason: z.string().max(500).optional(),
});
export type ForgiveCommitmentInstallmentRequest = z.infer<
  typeof ForgiveCommitmentInstallmentRequestSchema
>;

export const RescheduleCommitmentInstallmentRequestSchema = z.object({
  dueDate: z.string().regex(ISO_DATE_REGEX, 'Formato debe ser YYYY-MM-DD').nullable(),
  amount: z.number().positive('El monto debe ser mayor a 0').optional(),
});
export type RescheduleCommitmentInstallmentRequest = z.infer<
  typeof RescheduleCommitmentInstallmentRequestSchema
>;

export interface CommitmentSettlementDto {
  id: string;
  installmentId: string;
  transactionId: string;
  journalEntryId: string;
  settlementType: SettlementType;
  amount: number;
  settledAt: string;
  createdAt: string;
  cashAccountId?: string | null;
  cashAccountName?: string | null;
}

export interface CommitmentInstallmentDto {
  id: string;
  commitmentId: string;
  installmentNumber: number;
  dueDate: string | null;
  amount: number;
  settledAmount: number;
  pendingAmount: number;
  status: CommitmentStatus;
  settlements: CommitmentSettlementDto[];
}

export interface LinkedTransactionEntryDto {
  accountId: string;
  accountName: string;
  entryType: 'DEBIT' | 'CREDIT';
  amount: number;
}

export interface LinkedTransactionDto {
  id: string;
  accountingDate: string;
  description: string;
  status: string;
  entries: LinkedTransactionEntryDto[];
}

export interface CommitmentDto {
  id: string;
  contactId: string;
  contactName: string;
  direction: CommitmentFlowDirection;
  originType: CommitmentOriginType;
  originBadgeText: string;
  description: string;
  notes: string | null;
  totalAmount: number;
  settledAmount: number;
  pendingAmount: number;
  status: CommitmentStatus;
  hasNoDateInstallments: boolean;
  nextDueDate: string | null;
  categoryAccountId: string | null;
  categoryAccountName: string | null;
  cashAccountId: string | null;
  cashAccountName: string | null;
  controlAccountId: string;
  controlAccountName: string;
  initialTransactionId: string;
  initialTransaction?: LinkedTransactionDto | null;
  createdAt: string;
  installments: CommitmentInstallmentDto[];
}

export interface CommitmentKpiSummary {
  receivableTotal: number;
  payableTotal: number;
  netBalance: number;
  receivableInstallmentsCount: number;
  overdueReceivableCount: number;
  overduePayableCount: number;
  noDateCount: number;
  payableInstallmentsCount: number;
  nextPayableDueDate: string | null;
}

export interface CommitmentsListResponse {
  kpis: CommitmentKpiSummary;
  commitments: CommitmentDto[];
}

// Spec 02: Préstamos y Deuda Bancaria (Plan Maleable y Rubros a Medida)
export const LoanStatusSchema = z.enum(['ACTIVE', 'SETTLED', 'CANCELLED']);
export type LoanStatus = z.infer<typeof LoanStatusSchema>;

export const LoanOpeningModeSchema = z.enum(['NEW', 'ONGOING']);
export type LoanOpeningMode = z.infer<typeof LoanOpeningModeSchema>;

export const LoanInstallmentStatusSchema = z.enum(['PENDING', 'PARTIAL', 'PAID', 'OVERDUE']);
export type LoanInstallmentStatus = z.infer<typeof LoanInstallmentStatusSchema>;

export const LoanCapitalAdjustmentTypeSchema = z.enum([
  'CASH_TRANSFER',
  'CATEGORY',
  'CAPITAL_ADJUSTMENT',
]);
export type LoanCapitalAdjustmentType = z.infer<typeof LoanCapitalAdjustmentTypeSchema>;

export const LoanChargeColumnInputSchema = z.object({
  id: z.string().uuid().optional(),
  clientKey: z.string().trim().min(1, 'La clave de columna es obligatoria').max(80),
  name: z.string().trim().min(1, 'El nombre de la columna es obligatorio').max(80),
  expenseAccountId: z.string().uuid('Categoría de gasto inválida'),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).optional().default(0),
});
export type LoanChargeColumnInput = z.infer<typeof LoanChargeColumnInputSchema>;

export const LoanInstallmentInputSchema = z.object({
  id: z.string().uuid().optional(),
  installmentNumber: z.number().int().min(1, 'El número de cuota debe ser mayor o igual a 1'),
  dueDate: z.string().regex(ISO_DATE_REGEX, 'Formato debe ser YYYY-MM-DD'),
  principalAmount: z.number().positive('El capital de cada cuota debe ser mayor a 0'),
  charges: z
    .record(z.string(), z.number().min(0, 'Los cargos no pueden ser negativos'))
    .optional()
    .default({}),
});
export type LoanInstallmentInput = z.infer<typeof LoanInstallmentInputSchema>;

export const CreateLoanRequestSchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre del préstamo es obligatorio').max(120),
    currencyId: z.string().uuid('Moneda inválida').optional(),
    openingMode: LoanOpeningModeSchema,
    openingDate: z.string().regex(ISO_DATE_REGEX, 'Formato debe ser YYYY-MM-DD'),
    disbursementAccountId: z.string().uuid('Cuenta de acreditación inválida').nullable().optional(),
    defaultPaymentAccountId: z
      .string()
      .uuid('Cuenta habitual de pago inválida')
      .nullable()
      .optional(),
    annualRate: z
      .number()
      .min(0, 'La tasa no puede ser negativa')
      .max(999.9999)
      .optional()
      .default(0),
    startInstallmentNumber: z.number().int().min(1).optional().default(1),
    totalInstallmentsCount: z.number().int().min(1).optional(),
    chargeColumns: z.array(LoanChargeColumnInputSchema).optional().default([]),
    installments: z.array(LoanInstallmentInputSchema).min(1, 'Debe incluir al menos 1 cuota'),
  })
  .superRefine((data, ctx) => {
    if (data.openingMode === 'NEW' && !data.disbursementAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Debe seleccionar la cuenta bancaria donde ingresó el desembolso',
        path: ['disbursementAccountId'],
      });
    }
    const seenKeys = new Set<string>();
    for (const col of data.chargeColumns || []) {
      if (seenKeys.has(col.clientKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Columna duplicada: ${col.clientKey}`,
          path: ['chargeColumns'],
        });
        break;
      }
      seenKeys.add(col.clientKey);
    }
    const seenNumbers = new Set<number>();
    for (const inst of data.installments) {
      if (seenNumbers.has(inst.installmentNumber)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Número de cuota duplicado: #${inst.installmentNumber}`,
          path: ['installments'],
        });
        break;
      }
      seenNumbers.add(inst.installmentNumber);
    }
  });
export type CreateLoanRequest = z.infer<typeof CreateLoanRequestSchema>;

export const PayLoanInstallmentRequestSchema = z
  .object({
    paymentAccountId: z.string().uuid('Debe seleccionar una cuenta de pago'),
    paidAt: z.string().regex(ISO_DATE_REGEX, 'Formato debe ser YYYY-MM-DD'),
    allocatedPrincipal: z.number().min(0, 'El capital pagado no puede ser negativo'),
    allocatedCharges: z
      .record(z.string(), z.number().min(0, 'Los cargos no pueden ser negativos'))
      .optional()
      .default({}),
  })
  .superRefine((data, ctx) => {
    const chargesSum = Object.values(data.allocatedCharges || {}).reduce(
      (sum, val) => sum + Number(val || 0),
      0,
    );
    if (data.allocatedPrincipal + chargesSum <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El total pagado debe ser mayor a 0',
        path: ['allocatedPrincipal'],
      });
    }
  });
export type PayLoanInstallmentRequest = z.infer<typeof PayLoanInstallmentRequestSchema>;

export const LoanCapitalAdjustmentInputSchema = z
  .object({
    type: LoanCapitalAdjustmentTypeSchema,
    cashAccountId: z.string().uuid('Cuenta bancaria inválida').nullable().optional(),
    categoryAccountId: z.string().uuid('Categoría inválida').nullable().optional(),
    adjustmentDate: z.string().regex(ISO_DATE_REGEX, 'Formato debe ser YYYY-MM-DD'),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'CASH_TRANSFER' && !data.cashAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Debe seleccionar una cuenta bancaria o de efectivo para el ajuste',
        path: ['cashAccountId'],
      });
    }
    if (data.type === 'CATEGORY' && !data.categoryAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Debe seleccionar una categoría de Ingreso o Gasto para el ajuste',
        path: ['categoryAccountId'],
      });
    }
  });
export type LoanCapitalAdjustmentInput = z.infer<typeof LoanCapitalAdjustmentInputSchema>;

export const UpdateLoanPlanRequestSchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre del préstamo es obligatorio').max(120),
    annualRate: z.number().min(0, 'La tasa no puede ser negativa').max(999.9999),
    defaultPaymentAccountId: z
      .string()
      .uuid('Cuenta habitual de pago inválida')
      .nullable()
      .optional(),
    chargeColumns: z.array(LoanChargeColumnInputSchema),
    installments: z.array(LoanInstallmentInputSchema),
    capitalAdjustment: LoanCapitalAdjustmentInputSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const seenKeys = new Set<string>();
    for (const col of data.chargeColumns || []) {
      if (seenKeys.has(col.clientKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Columna duplicada: ${col.clientKey}`,
          path: ['chargeColumns'],
        });
        break;
      }
      seenKeys.add(col.clientKey);
    }
    const seenNumbers = new Set<number>();
    for (const inst of data.installments) {
      if (seenNumbers.has(inst.installmentNumber)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Número de cuota duplicado: #${inst.installmentNumber}`,
          path: ['installments'],
        });
        break;
      }
      seenNumbers.add(inst.installmentNumber);
    }
  });
export type UpdateLoanPlanRequest = z.infer<typeof UpdateLoanPlanRequestSchema>;

export interface LoanChargeColumnDto {
  id: string;
  name: string;
  expenseAccountId: string;
  expenseAccountName: string;
  isActive: boolean;
  sortOrder: number;
  hasAllocations: boolean;
}

export interface LoanPaymentAllocationDto {
  id: string;
  installmentId: string;
  transactionId: string;
  principalJournalEntryId: string | null;
  allocatedPrincipal: number;
  allocatedCharges: Record<string, number>;
  totalAmount: number;
  paidAt: string;
  paymentAccountId: string | null;
  paymentAccountName: string | null;
  createdAt: string;
}

export interface LoanInstallmentDto {
  id: string;
  loanId: string;
  installmentNumber: number;
  dueDate: string;
  principalAmount: number;
  charges: Record<string, number>;
  paidPrincipal: number;
  pendingPrincipal: number;
  paidCharges: Record<string, number>;
  pendingCharges: Record<string, number>;
  scheduledTotal: number;
  paidTotal: number;
  pendingTotal: number;
  status: LoanInstallmentStatus;
  isOverdue: boolean;
  allocations: LoanPaymentAllocationDto[];
}

export interface LoanDto {
  id: string;
  name: string;
  currencyId: string;
  currencyCode: string;
  currencySymbol: string;
  decimalPlaces: number;
  rateToBase: number;
  initialPrincipal: number;
  annualRate: number;
  openingDate: string;
  startInstallmentNumber: number;
  totalInstallmentsCount: number;
  liabilityAccountId: string;
  liabilityAccountName: string;
  defaultPaymentAccountId: string | null;
  defaultPaymentAccountName: string | null;
  initialTransactionId: string;
  initialTransaction?: LinkedTransactionDto | null;
  status: LoanStatus;
  paidPrincipal: number;
  pendingPrincipal: number;
  paidChargesTotal: number;
  totalPaid: number;
  progressPercent: number;
  paidInstallmentsCount: number;
  pendingInstallmentsCount: number;
  nextDueDate: string | null;
  nextInstallmentNumber: number | null;
  nextInstallmentPendingTotal: number;
  isNextOverdue: boolean;
  activeMovementsCount: number;
  deleteActionPreview: 'DELETE' | 'CANCEL' | 'BLOCKED';
  chargeColumns: LoanChargeColumnDto[];
  installments: LoanInstallmentDto[];
  createdAt: string;
}

export interface LoanPortfolioNextInstallmentDto {
  loanId: string;
  loanName: string;
  installmentId: string;
  installmentNumber: number;
  dueDate: string;
  pendingTotal: number;
  pendingTotalBase: number;
  currencyCode: string;
  currencySymbol: string;
  decimalPlaces: number;
  isOverdue: boolean;
}

export interface LoansKpiSummary {
  totalPendingPrincipalBase: number;
  monthlyLoadBase: number;
  activeLoansCount: number;
  settledLoansCount: number;
  pendingInstallmentsCount: number;
  paidInstallmentsCount: number;
  nextInstallment: LoanPortfolioNextInstallmentDto | null;
}

export interface LoansListResponse {
  kpis: LoansKpiSummary;
  loans: LoanDto[];
}

export interface DeleteLoanResponse {
  success: boolean;
  action: 'DELETED' | 'CANCELLED';
}
