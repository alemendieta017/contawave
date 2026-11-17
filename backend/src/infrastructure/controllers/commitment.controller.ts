import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AddCommitmentInstallmentRequest,
  AddCommitmentInstallmentRequestSchema,
  CreateCommitmentRequest,
  CreateCommitmentRequestSchema,
  ForgiveCommitmentInstallmentRequest,
  ForgiveCommitmentInstallmentRequestSchema,
  RescheduleCommitmentInstallmentRequest,
  RescheduleCommitmentInstallmentRequestSchema,
  SettleCommitmentInstallmentRequest,
  SettleCommitmentInstallmentRequestSchema,
  UpdateCommitmentRequest,
  UpdateCommitmentRequestSchema,
} from '@sistema-contable/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UserEntity } from '../database/entities/user.entity';
import { CreateCommitmentUseCase } from '../../application/commitments/create-commitment.use-case';
import { GetCommitmentsUseCase } from '../../application/commitments/get-commitments.use-case';
import { UpdateCommitmentUseCase } from '../../application/commitments/update-commitment.use-case';
import { DeleteCommitmentUseCase } from '../../application/commitments/delete-commitment.use-case';
import { ManageCommitmentInstallmentsUseCase } from '../../application/commitments/manage-commitment-installments.use-case';
import { SettleCommitmentInstallmentUseCase } from '../../application/commitments/settle-commitment-installment.use-case';
import { ForgiveCommitmentInstallmentUseCase } from '../../application/commitments/forgive-commitment-installment.use-case';
import { RescheduleCommitmentInstallmentUseCase } from '../../application/commitments/reschedule-commitment-installment.use-case';
import { UndoCommitmentSettlementUseCase } from '../../application/commitments/undo-commitment-settlement.use-case';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('api/commitments')
@UseGuards(JwtAuthGuard)
export class CommitmentController {
  constructor(
    private readonly getCommitmentsUseCase: GetCommitmentsUseCase,
    private readonly createCommitmentUseCase: CreateCommitmentUseCase,
    private readonly updateCommitmentUseCase: UpdateCommitmentUseCase,
    private readonly deleteCommitmentUseCase: DeleteCommitmentUseCase,
    private readonly manageInstallmentsUseCase: ManageCommitmentInstallmentsUseCase,
    private readonly settleInstallmentUseCase: SettleCommitmentInstallmentUseCase,
    private readonly forgiveInstallmentUseCase: ForgiveCommitmentInstallmentUseCase,
    private readonly rescheduleInstallmentUseCase: RescheduleCommitmentInstallmentUseCase,
    private readonly undoSettlementUseCase: UndoCommitmentSettlementUseCase,
  ) {}

  private parseTimezoneOffset(raw?: string): number | undefined {
    if (raw === undefined || raw === '') return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  @Get()
  async list(@CurrentUser() user: UserEntity, @Query('timezoneOffset') timezoneOffset?: string) {
    return this.getCommitmentsUseCase.list(user.id, this.parseTimezoneOffset(timezoneOffset));
  }

  @Post()
  async create(
    @CurrentUser() user: UserEntity,
    @Body(new ZodValidationPipe(CreateCommitmentRequestSchema)) body: CreateCommitmentRequest,
  ) {
    return this.createCommitmentUseCase.execute(user.id, body);
  }

  @Post('installments/:id/settle')
  async settleInstallment(
    @CurrentUser() user: UserEntity,
    @Param('id', new ParseUUIDPipe()) installmentId: string,
    @Body(new ZodValidationPipe(SettleCommitmentInstallmentRequestSchema))
    body: SettleCommitmentInstallmentRequest,
  ) {
    return this.settleInstallmentUseCase.execute(user.id, installmentId, body);
  }

  @Post('installments/:id/forgive')
  async forgiveInstallment(
    @CurrentUser() user: UserEntity,
    @Param('id', new ParseUUIDPipe()) installmentId: string,
    @Body(new ZodValidationPipe(ForgiveCommitmentInstallmentRequestSchema))
    body: ForgiveCommitmentInstallmentRequest,
  ) {
    return this.forgiveInstallmentUseCase.execute(user.id, installmentId, body);
  }

  @Patch('installments/:id')
  async rescheduleInstallment(
    @CurrentUser() user: UserEntity,
    @Param('id', new ParseUUIDPipe()) installmentId: string,
    @Body(new ZodValidationPipe(RescheduleCommitmentInstallmentRequestSchema))
    body: RescheduleCommitmentInstallmentRequest,
  ) {
    return this.rescheduleInstallmentUseCase.execute(user.id, installmentId, body);
  }

  @Post('settlements/:id/undo')
  async undoSettlement(
    @CurrentUser() user: UserEntity,
    @Param('id', new ParseUUIDPipe()) settlementId: string,
  ) {
    return this.undoSettlementUseCase.execute(user.id, settlementId);
  }

  @Get(':id')
  async getById(
    @CurrentUser() user: UserEntity,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('timezoneOffset') timezoneOffset?: string,
  ) {
    return this.getCommitmentsUseCase.getById(
      user.id,
      id,
      this.parseTimezoneOffset(timezoneOffset),
    );
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: UserEntity,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateCommitmentRequestSchema)) body: UpdateCommitmentRequest,
  ) {
    return this.updateCommitmentUseCase.execute(user.id, id, body);
  }

  @Delete(':id')
  async delete(@CurrentUser() user: UserEntity, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.deleteCommitmentUseCase.execute(user.id, id);
  }

  @Post(':id/installments')
  async addInstallment(
    @CurrentUser() user: UserEntity,
    @Param('id', new ParseUUIDPipe()) commitmentId: string,
    @Body(new ZodValidationPipe(AddCommitmentInstallmentRequestSchema))
    body: AddCommitmentInstallmentRequest,
  ) {
    return this.manageInstallmentsUseCase.addInstallment(user.id, commitmentId, body);
  }

  @Delete(':id/installments/:installmentId')
  async deleteInstallment(
    @CurrentUser() user: UserEntity,
    @Param('id', new ParseUUIDPipe()) commitmentId: string,
    @Param('installmentId', new ParseUUIDPipe()) installmentId: string,
  ) {
    return this.manageInstallmentsUseCase.deleteInstallment(user.id, commitmentId, installmentId);
  }
}
