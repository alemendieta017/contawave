import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BudgetMatrixSectionKey, CashFlowDirection } from '@sistema-contable/shared';
import { DataSource } from 'typeorm';
import {
  calculateFrenchAmortizationSchedule,
  calculateLoanDerived,
  calculateLoanInstallmentDerived,
  computeLoansKpis,
  roundMoney,
} from '../../domain/loans/loan-calculator';
import { AccountEntity } from '../../infrastructure/database/entities/account.entity';
import { AccountPeriodBalanceEntity } from '../../infrastructure/database/entities/account-period-balance.entity';
import { BudgetEntity } from '../../infrastructure/database/entities/budget.entity';
import { BudgetItemEntity } from '../../infrastructure/database/entities/budget-item.entity';
import { CurrencyEntity } from '../../infrastructure/database/entities/currency.entity';
import { JournalEntryEntity } from '../../infrastructure/database/entities/journal-entry.entity';
import { LoanChargeColumnEntity } from '../../infrastructure/database/entities/loan-charge-column.entity';
import { LoanEntity } from '../../infrastructure/database/entities/loan.entity';
import { LoanInstallmentEntity } from '../../infrastructure/database/entities/loan-installment.entity';
import { LoanPaymentAllocationEntity } from '../../infrastructure/database/entities/loan-payment-allocation.entity';
import { PeriodEntity } from '../../infrastructure/database/entities/period.entity';
import { TransactionEntity } from '../../infrastructure/database/entities/transaction.entity';
import { SystemAccountService } from '../commitments/system-account.service';
import { ReverseTransactionUseCase } from '../ledger/reverse-transaction.use-case';
import { GetBudgetControlUseCase } from '../budgets/get-budget-control.use-case';
import { CashFlowStatementForecastUseCase } from '../reports/cash-flow-statement.use-case';
import { IncomeStatementForecastUseCase } from '../reports/income-statement-forecast.use-case';
import { CreateLoanUseCase } from './create-loan.use-case';
import { DeleteLoanUseCase } from './delete-loan.use-case';
import { GetLoansUseCase } from './get-loans.use-case';
import { LoanCashFlowAdapter } from './loan-cash-flow.adapter';
import { PayLoanInstallmentUseCase } from './pay-loan-installment.use-case';
import { ReverseLoanPaymentUseCase } from './reverse-loan-payment.use-case';
import { UpdateLoanPlanUseCase } from './update-loan-plan.use-case';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CUR_PYG_ID = '22222222-2222-4222-8222-222222222222';
const CUR_USD_ID = '33333333-3333-4333-8333-333333333333';
const ACC_BANK_ID = '44444444-4444-4444-8444-444444444444';
const ACC_CAPITAL_ID = '55555555-5555-4555-8555-555555555555';
const ACC_INTEREST_ID = '66666666-6666-4666-8666-666666666666';
const ACC_INSURANCE_ID = '77777777-7777-4777-8777-777777777777';
const ACC_INCOME_ID = '88888888-8888-4888-8888-888888888888';
const ACC_LIABILITY_ID = '99999999-9999-4999-8999-999999999999';
const LOAN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COL_INT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COL_SEG_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INST_1_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const INST_2_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ALLOC_1_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const TX_INIT_ID = '12121212-1212-4121-8121-121212121212';
const TX_PAY_ID = '34343434-3434-4343-8343-343434343434';

