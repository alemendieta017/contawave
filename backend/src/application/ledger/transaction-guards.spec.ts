import { BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AccountEntity } from '../../infrastructure/database/entities/account.entity';
import { CommitmentEntity } from '../../infrastructure/database/entities/commitment.entity';
import { CommitmentSettlementEntity } from '../../infrastructure/database/entities/commitment-settlement.entity';
import { TransactionEntity } from '../../infrastructure/database/entities/transaction.entity';
import { BalanceUpdateService } from '../periods/balance-update.service';
import { EnsurePeriodService } from '../periods/ensure-period.service';
import { CreateTransactionUseCase } from './create-transaction.use-case';
import { DeleteTransactionUseCase } from './delete-transaction.use-case';
import { ReverseTransactionUseCase } from './reverse-transaction.use-case';
import {
  assertAccountOperableForManualEntry,
  assertTransactionMutationAllowed,
} from './transaction-guards';
import { UpdateTransactionUseCase } from './update-transaction.use-case';

describe('Ledger Transaction & Control Account Guards', () => {
  const userId = 'user-1';

  describe('assertAccountOperableForManualEntry', () => {
    it('rejects control accounts (isControlAccount, ACCOUNTS_RECEIVABLE, ACCOUNTS_PAYABLE) and NET_INCOME', () => {
      expect(() =>
        assertAccountOperableForManualEntry({
          id: 'a-1',
          name: 'Cuentas por Cobrar',
          status: 'ACTIVE',
          systemRole: 'ACCOUNTS_RECEIVABLE',
          isControlAccount: true,
        } as AccountEntity),
      ).toThrow(BadRequestException);

      expect(() =>
        assertAccountOperableForManualEntry({
          id: 'a-2',
          name: 'Cuentas por Pagar',
          status: 'ACTIVE',
          systemRole: 'ACCOUNTS_PAYABLE',
          isControlAccount: false,
        } as AccountEntity),
      ).toThrow(BadRequestException);

      expect(() =>
        assertAccountOperableForManualEntry({
          id: 'a-3',
          name: 'Préstamo Itaú',
          status: 'ACTIVE',
          systemRole: null,
          isControlAccount: true,
        } as AccountEntity),
      ).toThrow(BadRequestException);

      expect(() =>
        assertAccountOperableForManualEntry({
          id: 'a-4',
          name: 'Resultado del Ejercicio',
          status: 'ACTIVE',
          systemRole: 'NET_INCOME',
          isControlAccount: false,
        } as AccountEntity),
      ).toThrow(BadRequestException);
    });

    it('allows normal active accounts', () => {
      expect(() =>
        assertAccountOperableForManualEntry({
          id: 'a-5',
          name: 'Banco Principal',
          status: 'ACTIVE',
          systemRole: null,
          isControlAccount: false,
        } as AccountEntity),
      ).not.toThrow();
    });
  });

  describe('assertTransactionMutationAllowed', () => {
    const emptyEm = {
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as EntityManager;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('blocks update, delete, and public reverse for controlled transactions', async () => {
      const tx = {
        id: 'tx-1',
        status: 'POSTED',
        reversalOfId: null,
        originModule: 'COMMITMENT',
        originEntityId: 'com-1',
      } as unknown as TransactionEntity;

      await expect(assertTransactionMutationAllowed(emptyEm, tx, 'update')).rejects.toThrow(
        BadRequestException,
      );
      await expect(assertTransactionMutationAllowed(emptyEm, tx, 'delete')).rejects.toThrow(
        BadRequestException,
      );
      await expect(assertTransactionMutationAllowed(emptyEm, tx, 'reverse')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('allows controlled reverse only when allowControlled is true', async () => {
      const tx = {
        id: 'tx-1',
        status: 'POSTED',
        reversalOfId: null,
        originModule: 'COMMITMENT',
        originEntityId: 'com-1',
      } as unknown as TransactionEntity;

      await expect(
        assertTransactionMutationAllowed(emptyEm, tx, 'reverse', { allowControlled: true }),
      ).resolves.toBeUndefined();
    });

    it('blocks deleting reversed transactions and reversal transactions', async () => {
      const reversedTx = {
        id: 'tx-orig',
        status: 'REVERSED',
        reversalOfId: null,
        originModule: 'MANUAL',
      } as unknown as TransactionEntity;

      const reversalTx = {
        id: 'tx-rev',
        status: 'POSTED',
        reversalOfId: 'tx-orig',
        originModule: 'MANUAL',
      } as unknown as TransactionEntity;

      await expect(assertTransactionMutationAllowed(emptyEm, reversedTx, 'delete')).rejects.toThrow(
        BadRequestException,
      );
      await expect(assertTransactionMutationAllowed(emptyEm, reversalTx, 'delete')).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        assertTransactionMutationAllowed(emptyEm, reversalTx, 'reverse'),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks mutating legacy untagged transactions linked to commitments or settlements', async () => {
      const legacyTx = {
        id: 'tx-legacy',
        status: 'POSTED',
        reversalOfId: null,
        originModule: 'MANUAL',
      } as unknown as TransactionEntity;

      const emWithCommitment = {
        findOne: jest.fn(async (entity: any) => {
          if (entity === CommitmentEntity) {
            return { id: 'com-legacy', initialTransactionId: 'tx-legacy' };
          }
          return null;
        }),
      } as unknown as EntityManager;

      await expect(
        assertTransactionMutationAllowed(emWithCommitment, legacyTx, 'delete'),
      ).rejects.toThrow(BadRequestException);

      const emWithSettlement = {
        findOne: jest.fn(async (entity: any) => {
          if (entity === CommitmentSettlementEntity) {
            return { id: 'set-legacy', transactionId: 'tx-legacy' };
          }
          return null;
        }),
      } as unknown as EntityManager;

      await expect(
        assertTransactionMutationAllowed(emWithSettlement, legacyTx, 'update'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('UseCases integration with guards', () => {
    it('CreateTransactionUseCase rejects manual post to ACCOUNTS_RECEIVABLE', async () => {
      const emMock: any = {
        findOne: jest.fn(async (entity: any, opts: any) => {
          if (entity === AccountEntity) {
            return {
              id: opts.where.id,
              userId,
              name: 'Cuentas por Cobrar',
              status: 'ACTIVE',
              systemRole: 'ACCOUNTS_RECEIVABLE',
              isControlAccount: true,
              currencyId: 'cur-1',
            };
          }
          return { id: 'cur-1', rateToBase: 1 };
        }),
      };

      const useCase = new CreateTransactionUseCase(
        {} as any,
        {} as any,
        {} as any,
        { transaction: (_iso: any, cb: any) => cb(emMock) } as unknown as DataSource,
        { updateBalances: jest.fn() } as unknown as BalanceUpdateService,
        { ensurePeriod: jest.fn() } as unknown as EnsurePeriodService,
      );

      await expect(
        useCase.execute(userId, {
          accountingDate: '2026-11-16',
          description: 'Asiento directo indebido',
          entries: [
            { accountId: 'ar-1', entryType: 'DEBIT', amount: 100 },
            { accountId: 'cash-1', entryType: 'CREDIT', amount: 100 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('DeleteTransactionUseCase and UpdateTransactionUseCase reject COMMITMENT transactions', async () => {
      const controlledTx = {
        id: 'tx-com',
        userId,
        accountingDate: '2026-11-16',
        description: 'Compromiso',
        status: 'POSTED',
        reversalOfId: null,
        originModule: 'COMMITMENT',
        originEntityId: 'com-1',
        entries: [],
      };

      const emMock: any = {
        findOne: jest.fn(async (entity: any) => {
          if (entity === TransactionEntity) return controlledTx;
          return null;
        }),
      };
      const dsMock = { transaction: (_iso: any, cb: any) => cb(emMock) } as unknown as DataSource;

      const deleteUc = new DeleteTransactionUseCase({} as any, dsMock, {
        updateBalances: jest.fn(),
      } as unknown as BalanceUpdateService);
      await expect(deleteUc.execute(userId, 'tx-com')).rejects.toThrow(BadRequestException);

      const updateUc = new UpdateTransactionUseCase(
        {} as any,
        {} as any,
        {} as any,
        dsMock,
        { updateBalances: jest.fn() } as unknown as BalanceUpdateService,
        { ensurePeriod: jest.fn() } as unknown as EnsurePeriodService,
      );
      await expect(
        updateUc.execute(userId, 'tx-com', {
          accountingDate: '2026-11-16',
          description: 'Editado',
          entries: [
            { accountId: 'a-1', entryType: 'DEBIT', amount: 100 },
            { accountId: 'a-2', entryType: 'CREDIT', amount: 100 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('ReverseTransactionUseCase blocks public reverse of COMMITMENT tx and propagates originModule when allowControlled=true', async () => {
      const controlledTx = {
        id: 'tx-com',
        userId,
        accountingDate: '2026-11-16',
        description: 'Cobro cuota #1',
        status: 'POSTED',
        reversalOfId: null,
        originModule: 'COMMITMENT',
        originEntityId: 'com-1',
        entries: [
          {
            id: 'je-1',
            accountId: 'cash-1',
            entryType: 'DEBIT',
            amount: 500,
            amountBase: 500,
            rateAtDate: 1,
          },
          {
            id: 'je-2',
            accountId: 'ar-1',
            entryType: 'CREDIT',
            amount: 500,
            amountBase: 500,
            rateAtDate: 1,
          },
        ],
      };

      const savedObjects: any[] = [];
      const emMock: any = {
        findOne: jest.fn(async (entity: any) => {
          if (entity === TransactionEntity) return { ...controlledTx };
          return null;
        }),
        create: jest.fn((_e: any, data: any) => ({ ...data })),
        save: jest.fn(async (_e: any, data: any) => {
          const saved = { id: `saved-${savedObjects.length + 1}`, ...data };
          savedObjects.push(saved);
          return saved;
        }),
      };

      const reverseUc = new ReverseTransactionUseCase(
        {} as any,
        {} as any,
        { transaction: (_iso: any, cb: any) => cb(emMock) } as unknown as DataSource,
        { updateBalances: jest.fn() } as unknown as BalanceUpdateService,
        { ensurePeriod: jest.fn() } as unknown as EnsurePeriodService,
      );

      await expect(reverseUc.execute(userId, 'tx-com')).rejects.toThrow(BadRequestException);

      await reverseUc.execute(userId, 'tx-com', { allowControlled: true });
      const createdReversal = savedObjects.find((o) => o.reversalOfId === 'tx-com');
      expect(createdReversal).toBeDefined();
      expect(createdReversal.originModule).toBe('COMMITMENT');
      expect(createdReversal.originEntityId).toBe('com-1');
    });
  });
});
