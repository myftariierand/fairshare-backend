import { Injectable, OnModuleInit } from '@nestjs/common';

import { PrismaClient } from '@prisma/client';

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit {
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
}
