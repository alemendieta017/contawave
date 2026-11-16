import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CommitmentDto,
  RescheduleCommitmentInstallmentRequest,
  RescheduleCommitmentInstallmentRequestSchema,
} from '@sistema-contable/shared';
import { CommitmentEntity } from '../../infrastructure/database/entities/commitment.entity';
import { CommitmentInstallmentEntity } from '../../infrastructure/database/entities/commitment-installment.entity';
import {
  calculateInstallmentDerived,
  roundMoney,
} from '../../domain/commitments/commitment-calculator';
import { SystemAccountService } from './system-account.service';
import { GetCommitmentsUseCase } from './get-commitments.use-case';

@Injectable()
export class RescheduleCommitmentInstallmentUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly systemAccountService: SystemAccountService,
    private readonly getCommitmentsUseCase: GetCommitmentsUseCase,
  ) {}

  async execute(
    userId: string,
    installmentId: string,
    dto: RescheduleCommitmentInstallmentRequest,
  ): Promise<CommitmentDto> {
    const parsed = RescheduleCommitmentInstallmentRequestSchema.parse(dto);

    const commitmentId = await this.dataSource.transaction('SERIALIZABLE', async (em) => {
      const installment = await em.findOne(CommitmentInstallmentEntity, {
        where: { id: installmentId },
        relations: [
          'commitment',
          'commitment.installments',
          'settlements',
          'settlements.transaction',
        ],
      });

      if (!installment || installment.commitment.userId !== userId) {
        throw new NotFoundException(`Cuota con ID ${installmentId} no encontrada`);
      }

      const commitment = installment.commitment;
      installment.dueDate = parsed.dueDate ?? null;

      let amountChanged = false;
      if (parsed.amount !== undefined) {
        const nextAmount = roundMoney(parsed.amount);
        if (Math.abs(nextAmount - Number(installment.amount)) > 0.0001) {
          const derived = calculateInstallmentDerived(installment);
          if (derived.settledAmount > 0.0001) {
            throw new BadRequestException(
              'No se puede cambiar el monto de una cuota que ya tiene cobros o pagos asentados',
            );
          }
          installment.amount = nextAmount;
          amountChanged = true;
        }
      }

      await em.save(CommitmentInstallmentEntity, installment);

      if (amountChanged) {
        const allInstallments = await em.find(CommitmentInstallmentEntity, {
          where: { commitmentId: commitment.id },
        });
        const newTotal = roundMoney(
          allInstallments.reduce((sum, item) => sum + Number(item.amount), 0),
        );
        commitment.totalAmount = newTotal;
        await em.save(CommitmentEntity, commitment);

        await this.systemAccountService.syncCommitmentInitialTransactionAmount(
          em,
          userId,
          commitment,
          newTotal,
        );
      }

      return commitment.id;
    });

    return this.getCommitmentsUseCase.getById(userId, commitmentId);
  }
}
