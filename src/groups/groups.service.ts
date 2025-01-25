import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

import { DatabaseService } from 'src/database/database.service';

import { Prisma } from '@prisma/client';

@Injectable()
export class GroupsService {
  constructor(private prisma: DatabaseService) {}

  async findMany(userId: string) {
    return await this.prisma.group.findMany({
      where: {
        members: {
          some: {
            userId,
          },
        },
      },
      include: {
        _count: {
          select: { members: true },
        },
      },
    });
  }

  async findGroupById(userId: string, groupId: string) {
    return await this.prisma.group.findUnique({
      where: {
        id: groupId,
        members: { some: { userId } },
      },
      include: {
        members: {
          include: { user: true },
        },
        createdBy: true,
        transactions: {
          include: {
            createdBy: true,
          },
        },
      },
    });
  }

  async create(
    userId: string,
    groupCreateInput: Prisma.GroupCreateWithoutCreatedByInput,
  ) {
    await this.prisma.group.create({
      data: {
        ...groupCreateInput,
        createdBy: {
          connect: {
            id: userId,
          },
        },
        members: {
          connectOrCreate: {
            where: {
              id: userId,
            },
            create: {
              user: {
                connect: {
                  id: userId,
                },
              },
            },
          },
        },
      },
    });
  }

  async update(
    userId: string,
    groupId: string,
    updateGroupDto: Prisma.GroupUpdateInput,
  ) {
    try {
      return await this.prisma.group.update({
        where: {
          id: groupId,
          AND: [{ createdById: userId }],
        },
        data: updateGroupDto,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new HttpException(
            {
              status: HttpStatus.NOT_FOUND,
              error: error.meta?.cause,
            },
            HttpStatus.NOT_FOUND,
          );
        }
      }
    }
  }

  async delete(userId: string, groupId: string) {
    try {
      await this.prisma.group.delete({
        where: {
          id: groupId,
          AND: [{ createdById: userId }],
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new HttpException(
          {
            status: HttpStatus.NOT_FOUND,
            error: error.meta?.cause,
          },
          HttpStatus.NOT_FOUND,
        );
      }
    }
  }

  async findInvites(where: Prisma.GroupInvitationWhereInput) {
    try {
      return await this.prisma.groupInvitation.findMany({
        where: where,
        include: {
          group: true,
          sender: true,
        },
      });
    } catch (error) {
      console.log(error);
    }
  }

  async invite(userId: string, groupId: string, receiverId: string) {
    try {
      return await this.prisma.groupInvitation.create({
        data: {
          groupId: groupId,
          senderId: userId,
          receiverId: receiverId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ForbiddenException('Invitation already sent!');
        }
      }
    }
  }

  async acceptInvitation(
    userId: string,
    groupId: string,
    invitationId: string,
  ) {
    try {
      await this.prisma.group.update({
        where: {
          id: groupId,
        },
        data: {
          members: {
            connectOrCreate: {
              where: {
                id: userId,
              },
              create: {
                user: {
                  connect: {
                    id: userId,
                  },
                },
              },
            },
          },
        },
      });
      await this.prisma.groupInvitation.update({
        where: {
          id: invitationId,
        },
        data: {
          status: 'ACCEPTED',
        },
      });
      return { success: true };
    } catch (error) {
      console.log(error);
    }
  }

  async rejectInvitation(invitationId: string) {
    try {
      return await this.prisma.groupInvitation.delete({
        where: {
          id: invitationId,
          status: 'PENDING',
        },
      });
    } catch (error) {
      console.log(error);
    }
  }
}
