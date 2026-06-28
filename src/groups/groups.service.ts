import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma, Group } from '@prisma/client';

import { SseService } from 'src/sse/sse.service';
import { DatabaseService } from 'src/database/database.service';
import { ActivityLogsService } from 'src/activity-logs/activity.service';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';

import { SseEventType } from 'src/types/sse';

import { BalanceUtil } from 'src/helpers/balance.util';

@Injectable()
export class GroupsService {
  constructor(
    private sse: SseService,
    private prisma: DatabaseService,
    private activityLogsService: ActivityLogsService,
    private cloudinaryService: CloudinaryService,
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
          select: { members: true, transactions: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findGroupById(userId: string, groupId: string) {
    try {
      const response = await this.prisma.group.findUnique({
        where: {
          id: groupId,
          members: { some: { userId } },
        },
        include: {
          members: {
            include: { user: true },
          },
          transactions: {
            include: {
              splits: {
                include: { user: { select: { id: true, name: true } } },
              },
              paidBy: { select: { id: true, name: true } },
            },
          },
          createdBy: true,
        },
      });

      if (response) {
        const balances = BalanceUtil.calculateGroupBalances(
          response.transactions,
          response.members.map((member) => member.user),
        );
        const settlements = BalanceUtil.simplifyBalances(
          balances,
          response.transactions,
        );

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
          balances,
          settlements,
        };

        return transformedResponse;
      }
    } catch (error) {
      throw new InternalServerErrorException(error);
    }
  }

  async create(
    userId: string,
    groupCreateInput: Prisma.GroupCreateWithoutCreatedByInput,
    coverImage: Express.Multer.File,
  ) {
    if (coverImage) {
      const uploadResult = await this.cloudinaryService.uploadFile(coverImage);
      groupCreateInput.cover = uploadResult.public_id;
    }

    const group = await this.prisma.group.create({
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

    await this.activityLogsService.createActivityLog({
      action: 'GROUP_CREATED',
      snapshot: { group },
      user: { connect: { id: userId } },
      group: { connect: { id: group.id } },
    });

    return group;
  }

  async update(
    userId: string,
    groupId: string,
    updateGroupDto: Prisma.GroupUpdateInput,
    newCover: Express.Multer.File,
  ) {
    try {
      const foundGroup = await this.prisma.group.findUnique({
        where: { id: groupId, members: { some: { userId } } },
      });

      if (!foundGroup)
        throw new NotFoundException({ message: 'Group not found!' });

      if (newCover) {
        if (foundGroup.cover)
          await this.cloudinaryService.deleteFile(foundGroup.cover);

        const uploadResult = await this.cloudinaryService.uploadFile(newCover);
        updateGroupDto.cover = uploadResult.public_id;
      }

      const response = await this.prisma.group.update({
        where: {
          id: groupId,
          AND: [{ members: { some: { userId } } }],
        },
        data: updateGroupDto,
        include: { members: { include: { user: true } } },
      });

      await this.activityLogsService.createActivityLog({
        action: 'GROUP_UPDATED',
        snapshot: { group: response },
        user: { connect: { id: userId } },
        group: { connect: { id: groupId } },
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

      console.log(response);

      await this.activityLogsService.createActivityLog({
        action: 'GROUP_DELETED',
        snapshot: { group: response },
        user: { connect: { id: userId } },
      });

      const membersIds = response.members.map((member) => member.userId);

      this.sse.emit(
        membersIds,
        SseEventType.GROUP_DELETED,
        `${response.createdBy.name} deleted "${response.name}" grup`,
      );

      return response;
    } catch (error) {
      console.log(error);

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

      await this.activityLogsService.createActivityLog({
        action: 'GROUP_INVITATION_SENT',
        snapshot: { group: response.group },
        user: { connect: { id: userId } },
        group: { connect: { id: groupId } },
        targetUser: { connect: { id: receiverId } },
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

      await this.activityLogsService.createActivityLog({
        action: 'GROUP_INVITATION_ACCEPTED',
        snapshot: { group },
        user: { connect: { id: invitation.receiverId } },
        group: { connect: { id: groupId } },
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

      return group;
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

      await this.activityLogsService.createActivityLog({
        action: 'GROUP_INVITATION_REJECTED',
        snapshot: { group: invite.group },
        user: { connect: { id: invite.receiverId } },
        group: { connect: { id: invite.groupId } },
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

  async joinGroup(userId: string, groupId: string) {
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
          members: { include: { user: true } },
        },
      });

      await this.activityLogsService.createActivityLog({
        action: 'GROUP_MEMBER_JOINED',
        snapshot: { group },
        user: { connect: { id: userId } },
        group: { connect: { id: groupId } },
      });

      const membersIds = group.members
        .filter((member) => member.userId !== userId)
        .map(({ userId }) => userId);

      const member = group.members.find((member) => member.userId === userId);

      this.sse.emit(
        membersIds,
        SseEventType.GROUP_JOINED,
        `${member?.user.name} joined ${group.name}`,
      );

      return group;
    } catch (error) {
      console.log(error);
    }
  }

  async removeMember(userId: string, groupId: string, memberId: string) {
    try {
      const group = await this.prisma.group.findUnique({
        where: { id: groupId },
        select: { createdById: true },
      });

      if (!group || group.createdById !== userId) {
        throw new ForbiddenException('You are not the owner of this group.');
      }

      // const transactions = await this.prisma.transaction.findMany({
      //   where: {
      //     groupId,
      //     OR: [
      //       { paidById: memberId },
      //       { splits: { some: { userId: memberId } } },
      //     ],
      //   },
      //   include: {
      //     splits: {
      //       include: { user: { select: { id: true, name: true } } },
      //     },
      //     paidBy: { select: { id: true, name: true } },
      //   },
      // });

      // const balances = this.calculateBalances(transactions);

      // if (balances.memberId && balances[memberId].balance.toNumber() !== 0) {
      //   throw new ForbiddenException(
      //     'This member cannot be removed until all balances are settled.',
      //   );
      // }

      const member = await this.prisma.groupMember.findUnique({
        where: {
          groupId_userId: {
            userId: memberId,
            groupId,
          },
        },
        include: { user: true },
      });

      if (!member) {
        throw new NotFoundException('Member not found in the group.');
      }

      const updatedGroup = await this.prisma.group.update({
        where: { id: groupId },
        data: {
          members: {
            delete: {
              groupId_userId: {
                userId: memberId,
                groupId,
              },
            },
          },
        },
        include: { members: { include: { user: true } } },
      });

      await this.prisma.groupInvitation.deleteMany({
        where: {
          receiverId: memberId,
          groupId: groupId,
        },
      });

      await this.activityLogsService.createActivityLog({
        action: 'GROUP_MEMBER_REMOVED',
        snapshot: { group: updatedGroup },
        user: { connect: { id: userId } },
        group: { connect: { id: groupId } },
        targetUser: { connect: { id: memberId } },
      });

      const membersIds = updatedGroup.members
        .filter((member) => member.userId !== memberId)
        .map(({ userId }) => userId);

      this.sse.emit(
        [memberId],
        SseEventType.GROUP_MEMBER_REMOVED,
        `You have been removed from ${updatedGroup.name}`,
      );

      this.sse.emit(
        membersIds,
        SseEventType.GROUP_MEMBER_REMOVED,
        `${member.user.name} removed from ${updatedGroup.name}`,
      );

      return updatedGroup;
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  async leaveGroup(userId: string, groupId: string): Promise<Group> {
    // const transactions = await this.prisma.transaction.findMany({
    //   where: {
    //     groupId,
    //     OR: [{ paidById: userId }, { splits: { some: { userId: userId } } }],
    //   },
    //   include: {
    //     splits: {
    //       include: { user: { select: { id: true, name: true } } },
    //     },
    //     paidBy: { select: { id: true, name: true } },
    //   },
    // });

    // const balances = this.calculateBalances(transactions);

    // if (balances.memberId && balances[userId].balance.toNumber() !== 0) {
    //   throw new ForbiddenException(
    //     'You cannot leave this group until all balances are settled.',
    //   );
    // }

    const member = await this.prisma.groupMember.delete({
      where: { groupId_userId: { groupId, userId } },
      include: { group: true },
    });

    await this.prisma.groupInvitation.deleteMany({
      where: {
        receiverId: userId,
        groupId: groupId,
      },
    });

    await this.activityLogsService.createActivityLog({
      action: 'GROUP_MEMBER_LEFT',
      snapshot: { group: member.group },
      user: { connect: { id: userId } },
      group: { connect: { id: groupId } },
    });

    return member.group;
  }
}
