import { Module } from '@nestjs/common';

import { GroupDebtService } from 'src/group-debt/groupDebt.service';

@Module({
  providers: [GroupDebtService],
  exports: [GroupDebtService],
})
export class GroupDebtModule {}
