import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CommitmentDto,
  SettleCommitmentInstallmentRequest,
  SettleCommitmentInstallmentRequestSchema,
} from '@sistema-contable/shared';
import { CommitmentInstallmentEntity } from '../../infrastructure/database/entities/commitment-installment.entity';
import { CommitmentSettlementEntity } from '../../infrastructure/database/entities/commitment-settlement.entity';
import { AccountEntity } from '../../infrastructure/database/entities/account.entity';
import {
  calculateInstallmentDerived,
  roundMoney,
} from '../../domain/commitments/commitment-calculator';
import { SystemAccountService } from './system-account.service';
import { GetCommitmentsUseCase } from './get-commitments.use-case';

@Injectable()
export class SettleCommitmentInstallmentUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly systemAccountService: SystemAccountService,
    private readonly getCommitmentsUseCase: GetCommitmentsUseCase,
  ) {}

  async execute(
    userId: string,
    installmentId: string,
    dto: SettleCommitmentInstallmentRequest,
  ): Promise<CommitmentDto> {
    const parsed = SettleCommitmentInstallmentRequestSchema.parse(dto);

    const commitmentId = await this.dataSource.transaction('SERIALIZABLE', async (em) => {
      const installment = await em.findOne(CommitmentInstallmentEntity, {
        where: { id: installmentId },
        relations: ['commitment', 'commitment.contact', 'settlements', 'settlements.transaction'],
      });

      if (!installment || installment.commitment.userId !== userId) {
        throw new NotFoundException(`Cuota con ID ${installmentId} no encontrada`);
      }

      const commitment = installment.commitment;
      const derived = calculateInstallmentDerived(installment);

      if (derived.pendingAmount <= 0) {
        throw new BadRequestException('Esta cuota ya se encuentra completamente saldada');
      }

      const requestedAmount = roundMoney(parsed.amount);
      if (requestedAmount > derived.pendingAmount + 0.01) {
        throw new BadRequestException(
          `El monto a liquidar (${requestedAmount}) supera el saldo pendiente (${derived.pendingAmount})`,
        );
      }
      const settleAmount = Math.min(requestedAmount, derived.pendingAmount);

      const cashAccount = await em.findOne(AccountEntity, {
        where: { id: parsed.cashAccountId, userId },
      });
      if (!cashAccount) {
        throw new NotFoundException('Cuenta de efectivo o banco no encontrada');
      }
      if (!cashAccount.isCashOrBank) {
        throw new BadRequestException(
          `La cuenta ${cashAccount.name} debe ser una cuenta de efectivo o banco`,
        );
      }

      const isInflow = commitment.direction === 'INFLOW';
      const debitAccountId = isInflow ? cashAccount.id : commitment.controlAccountId;
      const creditAccountId = isInflow ? commitment.controlAccountId : cashAccount.id;

      const actionLabel = isInflow ? 'Cobro' : 'Pago';
      const contactName = commitment.contact?.name || 'Contacto';
      const txDesc = `${actionLabel} cuota #${installment.installmentNumber} · ${contactName} — ${commitment.description}`;

      const { transaction, debitEntry, creditEntry } =
        await this.systemAccountService.postDoubleEntry(em, userId, {
          accountingDate: parsed.settledAt,
          description: txDesc,
          debitAccountId,
          creditAccountId,
          amountBase: settleAmount,
        });

      const cashEntry = isInflow ? debitEntry : creditEntry;

      const settlement = em.create(CommitmentSettlementEntity, {
        installmentId: installment.id,
        transactionId: transaction.id,
        journalEntryId: cashEntry.id,
        settlementType: 'CASH',
        amount: settleAmount,
        settledAt: parsed.settledAt,
      });
      await em.save(CommitmentSettlementEntity, settlement);

      const remainder = roundMoney(derived.pendingAmount - settleAmount);
      if (remainder > 0.0001 && parsed.newDueDateForRemainder !== undefined) {
        installment.dueDate = parsed.newDueDateForRemainder ?? null;
        await em.save(CommitmentInstallmentEntity, installment);
      }

      return commitment.id;
    });

    return this.getCommitmentsUseCase.getById(userId, commitmentId);
  }
}
