import { Module } from '@nestjs/common';

import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';

import { GroupDebtModule } from 'src/group-debt/groupDebt.module';
import { DevicesModule } from 'src/devices/devices.modules';

@Module({
  imports: [GroupDebtModule, DevicesModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
