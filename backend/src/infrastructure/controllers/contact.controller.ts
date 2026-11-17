import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  CreateContactRequest,
  CreateContactRequestSchema,
  UpdateContactRequest,
  UpdateContactRequestSchema,
} from '@sistema-contable/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UserEntity } from '../database/entities/user.entity';
import { ContactsUseCase } from '../../application/commitments/contacts.use-case';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('api/contacts')
@UseGuards(JwtAuthGuard)
export class ContactController {
  constructor(private readonly contactsUseCase: ContactsUseCase) {}

  @Get()
  async list(@CurrentUser() user: UserEntity) {
    return this.contactsUseCase.list(user.id);
  }

  @Post()
  async create(
    @CurrentUser() user: UserEntity,
    @Body(new ZodValidationPipe(CreateContactRequestSchema)) body: CreateContactRequest,
  ) {
    return this.contactsUseCase.create(user.id, body);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: UserEntity,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateContactRequestSchema)) body: UpdateContactRequest,
  ) {
    return this.contactsUseCase.update(user.id, id, body);
  }

  @Delete(':id')
  async delete(@CurrentUser() user: UserEntity, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.contactsUseCase.delete(user.id, id);
  }
}
