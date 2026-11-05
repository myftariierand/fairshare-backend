import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(PushService.name);
  private expo = new Expo();
  constructor(private prisma: DatabaseService) {}

  async sendToUsers(userIds: string[], msg: PushPayload) {
    await this.deliver(userIds, (to) => ({
      to,
      sound: 'default',
      channelId: 'default',
      priority: 'high',
      ...msg,
    }));
  }

  /**
   * Data-only push: no OS-rendered notification. The app's background task
   * receives it and decides what to display (e.g. via scheduleNotificationAsync).
   */
  async sendDataOnlyToUsers(userIds: string[], msg: PushPayload) {
    const { title, body, categoryId, data } = msg;

    await this.deliver(userIds, (to) => ({
      to,
      priority: 'high', // Android: deliver promptly
      // Everything goes under `data` so the background task can read it
      data: { title, body, categoryId, ...data },
    }));
  }

  // Callers don't wait for pushes and have already saved their change, so this never rejects:
  // a notification that can't be sent is logged, not an error for the request or the process.
  private async deliver(
    userIds: string[],
    toMessage: (token: string) => ExpoPushMessage,
  ) {
    try {
      const tokens = await this.getTokens(userIds);

      await this.send(tokens.map(toMessage));
    } catch (error) {
      this.logger.error('Failed to send push notifications', error);
    }
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
      try {
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
      } catch (error) {
        // One failed chunk shouldn't stop the others
        this.logger.error('Failed to send a push notification chunk', error);
      }
    }
  }
}
