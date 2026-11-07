import { Module } from '@nestjs/common';

import { AdminController } from 'src/admin/admin.controller';
import { AdminService } from 'src/admin/admin.service';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [UsersModule],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
