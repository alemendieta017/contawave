import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DangerZoneAction, FACTORY_RESET_PHRASE } from '@sistema-contable/shared';
import { InvalidCurrentPasswordException } from '../../domain/exceptions/auth.exception';
import { FactoryResetUseCase } from './factory-reset.use-case';
import { UserEntity } from '../../infrastructure/database/entities/user.entity';
import { AccountEntity } from '../../infrastructure/database/entities/account.entity';
import { CurrencyEntity } from '../../infrastructure/database/entities/currency.entity';
import { BudgetEntity } from '../../infrastructure/database/entities/budget.entity';
import { LoanChargeColumnEntity } from '../../infrastructure/database/entities/loan-charge-column.entity';
import { LoanEntity } from '../../infrastructure/database/entities/loan.entity';
import { LoanInstallmentEntity } from '../../infrastructure/database/entities/loan-installment.entity';
import { LoanPaymentAllocationEntity } from '../../infrastructure/database/entities/loan-payment-allocation.entity';
import { TransactionEntity } from '../../infrastructure/database/entities/transaction.entity';

describe('FactoryResetUseCase (US2)', () => {
  let useCase: FactoryResetUseCase;
  let userRepositoryMock: any;
  let entityManagerMock: any;
  let queryBuilderMock: any;

  beforeEach(async () => {
    queryBuilderMock = {
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    entityManagerMock = {
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((entityClass, data) => data),
      save: jest.fn().mockImplementation((entityClass, data) => {
        if (Array.isArray(data)) {
          return Promise.resolve(data.map((d, i) => ({ id: `saved-id-${i}`, ...d })));
        }
        return Promise.resolve({ id: 'saved-id', ...data });
      }),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilderMock),
    };

    const dataSourceMock = {
      transaction: jest.fn().mockImplementation((isolationOrCb: any, maybeCb?: any) => {
        const cb = typeof isolationOrCb === 'function' ? isolationOrCb : maybeCb;
        return cb(entityManagerMock);
      }),
    };

    userRepositoryMock = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FactoryResetUseCase,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: userRepositoryMock,
        },
        {
          provide: DataSource,
          useValue: dataSourceMock,
        },
      ],
    }).compile();

    useCase = module.get<FactoryResetUseCase>(FactoryResetUseCase);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should throw UnauthorizedException if password does not match', async () => {
    const user: Partial<UserEntity> = {
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: '$2b$10$hashedpassword',
    };

    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(false) as any);

    await expect(
      useCase.execute(user as UserEntity, {
        confirmationPhrase: FACTORY_RESET_PHRASE,
        currentPassword: 'wrongPassword',
      }),
    ).rejects.toThrow(InvalidCurrentPasswordException);
  });

  it('should throw NotFoundException if user id is passed and user is not in database', async () => {
    userRepositoryMock.findOne.mockResolvedValue(null);

    await expect(
      useCase.execute('non-existent-user', {
        confirmationPhrase: FACTORY_RESET_PHRASE,
        currentPassword: 'anyPassword',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('should atomically purge data and re-seed starter accounts upon valid password', async () => {
    const user: Partial<UserEntity> = {
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: '$2b$10$hashedpassword',
    };

    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true) as any);

    queryBuilderMock.getMany = jest.fn().mockResolvedValue([{ id: 'li-1' }]);
    entityManagerMock.find.mockImplementation((entityClass: any) => {
      if (entityClass === BudgetEntity) {
        return Promise.resolve([{ id: 'b-1' }]);
      }
      if (entityClass === LoanEntity) {
        return Promise.resolve([{ id: 'loan-1' }]);
      }
      if (entityClass === AccountEntity) {
        return Promise.resolve([{ id: 'acc-1' }, { id: 'acc-2' }]);
      }
      if (entityClass === TransactionEntity) {
        return Promise.resolve([{ id: 'tx-1' }]);
      }
      return Promise.resolve([]);
    });

    entityManagerMock.findOne.mockImplementation((entityClass: any) => {
      if (entityClass === CurrencyEntity) {
        return Promise.resolve({ id: 'curr-base-usd', isBase: true, code: 'USD' });
      }
      return Promise.resolve(null);
    });

    const response = await useCase.execute(user as UserEntity, {
      confirmationPhrase: FACTORY_RESET_PHRASE,
      currentPassword: 'correctPassword',
    });

    expect(response.success).toBe(true);
    expect(response.action).toBe(DangerZoneAction.FACTORY_RESET);
    expect(response.message).toContain('restablecidos de fábrica');

    // Verify cascade deletions
    expect(entityManagerMock.createQueryBuilder).toHaveBeenCalled();
    expect(entityManagerMock.delete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-1' }),
    );

    // Verify starter accounts, periods, and budgets re-seeded in batch
    // 1 (accounts batch) + 1 (periods batch) + 1 (budgets batch) = 3 save calls
    // Verify ordered Loans purge before Transactions & Accounts deletion
    const allDeletedTargets: Array<{ entity: unknown; order: number }> = [
      ...entityManagerMock.delete.mock.calls.map((c: unknown[], idx: number) => ({
        entity: c[0],
        order: entityManagerMock.delete.mock.invocationCallOrder[idx],
      })),
      ...queryBuilderMock.from.mock.calls.map((c: unknown[], idx: number) => ({
        entity: c[0],
        order: queryBuilderMock.from.mock.invocationCallOrder[idx],
      })),
    ];
    const firstOrderOf = (target: unknown) =>
      allDeletedTargets.find((entry) => entry.entity === target)?.order ?? -1;

    expect(firstOrderOf(LoanPaymentAllocationEntity)).toBeGreaterThan(-1);
    expect(firstOrderOf(LoanInstallmentEntity)).toBeGreaterThan(
      firstOrderOf(LoanPaymentAllocationEntity),
    );
    expect(firstOrderOf(LoanChargeColumnEntity)).toBeGreaterThan(
      firstOrderOf(LoanInstallmentEntity),
    );
    expect(firstOrderOf(LoanEntity)).toBeGreaterThan(firstOrderOf(LoanChargeColumnEntity));
    expect(firstOrderOf(TransactionEntity)).toBeGreaterThan(firstOrderOf(LoanEntity));
    expect(firstOrderOf(AccountEntity)).toBeGreaterThan(firstOrderOf(TransactionEntity));

    expect(entityManagerMock.save).toHaveBeenCalledTimes(3);
  });
});
