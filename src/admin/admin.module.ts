import { Module } from '@nestjs/common';

import { AdminController } from 'src/admin/admin.controller';
import { AdminService } from 'src/admin/admin.service';
import { EmailModule } from 'src/email/email.module';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [UsersModule, EmailModule],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
