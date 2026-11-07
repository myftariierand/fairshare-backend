import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ActivityLogsService } from 'src/activity-logs/activity.service';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { DatabaseService } from 'src/database/database.service';
import { EmailService } from 'src/email/email.service';
import { sendInBackground } from 'src/email/send-in-background';
import { GroupDebtService } from 'src/group-debt/groupDebt.service';

const DELETED_USER_NAME = 'Deleted user';

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly groupDebtService: GroupDebtService,
    private readonly activityLogsService: ActivityLogsService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly emailService: EmailService,
  ) {}

  // The row stays, as "Deleted user", because other people's expenses and balances point at it.
  // Everything that identifies the person goes. Being owed money blocks this as well as owing it:
  // only the person owed can mark a debt as paid, so their debtors could never settle up.
  async deleteAccount(userId: string, deletedBy: string) {
    const { covers, user } = await this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findFirst({
          where: { id: userId, deletedAt: null },
        });

        if (!user) throw new NotFoundException('User not found');

        if (user.role === 'ADMIN') {
          throw new ForbiddenException('Admin accounts cannot be deleted.');
        }

        // Always in the same order, so two deletions can't wait on each other's groups
        const memberships = await tx.groupMember.findMany({
          where: { userId },
          orderBy: { groupId: 'asc' },
          select: { groupId: true },
        });
        const groupIds = memberships.map(({ groupId }) => groupId);

        for (const groupId of groupIds) {
          await tx.$queryRaw`SELECT 1 FROM "Group" WHERE "id" = ${groupId} FOR UPDATE`;

          if (await this.groupDebtService.hasOpenDebts(groupId, userId, tx)) {
            throw new ConflictException(
              'All balances need to be settled before this account can be deleted.',
            );
          }
        }

        const covers: string[] = [];

        for (const groupId of groupIds) {
          const cover = await this.leaveGroup(userId, groupId, tx);
          if (cover) covers.push(cover);
        }

        await tx.friendships.deleteMany({
          where: { OR: [{ senderId: userId }, { receiverId: userId }] },
        });
        await tx.groupInvitation.deleteMany({
          where: { OR: [{ senderId: userId }, { receiverId: userId }] },
        });
        await tx.refreshToken.deleteMany({ where: { userId } });
        await tx.deviceToken.deleteMany({ where: { userId } });
        await tx.emailVerificationOtp.deleteMany({ where: { userId } });

        await tx.bugReport.updateMany({
          where: { email: user.email },
          data: { name: null, email: null },
        });

        await this.scrubActivitySnapshots(userId, tx);

        await tx.user.update({
          where: { id: userId },
          data: {
            name: DELETED_USER_NAME,
            email: `deleted-${userId}@deleted.invalid`,
            password: null,
            provider: 'deleted',
            emailVerified: false,
            deletedAt: new Date(),
          },
        });

        await this.activityLogsService.createActivityLog(
          {
            action: 'USER_DELETED',
            user: { connect: { id: deletedBy } },
            targetUser: { connect: { id: userId } },
          },
          tx,
        );

        // Read before the update above, because this is the only copy of the address now
        return { covers, user };
      },
      // Rewrites every log that mentions them, on top of waiting for each of their groups
      { maxWait: 10_000, timeout: 60_000 },
    );

    // Only now is it certain the groups are gone. A leftover file is better than failing here.
    await Promise.all(
      covers.map((cover) =>
        this.cloudinaryService.deleteFile(cover).catch((error) => {
          this.logger.error(`Failed to delete cover ${cover}`, error);
        }),
      ),
    );

    // An unverified address might not belong to whoever typed it in at sign-up
    if (user.emailVerified) {
      sendInBackground(
        this.emailService,
        this.logger,
        user.email,
        'account-deleted',
        {
          email: user.email,
          byAdmin: deletedBy !== userId,
          deletedAt: new Date(),
        },
      );
    }
  }

  // Returns the cover file to remove if this was the last member and the group went with them
  private async leaveGroup(
    userId: string,
    groupId: string,
    tx: Prisma.TransactionClient,
  ) {
    const group = await tx.group.findUniqueOrThrow({
      where: { id: groupId },
      select: {
        createdById: true,
        cover: true,
        members: {
          where: { NOT: { userId } },
          orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { userId: true },
        },
      },
    });

    const [nextOwner] = group.members;

    if (!nextOwner) {
      await tx.group.delete({ where: { id: groupId } });

      return group.cover;
    }

    await tx.groupMember.delete({
      where: { groupId_userId: { groupId, userId } },
    });

    if (group.createdById === userId) {
      await tx.group.update({
        where: { id: groupId },
        data: { createdById: nextOwner.userId },
      });
    }

    return null;
  }

  // Logs keep copies of the people involved at the time, including everyone in a group
  private async scrubActivitySnapshots(
    userId: string,
    tx: Prisma.TransactionClient,
  ) {
    const logs = await tx.$queryRaw<
      { id: string; snapshot: Prisma.JsonValue }[]
    >`
      SELECT "id", "snapshot" FROM "ActivityLog"
      WHERE "snapshot"::text LIKE ${`%${userId}%`}
    `;

    for (const { id, snapshot } of logs) {
      await tx.activityLog.update({
        where: { id },
        data: {
          snapshot: this.scrub(snapshot, userId) as Prisma.InputJsonValue,
        },
      });
    }
  }

  private scrub(value: Prisma.JsonValue, userId: string): Prisma.JsonValue {
    if (Array.isArray(value)) {
      return value.map((item) => this.scrub(item, userId));
    }

    if (value === null || typeof value !== 'object') return value;

    const entries = Object.entries(value).map(
      ([key, item]) => [key, this.scrub(item ?? null, userId)] as const,
    );
    const scrubbed = Object.fromEntries(entries);

    if (scrubbed.id !== userId) return scrubbed;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, ...rest } = scrubbed;

    return {
      ...rest,
      ...('name' in rest && { name: DELETED_USER_NAME }),
      ...('email' in rest && { email: `deleted-${userId}@deleted.invalid` }),
    };
  }
}
