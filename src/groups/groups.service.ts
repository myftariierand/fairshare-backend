import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { SseService } from 'src/sse/sse.service';
import { DatabaseService } from 'src/database/database.service';

import { SseEventType } from 'src/types/sse';

@Injectable()
export class GroupsService {
  constructor(
    private sse: SseService,
    private prisma: DatabaseService,
  ) {}

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
    const response = await this.prisma.group.findUnique({
      where: {
        id: groupId,
        members: { some: { userId } },
      },
      include: {
        members: {
          include: { user: true },
        },
        createdBy: true,
      },
    });

    const transformedResponse = {
      ...response,
      members: response?.members.map(
        ({ joinedAt, user: { id, email, name } }) => ({
          id,
          joinedAt,
          email,
          name,
        }),
      ),
    };

    return transformedResponse;
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
      const response = await this.prisma.group.update({
        where: {
          id: groupId,
          AND: [{ members: { some: { userId } } }],
        },
        data: updateGroupDto,
        include: { members: { include: { user: true } } },
      });

      const memebersIds = response.members
        .map(({ userId }) => userId)
        .filter((id) => id !== userId);
      const user = response.members.find((member) => member.userId === userId);

      this.sse.emit(
        memebersIds,
        SseEventType.GROUP_UDPATED,
        `${user?.user.name} updated group "${response.name}"`,
      );

      return response;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException(error.meta?.cause);
        }
      }
    }
  }

  async delete(userId: string, groupId: string) {
    try {
      const response = await this.prisma.group.delete({
        where: {
          id: groupId,
          AND: [{ createdById: userId }],
        },
        include: { createdBy: true, members: { where: { NOT: { userId } } } },
      });

      const membersIds = response.members.map((member) => member.userId);

      this.sse.emit(
        membersIds,
        SseEventType.GROUP_DELETED,
        `${response.createdBy.name} deleted "${response.name}" grup`,
      );

      return response;
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
      const response = await this.prisma.groupInvitation.create({
        data: {
          groupId: groupId,
          senderId: userId,
          receiverId: receiverId,
        },
        include: {
          group: true,
          sender: true,
        },
      });

      this.sse.emit(
        [receiverId],
        SseEventType.GROUP_INVITE_RECEIVED,
        `${response.sender.name} invites you to join ${response.group.name}`,
      );

      return response;
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
      const group = await this.prisma.group.update({
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
        include: {
          members: true,
        },
      });

      const invitation = await this.prisma.groupInvitation.update({
        where: {
          id: invitationId,
        },
        data: {
          status: 'ACCEPTED',
        },
        include: { receiver: true },
      });

      const membersIds = group.members
        .filter(
          (member) =>
            member.userId !== invitation.senderId &&
            member.userId !== invitation.receiverId,
        )
        .map(({ userId }) => userId);

      this.sse.emit(
        [invitation.senderId],
        SseEventType.GROUP_INVITE_ACCEPTED,
        `${invitation.receiver.name} accepted invitation to ${group.name}`,
      );

      this.sse.emit(
        membersIds,
        SseEventType.GROUP_JOINED,
        `${invitation.receiver.name} joined ${group.name}`,
      );

      return { success: true };
    } catch (error) {
      console.log(error);
    }
  }

  async rejectInvitation(invitationId: string) {
    try {
      const invite = await this.prisma.groupInvitation.delete({
        where: {
          id: invitationId,
          status: 'PENDING',
        },
        include: { receiver: true, group: true },
      });

      this.sse.emit(
        [invite.senderId],
        SseEventType.GROUP_INVITE_ACCEPTED,
        `${invite.receiver.name} rejected invitation to ${invite.group.name}`,
      );

      return invite;
    } catch (error) {
      console.log(error);
    }
  }
}
