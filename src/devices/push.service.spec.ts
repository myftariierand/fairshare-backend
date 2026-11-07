import { Logger } from '@nestjs/common';
import { Expo } from 'expo-server-sdk';

import { PushService } from './push.service';

// The real package is ESM only, which Jest can't load
jest.mock('expo-server-sdk', () => ({
  Expo: class {
    static isExpoPushToken(): boolean {
      return true;
    }
    chunkPushNotifications(messages: unknown[]) {
      return messages.length ? [messages] : [];
    }
    sendPushNotificationsAsync() {
      return Promise.resolve([]);
    }
  },
}));

const TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const OTHER_TOKEN = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
const message = { title: 'Title', body: 'Body' };

describe('PushService', () => {
  const prisma = {
    deviceToken: { findMany: jest.fn(), deleteMany: jest.fn() },
  };

  let service: PushService;
  let send: jest.SpyInstance;
  let chunk: jest.SpyInstance;
  let logError: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.deviceToken.findMany.mockResolvedValue([{ token: TOKEN }]);
    send = jest
      .spyOn(Expo.prototype, 'sendPushNotificationsAsync')
      .mockResolvedValue([{ status: 'ok', id: '1' }]);
    chunk = jest.spyOn(Expo.prototype, 'chunkPushNotifications');
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    service = new PushService(prisma as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends to the devices of the given users', async () => {
    await service.sendToUsers(['user-1'], message);

    expect(send).toHaveBeenCalledWith([
      expect.objectContaining({ to: TOKEN, title: 'Title', sound: 'default' }),
    ]);
  });

  it('puts everything under data for data-only pushes', async () => {
    await service.sendDataOnlyToUsers(['user-1'], {
      ...message,
      categoryId: 'group_invite',
    });

    const [sent] = send.mock.calls[0][0];
    expect(sent.title).toBeUndefined();
    expect(sent.data).toMatchObject({
      title: 'Title',
      categoryId: 'group_invite',
    });
  });

  it('sends nothing when there are no users', async () => {
    await service.sendToUsers([], message);

    expect(prisma.deviceToken.findMany).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([['sendToUsers' as const], ['sendDataOnlyToUsers' as const]])(
    '%s does not reject when Expo fails',
    async (method) => {
      send.mockRejectedValue(new Error('Expo is down'));

      await expect(
        service[method](['user-1'], message),
      ).resolves.toBeUndefined();
      expect(logError).toHaveBeenCalled();
    },
  );

  it('does not reject when the database fails', async () => {
    prisma.deviceToken.findMany.mockRejectedValue(new Error('db down'));

    await expect(
      service.sendToUsers(['user-1'], message),
    ).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalled();
  });

  it('does not reject when removing dead tokens fails', async () => {
    send.mockResolvedValue([
      {
        status: 'error',
        message: 'gone',
        details: { error: 'DeviceNotRegistered' },
      },
    ]);
    prisma.deviceToken.deleteMany.mockRejectedValue(new Error('db down'));

    await expect(
      service.sendToUsers(['user-1'], message),
    ).resolves.toBeUndefined();
  });

  it('still sends the other chunks when one fails', async () => {
    prisma.deviceToken.findMany.mockResolvedValue([
      { token: TOKEN },
      { token: OTHER_TOKEN },
    ]);
    chunk.mockImplementation((messages) => messages.map((m: unknown) => [m]));
    send.mockRejectedValueOnce(new Error('Expo is down'));

    await service.sendToUsers(['user-1'], message);

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('removes only tokens for uninstalled apps', async () => {
    prisma.deviceToken.findMany.mockResolvedValue([
      { token: TOKEN },
      { token: OTHER_TOKEN },
    ]);
    send.mockResolvedValue([
      {
        status: 'error',
        message: 'gone',
        details: { error: 'DeviceNotRegistered' },
      },
      { status: 'ok', id: '2' },
    ]);

    await service.sendToUsers(['user-1'], message);

    expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({
      where: { token: { in: [TOKEN] } },
    });
  });
});