describe('Loans Bounded Context (Spec 02 & Spec 00)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loan-calculator domain engine', () => {
    it('calculates French amortization with exact principal sum and decreasing interest', () => {
      const schedule = calculateFrenchAmortizationSchedule({
        principal: 12000000,
        annualRate: 13.5,
        count: 12,
        firstDueDate: '2026-12-01',
        decimalPlaces: 0,
      });

      expect(schedule).toHaveLength(12);
      const totalPrincipal = schedule.reduce((sum, r) => sum + r.principalAmount, 0);
      expect(totalPrincipal).toBe(12000000);
      expect(schedule[0].installmentNumber).toBe(1);
      expect(schedule[11].installmentNumber).toBe(12);
      expect(schedule[0].interestAmount).toBeGreaterThan(schedule[11].interestAmount);
      expect(schedule[0].principalAmount).toBeLessThan(schedule[11].principalAmount);
      expect(schedule.every((r) => r.principalAmount > 0)).toBe(true);
    });

    it('handles 0% annual rate with multi-decimal rounding and exact last installment adjustment', () => {
      const schedule = calculateFrenchAmortizationSchedule({
        principal: 100,
        annualRate: 0,
        count: 3,
        firstDueDate: '2026-01-31',
        startInstallmentNumber: 5,
        decimalPlaces: 2,
      });

      expect(schedule.map((r) => r.installmentNumber)).toEqual([5, 6, 7]);
      expect(schedule.map((r) => r.dueDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
      expect(schedule.map((r) => r.interestAmount)).toEqual([0, 0, 0]);
      expect(schedule.map((r) => r.principalAmount)).toEqual([33.33, 33.33, 33.34]);
      expect(
        roundMoney(
          schedule.reduce((s, r) => s + r.principalAmount, 0),
          2,
        ),
      ).toBe(100);
    });

    it('enforces capital-only status invariants and non-negative pending charges on mora overpayment', () => {
      const cols = [
        {
          id: COL_INT_ID,
          name: 'Interés',
          expenseAccountId: ACC_INTEREST_ID,
          isActive: true,
          sortOrder: 0,
        },
        {
          id: COL_SEG_ID,
          name: 'Seguros',
          expenseAccountId: ACC_INSURANCE_ID,
          isActive: true,
          sortOrder: 1,
        },
      ];

      // Charges-only payment leaves status PENDING (not PARTIAL or PAID)
      const chargesOnly = calculateLoanInstallmentDerived(
        {
          id: INST_1_ID,
          loanId: LOAN_ID,
          installmentNumber: 1,
          dueDate: '2026-12-15',
          principalAmount: 1000000,
          chargesJson: { [COL_INT_ID]: 135000, [COL_SEG_ID]: 25000 },
          allocations: [
            {
              id: ALLOC_1_ID,
              installmentId: INST_1_ID,
              transactionId: TX_PAY_ID,
              principalJournalEntryId: null,
              allocatedPrincipal: 0,
              allocatedChargesJson: { [COL_INT_ID]: 135000 },
              paidAt: '2026-12-01',
              transaction: { status: 'POSTED' },
            },
          ],
        },
        cols,
        '2026-12-01',
      );

      expect(chargesOnly.status).toBe('PENDING');
      expect(chargesOnly.paidPrincipal).toBe(0);
      expect(chargesOnly.pendingPrincipal).toBe(1000000);
      expect(chargesOnly.pendingCharges[COL_INT_ID]).toBe(0);
      expect(chargesOnly.pendingCharges[COL_SEG_ID]).toBe(25000);

      // Partial principal + past due date => PARTIAL with isOverdue = true
      const partialOverdue = calculateLoanInstallmentDerived(
        {
          id: INST_1_ID,
          loanId: LOAN_ID,
          installmentNumber: 1,
          dueDate: '2026-11-10',
          principalAmount: 1000000,
          chargesJson: { [COL_INT_ID]: 100000 },
          allocations: [
            {
              id: ALLOC_1_ID,
              installmentId: INST_1_ID,
              transactionId: TX_PAY_ID,
              principalJournalEntryId: 'je-1',
              allocatedPrincipal: 400000,
              allocatedChargesJson: { [COL_INT_ID]: 150000 },
              paidAt: '2026-11-12',
              transaction: { status: 'POSTED' },
            },
            {
              id: 'alloc-rev',
              installmentId: INST_1_ID,
              transactionId: 'tx-rev',
              principalJournalEntryId: 'je-rev',
              allocatedPrincipal: 600000,
              allocatedChargesJson: {},
              paidAt: '2026-11-12',
              transaction: { status: 'REVERSED' },
            },
          ],
        },
        cols,
        '2026-11-20',
      );

      expect(partialOverdue.status).toBe('PARTIAL');
      expect(partialOverdue.isOverdue).toBe(true);
      expect(partialOverdue.paidPrincipal).toBe(400000);
      expect(partialOverdue.pendingPrincipal).toBe(600000);
      expect(partialOverdue.pendingCharges[COL_INT_ID]).toBe(0);

      // Full principal paid => PAID even when scheduled charge wasn't paid in full
      const fullCapital = calculateLoanInstallmentDerived(
        {
          id: INST_2_ID,
          loanId: LOAN_ID,
          installmentNumber: 2,
          dueDate: '2026-11-01',
          principalAmount: 500000,
          chargesJson: { [COL_INT_ID]: 50000 },
          allocations: [
            {
              id: ALLOC_1_ID,
              installmentId: INST_2_ID,
              transactionId: TX_PAY_ID,
              principalJournalEntryId: 'je-2',
              allocatedPrincipal: 500000,
              allocatedChargesJson: {},
              paidAt: '2026-11-01',
              transaction: { status: 'POSTED' },
            },
          ],
        },
        cols,
        '2026-11-20',
      );

      expect(fullCapital.status).toBe('PAID');
      expect(fullCapital.isOverdue).toBe(false);
    });

    it('derives loan status and converts multi-currency portfolio KPIs to base', () => {
      const derivedSettled = calculateLoanDerived('ACTIVE', [
        {
          installmentNumber: 1,
          dueDate: '2026-11-10',
          paidPrincipal: 1000,
          pendingPrincipal: 0,
          paidTotal: 1100,
          pendingTotal: 0,
          status: 'PAID',
          isOverdue: false,
        },
      ]);
      expect(derivedSettled.status).toBe('SETTLED');
      expect(derivedSettled.progressPercent).toBe(100);

      const kpis = computeLoansKpis([
        {
          id: LOAN_ID,
          name: 'Préstamo USD',
          currencyId: CUR_USD_ID,
          currencyCode: 'USD',
          currencySymbol: 'u$s',
          decimalPlaces: 2,
          rateToBase: 7500,
          initialPrincipal: 1000,
          annualRate: 8,
          openingDate: '2026-10-01',
          startInstallmentNumber: 1,
          totalInstallmentsCount: 2,
          liabilityAccountId: ACC_LIABILITY_ID,
          liabilityAccountName: 'Préstamo USD',
          defaultPaymentAccountId: ACC_BANK_ID,
          defaultPaymentAccountName: 'Banco Itaú',
          initialTransactionId: TX_INIT_ID,
          status: 'ACTIVE',
          paidPrincipal: 0,
          pendingPrincipal: 1000,
          paidChargesTotal: 0,
          totalPaid: 0,
          progressPercent: 0,
          paidInstallmentsCount: 0,
          pendingInstallmentsCount: 1,
          nextDueDate: '2026-12-05',
          nextInstallmentNumber: 1,
          nextInstallmentPendingTotal: 520,
          isNextOverdue: false,
          activeMovementsCount: 0,
          deleteActionPreview: 'DELETE',
          chargeColumns: [],
          installments: [
            {
              id: INST_1_ID,
              loanId: LOAN_ID,
              installmentNumber: 1,
              dueDate: '2026-12-05',
              principalAmount: 500,
              charges: {},
              paidPrincipal: 0,
              pendingPrincipal: 500,
              paidCharges: {},
              pendingCharges: {},
              scheduledTotal: 520,
              paidTotal: 0,
              pendingTotal: 520,
              status: 'PENDING',
              isOverdue: false,
              allocations: [],
            },
          ],
          createdAt: '2026-10-01T00:00:00Z',
        },
      ]);

      expect(kpis.totalPendingPrincipalBase).toBe(7500000);
      expect(kpis.monthlyLoadBase).toBe(3900000);
      expect(kpis.activeLoansCount).toBe(1);
      expect(kpis.nextInstallment?.loanId).toBe(LOAN_ID);
    });
  });

  describe('CreateLoanUseCase', () => {
    function buildCreateContext(overrides?: {
      currency?: Partial<CurrencyEntity>;
      existingLiability?: boolean;
    }) {
      const currency = {
        id: overrides?.currency?.id || CUR_PYG_ID,
        code: overrides?.currency?.code || 'PYG',
        decimalPlaces: overrides?.currency?.decimalPlaces ?? 0,
        rateToBase: overrides?.currency?.rateToBase ?? 1,
        isBase: overrides?.currency?.isBase ?? true,
      } as CurrencyEntity;

      const bankAcc = {
        id: ACC_BANK_ID,
        userId: USER_ID,
        name: 'Banco Itaú',
        type: 'ASSET',
        status: 'ACTIVE',
        isCashOrBank: true,
        isControlAccount: false,
      } as AccountEntity;

      const interestAcc = {
        id: ACC_INTEREST_ID,
        userId: USER_ID,
        name: 'Intereses y Cargos Financieros',
        type: 'EXPENSE',
        status: 'ACTIVE',
        isCashOrBank: false,
        isControlAccount: false,
      } as AccountEntity;

      const capitalAcc = {
        id: ACC_CAPITAL_ID,
        userId: USER_ID,
        name: 'Capital Inicial',
        type: 'EQUITY',
        status: 'ACTIVE',
        isCashOrBank: false,
        systemRole: 'CAPITAL',
      } as AccountEntity;

      let seq = 0;
      const em: any = {
        findOne: jest.fn(async (entity: any, opts: any) => {
          if (entity === CurrencyEntity) return currency;
          if (entity === AccountEntity) {
            if (opts?.where?.id === ACC_BANK_ID) return bankAcc;
            if (opts?.where?.id === ACC_INTEREST_ID) return interestAcc;
            return null;
          }
          return null;
        }),
        create: jest.fn((entity: any, data: any) => ({ ...data, __entity: entity.name })),
        save: jest.fn(async (entity: any, payload: any) => {
          if (Array.isArray(payload)) {
            return payload.map((item) => ({ ...item, id: `row-${++seq}` }));
          }
          if (entity === AccountEntity) return { ...payload, id: ACC_LIABILITY_ID };
          if (entity === LoanEntity) return { ...payload, id: LOAN_ID };
          if (entity === LoanChargeColumnEntity) return { ...payload, id: COL_INT_ID };
          return { ...payload, id: `id-${++seq}` };
        }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      const systemAccountService = {
        resolveUniqueAccountName: jest
          .fn()
          .mockResolvedValue(
            overrides?.existingLiability ? 'Préstamo Personal (2)' : 'Préstamo Personal',
          ),
        getOrCreateSystemAccount: jest.fn().mockResolvedValue(capitalAcc),
        postDoubleEntry: jest
          .fn()
          .mockResolvedValue({ transaction: { id: TX_INIT_ID }, entries: [] }),
      } as unknown as SystemAccountService;

      const getLoansUseCase = {
        getById: jest.fn().mockResolvedValue({ id: LOAN_ID }),
      } as unknown as GetLoansUseCase;

      const dataSource = {
        transaction: jest.fn((_iso: any, cb: any) => cb(em)),
      } as unknown as DataSource;

      return {
        useCase: new CreateLoanUseCase(dataSource, systemAccountService, getLoansUseCase),
        em,
        systemAccountService,
      };
    }

    it('creates NEW loan crediting dedicated LOAN liability, debiting bank, and converts FX to base', async () => {
      const { useCase, em, systemAccountService } = buildCreateContext({
        currency: {
          id: CUR_USD_ID,
          code: 'USD',
          decimalPlaces: 2,
          rateToBase: 7500,
          isBase: false,
        },
        existingLiability: true,
      });

      await useCase.execute(USER_ID, {
        name: 'Préstamo Personal',
        currencyId: CUR_USD_ID,
        openingMode: 'NEW',
        openingDate: '2026-11-15',
        disbursementAccountId: ACC_BANK_ID,
        defaultPaymentAccountId: ACC_BANK_ID,
        annualRate: 9,
        startInstallmentNumber: 1,
        chargeColumns: [
          {
            clientKey: 'interest',
            name: 'Interés',
            expenseAccountId: ACC_INTEREST_ID,
            isActive: true,
            sortOrder: 0,
          },
        ],
        installments: [
          {
            installmentNumber: 1,
            dueDate: '2026-12-15',
            principalAmount: 500,
            charges: { interest: 10 },
          },
          {
            installmentNumber: 2,
            dueDate: '2027-01-15',
            principalAmount: 500,
            charges: { interest: 5 },
          },
        ],
      });

      expect(em.save).toHaveBeenCalledWith(
        AccountEntity,
        expect.objectContaining({
          name: 'Préstamo Personal (2)',
          type: 'LIABILITY',
          controlType: 'LOAN',
          isControlAccount: true,
        }),
      );
      expect(systemAccountService.postDoubleEntry).toHaveBeenCalledWith(
        em,
        USER_ID,
        expect.objectContaining({
          accountingDate: '2026-11-15',
          debitAccountId: ACC_BANK_ID,
          creditAccountId: ACC_LIABILITY_ID,
          amountBase: 7500000,
          originModule: 'LOAN',
        }),
      );
      expect(em.update).toHaveBeenCalledWith(
        TransactionEntity,
        { id: TX_INIT_ID },
        { originEntityId: LOAN_ID },
      );
    });

    it('creates ONGOING loan against CAPITAL system account without bank disbursement', async () => {
      const { useCase, em, systemAccountService } = buildCreateContext();

      await useCase.execute(USER_ID, {
        name: 'Préstamo Auto Itaú',
        openingMode: 'ONGOING',
        openingDate: '2026-11-01',
        disbursementAccountId: null,
        defaultPaymentAccountId: ACC_BANK_ID,
        annualRate: 13.5,
        startInstallmentNumber: 7,
        totalInstallmentsCount: 24,
        chargeColumns: [
          {
            clientKey: 'interest',
            name: 'Interés',
            expenseAccountId: ACC_INTEREST_ID,
            isActive: true,
            sortOrder: 0,
          },
        ],
        installments: [
          {
            installmentNumber: 7,
            dueDate: '2026-12-05',
            principalAmount: 2000000,
            charges: { interest: 150000 },
          },
        ],
      });

      expect(systemAccountService.getOrCreateSystemAccount).toHaveBeenCalledWith(
        em,
        USER_ID,
        'CAPITAL',
      );
      expect(systemAccountService.postDoubleEntry).toHaveBeenCalledWith(
        em,
        USER_ID,
        expect.objectContaining({
          debitAccountId: ACC_CAPITAL_ID,
          creditAccountId: ACC_LIABILITY_ID,
          amountBase: 2000000,
        }),
      );
    });
  });

  describe('PayLoanInstallmentUseCase & ReverseLoanPaymentUseCase', () => {
    function buildPayContext(instOverrides?: Partial<LoanInstallmentEntity>) {
      const loan = {
        id: LOAN_ID,
        userId: USER_ID,
        name: 'Préstamo Personal',
        status: 'ACTIVE',
        liabilityAccountId: ACC_LIABILITY_ID,
        currency: { id: CUR_PYG_ID, rateToBase: 1, decimalPlaces: 0 } as CurrencyEntity,
        chargeColumns: [
          { id: COL_INT_ID, name: 'Interés', expenseAccountId: ACC_INTEREST_ID, isActive: true },
        ],
      } as unknown as LoanEntity;

      const installment = {
        id: INST_1_ID,
        loanId: LOAN_ID,
        installmentNumber: 1,
        dueDate: '2026-12-05',
        principalAmount: 1000000,
        chargesJson: { [COL_INT_ID]: 120000 },
        allocations: [],
        loan,
        ...instOverrides,
      } as unknown as LoanInstallmentEntity;

      const bankAcc = {
        id: ACC_BANK_ID,
        userId: USER_ID,
        name: 'Banco Itaú',
        status: 'ACTIVE',
        isCashOrBank: true,
        isControlAccount: false,
      } as AccountEntity;

      const em: any = {
        findOne: jest.fn(async (entity: any) => {
          if (entity === LoanInstallmentEntity) return installment;
          if (entity === AccountEntity) return bankAcc;
          return null;
        }),
        find: jest.fn(async () => [installment]),
        create: jest.fn((_e: any, data: any) => ({ ...data })),
        save: jest.fn(async (_e: any, data: any) => ({ id: ALLOC_1_ID, ...data })),
      };

      const systemAccountService = {
        postMultiEntry: jest.fn(async (_em: any, _u: string, params: any) => ({
          transaction: { id: TX_PAY_ID, status: 'POSTED' },
          entries: params.entries.map((entry: any, i: number) => ({
            id: `je-${i + 1}`,
            ...entry,
          })),
        })),
      } as unknown as SystemAccountService;

      const getLoansUseCase = {
        getById: jest.fn().mockResolvedValue({ id: LOAN_ID }),
      } as unknown as GetLoansUseCase;

      const dataSource = {
        transaction: jest.fn((_iso: any, cb: any) => cb(em)),
      } as unknown as DataSource;

      return {
        useCase: new PayLoanInstallmentUseCase(dataSource, systemAccountService, getLoansUseCase),
        em,
        loan,
        installment,
        systemAccountService,
      };
    }

    it('emits balanced multi-entry and marks loan SETTLED on full principal settlement', async () => {
      const { useCase, em, systemAccountService } = buildPayContext();

      await useCase.execute(USER_ID, INST_1_ID, {
        paymentAccountId: ACC_BANK_ID,
        paidAt: '2026-12-05',
        allocatedPrincipal: 1000000,
        allocatedCharges: { [COL_INT_ID]: 140000 }, // mora > scheduled 120000 allowed
      });

      expect(systemAccountService.postMultiEntry).toHaveBeenCalledWith(
        em,
        USER_ID,
        expect.objectContaining({
          entries: [
            { accountId: ACC_LIABILITY_ID, entryType: 'DEBIT', amountBase: 1000000 },
            { accountId: ACC_INTEREST_ID, entryType: 'DEBIT', amountBase: 140000 },
            { accountId: ACC_BANK_ID, entryType: 'CREDIT', amountBase: 1140000 },
          ],
          originModule: 'LOAN',
          originEntityId: LOAN_ID,
        }),
      );
      expect(em.save).toHaveBeenCalledWith(
        LoanPaymentAllocationEntity,
        expect.objectContaining({
          principalJournalEntryId: 'je-1',
          allocatedPrincipal: 1000000,
        }),
      );
      expect(em.save).toHaveBeenCalledWith(
        LoanEntity,
        expect.objectContaining({ status: 'SETTLED' }),
      );
    });

    it('allows charges-only payment with principalJournalEntryId = null and rejects principal overpayment', async () => {
      const { useCase, em } = buildPayContext();

      await useCase.execute(USER_ID, INST_1_ID, {
        paymentAccountId: ACC_BANK_ID,
        paidAt: '2026-12-05',
        allocatedPrincipal: 0,
        allocatedCharges: { [COL_INT_ID]: 120000 },
      });

      expect(em.save).toHaveBeenCalledWith(
        LoanPaymentAllocationEntity,
        expect.objectContaining({
          principalJournalEntryId: null,
          allocatedPrincipal: 0,
        }),
      );

      await expect(
        useCase.execute(USER_ID, INST_1_ID, {
          paymentAccountId: ACC_BANK_ID,
          paidAt: '2026-12-05',
          allocatedPrincipal: 1000001,
          allocatedCharges: {},
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('reverses payment atomically via executeWithManager and restores SETTLED -> ACTIVE', async () => {
      const loan = {
        id: LOAN_ID,
        userId: USER_ID,
        status: 'SETTLED',
        chargeColumns: [],
      } as unknown as LoanEntity;

      const allocation = {
        id: ALLOC_1_ID,
        installmentId: INST_1_ID,
        transactionId: TX_PAY_ID,
        allocatedPrincipal: 1000000,
        transaction: { id: TX_PAY_ID, status: 'POSTED' },
        installment: { id: INST_1_ID, loan },
      } as unknown as LoanPaymentAllocationEntity;

      const em: any = {
        findOne: jest.fn(async (entity: any) => {
          if (entity === LoanPaymentAllocationEntity) return allocation;
          if (entity === LoanEntity) return loan;
          return null;
        }),
        find: jest.fn(async () => [
          {
            id: INST_1_ID,
            installmentNumber: 1,
            dueDate: '2026-12-05',
            principalAmount: 1000000,
            chargesJson: {},
            allocations: [allocation],
          },
        ]),
        save: jest.fn(async (_e: any, data: any) => data),
      };

      const reverseTransactionUseCase = {
        executeWithManager: jest.fn().mockResolvedValue({}),
      } as unknown as ReverseTransactionUseCase;

      const getLoansUseCase = {
        getById: jest.fn().mockResolvedValue({ id: LOAN_ID, status: 'ACTIVE' }),
      } as unknown as GetLoansUseCase;

      const dataSource = {
        transaction: jest.fn((_iso: any, cb: any) => cb(em)),
      } as unknown as DataSource;

      const useCase = new ReverseLoanPaymentUseCase(
        dataSource,
        reverseTransactionUseCase,
        getLoansUseCase,
      );

      await useCase.execute(USER_ID, ALLOC_1_ID);

      expect(reverseTransactionUseCase.executeWithManager).toHaveBeenCalledWith(
        em,
        USER_ID,
        TX_PAY_ID,
        { allowControlled: true },
      );
      expect(em.save).toHaveBeenCalledWith(
        LoanEntity,
        expect.objectContaining({ status: 'ACTIVE' }),
      );
    });
  });

  describe('UpdateLoanPlanUseCase', () => {
    function buildUpdateContext() {
      const bankAcc = {
        id: ACC_BANK_ID,
        userId: USER_ID,
        name: 'Banco Itaú',
        type: 'ASSET',
        status: 'ACTIVE',
        isCashOrBank: true,
        isControlAccount: false,
      } as AccountEntity;
      const interestAcc = {
        id: ACC_INTEREST_ID,
        userId: USER_ID,
        name: 'Intereses',
        type: 'EXPENSE',
        status: 'ACTIVE',
        isCashOrBank: false,
        isControlAccount: false,
      } as AccountEntity;
      const insuranceAcc = {
        id: ACC_INSURANCE_ID,
        userId: USER_ID,
        name: 'Seguros',
        type: 'EXPENSE',
        status: 'ACTIVE',
        isCashOrBank: false,
        isControlAccount: false,
      } as AccountEntity;
      const incomeAcc = {
        id: ACC_INCOME_ID,
        userId: USER_ID,
        name: 'Quita de Deuda',
        type: 'INCOME',
        status: 'ACTIVE',
        isCashOrBank: false,
        isControlAccount: false,
      } as AccountEntity;
      const capitalAcc = {
        id: ACC_CAPITAL_ID,
        userId: USER_ID,
        name: 'Capital Inicial',
        type: 'EQUITY',
        status: 'ACTIVE',
      } as AccountEntity;

      const liabilityAcc = {
        id: ACC_LIABILITY_ID,
        userId: USER_ID,
        name: 'Préstamo Personal',
        type: 'LIABILITY',
        status: 'ACTIVE',
      } as AccountEntity;

      const colInt = {
        id: COL_INT_ID,
        loanId: LOAN_ID,
        name: 'Interés',
        expenseAccountId: ACC_INTEREST_ID,
        isActive: true,
        sortOrder: 0,
      } as LoanChargeColumnEntity;

      const colSeg = {
        id: COL_SEG_ID,
        loanId: LOAN_ID,
        name: 'Seguros',
        expenseAccountId: ACC_INSURANCE_ID,
        isActive: true,
        sortOrder: 1,
      } as LoanChargeColumnEntity;

      const inst1Paid = {
        id: INST_1_ID,
        loanId: LOAN_ID,
        installmentNumber: 1,
        dueDate: '2026-11-05',
        principalAmount: 500000,
        chargesJson: { [COL_INT_ID]: 50000, [COL_SEG_ID]: 10000 },
        allocations: [
          {
            id: ALLOC_1_ID,
            installmentId: INST_1_ID,
            transactionId: TX_PAY_ID,
            allocatedPrincipal: 500000,
            allocatedChargesJson: { [COL_INT_ID]: 50000 },
            transaction: { status: 'POSTED' },
          },
        ],
      } as unknown as LoanInstallmentEntity;

      const inst2Partial = {
        id: INST_2_ID,
        loanId: LOAN_ID,
        installmentNumber: 2,
        dueDate: '2026-12-05',
        principalAmount: 500000,
        chargesJson: { [COL_INT_ID]: 40000 },
        allocations: [
          {
            id: 'alloc-2',
            installmentId: INST_2_ID,
            transactionId: 'tx-2',
            allocatedPrincipal: 200000,
            allocatedChargesJson: {},
            transaction: { status: 'POSTED' },
          },
        ],
      } as unknown as LoanInstallmentEntity;

      const loan = {
        id: LOAN_ID,
        userId: USER_ID,
        name: 'Préstamo Personal',
        status: 'ACTIVE',
        annualRate: 13.5,
        startInstallmentNumber: 1,
        liabilityAccountId: ACC_LIABILITY_ID,
        liabilityAccount: liabilityAcc,
        currency: { id: CUR_PYG_ID, rateToBase: 1, decimalPlaces: 0 },
        chargeColumns: [colInt, colSeg],
        installments: [inst1Paid, inst2Partial],
      } as unknown as LoanEntity;

      const em: any = {
        findOne: jest.fn(async (entity: any, opts: any) => {
          if (entity === LoanEntity) return loan;
          if (entity === AccountEntity) {
            if (opts?.where?.id === ACC_BANK_ID) return bankAcc;
            if (opts?.where?.id === ACC_INTEREST_ID) return interestAcc;
            if (opts?.where?.id === ACC_INSURANCE_ID) return insuranceAcc;
            if (opts?.where?.id === ACC_INCOME_ID) return incomeAcc;
          }
          return null;
        }),
        create: jest.fn((_e: any, data: any) => ({ ...data })),
        save: jest.fn(async (_e: any, data: any) => data),
        delete: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      const systemAccountService = {
        getOrCreateSystemAccount: jest.fn().mockResolvedValue(capitalAcc),
        resolveUniqueAccountName: jest.fn().mockImplementation(async (_em, _u, n) => n),
        postDoubleEntry: jest.fn().mockResolvedValue({ transaction: { id: 'tx-adj' } }),
      } as unknown as SystemAccountService;

      const getLoansUseCase = {
        getById: jest.fn().mockResolvedValue({ id: LOAN_ID }),
      } as unknown as GetLoansUseCase;

      const dataSource = {
        transaction: jest.fn((_iso: any, cb: any) => cb(em)),
      } as unknown as DataSource;

      return {
        useCase: new UpdateLoanPlanUseCase(dataSource, systemAccountService, getLoansUseCase),
        em,
        systemAccountService,
      };
    }

    it('rejects missing adjustment on capital change, protects PAID/PARTIAL invariants, and handles column archive vs delete', async () => {
      const { useCase, systemAccountService } = buildUpdateContext();

      // Paid principal = 200k on inst2 => pending = 300k. Changing to 250k fails without adjustment
      await expect(
        useCase.execute(USER_ID, LOAN_ID, {
          name: 'Préstamo Personal',
          annualRate: 13.5,
          chargeColumns: [
            {
              id: COL_INT_ID,
              clientKey: COL_INT_ID,
              name: 'Interés',
              expenseAccountId: ACC_INTEREST_ID,
              isActive: true,
              sortOrder: 0,
            },
          ],
          installments: [
            {
              id: INST_2_ID,
              installmentNumber: 2,
              dueDate: '2026-12-05',
              principalAmount: 450000,
              charges: {},
            },
          ],
          capitalAdjustment: null,
        }),
      ).rejects.toThrow(BadRequestException);

      // Cannot lower principal below paidPrincipal (200k)
      await expect(
        useCase.execute(USER_ID, LOAN_ID, {
          name: 'Préstamo Personal',
          annualRate: 13.5,
          chargeColumns: [
            {
              id: COL_INT_ID,
              clientKey: COL_INT_ID,
              name: 'Interés',
              expenseAccountId: ACC_INTEREST_ID,
              isActive: true,
              sortOrder: 0,
            },
          ],
          installments: [
            {
              id: INST_2_ID,
              installmentNumber: 2,
              dueDate: '2026-12-05',
              principalAmount: 150000,
              charges: {},
            },
          ],
          capitalAdjustment: {
            type: 'CASH_TRANSFER',
            cashAccountId: ACC_BANK_ID,
            adjustmentDate: '2026-11-20',
          },
        }),
      ).rejects.toThrow(BadRequestException);

      // Rebaja (-100k) via CASH_TRANSFER credits bank & debits liability; colInt archived if omitted, colSeg physically deleted
      const ctx2 = buildUpdateContext();
      await ctx2.useCase.execute(USER_ID, LOAN_ID, {
        name: 'Préstamo Reestructurado',
        annualRate: 10,
        chargeColumns: [], // omit both: colInt has allocations (archived), colSeg has none (deleted)
        installments: [
          {
            id: INST_2_ID,
            installmentNumber: 2,
            dueDate: '2026-12-05',
            principalAmount: 400000, // pending goes 300k -> 200k => delta = -100k
            charges: {},
          },
        ],
        capitalAdjustment: {
          type: 'CASH_TRANSFER',
          cashAccountId: ACC_BANK_ID,
          adjustmentDate: '2026-11-21',
        },
      });

      expect(ctx2.em.save).toHaveBeenCalledWith(
        LoanChargeColumnEntity,
        expect.objectContaining({ id: COL_INT_ID, isActive: false }),
      );
      expect(ctx2.em.delete).toHaveBeenCalledWith(LoanChargeColumnEntity, { id: COL_SEG_ID });
      expect(ctx2.systemAccountService.postDoubleEntry).toHaveBeenCalledWith(
        ctx2.em,
        USER_ID,
        expect.objectContaining({
          debitAccountId: ACC_LIABILITY_ID,
          creditAccountId: ACC_BANK_ID,
          amountBase: 100000,
          originModule: 'LOAN',
          originEntityId: LOAN_ID,
        }),
      );
      expect(systemAccountService.postDoubleEntry).not.toHaveBeenCalled();
    });

    it('enforces CATEGORY polarity (INCOME for reduction, EXPENSE for increase) and supports CAPITAL_ADJUSTMENT', async () => {
      const { useCase, em, systemAccountService } = buildUpdateContext();

      // Increase (+100k) with INCOME category rejected
      await expect(
        useCase.execute(USER_ID, LOAN_ID, {
          name: 'Préstamo Personal',
          annualRate: 13.5,
          chargeColumns: [
            {
              id: COL_INT_ID,
              clientKey: COL_INT_ID,
              name: 'Interés',
              expenseAccountId: ACC_INTEREST_ID,
              isActive: true,
              sortOrder: 0,
            },
          ],
          installments: [
            {
              id: INST_2_ID,
              installmentNumber: 2,
              dueDate: '2026-12-05',
              principalAmount: 600000,
              charges: {},
            },
          ],
          capitalAdjustment: {
            type: 'CATEGORY',
            categoryAccountId: ACC_INCOME_ID,
            adjustmentDate: '2026-11-21',
          },
        }),
      ).rejects.toThrow(BadRequestException);

      // Increase (+100k) with CAPITAL_ADJUSTMENT debits CAPITAL & credits liability
      const ctxCap = buildUpdateContext();
      await ctxCap.useCase.execute(USER_ID, LOAN_ID, {
        name: 'Préstamo Personal',
        annualRate: 13.5,
        chargeColumns: [
          {
            id: COL_INT_ID,
            clientKey: COL_INT_ID,
            name: 'Interés',
            expenseAccountId: ACC_INTEREST_ID,
            isActive: true,
            sortOrder: 0,
          },
        ],
        installments: [
          {
            id: INST_2_ID,
            installmentNumber: 2,
            dueDate: '2026-12-05',
            principalAmount: 600000,
            charges: {},
          },
        ],
        capitalAdjustment: {
          type: 'CAPITAL_ADJUSTMENT',
          adjustmentDate: '2026-11-21',
        },
      });

      expect(ctxCap.systemAccountService.postDoubleEntry).toHaveBeenCalledWith(
        ctxCap.em,
        USER_ID,
        expect.objectContaining({
          debitAccountId: ACC_CAPITAL_ID,
          creditAccountId: ACC_LIABILITY_ID,
          amountBase: 100000,
        }),
      );
      expect(em.save).not.toHaveBeenCalledWith(LoanEntity, expect.anything());
      expect(systemAccountService.postDoubleEntry).not.toHaveBeenCalled();
    });
  });

  describe('DeleteLoanUseCase', () => {
    function buildDeleteContext(scenario: 'BLOCKED' | 'VIRGIN' | 'REVERSED_HISTORY') {
      const liabilityAccount = {
        id: ACC_LIABILITY_ID,
        userId: USER_ID,
        status: 'ACTIVE',
      } as AccountEntity;

      const loan = {
        id: LOAN_ID,
        userId: USER_ID,
        status: 'ACTIVE',
        liabilityAccountId: ACC_LIABILITY_ID,
        liabilityAccount,
        initialTransactionId: TX_INIT_ID,
        initialTransaction: { id: TX_INIT_ID, status: 'POSTED' },
        installments:
          scenario === 'VIRGIN'
            ? [{ id: INST_1_ID, allocations: [] }]
            : [
                {
                  id: INST_1_ID,
                  allocations: [
                    {
                      id: ALLOC_1_ID,
                      transactionId: TX_PAY_ID,
                      transaction: {
                        id: TX_PAY_ID,
                        status: scenario === 'BLOCKED' ? 'POSTED' : 'REVERSED',
                      },
                    },
                  ],
                },
              ],
      } as unknown as LoanEntity;

      const em: any = {
        findOne: jest.fn(async () => loan),
        find: jest.fn(async () => [{ id: TX_INIT_ID, status: 'POSTED' }]),
        delete: jest.fn().mockResolvedValue({ affected: 1 }),
        save: jest.fn(async (_e: any, data: any) => data),
      };

      const systemAccountService = {
        deletePostedTransactionWithBalances: jest.fn().mockResolvedValue(undefined),
      } as unknown as SystemAccountService;

      const reverseTransactionUseCase = {
        executeWithManager: jest.fn().mockResolvedValue({}),
      } as unknown as ReverseTransactionUseCase;

      const dataSource = {
        transaction: jest.fn((_iso: any, cb: any) => cb(em)),
      } as unknown as DataSource;

      return {
        useCase: new DeleteLoanUseCase(dataSource, systemAccountService, reverseTransactionUseCase),
        em,
        systemAccountService,
        reverseTransactionUseCase,
      };
    }

    it('blocks deletion when active payments exist, permanently deletes virgin loans, and cancels reversed-history loans', async () => {
      const blocked = buildDeleteContext('BLOCKED');
      await expect(blocked.useCase.execute(USER_ID, LOAN_ID)).rejects.toThrow(BadRequestException);

      const virgin = buildDeleteContext('VIRGIN');
      const virginRes = await virgin.useCase.execute(USER_ID, LOAN_ID);
      expect(virginRes).toEqual({ success: true, action: 'DELETED' });
      expect(virgin.em.delete).toHaveBeenCalledWith(LoanInstallmentEntity, { loanId: LOAN_ID });
      expect(virgin.em.delete).toHaveBeenCalledWith(LoanChargeColumnEntity, { loanId: LOAN_ID });
      expect(virgin.em.delete).toHaveBeenCalledWith(LoanEntity, { id: LOAN_ID, userId: USER_ID });
      expect(virgin.systemAccountService.deletePostedTransactionWithBalances).toHaveBeenCalledWith(
        virgin.em,
        USER_ID,
        TX_INIT_ID,
      );
      expect(virgin.em.delete).toHaveBeenCalledWith(AccountPeriodBalanceEntity, {
        accountId: ACC_LIABILITY_ID,
      });
      expect(virgin.em.delete).toHaveBeenCalledWith(BudgetItemEntity, {
        accountId: ACC_LIABILITY_ID,
      });
      expect(virgin.em.delete).toHaveBeenCalledWith(AccountEntity, {
        id: ACC_LIABILITY_ID,
        userId: USER_ID,
      });

      const cancelled = buildDeleteContext('REVERSED_HISTORY');
      const cancelRes = await cancelled.useCase.execute(USER_ID, LOAN_ID);
      expect(cancelRes).toEqual({ success: true, action: 'CANCELLED' });
      expect(cancelled.reverseTransactionUseCase.executeWithManager).toHaveBeenCalledWith(
        cancelled.em,
        USER_ID,
        TX_INIT_ID,
        { allowControlled: true },
      );
      expect(cancelled.em.save).toHaveBeenCalledWith(
        LoanEntity,
        expect.objectContaining({ status: 'CANCELLED' }),
      );
      expect(cancelled.em.save).toHaveBeenCalledWith(
        AccountEntity,
        expect.objectContaining({ id: ACC_LIABILITY_ID, status: 'INACTIVE' }),
      );
    });

    it('throws NotFoundException when loan does not exist', async () => {
      const em: any = { findOne: jest.fn().mockResolvedValue(null) };
      const dataSource = {
        transaction: jest.fn((_iso: any, cb: any) => cb(em)),
      } as unknown as DataSource;
      const useCase = new DeleteLoanUseCase(
        dataSource,
        {} as SystemAccountService,
        {} as ReverseTransactionUseCase,
      );
      await expect(useCase.execute(USER_ID, 'missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('Spec 00 Integration (LoanCashFlowAdapter -> CashFlow, BudgetControl & IncomeStatement)', () => {
    const createLoanAdapterWithSampleInstallments = () => {
      const qbMock = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: INST_1_ID,
            loanId: LOAN_ID,
            installmentNumber: 1,
            dueDate: '2026-12-10',
            principalAmount: 1000, // USD
            chargesJson: { [COL_INT_ID]: 100, [COL_SEG_ID]: 20 },
            allocations: [
              {
                id: ALLOC_1_ID,
                installmentId: INST_1_ID,
                transactionId: TX_PAY_ID,
                allocatedPrincipal: 400, // pendingPrincipal = 600 USD
                allocatedChargesJson: { [COL_INT_ID]: 100 }, // pendingInterest = 0, pendingSeg = 20 USD
                paidAt: '2026-12-01',
                transaction: { status: 'POSTED' },
              },
            ],
            loan: {
              id: LOAN_ID,
              userId: USER_ID,
              name: 'Préstamo Auto Itaú',
              status: 'ACTIVE',
              liabilityAccountId: ACC_LIABILITY_ID,
              currency: { code: 'USD', rateToBase: 7000, decimalPlaces: 2 },
              initialTransaction: { id: TX_INIT_ID, status: 'POSTED' },
              chargeColumns: [
                {
                  id: COL_INT_ID,
                  name: 'Interés',
                  expenseAccountId: ACC_INTEREST_ID,
                  isActive: true,
                },
                {
                  id: COL_SEG_ID,
                  name: 'Seguros',
                  expenseAccountId: ACC_INSURANCE_ID,
                  isActive: true,
                },
              ],
            },
          },
        ]),
      };
      return new LoanCashFlowAdapter({
        createQueryBuilder: jest.fn(() => qbMock),
      } as any);
    };

    it('projects pending principal to liabilityAccountId (Q4) and pending charges grouped by expenseAccountId', async () => {
      const adapter = createLoanAdapterWithSampleInstallments();
      const items = await adapter.getScheduledCashFlowItems(USER_ID, '2026-12-01', '2026-12-31');

      expect(items).toHaveLength(2);
      expect(items[0]).toEqual(
        expect.objectContaining({
          dueDate: '2026-12-10',
          periodName: '2026-12',
          amount: 4200000, // 600 USD * 7000
          direction: 'OUTFLOW',
          categoryAccountId: ACC_LIABILITY_ID,
          controlAccountId: ACC_LIABILITY_ID,
          sourceType: 'LOAN',
          sourceId: INST_1_ID,
          loanId: LOAN_ID,
        }),
      );
      expect(items[1]).toEqual(
        expect.objectContaining({
          dueDate: '2026-12-10',
          periodName: '2026-12',
          amount: 140000, // 20 USD * 7000
          direction: 'OUTFLOW',
          categoryAccountId: ACC_INSURANCE_ID,
          sourceType: 'LOAN',
          sourceId: INST_1_ID,
          loanId: LOAN_ID,
        }),
      );
    });

    it('feeds CashFlowStatementForecastUseCase, GetBudgetControlUseCase, and IncomeStatementForecastUseCase', async () => {
      const adapter = createLoanAdapterWithSampleInstallments();
      const periodDec = {
        id: 'p-dec',
        userId: USER_ID,
        name: '2026-12',
        startDate: '2026-12-01',
        endDate: '2026-12-31',
        status: 'PLANNING',
      } as PeriodEntity;

      const reportAccounts = [
        {
          id: ACC_BANK_ID,
          userId: USER_ID,
          name: 'Banco Itaú',
          type: 'ASSET',
          isCashOrBank: true,
          isControlAccount: false,
          status: 'ACTIVE',
        },
        {
          id: ACC_LIABILITY_ID,
          userId: USER_ID,
          name: 'Préstamo Auto Itaú',
          type: 'LIABILITY',
          isCashOrBank: false,
          isControlAccount: true,
          controlType: 'LOAN',
          status: 'ACTIVE',
        },
        {
          id: ACC_INSURANCE_ID,
          userId: USER_ID,
          name: 'Seguros',
          type: 'EXPENSE',
          isCashOrBank: false,
          isControlAccount: false,
          status: 'ACTIVE',
        },
      ] as AccountEntity[];

      // 1. CashFlowStatementForecastUseCase
      const reportEmMock: any = {
        findOne: jest.fn(async (entity: any) => {
          if (entity === PeriodEntity) return periodDec;
          if (entity === BudgetEntity) return null;
          return null;
        }),
        find: jest.fn(async (entity: any) => {
          if (entity === AccountEntity) return reportAccounts;
          if (entity === AccountPeriodBalanceEntity) return [];
          if (entity === PeriodEntity) return [periodDec];
          if (entity === TransactionEntity) return [];
          return [];
        }),
        getRepository: jest.fn(() => ({
          createQueryBuilder: jest.fn(() => ({
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockResolvedValue(null),
          })),
        })),
      };
      const periodRepoMock: any = {
        manager: {
          transaction: jest.fn(async (cb: any) => cb(reportEmMock)),
        },
      };

      const cfUseCase = new CashFlowStatementForecastUseCase(
        periodRepoMock,
        {} as any,
        {} as any,
        undefined,
        adapter,
      );
      const cashFlow = await cfUseCase.execute(USER_ID, '2026-12', true, new Date(2026, 10, 15), 1);
      const cfMonth = cashFlow.months.find((m) => m.periodName === '2026-12');
      expect(cfMonth?.egresosOperativos).toBe(140000);
      expect(cfMonth?.salidasActivoPasivo).toBe(4200000);
      expect(cfMonth?.totalSalidas).toBe(4340000);
      expect(
        cashFlow.accounts.find((a) => a.accountId === ACC_INSURANCE_ID)?.outflowValues['p-dec'],
      ).toBe(140000);
      expect(
        cashFlow.accounts.find((a) => a.accountId === ACC_LIABILITY_ID)?.outflowValues['p-dec'],
      ).toBe(4200000);

      // 2. GetBudgetControlUseCase (Egresos quadrant committed = 140,000; control account excluded)
      const budgetAccountQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([reportAccounts[2]]),
      };
      const budgetEntryQb = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      const budgetEmMock: any = {
        findOne: jest.fn(async (entity: any) => {
          if (entity === PeriodEntity) return periodDec;
          if (entity === BudgetEntity) {
            return {
              id: 'budget-1',
              userId: USER_ID,
              periodId: 'p-dec',
              items: [
                {
                  id: 'bi-1',
                  accountId: ACC_INSURANCE_ID,
                  amount: 200000,
                  cashFlowDirection: CashFlowDirection.EGRESO_EFECTIVO,
                },
              ],
            } as unknown as BudgetEntity;
          }
          return null;
        }),
        createQueryBuilder: jest.fn((entity: any) => {
          if (entity === AccountEntity) return budgetAccountQb;
          if (entity === JournalEntryEntity) return budgetEntryQb;
          return budgetAccountQb;
        }),
      };

      const budgetUseCase = new GetBudgetControlUseCase(
        { transaction: jest.fn((cb: any) => cb(budgetEmMock)) } as any,
        undefined,
        adapter,
      );
      const budget = await budgetUseCase.execute(USER_ID, 'p-dec');
      const expenseSection = budget.sections?.find(
        (s) => s.sectionKey === BudgetMatrixSectionKey.GASTOS_VIDA,
      );
      const insLine = expenseSection?.items.find((i) => i.accountId === ACC_INSURANCE_ID);
      expect(insLine?.committed).toBe(140000);
      expect(insLine?.available).toBe(60000);

      // 3. IncomeStatementForecastUseCase (charges flow to expense lines, liability capital does NOT hit P&L)
      const isUseCase = new IncomeStatementForecastUseCase(
        periodRepoMock,
        {} as any,
        {} as any,
        adapter,
      );
      const isForecast = await isUseCase.execute(
        USER_ID,
        '2026-12',
        true,
        new Date(2026, 10, 15),
        1,
      );
      const isMonth = isForecast.months.find((m) => m.periodName === '2026-12');
      expect(isMonth?.expense).toBe(140000);
    });
  });
});
