import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  CommitmentDto,
  CommitmentFlowDirection,
  CommitmentOriginType,
  CreateCommitmentRequest,
  CreateCommitmentRequestSchema,
} from '@sistema-contable/shared';
import { ContactEntity } from '../../infrastructure/database/entities/contact.entity';
import { AccountEntity } from '../../infrastructure/database/entities/account.entity';
import { CommitmentEntity } from '../../infrastructure/database/entities/commitment.entity';
import { CommitmentInstallmentEntity } from '../../infrastructure/database/entities/commitment-installment.entity';
import { TransactionEntity } from '../../infrastructure/database/entities/transaction.entity';
import {
  buildCommitmentTransactionDescription,
  getTodayIsoDate,
  roundMoney,
} from '../../domain/commitments/commitment-calculator';
import { SystemAccountService } from './system-account.service';
import { GetCommitmentsUseCase } from './get-commitments.use-case';

@Injectable()
export class CreateCommitmentUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly systemAccountService: SystemAccountService,
    private readonly getCommitmentsUseCase: GetCommitmentsUseCase,
  ) {}

  private async resolveCounterpartAccount(
    em: EntityManager,
    userId: string,
    direction: CommitmentFlowDirection,
    originType: CommitmentOriginType,
    categoryAccountId?: string | null,
    cashAccountId?: string | null,
  ): Promise<{
    counterpartAccount: AccountEntity;
    categoryId: string | null;
    cashId: string | null;
  }> {
    if (originType === 'CATEGORY') {
      if (!categoryAccountId) {
        throw new BadRequestException('Debe seleccionar una categoría contable');
      }
      const cat = await em.findOne(AccountEntity, {
        where: { id: categoryAccountId, userId },
      });
      if (!cat) {
        throw new NotFoundException('Categoría seleccionada no encontrada');
      }
      const expectedType = direction === 'INFLOW' ? 'INCOME' : 'EXPENSE';
      if (cat.type !== expectedType) {
        throw new BadRequestException(
          `La cuenta ${cat.name} debe ser de tipo ${expectedType === 'INCOME' ? 'Ingreso' : 'Gasto'}`,
        );
      }
      return { counterpartAccount: cat, categoryId: cat.id, cashId: null };
    }

    if (originType === 'CASH_TRANSFER') {
      if (!cashAccountId) {
        throw new BadRequestException('Debe seleccionar una cuenta de efectivo o banco');
      }
      const cashAcc = await em.findOne(AccountEntity, {
        where: { id: cashAccountId, userId },
      });
      if (!cashAcc) {
        throw new NotFoundException('Cuenta de efectivo/banco no encontrada');
      }
      if (!cashAcc.isCashOrBank) {
        throw new BadRequestException(
          `La cuenta ${cashAcc.name} debe ser una cuenta líquida (efectivo o banco)`,
        );
      }
      return { counterpartAccount: cashAcc, categoryId: null, cashId: cashAcc.id };
    }

    const capitalAcc = await this.systemAccountService.getOrCreateSystemAccount(
      em,
      userId,
      'CAPITAL',
    );
    return { counterpartAccount: capitalAcc, categoryId: null, cashId: null };
  }

  async execute(userId: string, dto: CreateCommitmentRequest): Promise<CommitmentDto> {
    const parsed = CreateCommitmentRequestSchema.parse(dto);
    const totalAmount = roundMoney(parsed.totalAmount);
    const accountingDate = parsed.accountingDate || getTodayIsoDate();

    const createdId = await this.dataSource.transaction('SERIALIZABLE', async (em) => {
      const contact = await em.findOne(ContactEntity, {
        where: { id: parsed.contactId, userId },
      });
      if (!contact) {
        throw new NotFoundException('Contacto no encontrado');
      }

      const controlRole =
        parsed.direction === 'INFLOW' ? 'ACCOUNTS_RECEIVABLE' : 'ACCOUNTS_PAYABLE';
      const controlAccount = await this.systemAccountService.getOrCreateSystemAccount(
        em,
        userId,
        controlRole,
      );

      const { counterpartAccount, categoryId, cashId } = await this.resolveCounterpartAccount(
        em,
        userId,
        parsed.direction,
        parsed.originType,
        parsed.categoryAccountId,
        parsed.cashAccountId,
      );

      const debitAccountId =
        parsed.direction === 'INFLOW' ? controlAccount.id : counterpartAccount.id;
      const creditAccountId =
        parsed.direction === 'INFLOW' ? counterpartAccount.id : controlAccount.id;

      const { transaction } = await this.systemAccountService.postDoubleEntry(em, userId, {
        accountingDate,
        description: buildCommitmentTransactionDescription(
          parsed.direction,
          contact.name,
          parsed.description,
        ),
        debitAccountId,
        creditAccountId,
        amountBase: totalAmount,
        originModule: 'COMMITMENT',
      });

      const commitment = em.create(CommitmentEntity, {
        userId,
        contactId: contact.id,
        direction: parsed.direction,
        originType: parsed.originType,
        description: parsed.description.trim(),
        notes: parsed.notes ?? null,
        totalAmount,
        categoryAccountId: categoryId,
        cashAccountId: cashId,
        controlAccountId: controlAccount.id,
        initialTransactionId: transaction.id,
      });
      const savedCommitment = await em.save(CommitmentEntity, commitment);
      if (typeof em.update === 'function') {
        await em.update(
          TransactionEntity,
          { id: transaction.id },
          { originEntityId: savedCommitment.id },
        );
      }

      const installmentEntities = parsed.installments.map((row, index) =>
        em.create(CommitmentInstallmentEntity, {
          commitmentId: savedCommitment.id,
          installmentNumber: index + 1,
          dueDate: row.dueDate ?? null,
          amount: roundMoney(row.amount),
        }),
      );
      await em.save(CommitmentInstallmentEntity, installmentEntities);

      return savedCommitment.id;
    });

    return this.getCommitmentsUseCase.getById(userId, createdId);
  }
}
