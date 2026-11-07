import { Controller, Post, Body, Delete, Param } from '@nestjs/common';

import { DatabaseService } from 'src/database/database.service';

import { UserId } from 'src/users/user.decorator';

import { RegisterDeviceDto } from 'src/schema/devices';

// Every event is sent to all of them, so this also limits what one account can make us send
const MAX_DEVICES_PER_USER = 10;

@Controller('devices')
export class DevicesController {
  constructor(private prisma: DatabaseService) {}

  @Post()
  async register(@UserId() userId: string, @Body() dto: RegisterDeviceDto) {
    await this.prisma.$transaction(async (tx) => {
      // upsert by token: if the device switches accounts, the token moves to the new user
      await tx.deviceToken.upsert({
        where: { token: dto.token },
        update: { userId, platform: dto.platform },
        create: { token: dto.token, platform: dto.platform, userId },
      });

      const stale = await tx.deviceToken.findMany({
        where: { userId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: MAX_DEVICES_PER_USER,
        select: { id: true },
      });

      await tx.deviceToken.deleteMany({
        where: { id: { in: stale.map(({ id }) => id) } },
      });
    });

    return { registered: true };
  }

  @Delete(':token')
  unregister(@UserId() userId: string, @Param('token') token: string) {
    return this.prisma.deviceToken.deleteMany({
      where: { token, userId },
    });
  }
}
