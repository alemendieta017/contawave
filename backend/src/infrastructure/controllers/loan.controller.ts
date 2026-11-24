import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CreateLoanRequest,
  CreateLoanRequestSchema,
  PayLoanInstallmentRequest,
  PayLoanInstallmentRequestSchema,
  UpdateLoanPlanRequest,
  UpdateLoanPlanRequestSchema,
} from '@sistema-contable/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UserEntity } from '../database/entities/user.entity';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { GetLoansUseCase } from '../../application/loans/get-loans.use-case';
import { CreateLoanUseCase } from '../../application/loans/create-loan.use-case';
import { PayLoanInstallmentUseCase } from '../../application/loans/pay-loan-installment.use-case';
import { ReverseLoanPaymentUseCase } from '../../application/loans/reverse-loan-payment.use-case';
import { UpdateLoanPlanUseCase } from '../../application/loans/update-loan-plan.use-case';
import { DeleteLoanUseCase } from '../../application/loans/delete-loan.use-case';

@Controller('api/loans')
@UseGuards(JwtAuthGuard)
export class LoanController {
  constructor(
    private readonly getLoansUseCase: GetLoansUseCase,
    private readonly createLoanUseCase: CreateLoanUseCase,
    private readonly payLoanInstallmentUseCase: PayLoanInstallmentUseCase,
    private readonly reverseLoanPaymentUseCase: ReverseLoanPaymentUseCase,
    private readonly updateLoanPlanUseCase: UpdateLoanPlanUseCase,
    private readonly deleteLoanUseCase: DeleteLoanUseCase,
  ) {}

  private parseTimezoneOffset(raw?: string): number | undefined {
    if (raw === undefined || raw === '') return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  @Get()
  async list(@CurrentUser() user: UserEntity, @Query('timezoneOffset') timezoneOffset?: string) {
    return this.getLoansUseCase.list(user.id, this.parseTimezoneOffset(timezoneOffset));
  }

  @Post()
  async create(
    @CurrentUser() user: UserEntity,
    @Body(new ZodValidationPipe(CreateLoanRequestSchema)) body: CreateLoanRequest,
  ) {
    return this.createLoanUseCase.execute(user.id, body);
  }

  @Post('installments/:id/pay')
  async payInstallment(
    @CurrentUser() user: UserEntity,
    @Param('id', new ParseUUIDPipe()) installmentId: string,
    @Body(new ZodValidationPipe(PayLoanInstallmentRequestSchema))
    body: PayLoanInstallmentRequest,
  ) {
    return this.payLoanInstallmentUseCase.execute(user.id, installmentId, body);
  }

  @Post('allocations/:id/reverse')
  async reversePayment(
    @CurrentUser() user: UserEntity,
    @Param('id', new ParseUUIDPipe()) allocationId: string,
  ) {
    return this.reverseLoanPaymentUseCase.execute(user.id, allocationId);
  }

  @Get(':id')
  async getById(
    @CurrentUser() user: UserEntity,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('timezoneOffset') timezoneOffset?: string,
  ) {
    return this.getLoansUseCase.getById(user.id, id, this.parseTimezoneOffset(timezoneOffset));
  }

  @Patch(':id/plan')
  async updatePlan(
    @CurrentUser() user: UserEntity,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateLoanPlanRequestSchema)) body: UpdateLoanPlanRequest,
  ) {
    return this.updateLoanPlanUseCase.execute(user.id, id, body);
  }

  @Delete(':id')
  async delete(@CurrentUser() user: UserEntity, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.deleteLoanUseCase.execute(user.id, id);
  }
}
