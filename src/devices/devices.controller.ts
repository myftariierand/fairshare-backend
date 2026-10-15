import { Controller, Post, Body, Delete, Param } from '@nestjs/common';

import { DatabaseService } from 'src/database/database.service';

import { UserId } from 'src/users/user.decorator';

@Controller('devices')
export class DevicesController {
  constructor(private prisma: DatabaseService) {}

  @Post()
  register(@UserId() userId, @Body() dto: { token: string; platform: string }) {
    // upsert by token: if the device switches accounts, the token moves to the new user
    return this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      update: { userId, platform: dto.platform },
      create: { token: dto.token, platform: dto.platform, userId },
    });
  }

  @Delete(':token')
  unregister(@UserId() userId, @Param('token') token: string) {
    return this.prisma.deviceToken.deleteMany({
      where: { token, userId },
    });
  }
}
