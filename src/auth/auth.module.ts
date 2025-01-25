import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthService } from 'src/auth/auth.service';
import { AuthController } from 'src/auth/auth.controller';

import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [UsersModule, JwtModule.register({ global: true })],
  providers: [AuthService],
  controllers: [AuthController],
})
export class AuthModule {}
