import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Friendships, Prisma } from '@prisma/client';

import { SseService } from 'src/sse/sse.service';
import { DatabaseService } from 'src/database/database.service';
import { ActivityLogsService } from 'src/activity-logs/activity.service';
import { PushService } from 'src/devices/push.service';

import { SseEventType } from 'src/types/sse';

@Injectable()
export class FriendshipsService {
  constructor(
    private sse: SseService,
    private prisma: DatabaseService,
    private activityLogsService: ActivityLogsService,
    private push: PushService,
  ) {}

  async findFriends(userId: string) {
    const response = await this.prisma.friendships.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      include: {
        sender: {
          include: {
            invitationReceiver: {
              where: {
                senderId: userId,
              },
              include: {
                group: true,
              },
            },
          },
        },
        receiver: {
          include: {
            invitationReceiver: {
              where: {
                senderId: userId,
              },
              include: {
                group: true,
              },
            },
          },
        },
      },
    });

    const transformedResponse = response.map((friendship) => {
      const friend =
        friendship.senderId === userId
          ? friendship.receiver
          : friendship.sender;

      return {
        id: friend.id,
        name: friend.name,
        email: friend.email,
        requestId: friendship.id,
        createdAt: friend.createdAt,
        updatedAt: friend.updatedAt,
        invitations: friend.invitationReceiver.map((invitation) => ({
          groupId: invitation.groupId,
          groupName: invitation.group.name,
          status: invitation.status,
        })),
      };
    });

    return transformedResponse;
  }

  async findRequests(userId: string): Promise<Friendships[]> {
    return this.prisma.friendships.findMany({
      where: {
        AND: [
          { OR: [{ receiverId: userId }, { senderId: userId }] },
          { status: 'PENDING' },
        ],
      },
      include: {
        receiver: true,
        sender: true,
      },
    });
  }

  async sendRequest(userId: string, receiverId: string) {
    if (userId === receiverId) {
      throw new BadRequestException(
        "You can't send a friend request to yourself",
      );
    }

    const reverse = await this.prisma.friendships.findUnique({
      where: {
        senderId_receiverId: { senderId: receiverId, receiverId: userId },
      },
    });

    // They already asked, so both want this. Already being friends is like sending it twice.
    if (reverse?.status === 'PENDING') {
      return this.acceptRequest(userId, reverse.id);
    }
    if (reverse) return;

    try {
      const response = await this.prisma.$transaction(async (tx) => {
        const response = await tx.friendships.create({
          data: {
            senderId: userId,
            receiverId: receiverId,
          },
          include: {
            sender: true,
          },
        });

        await this.activityLogsService.createActivityLog(
          {
            action: 'FRIENDSHIP_REQUEST_SENT',
            user: { connect: { id: userId } },
            targetUser: { connect: { id: receiverId } },
          },
          tx,
        );

        return response;
      });

      this.sse.emit(
        [receiverId],
        SseEventType.FRIEND_REQUEST_RECEIVED,
        `${response.sender.name} sent you a friend request`,
      );

      this.push.sendDataOnlyToUsers([receiverId], {
        title: 'New Friend Request',
        body: `${response.sender.name} wants to be your friend`,
        categoryId: 'friend_request',
        data: {
          type: SseEventType.FRIEND_REQUEST_RECEIVED,
          requestId: response.id,
        },
      });

      return response;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new NotFoundException('User not found');
      }

      // Sending a request twice still isn't an error for the client
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }

      throw error;
    }
  }

  async acceptRequest(userId: string, id: string) {
    const response = await this.prisma.$transaction(async (tx) => {
      const response = await tx.friendships.update({
        where: {
          id,
          receiverId: userId,
          status: 'PENDING',
        },
        data: {
          status: 'ACCEPTED',
        },
        include: {
          receiver: true,
        },
      });

      await this.activityLogsService.createActivityLog(
        {
          action: 'FRIENDSHIP_REQUEST_ACCEPTED',
          user: { connect: { id: userId } },
          targetUser: { connect: { id: response.senderId } },
        },
        tx,
      );

      return response;
    });

    this.sse.emit(
      [response.senderId],
      SseEventType.FRIEND_REQUEST_ACCEPTED,
      `${response.receiver.name} accepted your friend request`,
    );

    this.push.sendToUsers([response.senderId], {
      title: 'Friend Request Accepted',
      body: `${response.receiver.name} is now your friend`,
      data: {
        type: SseEventType.FRIEND_REQUEST_ACCEPTED,
      },
    });

    return response;
  }

  async rejectRequest(userId: string, id: string) {
    const response = await this.prisma.$transaction(async (tx) => {
      const response = await tx.friendships.delete({
        where: {
          id,
          receiverId: userId,
          status: 'PENDING',
        },
        include: {
          receiver: true,
        },
      });

      await this.activityLogsService.createActivityLog(
        {
          action: 'FRIENDSHIP_REQUEST_REJECTED',
          user: { connect: { id: userId } },
          targetUser: { connect: { id: response.senderId } },
        },
        tx,
      );

      return response;
    });

    this.sse.emit(
      [response.senderId],
      SseEventType.FRIEND_REQUEST_REJECTED,
      `${response.receiver.name} rejected your friend request`,
    );

    this.push.sendToUsers([response.senderId], {
      title: 'Friend Request Rejected',
      body: `${response.receiver.name} rejected your friend request`,
    });

    return response;
  }

  async cancelRequest(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.friendships.delete({
        where: {
          id,
          senderId: userId,
          status: 'PENDING',
        },
      });

      await this.activityLogsService.createActivityLog(
        {
          action: 'FRIENDSHIP_REQUEST_CANCELLED',
          user: { connect: { id: userId } },
          targetUser: { connect: { id: res.receiverId } },
        },
        tx,
      );

      return res;
    });
  }

  async unfriend(userId: string, id: string) {
    const { response, eventReceiver } = await this.prisma.$transaction(
      async (tx) => {
        const response = await tx.friendships.delete({
          where: {
            id,
            status: 'ACCEPTED',
            OR: [{ senderId: userId }, { receiverId: userId }],
          },
        });

        const eventReceiver =
          response.senderId === userId
            ? response.receiverId
            : response.senderId;

        await this.activityLogsService.createActivityLog(
          {
            action: 'FRIENDSHIP_REMOVED',
            user: { connect: { id: userId } },
            targetUser: { connect: { id: eventReceiver } },
          },
          tx,
        );

        return { response, eventReceiver };
      },
    );

    this.sse.emit([eventReceiver], SseEventType.FRIEND_REMOVED, '');

    return response;
  }
}
