import { Injectable } from '@nestjs/common';

import { Friendships } from '@prisma/client';

import { SseService } from 'src/sse/sse.service';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class FriendshipsService {
  constructor(
    private prisma: DatabaseService,
    private sseService: SseService,
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

      this.sseService.emit(
        receiverId,
        'new_friend_request',
        `${response.sender.name} sent you a friend request`,
      );

      return response;
    } catch (error) {
      console.log(error);
    }
  }

  async acceptRequest(userId: string, id: string) {
    return this.prisma.friendships.update({
      where: {
        id,
        receiverId: userId,
        status: 'PENDING',
      },
      data: {
        status: 'ACCEPTED',
      },
    });
  }

  async rejectRequest(userId: string, id: string) {
    return this.prisma.friendships.delete({
      where: {
        id,
        receiverId: userId,
        status: 'PENDING',
      },
    });
  }

  async cancelRequest(userId: string, id: string) {
    return this.prisma.friendships.delete({
      where: {
        id,
        senderId: userId,
        status: 'PENDING',
      },
    });
  }

  async unfriend(userId: string, id: string) {
    return this.prisma.friendships.delete({
      where: {
        id,
        status: 'ACCEPTED',
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
    });
  }
}
