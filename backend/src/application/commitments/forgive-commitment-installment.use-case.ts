import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CommitmentDto,
  ForgiveCommitmentInstallmentRequest,
  ForgiveCommitmentInstallmentRequestSchema,
} from '@sistema-contable/shared';
import { CommitmentInstallmentEntity } from '../../infrastructure/database/entities/commitment-installment.entity';
import { CommitmentSettlementEntity } from '../../infrastructure/database/entities/commitment-settlement.entity';
import { AccountEntity } from '../../infrastructure/database/entities/account.entity';
import {
  calculateInstallmentDerived,
  getTodayIsoDate,
} from '../../domain/commitments/commitment-calculator';
import { SystemAccountService } from './system-account.service';
import { GetCommitmentsUseCase } from './get-commitments.use-case';
import { isControlAccount } from '../ledger/transaction-guards';

@Injectable()
export class ForgiveCommitmentInstallmentUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly systemAccountService: SystemAccountService,
    private readonly getCommitmentsUseCase: GetCommitmentsUseCase,
  ) {}

  async execute(
    userId: string,
    installmentId: string,
    dto: ForgiveCommitmentInstallmentRequest = {},
  ): Promise<CommitmentDto> {
    const parsed = ForgiveCommitmentInstallmentRequestSchema.parse(dto || {});
    const settledAt = parsed.settledAt || getTodayIsoDate();

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
        throw new BadRequestException('Esta cuota no tiene saldo pendiente por condonar');
      }

      let adjustmentAccountId: string;
      if (parsed.expenseAccountId) {
        const expAcc = await em.findOne(AccountEntity, {
          where: { id: parsed.expenseAccountId, userId },
        });
        if (!expAcc) {
          throw new NotFoundException('Cuenta de ajuste o pérdida no encontrada');
        }
        if (expAcc.isCashOrBank) {
          throw new BadRequestException(
            'La condonación no puede imputarse contra una cuenta de efectivo o banco',
          );
        }
        if (isControlAccount(expAcc)) {
          throw new BadRequestException(
            'La condonación no puede imputarse contra una cuenta de control',
          );
        }
        adjustmentAccountId = expAcc.id;
      } else if (commitment.categoryAccountId) {
        adjustmentAccountId = commitment.categoryAccountId;
      } else {
        const capitalAcc = await this.systemAccountService.getOrCreateSystemAccount(
          em,
          userId,
          'CAPITAL',
        );
        adjustmentAccountId = capitalAcc.id;
      }

      const isInflow = commitment.direction === 'INFLOW';
      const debitAccountId = isInflow ? adjustmentAccountId : commitment.controlAccountId;
      const creditAccountId = isInflow ? commitment.controlAccountId : adjustmentAccountId;

      const contactName = commitment.contact?.name || 'Contacto';
      const reasonSuffix = parsed.reason ? ` (${parsed.reason})` : '';
      const txDesc = `Condonación cuota #${installment.installmentNumber} · ${contactName} — ${commitment.description}${reasonSuffix}`;

      const { transaction, debitEntry, creditEntry } =
        await this.systemAccountService.postDoubleEntry(em, userId, {
          accountingDate: settledAt,
          description: txDesc,
          debitAccountId,
          creditAccountId,
          amountBase: derived.pendingAmount,
          originModule: 'COMMITMENT',
          originEntityId: commitment.id,
        });

      const adjustmentEntry = isInflow ? debitEntry : creditEntry;

      const settlement = em.create(CommitmentSettlementEntity, {
        installmentId: installment.id,
        transactionId: transaction.id,
        journalEntryId: adjustmentEntry.id,
        settlementType: 'FORGIVEN',
        amount: derived.pendingAmount,
        settledAt,
      });
      await em.save(CommitmentSettlementEntity, settlement);

      return commitment.id;
    });

    return this.getCommitmentsUseCase.getById(userId, commitmentId);
  }
}
