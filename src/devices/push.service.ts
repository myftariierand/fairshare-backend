import { Injectable } from '@nestjs/common';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class PushService {
  private expo = new Expo();
  constructor(private prisma: DatabaseService) {}

  async sendToUsers(
    userIds: string[],
    msg: { title: string; body: string; data?: Record<string, unknown> },
  ) {
    if (!userIds.length) return;

    const devices = await this.prisma.deviceToken.findMany({
      where: { userId: { in: userIds } },
    });

    const messages: (ExpoPushMessage & { _token: string })[] = devices
      .filter((d) => Expo.isExpoPushToken(d.token))
      .map((d) => ({
        to: d.token,
        _token: d.token,
        sound: 'default',
        channelId: 'default',
        ...msg,
      }));

    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      const tickets = await this.expo.sendPushNotificationsAsync(chunk);

      // Clean up tokens for uninstalled apps
      const dead = tickets
        .map((t, i) =>
          t.status === 'error' && t.details?.error === 'DeviceNotRegistered'
            ? (chunk[i] as any).to
            : null,
        )
        .filter(Boolean);

      if (dead.length) {
        await this.prisma.deviceToken.deleteMany({
          where: { token: { in: dead } },
        });
      }
    }
  }
}
