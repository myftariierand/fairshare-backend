import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { DatabaseService } from 'src/database/database.service';
import { EmailService } from 'src/email/email.service';

import { Prisma, User } from '@prisma/client';

import { renderTemplate } from 'templates/render-template';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: DatabaseService,
    private emailService: EmailService,
  ) {}

  async findMany(): Promise<User[]> {
    return this.prisma.user.findMany();
  }

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
    const res = this.prisma.user.findMany({
      where: {
        id: { not: userId },
        OR: [
          { AND: [{ name: { contains: q, mode: 'insensitive' } }] },
          { AND: [{ email: { contains: q, mode: 'insensitive' } }] },
        ],
      },
      include: {
        friendshipsReceiver: {
          where: { senderId: userId },
          select: { id: true, status: true },
        },
        ...(groupId && {
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

    return res;
  }

  async create(userCreateInput: Prisma.UserCreateInput): Promise<User> {
    const { password, email, ...rest } = userCreateInput;

    const hashedPwd = await bcrypt.hash(password, 10);
    const normalizedEmail = email.trim().toLowerCase();

    const data = { ...rest, email: normalizedEmail, password: hashedPwd };

    const user = await this.prisma.user.create({ data });

    const html = renderTemplate('new-user-registered', {
      name: user.name,
      email: user.email,
      registeredAt: user.createdAt,
      provider: user.provider,
    });

    this.emailService
      .sendEmail({
        to: 'myftarierand@gmail.com',
        subject: `New user registered`,
        html,
      })
      .catch((err) => {
        this.logger?.error('Failed to send new-user notification email', err);
      });

    return user;
  }

  async findFriendRequests(userId: string) {
    try {
      return await this.prisma.friendships.findMany({
        where: {
          receiverId: userId,
        },
      });
    } catch (error) {
      console.log(error);
    }
  }
}
