import { Injectable } from '@nestjs/common';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

import { DatabaseService } from 'src/database/database.service';

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  categoryId?: string; // e.g. 'group_invite' to show action buttons
};

@Injectable()
export class PushService {
  private expo = new Expo();
  constructor(private prisma: DatabaseService) {}

  async sendToUsers(userIds: string[], msg: PushPayload) {
    const tokens = await this.getTokens(userIds);

    await this.send(
      tokens.map((to) => ({
        to,
        sound: 'default',
        channelId: 'default',
        priority: 'high',
        ...msg,
      })),
    );
  }

  /**
   * Data-only push: no OS-rendered notification. The app's background task
   * receives it and decides what to display (e.g. via scheduleNotificationAsync).
   */
  async sendDataOnlyToUsers(userIds: string[], msg: PushPayload) {
    const tokens = await this.getTokens(userIds);

    const { title, body, categoryId, data } = msg;

    await this.send(
      tokens.map((to) => ({
        to,
        priority: 'high', // Android: deliver promptly
        // Everything goes under `data` so the background task can read it
        data: { title, body, categoryId, ...data },
      })),
    );
  }

  private async getTokens(userIds: string[]): Promise<string[]> {
    if (!userIds.length) return [];

    const devices = await this.prisma.deviceToken.findMany({
      where: { userId: { in: userIds } },
    });

    return devices.map((d) => d.token).filter((t) => Expo.isExpoPushToken(t));
  }

  private async send(messages: ExpoPushMessage[]) {
    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      const tickets = await this.expo.sendPushNotificationsAsync(chunk);
      // Clean up tokens for uninstalled apps
      const dead = tickets
        .map((t, i) =>
          t.status === 'error' && t.details?.error === 'DeviceNotRegistered'
            ? (chunk[i].to as string)
            : null,
        )
        .filter((t): t is string => t !== null);

      if (dead.length) {
        await this.prisma.deviceToken.deleteMany({
          where: { token: { in: dead } },
        });
      }
    }
  }
}
