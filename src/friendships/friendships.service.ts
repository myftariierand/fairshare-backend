import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { Friendships } from '@prisma/client';

import { SseService } from 'src/sse/sse.service';
import { DatabaseService } from 'src/database/database.service';
import { ActivityLogsService } from 'src/activity-logs/activity.service';

import { SseEventType } from 'src/types/sse';

@Injectable()
export class FriendshipsService {
  constructor(
    private sse: SseService,
    private prisma: DatabaseService,
    private activityLogsService: ActivityLogsService,
  ) {}

  async findFriends(userId: string) {
    try {
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
    } catch (error) {
      console.log(error);
    }
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
    try {
      const response = await this.prisma.friendships.create({
        data: {
          senderId: userId,
          receiverId: receiverId,
        },
        include: {
          sender: true,
        },
      });

      this.activityLogsService.createActivityLog({
        action: 'FRIENDSHIP_REQUEST_SENT',
        user: { connect: { id: userId } },
        targetUser: { connect: { id: receiverId } },
        friendship: { connect: { id: response.id } },
      });

      this.sse.emit(
        [receiverId],
        SseEventType.FRIEND_REQUEST_RECEIVED,
        `${response.sender.name} sent you a friend request`,
      );

      return response;
    } catch (error) {
      console.log(error);
    }
  }

  async acceptRequest(userId: string, id: string) {
    try {
      const response = await this.prisma.friendships.update({
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

      this.activityLogsService.createActivityLog({
        action: 'FRIENDSHIP_REQUEST_ACCEPTED',
        user: { connect: { id: userId } },
        friendship: { connect: { id: response.id } },
      });

      this.sse.emit(
        [response.senderId],
        SseEventType.FRIEND_REQUEST_ACCEPTED,
        `${response.receiver.name} accepted your friend request`,
      );

      return response;
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException();
    }
  }

  async rejectRequest(userId: string, id: string) {
    try {
      const response = await this.prisma.friendships.delete({
        where: {
          id,
          receiverId: userId,
          status: 'PENDING',
        },
        include: {
          receiver: true,
        },
      });

      this.activityLogsService.createActivityLog({
        action: 'FRIENDSHIP_REQUEST_REJECTED',
        user: { connect: { id: userId } },
        friendship: { connect: { id: response.id } },
      });

      this.sse.emit(
        [response.senderId],
        SseEventType.FRIEND_REQUEST_REJECTED,
        `${response.receiver.name} rejected your friend request`,
      );

      return response;
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException();
    }
  }

  async cancelRequest(userId: string, id: string) {
    const res = await this.prisma.friendships.delete({
      where: {
        id,
        senderId: userId,
        status: 'PENDING',
      },
    });

    this.activityLogsService.createActivityLog({
      action: 'FRIENDSHIP_REQUEST_CANCELLED',
      user: { connect: { id: userId } },
      friendship: { connect: { id: res.id } },
    });

    return res;
  }

  async unfriend(userId: string, id: string) {
    try {
      const response = await this.prisma.friendships.delete({
        where: {
          id,
          status: 'ACCEPTED',
          OR: [{ senderId: userId }, { receiverId: userId }],
        },
      });

      const eventReceiver =
        response.senderId === userId ? response.receiverId : response.senderId;

      this.activityLogsService.createActivityLog({
        action: 'FRIENDSHIP_REMOVED',
        user: { connect: { id: eventReceiver } },
      });

      this.sse.emit([eventReceiver], SseEventType.FRIEND_REMOVED, '');

      return response;
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException();
    }
  }
}
