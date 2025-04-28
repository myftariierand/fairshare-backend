import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
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

  calculateBalances(
    transactions: Prisma.TransactionGetPayload<{
      include: {
        splits: {
          include: { user: { select: { id: true; name: true } } };
        };
        paidBy: { select: { id: true; name: true } };
      };
    }>[],
  ) {
    const balances: Record<string, { user: any; balance: number }> = {};

    transactions.forEach((transaction) => {
      const { paidBy, amount, splits } = transaction;

      // Ensure payer is initialized
      if (!balances[paidBy.id])
        balances[paidBy.id] = { user: paidBy, balance: 0 };

      // The payer gets a positive balance (paid money)
      balances[paidBy.id].balance += amount;

      // Distribute the debt to all users in the splits
      splits.forEach(({ user, amount }: any) => {
        if (!balances[user.id]) balances[user.id] = { user, balance: 0 };

        // The split users owe money, so subtract their amount
        balances[user.id].balance -= amount;
      });
    });

    return balances;
  }

  settleDebts(balances: Record<string, { user: any; balance: number }>) {
    const creditors: { user: any; amount: number }[] = [];
    const debtors: { user: any; amount: number }[] = [];

    Object.values(balances).forEach(({ user, balance }) => {
      if (balance > 0) {
        creditors.push({ user, amount: balance });
      } else if (balance < 0) {
        debtors.push({ user, amount: -balance }); // Convert to positive for easier calculations
      }
    });

    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);

    const transactions: { from: any; to: any; amount: number }[] = [];

    while (debtors.length > 0 && creditors.length > 0) {
      const debtor = debtors[0];
      const creditor = creditors[0];

      const settledAmount = Math.min(debtor.amount, creditor.amount);
      transactions.push({
        from: debtor.user,
        to: creditor.user,
        amount: settledAmount,
      });

      debtor.amount -= settledAmount;
      creditor.amount -= settledAmount;

      if (debtor.amount === 0) debtors.shift();
      if (creditor.amount === 0) creditors.shift();
    }

    return transactions;
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
        const balances = this.calculateBalances(response.transactions);
        const settlements = this.settleDebts(balances);

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

      const membersIds = group.members
        .filter((member) => member.userId !== userId)
        .map(({ userId }) => userId);

      const member = group.members.find((member) => member.userId === userId);

      this.sse.emit(
        membersIds,
        SseEventType.GROUP_JOINED,
        `${member?.user.name} joined ${group.name}`,
      );

      return { success: true };
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

      const activeTransactions = await this.prisma.transaction.findMany({
        where: {
          groupId,
          OR: [
            { paidById: memberId },
            { splits: { some: { userId: memberId } } },
          ],
        },
      });

      if (activeTransactions.length > 0) {
        throw new ForbiddenException(
          'The member cannot be removed as they are part of active transactions.',
        );
      }

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

      return { success: true };
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
}
