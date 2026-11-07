import { Module } from '@nestjs/common';

import { GroupsController } from 'src/groups/groups.controller';
import { GroupsService } from 'src/groups/groups.service';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import { DevicesModule } from 'src/devices/devices.module';
import { GroupDebtModule } from 'src/group-debt/groupDebt.module';

@Module({
  imports: [CloudinaryModule, DevicesModule, GroupDebtModule],
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
