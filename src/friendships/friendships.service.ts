import { Injectable } from '@nestjs/common';

import { Friendships } from '@prisma/client';

import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class FriendshipsService {
  constructor(private prisma: DatabaseService) {}

  async findFriends(userId: string) {
    return this.prisma.friendships.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      include: {
        sender: {
          include: { groups: { where: { members: { some: { id: userId } } } } },
        },
        receiver: {
          include: { groups: { where: { members: { some: { id: userId } } } } },
        },
      },
    });
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
    return this.prisma.friendships.create({
      data: {
        senderId: userId,
        receiverId: receiverId,
      },
    });
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
