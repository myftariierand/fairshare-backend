import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { DatabaseService } from 'src/database/database.service';
import { EmailService } from 'src/email/email.service';
import { sendInBackground } from 'src/email/send-in-background';

import { Prisma, User } from '@prisma/client';

const MIN_SEARCH_LENGTH = 2;

const maskEmail = (email: string) => {
  const [local, domain] = email.split('@');

  return `${local[0]}***@${domain}`;
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: DatabaseService,
    private emailService: EmailService,
  ) {}

  async findUnique(
    userWhereUniqueInput: Prisma.UserWhereUniqueInput,
    userFindUniqueArgs?: Omit<Prisma.UserFindUniqueArgs, 'where'>,
  ): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: userWhereUniqueInput,
      ...userFindUniqueArgs,
    });
  }

  async searchUsers(
    userId: string,
    query: string,
    limit: number,
    offset: number,
    groupId?: string,
  ) {
    const q = query.trim();

    if (q.length < MIN_SEARCH_LENGTH) return [];

    const canSeeInvitations =
      groupId &&
      (await this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
      }));

    const users = await this.prisma.user.findMany({
      where: {
        id: { not: userId },
        role: 'USER',
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          // From the start only, so a search for "@gmail.com" can't list everyone on Gmail
          { email: { startsWith: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        friendshipsReceiver: {
          where: { senderId: userId },
          select: { id: true, status: true },
        },
        ...(canSeeInvitations && {
          invitationReceiver: {
            where: { groupId },
            select: { id: true, status: true },
          },
        }),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit,
      skip: offset,
    });

    return users.map((user) => ({
      ...user,
      // Whoever typed the full address already knows it
      email:
        user.email.toLowerCase() === q.toLowerCase()
          ? user.email
          : maskEmail(user.email),
    }));
  }

  async create(userCreateInput: Prisma.UserCreateInput): Promise<User> {
    const { password, email, ...rest } = userCreateInput;

    const hashedPwd = password ? await bcrypt.hash(password, 10) : null;
    const normalizedEmail = email.trim().toLowerCase();

    const data = { ...rest, email: normalizedEmail, password: hashedPwd };

    const user = await this.prisma.user.create({ data });

    const to = process.env.NOTIFICATION_EMAIL;

    if (to) {
      sendInBackground(
        this.emailService,
        this.logger,
        to,
        'new-user-registered',
        {
          name: user.name,
          email: user.email,
          registeredAt: user.createdAt,
          provider: user.provider,
        },
      );
    }

    return user;
  }

  private sendWelcome(user: User) {
    sendInBackground(this.emailService, this.logger, user.email, 'welcome', {
      email: user.email,
      name: user.name,
    });
  }

  // Google has confirmed who owns this email, which an unverified account never proved. Anyone
  // could have registered it to wait for the real owner, so their password must not survive.
  async findOrCreateGoogleUser(email: string, name: string): Promise<User> {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await this.findUnique({ email: normalizedEmail });

    if (!user) {
      const created = await this.create({
        name,
        email: normalizedEmail,
        provider: 'google',
        emailVerified: true,
      });

      this.sendWelcome(created);

      return created;
    }

    if (user.emailVerified) return user;

    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { password: null, provider: 'google', emailVerified: true },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.deviceToken.deleteMany({ where: { userId: user.id } }),
    ]);

    this.sendWelcome(updated);

    return updated;
  }
}
