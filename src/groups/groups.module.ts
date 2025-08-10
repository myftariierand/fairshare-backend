import { Module } from '@nestjs/common';

import { GroupsController } from 'src/groups/groups.controller';
import { GroupsService } from 'src/groups/groups.service';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';

@Module({
  imports: [CloudinaryModule],
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
