import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Group, Prisma, TransactionType } from '@prisma/client';

import { SseService } from 'src/sse/sse.service';
import { DatabaseService } from 'src/database/database.service';
import { ActivityLogsService } from 'src/activity-logs/activity.service';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';

import { SseEventType } from 'src/types/sse';

type Balance = {
  from: {
    id: string;
    name: string;
  };
  to: {
    id: string;
    name: string;
  };
  amount: number;
};

type User = { id: string; name: string };

type Transaction = Prisma.TransactionGetPayload<{
  include: {
    splits: { include: { user: { select: { id: true; name: true } } } };
    paidBy: { select: { id: true; name: true } };
  };
}>;

@Injectable()
export class GroupsService {
  constructor(
    private sse: SseService,
    private prisma: DatabaseService,
    private activityLogsService: ActivityLogsService,
    private cloudinaryService: CloudinaryService,
  ) {}

  // ------------------------
  // 1. Calculate raw balances
  // ------------------------
  calculateGroupBalances(
    transactions: Transaction[],
    users: User[],
  ): Balance[] {
    const balances: Record<string, Record<string, number>> = {};
    const userMap: Record<string, User> = {};

    for (const user of users) userMap[user.id] = user;

    const addBalance = (from: string, to: string, amount: number) => {
      if (!balances[from]) balances[from] = {};
      if (!balances[to]) balances[to] = {};
      balances[from][to] = (balances[from][to] || 0) + amount;
    };

    for (const transaction of transactions) {
      if (transaction.type === TransactionType.EXPENSE) {
        for (const split of transaction.splits) {
          if (split.userId !== transaction.paidById) {
            addBalance(
              split.userId,
              transaction.paidById,
              split.amount.toNumber(),
            );
          }
        }
      }
    }

    // Convert to array without netting
    const result: Balance[] = [];
    for (const from in balances) {
      for (const to in balances[from]) {
        const amount = balances[from][to];
        if (amount !== 0) {
          result.push({
            from: userMap[from],
            to: userMap[to],
            amount,
          });
        }
      }
    }

    return result;
  }

  // ------------------------
  // 2. Simplify balances
  // ------------------------
  simplifyBalances(
    balances: Balance[],
    transactions: Transaction[],
  ): Balance[] {
    const net: Record<string, { name: string; balance: number }> = {};

    for (const b of balances) {
      if (!net[b.from.id]) net[b.from.id] = { name: b.from.name, balance: 0 };
      if (!net[b.to.id]) net[b.to.id] = { name: b.to.name, balance: 0 };

      net[b.from.id].balance -= b.amount;
      net[b.to.id].balance += b.amount;
    }

    const debtors: { id: string; name: string; balance: number }[] = [];
    const creditors: { id: string; name: string; balance: number }[] = [];

    for (const [id, { name, balance }] of Object.entries(net)) {
      if (balance < 0) debtors.push({ id, name, balance });
      else if (balance > 0) creditors.push({ id, name, balance });
    }

    let simplified: Balance[] = [];
    let i = 0,
      j = 0;

    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];
      const settleAmount = Math.min(-debtor.balance, creditor.balance);

      simplified.push({
        from: { id: debtor.id, name: debtor.name },
        to: { id: creditor.id, name: creditor.name },
        amount: settleAmount,
      });

      debtor.balance += settleAmount;
      creditor.balance -= settleAmount;

      if (debtor.balance === 0) i++;
      if (creditor.balance === 0) j++;
    }

    for (const tx of transactions) {
      if (tx.type === TransactionType.SETTLEMENT) {
        if (tx.splits.length !== 1)
          throw new Error('Settlement must have 1 split');

        const payer = tx.paidById;
        const receiver = tx.splits[0].userId;
        const amount = tx.amount.toNumber();

        let balance = simplified.find(
          (b) => b.from.id === payer && b.to.id === receiver,
        );

        if (balance) {
          balance.amount = Math.max(0, balance.amount - amount);
          continue;
        }

        balance = simplified.find(
          (b) => b.from.id === receiver && b.to.id === payer,
        );

        if (balance) {
          balance.amount = Math.max(0, balance.amount - amount);
          continue;
        }
      }
    }

    simplified = simplified.filter((b) => b.amount > 0);

    return simplified;
  }

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
        const balances = this.calculateGroupBalances(
          response.transactions,
          response.members.map((member) => member.user),
        );
        const settlements = this.simplifyBalances(
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
