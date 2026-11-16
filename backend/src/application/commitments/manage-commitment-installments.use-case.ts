import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AddCommitmentInstallmentRequest,
  AddCommitmentInstallmentRequestSchema,
  CommitmentDto,
} from '@sistema-contable/shared';
import { CommitmentEntity } from '../../infrastructure/database/entities/commitment.entity';
import { CommitmentInstallmentEntity } from '../../infrastructure/database/entities/commitment-installment.entity';
import { CommitmentSettlementEntity } from '../../infrastructure/database/entities/commitment-settlement.entity';
import {
  calculateInstallmentDerived,
  roundMoney,
} from '../../domain/commitments/commitment-calculator';
import { SystemAccountService } from './system-account.service';
import { GetCommitmentsUseCase } from './get-commitments.use-case';

@Injectable()
export class ManageCommitmentInstallmentsUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly systemAccountService: SystemAccountService,
    private readonly getCommitmentsUseCase: GetCommitmentsUseCase,
  ) {}

  async addInstallment(
    userId: string,
    commitmentId: string,
    dto: AddCommitmentInstallmentRequest,
  ): Promise<CommitmentDto> {
    const parsed = AddCommitmentInstallmentRequestSchema.parse(dto);
    const addAmount = roundMoney(parsed.amount);

    await this.dataSource.transaction('SERIALIZABLE', async (em) => {
      const commitment = await em.findOne(CommitmentEntity, {
        where: { id: commitmentId, userId },
        relations: ['installments'],
      });
      if (!commitment) {
        throw new NotFoundException(`Compromiso con ID ${commitmentId} no encontrado`);
      }

      const maxNum = (commitment.installments || []).reduce(
        (max, inst) => Math.max(max, inst.installmentNumber),
        0,
      );

      const newInst = em.create(CommitmentInstallmentEntity, {
        commitmentId,
        installmentNumber: maxNum + 1,
        dueDate: parsed.dueDate ?? null,
        amount: addAmount,
      });
      await em.save(CommitmentInstallmentEntity, newInst);

      const newTotal = roundMoney(Number(commitment.totalAmount) + addAmount);
      commitment.totalAmount = newTotal;
      await em.save(CommitmentEntity, commitment);

      await this.systemAccountService.syncCommitmentInitialTransactionAmount(
        em,
        userId,
        commitment,
        newTotal,
      );
    });

    return this.getCommitmentsUseCase.getById(userId, commitmentId);
  }

  async deleteInstallment(
    userId: string,
    commitmentId: string,
    installmentId: string,
  ): Promise<CommitmentDto> {
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

      const installments = (commitment.installments || [])
        .slice()
        .sort((a, b) => a.installmentNumber - b.installmentNumber);

      if (installments.length <= 1) {
        throw new BadRequestException('El compromiso debe conservar al menos 1 cuota');
      }

      const target = installments.find((i) => i.id === installmentId);
      if (!target) {
        throw new NotFoundException(`Cuota con ID ${installmentId} no encontrada`);
      }

      const derived = calculateInstallmentDerived(target);
      if (derived.settledAmount > 0.0001) {
        throw new BadRequestException(
          'No se puede quitar una cuota que ya tiene cobros o pagos asentados',
        );
      }

      await em.delete(CommitmentSettlementEntity, { installmentId });
      await em.delete(CommitmentInstallmentEntity, { id: installmentId, commitmentId });

      const remaining = installments.filter((i) => i.id !== installmentId);
      for (let idx = 0; idx < remaining.length; idx++) {
        remaining[idx].installmentNumber = idx + 1;
      }
      await em.save(CommitmentInstallmentEntity, remaining);

      const newTotal = roundMoney(remaining.reduce((sum, i) => sum + Number(i.amount), 0));
      commitment.totalAmount = newTotal;
      await em.save(CommitmentEntity, commitment);

      await this.systemAccountService.syncCommitmentInitialTransactionAmount(
        em,
        userId,
        commitment,
        newTotal,
      );
    });

    return this.getCommitmentsUseCase.getById(userId, commitmentId);
  }
}
