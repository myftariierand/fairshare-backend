import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';

import { PrismaClient } from '@prisma/client';

@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  constructor() {
    super({
      omit: {
        user: {
          password: true,
        },
        // Anyone holding it can join the group, so only getInviteLink selects it
        group: {
          inviteToken: true,
        },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  // Runs after the server has stopped, so requests still in progress can finish first
  async onApplicationShutdown() {
    await this.$disconnect();
  }
}
