import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { DatabaseService } from 'src/database/database.service';
import { EmailService } from 'src/email/email.service';

import { Prisma, User } from '@prisma/client';

import { renderTemplate } from 'templates/render-template';

@Injectable()
export class UsersService {
  constructor(
    private prisma: DatabaseService,
    private emailService: EmailService,
  ) {}

  async findMany(): Promise<User[]> {
    return this.prisma.user.findMany();
  }

  async findUnique(
    userWhereUniqueInput: Prisma.UserWhereUniqueInput,
  ): Promise<User | null> {
    return this.prisma.user.findUnique({ where: userWhereUniqueInput });
  }

  async searchUsers(
    userId: string,
    query: string,
    limit: number,
    offset: number,
    groupId?: string,
  ) {
    const res = this.prisma.user.findMany({
      where: {
        OR: [
          { AND: [{ name: { contains: query } }, { id: { not: userId } }] },
          { AND: [{ email: { contains: query } }, { id: { not: userId } }] },
        ],
      },
      take: limit,
      skip: offset,
      include: {
        friendshipsReceiver: { where: { OR: [{ senderId: userId }] } },
        invitationReceiver: { where: { groupId } },
      },
    });

    return res;
  }

  async create(userCreateInput: Prisma.UserCreateInput): Promise<User> {
    try {
      const { password, ...rest } = userCreateInput;

      const hashedPwd = await bcrypt.hash(password, 10);

      const data = { ...rest, password: hashedPwd };

      const user = await this.prisma.user.create({ data });

      const html = renderTemplate('new-user-registered', {
        name: user.name,
        email: user.email,
        registeredAt: user.createdAt,
        provider: user.provider,
      });

      this.emailService.sendEmail({
        to: 'myftarierand@gmail.com',
        subject: `New user registered`,
        html,
      });

      return user;
    } catch (error: any) {
      throw new HttpException(
        {
          status: HttpStatus.NOT_FOUND,
          message: `Not Found: ${error.message}`,
        },
        HttpStatus.NOT_FOUND,
      );
    }
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
