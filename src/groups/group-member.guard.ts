import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { DatabaseService } from 'src/database/database.service';

// For routes with a :groupId param. Runs after the global AuthGuard, which sets request.id.
@Injectable()
export class GroupMemberGuard implements CanActivate {
  constructor(private prisma: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const membership = await this.prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: request.params.groupId,
          userId: request.id,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this group');
    }

    return true;
  }
}
