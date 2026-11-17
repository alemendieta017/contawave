import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  CommitmentDto,
  CommitmentFlowDirection,
  CommitmentOriginType,
  UpdateCommitmentRequest,
  UpdateCommitmentRequestSchema,
} from '@sistema-contable/shared';
import { CommitmentEntity } from '../../infrastructure/database/entities/commitment.entity';
import { ContactEntity } from '../../infrastructure/database/entities/contact.entity';
import { AccountEntity } from '../../infrastructure/database/entities/account.entity';
import {
  buildCommitmentTransactionDescription,
  calculateCommitmentDerived,
  calculateInstallmentDerived,
} from '../../domain/commitments/commitment-calculator';
import { SystemAccountService } from './system-account.service';
import { GetCommitmentsUseCase } from './get-commitments.use-case';

@Injectable()
export class UpdateCommitmentUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly systemAccountService: SystemAccountService,
    private readonly getCommitmentsUseCase: GetCommitmentsUseCase,
  ) {}

  private async resolveOriginAccounts(
    em: EntityManager,
    userId: string,
    direction: CommitmentFlowDirection,
    originType: CommitmentOriginType,
    categoryAccountId?: string | null,
    cashAccountId?: string | null,
  ): Promise<{ counterpartId: string; categoryId: string | null; cashId: string | null }> {
    if (originType === 'CATEGORY') {
      if (!categoryAccountId) {
        throw new BadRequestException('Debe seleccionar una categoría para el origen CATEGORY');
      }
      const cat = await em.findOne(AccountEntity, { where: { id: categoryAccountId, userId } });
      if (!cat) {
        throw new NotFoundException('Categoría no encontrada');
      }
      const expectedType = direction === 'INFLOW' ? 'INCOME' : 'EXPENSE';
      if (cat.type !== expectedType) {
        throw new BadRequestException(
          `La cuenta ${cat.name} debe ser de tipo ${expectedType === 'INCOME' ? 'Ingreso' : 'Gasto'}`,
        );
      }
      return { counterpartId: cat.id, categoryId: cat.id, cashId: null };
    }

    if (originType === 'CASH_TRANSFER') {
      if (!cashAccountId) {
        throw new BadRequestException('Debe seleccionar una cuenta de efectivo o banco');
      }
      const cashAcc = await em.findOne(AccountEntity, { where: { id: cashAccountId, userId } });
      if (!cashAcc || !cashAcc.isCashOrBank) {
        throw new BadRequestException('La cuenta seleccionada debe ser de efectivo o banco');
      }
      return { counterpartId: cashAcc.id, categoryId: null, cashId: cashAcc.id };
    }

    const capitalAcc = await this.systemAccountService.getOrCreateSystemAccount(
      em,
      userId,
      'CAPITAL',
    );
    return { counterpartId: capitalAcc.id, categoryId: null, cashId: null };
  }

  async execute(
    userId: string,
    commitmentId: string,
    dto: UpdateCommitmentRequest,
  ): Promise<CommitmentDto> {
    const parsed = UpdateCommitmentRequestSchema.parse(dto);

    await this.dataSource.transaction('SERIALIZABLE', async (em) => {
      const commitment = await em.findOne(CommitmentEntity, {
        where: { id: commitmentId, userId },
        relations: [
          'contact',
          'initialTransaction',
          'installments',
          'installments.settlements',
          'installments.settlements.transaction',
        ],
      });
      if (!commitment) {
        throw new NotFoundException(`Compromiso con ID ${commitmentId} no encontrado`);
      }

      let contactName = commitment.contact?.name || 'Contacto';
      if (parsed.contactId && parsed.contactId !== commitment.contactId) {
        const nextContact = await em.findOne(ContactEntity, {
          where: { id: parsed.contactId, userId },
        });
        if (!nextContact) {
          throw new NotFoundException('Contacto seleccionado no encontrado');
        }
        commitment.contactId = nextContact.id;
        commitment.contact = nextContact;
        contactName = nextContact.name;
      }

      if (parsed.description !== undefined) {
        commitment.description = parsed.description.trim();
      }
      if (parsed.notes !== undefined) {
        commitment.notes = parsed.notes ?? null;
      }

      const nextOriginType = parsed.originType ?? commitment.originType;
      const nextCategoryId =
        parsed.categoryAccountId !== undefined
          ? parsed.categoryAccountId
          : commitment.categoryAccountId;
      const nextCashId =
        parsed.cashAccountId !== undefined ? parsed.cashAccountId : commitment.cashAccountId;

      const originChanged =
        nextOriginType !== commitment.originType ||
        nextCategoryId !== commitment.categoryAccountId ||
        nextCashId !== commitment.cashAccountId;

      const txDesc = buildCommitmentTransactionDescription(
        commitment.direction,
        contactName,
        commitment.description,
      );

      if (originChanged) {
        const derivedInsts = (commitment.installments || []).map((inst) => ({
          dueDate: inst.dueDate ? String(inst.dueDate) : null,
          ...calculateInstallmentDerived(inst),
        }));
        const derived = calculateCommitmentDerived(commitment.totalAmount, derivedInsts);
        if (derived.settledAmount > 0.0001) {
          throw new BadRequestException(
            'No se puede modificar el origen contable de un compromiso con cobros o pagos registrados',
          );
        }

        const resolved = await this.resolveOriginAccounts(
          em,
          userId,
          commitment.direction,
          nextOriginType,
          nextCategoryId,
          nextCashId,
        );
        commitment.originType = nextOriginType;
        commitment.categoryAccountId = resolved.categoryId;
        commitment.cashAccountId = resolved.cashId;

        if (commitment.initialTransaction && commitment.initialTransaction.status === 'POSTED') {
          const totalBase = Number(commitment.totalAmount);
          await this.systemAccountService.rebuildTransactionEntries(
            em,
            userId,
            commitment.initialTransactionId,
            [
              {
                accountId:
                  commitment.direction === 'INFLOW'
                    ? commitment.controlAccountId
                    : resolved.counterpartId,
                entryType: 'DEBIT',
                amountBase: totalBase,
              },
              {
                accountId:
                  commitment.direction === 'INFLOW'
                    ? resolved.counterpartId
                    : commitment.controlAccountId,
                entryType: 'CREDIT',
                amountBase: totalBase,
              },
            ],
            txDesc,
          );
        }
      } else if (
        commitment.initialTransaction &&
        commitment.initialTransaction.status === 'POSTED' &&
        (parsed.contactId || parsed.description !== undefined)
      ) {
        commitment.initialTransaction.description = txDesc;
        await em.save(commitment.initialTransaction);
      }

      await em.save(CommitmentEntity, commitment);
    });

    return this.getCommitmentsUseCase.getById(userId, commitmentId);
  }
}
