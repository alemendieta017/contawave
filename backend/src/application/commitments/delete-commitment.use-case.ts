import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CommitmentEntity } from '../../infrastructure/database/entities/commitment.entity';
import { CommitmentInstallmentEntity } from '../../infrastructure/database/entities/commitment-installment.entity';
import { CommitmentSettlementEntity } from '../../infrastructure/database/entities/commitment-settlement.entity';
import {
  calculateCommitmentDerived,
  calculateInstallmentDerived,
} from '../../domain/commitments/commitment-calculator';
import { SystemAccountService } from './system-account.service';

@Injectable()
export class DeleteCommitmentUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly systemAccountService: SystemAccountService,
  ) {}

  async execute(userId: string, commitmentId: string): Promise<{ success: boolean }> {
    await this.dataSource.transaction('SERIALIZABLE', async (em) => {
      const commitment = await em.findOne(CommitmentEntity, {
        where: { id: commitmentId, userId },
        relations: [
          'installments',
          'installments.settlements',
          'installments.settlements.transaction',
        ],
      });

      if (!commitment) {
        throw new NotFoundException(`Compromiso con ID ${commitmentId} no encontrado`);
      }

      const derivedInsts = (commitment.installments || []).map((inst) => ({
        dueDate: inst.dueDate ? String(inst.dueDate) : null,
        ...calculateInstallmentDerived(inst),
      }));
      const derived = calculateCommitmentDerived(commitment.totalAmount, derivedInsts);

      if (derived.settledAmount > 0.0001) {
        throw new BadRequestException(
          'No se puede eliminar un compromiso con movimientos asentados',
        );
      }

      const initialTxId = commitment.initialTransactionId;
      const installmentIds = (commitment.installments || []).map((i) => i.id);
      if (installmentIds.length > 0) {
        await em
          .createQueryBuilder()
          .delete()
          .from(CommitmentSettlementEntity)
          .where('installment_id IN (:...installmentIds)', { installmentIds })
          .execute();
      }
      await em.delete(CommitmentInstallmentEntity, { commitmentId });
      await em.delete(CommitmentEntity, { id: commitmentId, userId });

      await this.systemAccountService.deletePostedTransactionWithBalances(em, userId, initialTxId);
    });

    return { success: true };
  }
}
