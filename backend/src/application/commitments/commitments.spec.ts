import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BudgetMatrixSectionKey,
  CashFlowDirection,
  CashFlowCommitmentSource,
} from '@sistema-contable/shared';
import {
  buildOriginBadgeText,
  calculateCommitmentDerived,
  calculateInstallmentDerived,
  getTodayIsoDate,
} from '../../domain/commitments/commitment-calculator';
import { AccountEntity } from '../../infrastructure/database/entities/account.entity';
import { AccountPeriodBalanceEntity } from '../../infrastructure/database/entities/account-period-balance.entity';
import { BudgetEntity } from '../../infrastructure/database/entities/budget.entity';
import { CommitmentEntity } from '../../infrastructure/database/entities/commitment.entity';
import { CommitmentInstallmentEntity } from '../../infrastructure/database/entities/commitment-installment.entity';
import { CommitmentSettlementEntity } from '../../infrastructure/database/entities/commitment-settlement.entity';
import { ContactEntity } from '../../infrastructure/database/entities/contact.entity';
import { CurrencyEntity } from '../../infrastructure/database/entities/currency.entity';
import { JournalEntryEntity } from '../../infrastructure/database/entities/journal-entry.entity';
import { PeriodEntity } from '../../infrastructure/database/entities/period.entity';
import { TransactionEntity } from '../../infrastructure/database/entities/transaction.entity';
import { GetBudgetControlUseCase } from '../budgets/get-budget-control.use-case';
import { ReverseTransactionUseCase } from '../ledger/reverse-transaction.use-case';
import { BalanceSheetUseCase } from '../periods/balance-sheet.use-case';
import { BalanceUpdateService } from '../periods/balance-update.service';
import { EnsurePeriodService } from '../periods/ensure-period.service';
import { CashFlowStatementForecastUseCase } from '../reports/cash-flow-statement.use-case';
import { CommitmentCashFlowAdapter } from './commitment-cash-flow.adapter';
import { CreateCommitmentUseCase } from './create-commitment.use-case';
import { DeleteCommitmentUseCase } from './delete-commitment.use-case';
import { ForgiveCommitmentInstallmentUseCase } from './forgive-commitment-installment.use-case';
import { GetCommitmentsUseCase } from './get-commitments.use-case';
import { RescheduleCommitmentInstallmentUseCase } from './reschedule-commitment-installment.use-case';
import { SettleCommitmentInstallmentUseCase } from './settle-commitment-installment.use-case';
import { SystemAccountService } from './system-account.service';
import { UndoCommitmentSettlementUseCase } from './undo-commitment-settlement.use-case';
import { UpdateCommitmentUseCase } from './update-commitment.use-case';

