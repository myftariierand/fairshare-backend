import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { DatabaseService } from 'src/database/database.service';

import { Prisma, User } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: DatabaseService) {}

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
      },
    });

    return res;
  }

  async create(userCreateInput: Prisma.UserCreateInput): Promise<User> {
    try {
      const { password, ...rest } = userCreateInput;

      const hashedPwd = await bcrypt.hash(password, 10);

      const data = { ...rest, password: hashedPwd };

      return this.prisma.user.create({ data });
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
