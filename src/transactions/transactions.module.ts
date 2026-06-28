import { Module } from '@nestjs/common';

import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';

import { GroupDebtModule } from 'src/group-debt/groupDebt.module';

@Module({
  imports: [GroupDebtModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