describe('Commitments Bounded Context (Spec 00 & Spec 01)', () => {
  const userId = 'user-1';
  const contactId = '11111111-1111-4111-8111-111111111111';
  const arAccountId = '22222222-2222-4222-8222-222222222222';
  const apAccountId = '33333333-3333-4333-8333-333333333333';
  const capitalAccountId = '44444444-4444-4444-8444-444444444444';
  const incomeCatId = '55555555-5555-4555-8555-555555555555';
  const expenseCatId = '66666666-6666-4666-8666-666666666666';
  const cashAccountId = '77777777-7777-4777-8777-777777777777';
  const nonCashAssetId = '88888888-8888-4888-8888-888888888888';

  describe('CommitmentCalculator (Anti-Drift Derived States)', () => {
    it('derives PENDING, PARTIAL, PAID, OVERDUE, FORGIVEN and keeps dueDate=null from ever becoming OVERDUE', () => {
      const today = '2026-08-15';

      const sameDayPending = calculateInstallmentDerived(
        {
          id: 'i-today',
          amount: 1000,
          dueDate: today,
          settlements: [],
        } as unknown as CommitmentInstallmentEntity,
        today,
      );
      expect(sameDayPending.status).toBe('PENDING');

      const pending = calculateInstallmentDerived(
        {
          id: 'i-1',
          amount: 1000,
          dueDate: '2026-08-20',
          settlements: [],
        } as unknown as CommitmentInstallmentEntity,
        today,
      );
      expect(pending.status).toBe('PENDING');
      expect(pending.pendingAmount).toBe(1000);

      const overdue = calculateInstallmentDerived(
        {
          id: 'i-2',
          amount: 1000,
          dueDate: '2026-08-10',
          settlements: [],
        } as unknown as CommitmentInstallmentEntity,
        today,
      );
      expect(overdue.status).toBe('OVERDUE');

      const noDatePending = calculateInstallmentDerived(
        {
          id: 'i-3',
          amount: 1000,
          dueDate: null,
          settlements: [],
        } as unknown as CommitmentInstallmentEntity,
        today,
      );
      expect(noDatePending.status).toBe('PENDING');

      const noDatePartial = calculateInstallmentDerived(
        {
          id: 'i-4',
          amount: 1000,
          dueDate: null,
          settlements: [
            {
              id: 's-1',
              settlementType: 'CASH',
              amount: 400,
              transaction: { status: 'POSTED' },
            },
          ],
        } as unknown as CommitmentInstallmentEntity,
        today,
      );
      expect(noDatePartial.status).toBe('PARTIAL');
      expect(noDatePartial.settledAmount).toBe(400);
      expect(noDatePartial.pendingAmount).toBe(600);

      const forgiven = calculateInstallmentDerived(
        {
          id: 'i-5',
          amount: 1000,
          dueDate: '2026-08-01',
          settlements: [
            {
              id: 's-2',
              settlementType: 'FORGIVEN',
              amount: 1000,
              transaction: { status: 'POSTED' },
            },
          ],
        } as unknown as CommitmentInstallmentEntity,
        today,
      );
      expect(forgiven.status).toBe('PAID');
      expect(forgiven.settledAmount).toBe(1000);
      expect(forgiven.pendingAmount).toBe(0);
      expect(forgiven.activeSettlements[0].settlementType).toBe('FORGIVEN');

      // Reversed settlements are ignored by anti-drift calculation
      const afterUndo = calculateInstallmentDerived(
        {
          id: 'i-6',
          amount: 1000,
          dueDate: '2026-08-25',
          settlements: [
            {
              id: 's-rev',
              settlementType: 'CASH',
              amount: 1000,
              transaction: { status: 'REVERSED' },
            },
          ],
        } as unknown as CommitmentInstallmentEntity,
        today,
      );
      expect(afterUndo.status).toBe('PENDING');
      expect(afterUndo.pendingAmount).toBe(1000);
    });

    it('computes aggregate commitment state and human origin badge text', () => {
      const agg = calculateCommitmentDerived(1500, [
        { dueDate: '2026-08-10', settledAmount: 0, pendingAmount: 500, status: 'OVERDUE' },
        { dueDate: null, settledAmount: 200, pendingAmount: 800, status: 'PARTIAL' },
      ]);
      expect(agg.totalAmount).toBe(1500);
      expect(agg.settledAmount).toBe(200);
      expect(agg.pendingAmount).toBe(1300);
      expect(agg.status).toBe('OVERDUE');
      expect(agg.hasNoDateInstallments).toBe(true);
      expect(agg.nextDueDate).toBe('2026-08-10');

      expect(buildOriginBadgeText('CATEGORY', 'Honorarios', null)).toBe('Honorarios');
      expect(buildOriginBadgeText('CASH_TRANSFER', null, 'Banco Itaú')).toBe(
        'Préstamo de dinero · Banco Itaú',
      );
      expect(buildOriginBadgeText('CAPITAL_ADJUSTMENT', null, null)).toBe('Ajuste patrimonial');
    });

    it('uses timezoneOffset in getTodayIsoDate so late-night local users keep today as PENDING instead of UTC tomorrow', () => {
      jest.useFakeTimers();
      try {
        // 2026-11-15 22:32:00 UTC-3 === 2026-11-16 01:32:00 UTC
        jest.setSystemTime(new Date('2026-11-16T01:32:00.000Z'));
        const todayLocal = getTodayIsoDate(180);
        expect(todayLocal).toBe('2026-11-15');

        const instToday = calculateInstallmentDerived(
          {
            id: 'i-nov15',
            amount: 500000,
            dueDate: '2026-11-15',
            settlements: [],
          } as unknown as CommitmentInstallmentEntity,
          todayLocal,
        );
        expect(instToday.status).toBe('PENDING');

        // Next day (2026-11-16 local) it becomes OVERDUE
        jest.setSystemTime(new Date('2026-11-16T03:05:00.000Z'));
        expect(getTodayIsoDate(180)).toBe('2026-11-16');
        const instNextDay = calculateInstallmentDerived(
          {
            id: 'i-nov15',
            amount: 500000,
            dueDate: '2026-11-15',
            settlements: [],
          } as unknown as CommitmentInstallmentEntity,
          getTodayIsoDate(180),
        );
        expect(instNextDay.status).toBe('OVERDUE');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('SystemAccountService.postDoubleEntry', () => {
    it('posts balanced debit/credit entries and updates period balances', async () => {
      const ensurePeriodMock = { ensurePeriod: jest.fn().mockResolvedValue({ id: 'p-1' }) };
      const balanceUpdateMock = { updateBalances: jest.fn().mockResolvedValue(undefined) };

      const service = new SystemAccountService(
        ensurePeriodMock as unknown as EnsurePeriodService,
        balanceUpdateMock as unknown as BalanceUpdateService,
      );

      const savedRecords: any[] = [];
      const emMock: any = {
        findOne: jest.fn(async (entity: any, opts: any) => {
          if (entity === AccountEntity) {
            return {
              id: opts.where.id,
              userId,
              name: opts.where.id === cashAccountId ? 'Banco' : 'Cuentas por Cobrar',
              status: 'ACTIVE',
              currencyId: 'cur-pyg',
            };
          }
          if (entity === CurrencyEntity) {
            return { id: 'cur-pyg', rateToBase: 1, decimalPlaces: 0 };
          }
          return null;
        }),
        create: jest.fn((entity: any, data: any) => ({ ...data })),
        save: jest.fn(async (_entity: any, data: any) => {
          const saved = { id: `id-${savedRecords.length + 1}`, ...data };
          savedRecords.push(saved);
          return saved;
        }),
      };

      const res = await service.postDoubleEntry(emMock, userId, {
        accountingDate: '2026-08-15',
        description: 'Test balanced entry',
        debitAccountId: arAccountId,
        creditAccountId: cashAccountId,
        amountBase: 250000,
      });

      expect(res.debitEntry.entryType).toBe('DEBIT');
      expect(res.creditEntry.entryType).toBe('CREDIT');
      expect(res.debitEntry.amountBase).toBe(res.creditEntry.amountBase);
      expect(ensurePeriodMock.ensurePeriod).toHaveBeenCalledWith(emMock, userId, '2026-08');
      expect(balanceUpdateMock.updateBalances).toHaveBeenCalledWith(emMock, userId, '2026-08-15', [
        { accountId: arAccountId, debitDiff: 250000, creditDiff: 0 },
        { accountId: cashAccountId, debitDiff: 0, creditDiff: 250000 },
      ]);
    });
  });

  describe('CreateCommitmentUseCase (3 Origins & Double Entry)', () => {
    let createUseCase: CreateCommitmentUseCase;
    let postDoubleEntrySpy: jest.Mock;
    let getByIdSpy: jest.Mock;
    let emMock: any;

    const accountsMap: Record<string, Partial<AccountEntity>> = {
      [incomeCatId]: { id: incomeCatId, userId, name: 'Consultoría', type: 'INCOME' },
      [expenseCatId]: { id: expenseCatId, userId, name: 'Proveedor IT', type: 'EXPENSE' },
      [cashAccountId]: {
        id: cashAccountId,
        userId,
        name: 'Banco Itaú',
        type: 'ASSET',
        isCashOrBank: true,
      },
    };

    beforeEach(() => {
      postDoubleEntrySpy = jest.fn().mockResolvedValue({
        transaction: { id: 'tx-init-1' },
        debitEntry: { id: 'je-d' },
        creditEntry: { id: 'je-c' },
      });
      getByIdSpy = jest.fn().mockResolvedValue({ id: 'com-1' });

      const systemServiceMock = {
        getOrCreateSystemAccount: jest.fn(async (_em: any, _uid: string, role: string) => {
          const map: Record<string, string> = {
            ACCOUNTS_RECEIVABLE: arAccountId,
            ACCOUNTS_PAYABLE: apAccountId,
            CAPITAL: capitalAccountId,
          };
          if (!map[role]) {
            throw new Error(`Unexpected role passed to getOrCreateSystemAccount: ${String(role)}`);
          }
          return { id: map[role], systemRole: role };
        }),
        postDoubleEntry: postDoubleEntrySpy,
      };

      emMock = {
        findOne: jest.fn(async (entity: any, opts: any) => {
          if (entity === ContactEntity) {
            return { id: opts.where.id, userId, name: 'Cliente / Proveedor Test' };
          }
          if (entity === AccountEntity) {
            return accountsMap[opts.where.id] || null;
          }
          return null;
        }),
        create: jest.fn((_entity: any, data: any) => ({ ...data })),
        save: jest.fn(async (_entity: any, data: any) => {
          if (Array.isArray(data)) return data;
          return { id: 'com-1', ...data };
        }),
      };

      const dataSourceMock = {
        transaction: jest.fn((_iso: any, cb: any) => cb(emMock)),
      };

      createUseCase = new CreateCommitmentUseCase(
        dataSourceMock as unknown as DataSource,
        systemServiceMock as unknown as SystemAccountService,
        { getById: getByIdSpy } as unknown as GetCommitmentsUseCase,
      );
    });

    it('creates EXPENSE_DEBT (CATEGORY OUTFLOW): Debits Expense and Credits ACCOUNTS_PAYABLE', async () => {
      await createUseCase.execute(userId, {
        contactId,
        direction: 'OUTFLOW',
        originType: 'CATEGORY',
        categoryAccountId: expenseCatId,
        description: 'Factura pendiente nube',
        totalAmount: 500000,
        accountingDate: '2026-08-05',
        installments: [{ dueDate: '2026-09-05', amount: 500000 }],
      });

      expect(postDoubleEntrySpy).toHaveBeenCalledWith(emMock, userId, {
        accountingDate: '2026-08-05',
        description: '[Cuentas por pagar] Cliente / Proveedor Test — Factura pendiente nube',
        debitAccountId: expenseCatId,
        creditAccountId: apAccountId,
        amountBase: 500000,
        originModule: 'COMMITMENT',
      });
    });

    it('creates CASH_LOAN (CASH_TRANSFER INFLOW): Debits ACCOUNTS_RECEIVABLE and Credits Cash account', async () => {
      await createUseCase.execute(userId, {
        contactId,
        direction: 'INFLOW',
        originType: 'CASH_TRANSFER',
        cashAccountId,
        description: 'Préstamo a amigo',
        totalAmount: 1000000,
        accountingDate: '2026-08-05',
        installments: [
          { dueDate: '2026-09-01', amount: 500000 },
          { dueDate: null, amount: 500000 },
        ],
      });

      expect(postDoubleEntrySpy).toHaveBeenCalledWith(emMock, userId, {
        accountingDate: '2026-08-05',
        description: '[Cuentas por cobrar] Cliente / Proveedor Test — Préstamo a amigo',
        debitAccountId: arAccountId,
        creditAccountId: cashAccountId,
        amountBase: 1000000,
        originModule: 'COMMITMENT',
      });
    });

    it('creates LEGACY_BALANCE (CAPITAL INFLOW & OUTFLOW) against CAPITAL system account', async () => {
      await createUseCase.execute(userId, {
        contactId,
        direction: 'INFLOW',
        originType: 'CAPITAL_ADJUSTMENT',
        description: 'Saldo histórico a favor',
        totalAmount: 300000,
        accountingDate: '2026-08-01',
        installments: [{ dueDate: null, amount: 300000 }],
      });

      expect(postDoubleEntrySpy).toHaveBeenCalledWith(emMock, userId, {
        accountingDate: '2026-08-01',
        description: '[Cuentas por cobrar] Cliente / Proveedor Test — Saldo histórico a favor',
        debitAccountId: arAccountId,
        creditAccountId: capitalAccountId,
        amountBase: 300000,
        originModule: 'COMMITMENT',
      });
    });
  });

  describe('Settle, Forgive, Reschedule, Undo & Delete Use Cases', () => {
    it('settles full and partial installments and updates remainder dueDate', async () => {
      const postDoubleEntryMock = jest.fn().mockResolvedValue({
        transaction: { id: 'tx-set-1' },
        debitEntry: { id: 'je-cash' },
        creditEntry: { id: 'je-ar' },
      });

      const installment: any = {
        id: 'inst-1',
        installmentNumber: 1,
        amount: 1000,
        dueDate: '2026-08-20',
        settlements: [],
        commitment: {
          id: 'com-1',
          userId,
          direction: 'INFLOW',
          description: 'Venta crédito',
          controlAccountId: arAccountId,
          contact: { name: 'Cliente A' },
        },
      };

      const emMock: any = {
        findOne: jest.fn(async (entity: any) => {
          if (entity === CommitmentInstallmentEntity) return installment;
          if (entity === AccountEntity) {
            return { id: cashAccountId, userId, name: 'Caja', isCashOrBank: true };
          }
          return null;
        }),
        create: jest.fn((_e: any, data: any) => ({ ...data })),
        save: jest.fn(async (_e: any, data: any) => data),
      };

      const settleUseCase = new SettleCommitmentInstallmentUseCase(
        { transaction: (_iso: any, cb: any) => cb(emMock) } as unknown as DataSource,
        { postDoubleEntry: postDoubleEntryMock } as unknown as SystemAccountService,
        {
          getById: jest.fn().mockResolvedValue({ id: 'com-1' }),
        } as unknown as GetCommitmentsUseCase,
      );

      await settleUseCase.execute(userId, 'inst-1', {
        amount: 400,
        cashAccountId,
        settledAt: '2026-08-15',
        newDueDateForRemainder: '2026-09-15',
      });

      expect(postDoubleEntryMock).toHaveBeenCalledWith(emMock, userId, {
        accountingDate: '2026-08-15',
        description: 'Cobro cuota #1 · Cliente A — Venta crédito',
        debitAccountId: cashAccountId,
        creditAccountId: arAccountId,
        amountBase: 400,
        originModule: 'COMMITMENT',
        originEntityId: 'com-1',
      });
      expect(installment.dueDate).toBe('2026-09-15');

      // Overpayment check
      await expect(
        settleUseCase.execute(userId, 'inst-1', {
          amount: 1500,
          cashAccountId,
          settledAt: '2026-08-15',
        }),
      ).rejects.toThrow(BadRequestException);

      // Non-cash account check
      emMock.findOne.mockImplementation(async (entity: any) => {
        if (entity === CommitmentInstallmentEntity) return installment;
        if (entity === AccountEntity) {
          return { id: nonCashAssetId, userId, name: 'Vehículo', isCashOrBank: false };
        }
        return null;
      });
      await expect(
        settleUseCase.execute(userId, 'inst-1', {
          amount: 400,
          cashAccountId: nonCashAssetId,
          settledAt: '2026-08-15',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('forgives pending balance by reversing origin category without hitting cash', async () => {
      const postDoubleEntryMock = jest.fn().mockResolvedValue({
        transaction: { id: 'tx-forgive' },
        debitEntry: { id: 'je-adj' },
        creditEntry: { id: 'je-ctrl' },
      });

      const installment: any = {
        id: 'inst-2',
        installmentNumber: 1,
        amount: 500,
        dueDate: '2026-08-10',
        settlements: [],
        commitment: {
          id: 'com-2',
          userId,
          direction: 'INFLOW',
          originType: 'CATEGORY',
          categoryAccountId: incomeCatId,
          description: 'Factura incobrable',
          controlAccountId: arAccountId,
          contact: { name: 'Cliente B' },
        },
      };

      const savedSettlements: any[] = [];
      const emMock: any = {
        findOne: jest.fn(async (entity: any) => {
          if (entity === CommitmentInstallmentEntity) return installment;
          return null;
        }),
        create: jest.fn((_e: any, data: any) => ({ ...data })),
        save: jest.fn(async (_e: any, data: any) => {
          savedSettlements.push(data);
          return data;
        }),
      };

      const forgiveUseCase = new ForgiveCommitmentInstallmentUseCase(
        { transaction: (_iso: any, cb: any) => cb(emMock) } as unknown as DataSource,
        { postDoubleEntry: postDoubleEntryMock } as unknown as SystemAccountService,
        {
          getById: jest.fn().mockResolvedValue({ id: 'com-2' }),
        } as unknown as GetCommitmentsUseCase,
      );

      await forgiveUseCase.execute(userId, 'inst-2', {
        settledAt: '2026-08-16',
        reason: 'Acuerdo comercial',
      });

      expect(postDoubleEntryMock).toHaveBeenCalledWith(emMock, userId, {
        accountingDate: '2026-08-16',
        description: 'Condonación cuota #1 · Cliente B — Factura incobrable (Acuerdo comercial)',
        debitAccountId: incomeCatId,
        creditAccountId: arAccountId,
        amountBase: 500,
        originModule: 'COMMITMENT',
        originEntityId: 'com-2',
      });
      expect(savedSettlements[0].settlementType).toBe('FORGIVEN');
    });

    it('reschedules dueDate (including null) and syncs initial tx when amount changes', async () => {
      const syncSpy = jest.fn().mockResolvedValue(undefined);
      const installment: any = {
        id: 'inst-3',
        installmentNumber: 1,
        amount: 200,
        dueDate: '2026-08-20',
        settlements: [],
        commitment: { id: 'com-3', userId, totalAmount: 500 },
      };

      const emMock: any = {
        findOne: jest.fn(async () => installment),
        find: jest.fn(async () => [
          { id: 'inst-3', amount: 350 },
          { id: 'inst-4', amount: 300 },
        ]),
        save: jest.fn(async (_e: any, data: any) => data),
      };

      const rescheduleUseCase = new RescheduleCommitmentInstallmentUseCase(
        { transaction: (_iso: any, cb: any) => cb(emMock) } as unknown as DataSource,
        { syncCommitmentInitialTransactionAmount: syncSpy } as unknown as SystemAccountService,
        {
          getById: jest.fn().mockResolvedValue({ id: 'com-3' }),
        } as unknown as GetCommitmentsUseCase,
      );

      await rescheduleUseCase.execute(userId, 'inst-3', { dueDate: null, amount: 350 });

      expect(installment.dueDate).toBeNull();
      expect(installment.amount).toBe(350);
      expect(syncSpy).toHaveBeenCalledWith(emMock, userId, installment.commitment, 650);
    });

    it('undoes a settlement using ReverseTransactionUseCase and blocks deletion of settled commitments', async () => {
      const reverseTxMock = { execute: jest.fn().mockResolvedValue({ id: 'tx-rev' }) };
      const emMock: any = {
        findOne: jest.fn(async (entity: any) => {
          if (entity === CommitmentSettlementEntity) {
            return {
              id: 'set-1',
              transactionId: 'tx-set-1',
              installment: {
                commitmentId: 'com-4',
                commitment: { id: 'com-4', userId },
              },
            };
          }
          if (entity === CommitmentEntity) {
            return {
              id: 'com-4',
              userId,
              totalAmount: 1000,
              installments: [
                {
                  id: 'inst-4',
                  amount: 1000,
                  dueDate: '2026-08-30',
                  settlements: [
                    {
                      id: 'set-1',
                      settlementType: 'CASH',
                      amount: 400,
                      transaction: { status: 'POSTED' },
                    },
                  ],
                },
              ],
            };
          }
          return null;
        }),
        delete: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      const settlementRepoMock = {
        findOne: jest.fn().mockResolvedValue({
          id: 'set-1',
          transactionId: 'tx-set-1',
          installment: {
            commitmentId: 'com-4',
            commitment: { id: 'com-4', userId },
          },
        }),
        delete: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      const undoModule: TestingModule = await Test.createTestingModule({
        providers: [
          UndoCommitmentSettlementUseCase,
          { provide: DataSource, useValue: { transaction: (_iso: any, cb: any) => cb(emMock) } },
          {
            provide: getRepositoryToken(CommitmentSettlementEntity),
            useValue: settlementRepoMock,
          },
          { provide: ReverseTransactionUseCase, useValue: reverseTxMock },
          {
            provide: GetCommitmentsUseCase,
            useValue: { getById: jest.fn().mockResolvedValue({ id: 'com-4' }) },
          },
        ],
      }).compile();

      const undoUseCase = undoModule.get<UndoCommitmentSettlementUseCase>(
        UndoCommitmentSettlementUseCase,
      );
      await undoUseCase.execute(userId, 'set-1');
      expect(reverseTxMock.execute).toHaveBeenCalledWith(userId, 'tx-set-1', {
        allowControlled: true,
      });

      const deleteUseCase = new DeleteCommitmentUseCase(
        { transaction: (_iso: any, cb: any) => cb(emMock) } as unknown as DataSource,
        { deletePostedTransactionWithBalances: jest.fn() } as unknown as SystemAccountService,
      );
      await expect(deleteUseCase.execute(userId, 'com-4')).rejects.toThrow(BadRequestException);
    });

    it('rejects forgiving against cash/bank or control accounts and rejects same-account double entry', async () => {
      const installment: any = {
        id: 'inst-fg',
        installmentNumber: 1,
        amount: 500,
        dueDate: '2026-08-10',
        settlements: [],
        commitment: {
          id: 'com-fg',
          userId,
          direction: 'INFLOW',
          originType: 'CASH_TRANSFER',
          description: 'Préstamo sin cobro',
          controlAccountId: arAccountId,
          contact: { name: 'Familiar' },
        },
      };

      const emMock: any = {
        findOne: jest.fn(async (entity: any, opts: any) => {
          if (entity === CommitmentInstallmentEntity) return installment;
          if (entity === AccountEntity) {
            if (opts?.where?.id === cashAccountId) {
              return {
                id: cashAccountId,
                userId,
                name: 'Caja',
                type: 'ASSET',
                isCashOrBank: true,
                isControlAccount: false,
              };
            }
            if (opts?.where?.id === arAccountId) {
              return {
                id: arAccountId,
                userId,
                name: 'Cuentas por Cobrar',
                type: 'ASSET',
                isCashOrBank: false,
                isControlAccount: true,
                systemRole: 'ACCOUNTS_RECEIVABLE',
              };
            }
          }
          return null;
        }),
      };

      const forgiveUseCase = new ForgiveCommitmentInstallmentUseCase(
        { transaction: (_iso: any, cb: any) => cb(emMock) } as unknown as DataSource,
        { postDoubleEntry: jest.fn() } as unknown as SystemAccountService,
        { getById: jest.fn() } as unknown as GetCommitmentsUseCase,
      );

      await expect(
        forgiveUseCase.execute(userId, 'inst-fg', { expenseAccountId: cashAccountId }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        forgiveUseCase.execute(userId, 'inst-fg', { expenseAccountId: arAccountId }),
      ).rejects.toThrow(BadRequestException);

      const sysAccountService = new SystemAccountService(
        { ensurePeriod: jest.fn() } as unknown as EnsurePeriodService,
        { updateBalances: jest.fn() } as unknown as BalanceUpdateService,
      );

      await expect(
        sysAccountService.postDoubleEntry(emMock, userId, {
          accountingDate: '2026-08-15',
          description: 'Asiento inválido',
          debitAccountId: arAccountId,
          creditAccountId: arAccountId,
          amountBase: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('UpdateCommitmentUseCase blocks origin change when settled > 0, allows metadata edit, and rebuilds tx when unsettled', async () => {
      const rebuildSpy = jest.fn().mockResolvedValue(undefined);
      const savedCommitments: any[] = [];

      const buildEm = (settledAmount: number) => ({
        findOne: jest.fn(async (entity: any, opts: any) => {
          if (entity === CommitmentEntity) {
            return {
              id: 'com-upd',
              userId,
              contactId,
              contact: { id: contactId, name: 'Cliente A' },
              direction: 'INFLOW',
              originType: 'CATEGORY',
              categoryAccountId: incomeCatId,
              cashAccountId: null,
              controlAccountId: arAccountId,
              description: 'Servicio original',
              notes: null,
              totalAmount: 1000,
              initialTransactionId: 'tx-init-upd',
              initialTransaction: {
                id: 'tx-init-upd',
                status: 'POSTED',
                description: 'Desc inicial',
              },
              installments: [
                {
                  id: 'inst-upd-1',
                  amount: 1000,
                  dueDate: '2026-09-01',
                  settlements:
                    settledAmount > 0
                      ? [
                          {
                            id: 'set-upd',
                            amount: settledAmount,
                            transaction: { status: 'POSTED' },
                          },
                        ]
                      : [],
                },
              ],
            };
          }
          if (
            entity === ContactEntity &&
            opts?.where?.id === '99999999-9999-4999-8999-999999999999'
          ) {
            return {
              id: '99999999-9999-4999-8999-999999999999',
              userId,
              name: 'Cliente Nuevo',
            };
          }
          if (entity === AccountEntity && opts?.where?.id === cashAccountId) {
            return {
              id: cashAccountId,
              userId,
              name: 'Banco Principal',
              type: 'ASSET',
              isCashOrBank: true,
            };
          }
          return null;
        }),
        save: jest.fn(async (entityOrData: any, data?: any) => {
          const record = data ?? entityOrData;
          if (entityOrData === CommitmentEntity) {
            savedCommitments.push(record);
          }
          return record;
        }),
      });

      const settledEm = buildEm(400);
      const settledUpdateUseCase = new UpdateCommitmentUseCase(
        { transaction: (_iso: any, cb: any) => cb(settledEm) } as unknown as DataSource,
        { rebuildTransactionEntries: rebuildSpy } as unknown as SystemAccountService,
        {
          getById: jest.fn().mockResolvedValue({ id: 'com-upd' }),
        } as unknown as GetCommitmentsUseCase,
      );

      // Cannot change originType when settled > 0
      await expect(
        settledUpdateUseCase.execute(userId, 'com-upd', {
          originType: 'CASH_TRANSFER',
          cashAccountId,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(rebuildSpy).not.toHaveBeenCalled();

      // Can still edit metadata (contactId/description/notes) when settled > 0
      await settledUpdateUseCase.execute(userId, 'com-upd', {
        contactId: '99999999-9999-4999-8999-999999999999',
        description: 'Servicio renombrado',
        notes: 'Nota actualizada',
      });
      const savedSettled = savedCommitments.find((c) => c.description === 'Servicio renombrado');
      expect(savedSettled?.contactId).toBe('99999999-9999-4999-8999-999999999999');
      expect(savedSettled?.contact?.name).toBe('Cliente Nuevo');
      expect(settledEm.save).toHaveBeenCalled();

      // Can change originType when settled === 0 and rebuilds initial transaction
      const unsettledEm = buildEm(0);
      const unsettledUpdateUseCase = new UpdateCommitmentUseCase(
        { transaction: (_iso: any, cb: any) => cb(unsettledEm) } as unknown as DataSource,
        { rebuildTransactionEntries: rebuildSpy } as unknown as SystemAccountService,
        {
          getById: jest.fn().mockResolvedValue({ id: 'com-upd' }),
        } as unknown as GetCommitmentsUseCase,
      );

      await unsettledUpdateUseCase.execute(userId, 'com-upd', {
        originType: 'CASH_TRANSFER',
        cashAccountId,
      });
      expect(rebuildSpy).toHaveBeenCalledWith(
        unsettledEm,
        userId,
        'tx-init-upd',
        [
          { accountId: arAccountId, entryType: 'DEBIT', amountBase: 1000 },
          { accountId: cashAccountId, entryType: 'CREDIT', amountBase: 1000 },
        ],
        '[Cuentas por cobrar] Cliente A — Servicio original',
      );
    });
  });

  describe('Spec 00 Integration (CashFlowAdapter, BudgetControl & BalanceSheet)', () => {
    it('projects dated pending/overdue installments in CommitmentCashFlowAdapter and populates Budget committed', async () => {
      const qbMock = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'i-dated',
            dueDate: '2026-08-25',
            amount: 3000,
            settlements: [],
            commitment: {
              id: 'c-1',
              userId,
              direction: 'OUTFLOW',
              originType: 'CATEGORY',
              categoryAccountId: expenseCatId,
              controlAccountId: apAccountId,
              contactId,
              contact: { name: 'Proveedor IT' },
            },
          },
          {
            id: 'i-nodate',
            dueDate: null,
            amount: 9999,
            settlements: [],
            commitment: {
              id: 'c-2',
              userId,
              direction: 'OUTFLOW',
              originType: 'CATEGORY',
              categoryAccountId: expenseCatId,
              controlAccountId: apAccountId,
              contactId,
              contact: { name: 'Sin Fecha' },
            },
          },
        ]),
      };

      const mockInstallmentRepo = {
        createQueryBuilder: jest.fn(() => qbMock),
      };

      const adapterModule: TestingModule = await Test.createTestingModule({
        providers: [
          CommitmentCashFlowAdapter,
          {
            provide: getRepositoryToken(CommitmentInstallmentEntity),
            useValue: mockInstallmentRepo,
          },
          {
            provide: getRepositoryToken(CommitmentEntity),
            useValue: { find: jest.fn().mockResolvedValue([]) },
          },
        ],
      }).compile();

      const adapter = adapterModule.get<CommitmentCashFlowAdapter>(CommitmentCashFlowAdapter);
      const scheduled = await adapter.getScheduledCashFlowItems(userId, '2026-08-01', '2026-08-31');

      expect(qbMock.andWhere).toHaveBeenCalledWith('inst.dueDate IS NOT NULL');
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0]).toMatchObject({
        sourceId: 'i-dated',
        categoryAccountId: expenseCatId,
        amount: 3000,
        direction: 'OUTFLOW',
      });

      // Verify GetBudgetControlUseCase aggregates adapter committed amounts once per account/direction
      const budgetQbMock = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest
          .fn()
          .mockResolvedValueOnce([
            { id: expenseCatId, userId, name: 'Proveedor IT', type: 'EXPENSE', status: 'ACTIVE' },
          ])
          .mockResolvedValueOnce([]),
      };

      const budgetEmMock: any = {
        findOne: jest.fn(async (entity: any) => {
          if (entity === PeriodEntity) {
            return {
              id: 'p-aug',
              userId,
              name: '2026-08',
              startDate: '2026-08-01',
              endDate: '2026-08-31',
              status: 'OPEN',
            };
          }
          if (entity === BudgetEntity) {
            return {
              id: 'b-aug',
              userId,
              periodId: 'p-aug',
              items: [
                {
                  accountId: expenseCatId,
                  amount: 5000,
                  cashFlowDirection: CashFlowDirection.EGRESO_EFECTIVO,
                },
              ],
            };
          }
          return null;
        }),
        createQueryBuilder: jest.fn(() => budgetQbMock),
      };

      const budgetModule: TestingModule = await Test.createTestingModule({
        providers: [
          GetBudgetControlUseCase,
          {
            provide: DataSource,
            useValue: { transaction: (cb: any) => cb(budgetEmMock) },
          },
          { provide: CommitmentCashFlowAdapter, useValue: adapter as CashFlowCommitmentSource },
        ],
      }).compile();

      const budgetControl = budgetModule.get<GetBudgetControlUseCase>(GetBudgetControlUseCase);
      const controlResult = await budgetControl.execute(userId, 'p-aug');
      const lifeSec = controlResult.sections?.find(
        (s) => s.sectionKey === BudgetMatrixSectionKey.GASTOS_VIDA,
      );
      const expenseItem = lifeSec?.items.find((i) => i.accountId === expenseCatId);
      expect(expenseItem?.committed).toBe(3000);
    });

    it('attaches contactBreakdown with hasNoDate flag on ACCOUNTS_RECEIVABLE in BalanceSheetUseCase', async () => {
      const commitmentRepoMock = {
        find: jest.fn().mockResolvedValue([
          {
            id: 'com-bs-1',
            userId,
            direction: 'INFLOW',
            controlAccountId: arAccountId,
            contactId,
            contact: { name: 'Cliente Alfa' },
            installments: [
              { id: 'i-1', amount: 800, dueDate: '2026-09-01', settlements: [] },
              { id: 'i-2', amount: 200, dueDate: null, settlements: [] },
            ],
          },
        ]),
      };

      const bsModule: TestingModule = await Test.createTestingModule({
        providers: [
          BalanceSheetUseCase,
          {
            provide: getRepositoryToken(PeriodEntity),
            useValue: {
              findOne: jest.fn().mockResolvedValue({
                id: 'p-1',
                name: '2026-08',
                userId,
                startDate: '2026-08-01',
                endDate: '2026-08-31',
                status: 'OPEN',
              }),
            },
          },
          {
            provide: getRepositoryToken(AccountPeriodBalanceEntity),
            useValue: {
              find: jest
                .fn()
                .mockResolvedValue([
                  { accountId: arAccountId, periodId: 'p-1', closingBalance: 1000 },
                ]),
            },
          },
          {
            provide: getRepositoryToken(AccountEntity),
            useValue: {
              find: jest.fn().mockResolvedValue([
                {
                  id: arAccountId,
                  name: 'Cuentas por Cobrar',
                  type: 'ASSET',
                  systemRole: 'ACCOUNTS_RECEIVABLE',
                  parentId: null,
                  status: 'ACTIVE',
                  userId,
                },
              ]),
            },
          },
          {
            provide: getRepositoryToken(JournalEntryEntity),
            useValue: { find: jest.fn() },
          },
          {
            provide: DataSource,
            useValue: { getRepository: jest.fn(() => commitmentRepoMock) },
          },
          {
            provide: getRepositoryToken(CommitmentEntity),
            useValue: commitmentRepoMock,
          },
        ],
      }).compile();

      const balanceSheetUseCase = bsModule.get<BalanceSheetUseCase>(BalanceSheetUseCase);
      const bs = (await balanceSheetUseCase.execute(userId, {
        mode: 'period',
        periodId: 'p-1',
      })) as any;

      expect(bs.assets[0].contactBreakdown).toEqual([
        {
          contactId,
          contactName: 'Cliente Alfa',
          amount: 1000,
          hasNoDate: true,
        },
      ]);
    });

    it('computes Spec 00 Rolling Forecast (non-cash exclusion, CATEGORY cash attribution, ACTUAL & PROYECTADO max)', async () => {
      const periods = [
        {
          id: 'p-jul',
          userId,
          name: '2026-07',
          startDate: '2026-07-01',
          endDate: '2026-07-31',
          status: 'CLOSED',
        },
        {
          id: 'p-aug',
          userId,
          name: '2026-08',
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          status: 'OPEN',
        },
        {
          id: 'p-sep',
          userId,
          name: '2026-09',
          startDate: '2026-09-01',
          endDate: '2026-09-30',
          status: 'PLANNING',
        },
      ];

      const accounts = [
        {
          id: cashAccountId,
          userId,
          name: 'Banco',
          type: 'ASSET',
          isCashOrBank: true,
          parentId: null,
        },
        {
          id: expenseCatId,
          userId,
          name: 'Nube AWS',
          type: 'EXPENSE',
          isCashOrBank: false,
          parentId: null,
        },
        {
          id: incomeCatId,
          userId,
          name: 'Honorarios',
          type: 'INCOME',
          isCashOrBank: false,
          parentId: null,
        },
        {
          id: apAccountId,
          userId,
          name: 'Cuentas por Pagar',
          type: 'LIABILITY',
          isCashOrBank: false,
          systemRole: 'ACCOUNTS_PAYABLE',
          parentId: null,
        },
        {
          id: arAccountId,
          userId,
          name: 'Cuentas por Cobrar',
          type: 'ASSET',
          isCashOrBank: false,
          systemRole: 'ACCOUNTS_RECEIVABLE',
          parentId: null,
        },
      ];

      const adapterMock: CashFlowCommitmentSource = {
        getScheduledCashFlowItems: jest.fn().mockResolvedValue([
          {
            dueDate: '2026-08-05',
            periodName: '2026-08',
            amount: 400,
            direction: 'OUTFLOW',
            categoryAccountId: expenseCatId,
            controlAccountId: apAccountId,
            sourceType: 'COMMITMENT',
            sourceId: 'inst-aug-overdue',
            commitmentId: 'com-a',
            contactId,
            contactName: 'Proveedor Nube',
          },
          {
            dueDate: '2026-08-25',
            periodName: '2026-08',
            amount: 300,
            direction: 'OUTFLOW',
            categoryAccountId: expenseCatId,
            controlAccountId: apAccountId,
            sourceType: 'COMMITMENT',
            sourceId: 'inst-aug-rem',
            commitmentId: 'com-b',
            contactId,
            contactName: 'Proveedor Nube',
          },
          {
            dueDate: '2026-08-22',
            periodName: '2026-08',
            amount: 600,
            direction: 'INFLOW',
            categoryAccountId: arAccountId,
            controlAccountId: arAccountId,
            sourceType: 'COMMITMENT',
            sourceId: 'inst-aug-ar',
            commitmentId: 'com-c',
            contactId,
            contactName: 'Cliente Norte',
          },
          {
            dueDate: '2026-09-10',
            periodName: '2026-09',
            amount: 1500,
            direction: 'OUTFLOW',
            categoryAccountId: expenseCatId,
            controlAccountId: apAccountId,
            sourceType: 'COMMITMENT',
            sourceId: 'inst-sep-out',
            commitmentId: 'com-d',
            contactId,
            contactName: 'Proveedor Nube',
          },
          {
            dueDate: '2026-09-10',
            periodName: '2026-09',
            amount: 800,
            direction: 'INFLOW',
            categoryAccountId: incomeCatId,
            controlAccountId: arAccountId,
            sourceType: 'COMMITMENT',
            sourceId: 'inst-sep-in',
            commitmentId: 'com-e',
            contactId: 'contact-sur',
            contactName: 'Cliente Sur',
          },
        ]),
      };

      const emMock: any = {
        findOne: jest.fn(async (entity: any, opts: any) => {
          if (entity === PeriodEntity) {
            return periods.find((p) => p.name === opts?.where?.name) || null;
          }
          if (entity === BudgetEntity) {
            if (opts?.where?.periodId === 'p-aug') {
              return {
                id: 'b-aug',
                periodId: 'p-aug',
                items: [
                  {
                    accountId: expenseCatId,
                    amount: 900,
                    cashFlowDirection: 'EGRESO_EFECTIVO',
                    account: accounts[1],
                  },
                  {
                    accountId: incomeCatId,
                    amount: 3000,
                    cashFlowDirection: 'INGRESO_EFECTIVO',
                    account: accounts[2],
                  },
                ],
              };
            }
            if (opts?.where?.periodId === 'p-sep') {
              return {
                id: 'b-sep',
                periodId: 'p-sep',
                items: [
                  {
                    accountId: expenseCatId,
                    amount: 1000,
                    cashFlowDirection: 'EGRESO_EFECTIVO',
                    account: accounts[1],
                  },
                  {
                    accountId: incomeCatId,
                    amount: 2000,
                    cashFlowDirection: 'INGRESO_EFECTIVO',
                    account: accounts[2],
                  },
                ],
              };
            }
            return null;
          }
          return null;
        }),
        find: jest.fn(async (entity: any, opts: any) => {
          if (entity === PeriodEntity) return periods;
          if (entity === AccountEntity) return accounts;
          if (entity === AccountPeriodBalanceEntity) {
            if (opts?.where?.periodId === 'p-jul') {
              return [{ accountId: cashAccountId, openingBalance: 1000, account: accounts[0] }];
            }
            return [];
          }
          if (entity === TransactionEntity) {
            const rangeVal: string[] = opts?.where?.accountingDate?.value || [];
            const start = rangeVal[0] || '';
            if (start.startsWith('2026-07')) {
              return [
                // Non-cash accrual must be excluded from EjecutadoEnCaja
                {
                  id: 'tx-accrual-jul',
                  accountingDate: '2026-07-05',
                  status: 'POSTED',
                  entries: [
                    {
                      accountId: expenseCatId,
                      entryType: 'DEBIT',
                      amountBase: 500,
                      account: accounts[1],
                    },
                    {
                      accountId: apAccountId,
                      entryType: 'CREDIT',
                      amountBase: 500,
                      account: accounts[3],
                    },
                  ],
                },
                // CATEGORY settlement cash tx attributes back to expenseCatId (200)
                {
                  id: 'tx-set-cat-jul',
                  accountingDate: '2026-07-20',
                  status: 'POSTED',
                  entries: [
                    {
                      accountId: apAccountId,
                      entryType: 'DEBIT',
                      amountBase: 200,
                      account: accounts[3],
                    },
                    {
                      accountId: cashAccountId,
                      entryType: 'CREDIT',
                      amountBase: 200,
                      account: accounts[0],
                    },
                  ],
                },
              ];
            }
            if (start.startsWith('2026-08')) {
              return [
                {
                  id: 'tx-exp-aug',
                  accountingDate: '2026-08-03',
                  status: 'POSTED',
                  entries: [
                    {
                      accountId: expenseCatId,
                      entryType: 'DEBIT',
                      amountBase: 500,
                      account: accounts[1],
                    },
                    {
                      accountId: cashAccountId,
                      entryType: 'CREDIT',
                      amountBase: 500,
                      account: accounts[0],
                    },
                  ],
                },
              ];
            }
            return [];
          }
          if (entity === CommitmentSettlementEntity) {
            const txIds: string[] = opts?.where?.transactionId?.value || [];
            if (txIds.includes('tx-set-cat-jul')) {
              return [
                {
                  transactionId: 'tx-set-cat-jul',
                  installment: {
                    commitment: {
                      categoryAccountId: expenseCatId,
                      controlAccountId: apAccountId,
                    },
                  },
                },
              ];
            }
            return [];
          }
          return [];
        }),
      };

      const forecastModule: TestingModule = await Test.createTestingModule({
        providers: [
          CashFlowStatementForecastUseCase,
          {
            provide: getRepositoryToken(PeriodEntity),
            useValue: {
              manager: {
                transaction: (cb: any) => cb(emMock),
              },
            },
          },
          { provide: getRepositoryToken(AccountPeriodBalanceEntity), useValue: {} },
          { provide: getRepositoryToken(BudgetEntity), useValue: {} },
          { provide: CommitmentCashFlowAdapter, useValue: adapterMock },
        ],
      }).compile();

      const forecastUseCase = forecastModule.get<CashFlowStatementForecastUseCase>(
        CashFlowStatementForecastUseCase,
      );
      const res = await forecastUseCase.execute(userId, '2026-07', true, new Date('2026-08-15'), 3);

      expect(res.months.map((m: any) => m.periodStatus)).toEqual(['REAL', 'ACTUAL', 'PROYECTADO']);

      const expAcc = res.accounts.find((a: any) => a.accountId === expenseCatId)!;
      const incAcc = res.accounts.find((a: any) => a.accountId === incomeCatId)!;
      const arAcc = res.accounts.find((a: any) => a.accountId === arAccountId)!;
      const apAcc = res.accounts.find((a: any) => a.accountId === apAccountId)!;

      // REAL (Jul): accrual 500 ignored; settlement 200 appears under Cuentas por Pagar
      expect(apAcc.outflowValues['p-jul']).toBe(200);
      expect(res.months[0].initialCash).toBe(1000);
      expect(res.months[0].finalCash).toBe(800);

      // ACTUAL (Aug): Cuentas por Pagar absorbs 700 (400 + 300) from Nube AWS budget 900 -> remaining 200 vs exec 500 = 500; total = 500 + 700 = 1200
      expect(expAcc.outflowValues['p-aug']).toBe(500);
      expect(apAcc.outflowValues['p-aug']).toBe(700);
      expect(incAcc.inflowValues['p-aug']).toBe(3000);
      expect(arAcc.inflowValues['p-aug']).toBe(600);
      expect(arAcc.contactBreakdown).toEqual([
        {
          contactId: 'contact-sur',
          contactName: 'Cliente Sur',
          amount: 800,
          valuesByPeriod: { 'p-sep': 800 },
        },
        {
          contactId,
          contactName: 'Cliente Norte',
          amount: 600,
          valuesByPeriod: { 'p-aug': 600 },
        },
      ]);

      // PROYECTADO (Sep):
      // Nube AWS budget 1000 absorbed by 1500 AP commitment -> expAcc=0, apAcc=1500
      // Honorarios budget 2000 absorbed by 800 AR commitment -> incAcc=1200, arAcc=800 (total=2000, zero double counting)
      expect(expAcc.outflowValues['p-sep']).toBe(0);
      expect(apAcc.outflowValues['p-sep']).toBe(1500);
      expect(incAcc.inflowValues['p-sep']).toBe(1200);
      expect(arAcc.inflowValues['p-sep']).toBe(800);
      expect(apAcc.contactBreakdown).toEqual([
        {
          contactId,
          contactName: 'Proveedor Nube',
          amount: 2200,
          valuesByPeriod: { 'p-aug': 700, 'p-sep': 1500 },
        },
      ]);
    });

    it('skips DB queries on synthetic future periods (p-YYYY-MM) while projecting commitments cleanly', async () => {
      const findMock = jest.fn(async (entity: any) => {
        if (entity === PeriodEntity) return [];
        if (entity === AccountEntity) {
          return [
            {
              id: arAccountId,
              userId,
              name: 'Cuentas por Cobrar',
              type: 'ASSET',
              isCashOrBank: false,
              systemRole: 'ACCOUNTS_RECEIVABLE',
              parentId: null,
            },
          ];
        }
        return [];
      });
      const findOneMock = jest.fn(async (entity: any, opts: any) => {
        if (entity === BudgetEntity && String(opts?.where?.periodId || '').startsWith('p-')) {
          throw new Error(`Invalid UUID passed to BudgetEntity query: ${opts?.where?.periodId}`);
        }
        return null;
      });
      const adapterMock: CashFlowCommitmentSource = {
        getScheduledCashFlowItems: jest.fn().mockResolvedValue([
          {
            dueDate: '2026-12-15',
            periodName: '2026-12',
            amount: 500000,
            direction: 'INFLOW',
            categoryAccountId: incomeCatId,
            controlAccountId: arAccountId,
            sourceType: 'COMMITMENT',
            sourceId: 'inst-dec',
            commitmentId: 'com-dec',
            contactId,
            contactName: 'Jessica Ciancio',
            label: 'Jessica Ciancio — Prestamo personal (Cuota 2)',
          },
        ]),
      };

      const forecastModule: TestingModule = await Test.createTestingModule({
        providers: [
          CashFlowStatementForecastUseCase,
          {
            provide: getRepositoryToken(PeriodEntity),
            useValue: {
              manager: {
                transaction: (cb: any) =>
                  cb({
                    find: findMock,
                    findOne: findOneMock,
                  }),
              },
            },
          },
          { provide: getRepositoryToken(AccountPeriodBalanceEntity), useValue: {} },
          { provide: getRepositoryToken(BudgetEntity), useValue: {} },
          { provide: CommitmentCashFlowAdapter, useValue: adapterMock },
        ],
      }).compile();

      const forecastUseCase = forecastModule.get<CashFlowStatementForecastUseCase>(
        CashFlowStatementForecastUseCase,
      );
      const res = await forecastUseCase.execute(userId, '2026-11', true, new Date('2026-11-15'), 2);
      expect(res.months).toHaveLength(2);
      const arAcc = res.accounts.find((a: any) => a.accountId === arAccountId)!;
      expect(arAcc.inflowValues['p-2026-12']).toBe(500000);
      expect(arAcc.contactBreakdown?.[0]?.contactName).toBe('Jessica Ciancio');
    });
  });
});
