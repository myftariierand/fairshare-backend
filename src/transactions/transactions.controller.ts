import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { TransactionsService } from './transactions.service';

import { UserId } from 'src/users/user.decorator';

import {
  CreateTransactionDto,
  UpdateTransactionDto,
  UpdateTransactionParamsDto,
  DeleteTransactionParamsDto,
  GetTransactionParamsDto,
} from 'src/schema/transactions';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get(':groupId')
  getTransactions(
    @UserId() userId,
    @Param() { groupId }: GetTransactionParamsDto,
  ) {
    return this.transactionsService.findTransactions(userId, groupId);
  }

  @Post()
  createTransaction(
    @UserId() userId,
    @Body() createTransactionDto: CreateTransactionDto,
  ) {
    return this.transactionsService.createTransaction(
      userId,
      createTransactionDto.groupId,
      createTransactionDto.amount,
      createTransactionDto.description,
      createTransactionDto.splits,
    );
  }

  @Patch(':id')
  updateTransaction(
    @UserId() userId,
    @Param() { id }: UpdateTransactionParamsDto,
    @Body() updateTransactionDto: UpdateTransactionDto,
  ) {
    return this.transactionsService.updateTransaction(
      id,
      userId,
      updateTransactionDto.groupId,
      updateTransactionDto.amount,
      updateTransactionDto.description,
      updateTransactionDto.splits,
    );
  }

  @Delete(':id')
  deleteTransaction(
    @UserId() userId,
    @Param() { id }: DeleteTransactionParamsDto,
  ) {
    return this.transactionsService.deleteTransaction(userId, id);
  }
}
