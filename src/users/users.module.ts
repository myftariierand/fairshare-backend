import { Module } from '@nestjs/common';

import { UsersController } from 'src/users/users.controller';
import { UsersService } from 'src/users/users.service';
import { AccountDeletionService } from 'src/users/account-deletion.service';
import { EmailModule } from 'src/email/email.module';
import { GroupDebtModule } from 'src/group-debt/groupDebt.module';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';

@Module({
  imports: [EmailModule, GroupDebtModule, CloudinaryModule],
  controllers: [UsersController],
  providers: [UsersService, AccountDeletionService],
  exports: [UsersService, AccountDeletionService],
})
export class UsersModule {}
