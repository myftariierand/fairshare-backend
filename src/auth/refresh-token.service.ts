import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';

import { DatabaseService } from 'src/database/database.service';

export const REFRESH_TOKEN_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

// Two browser tabs can refresh at once, and a response can get lost on a bad connection, so
// a token that was just used stays valid briefly. After that, seeing it again means someone
// else has a copy.
const REUSE_GRACE_MS = 60 * 1000;

const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

// A token starts with its session id, so even an old token whose row has been pruned can
// still end its session
const parseSessionId = (token: unknown) => {
  if (typeof token !== 'string') return null;

  const [sessionId] = token.split('.');

  return SESSION_ID.test(sessionId) ? sessionId : null;
};

@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(private prisma: DatabaseService) {}

  private newToken(sessionId: string) {
    const token = `${sessionId}.${randomBytes(48).toString('base64url')}`;

    return {
      token,
      data: {
        sessionId,
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
      },
    };
  }

  async createSession(userId: string, admin = false): Promise<string> {
    const { token, data } = this.newToken(randomUUID());

    await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({
        where: { userId, expiresAt: { lt: new Date() } },
      }),
      this.prisma.refreshToken.create({ data: { ...data, userId, admin } }),
    ]);

    return token;
  }

  // Returns null when the token can't be used. A reused token also ends its session, and that
  // has to be saved, so this returns rather than throwing inside the transaction.
  async rotate(token: unknown) {
    const sessionId = parseSessionId(token);
    if (!sessionId) return null;

    const now = Date.now();
    const cutoff = new Date(now - REUSE_GRACE_MS);

    const rotated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.refreshToken.findUnique({
        where: { tokenHash: hash(token as string) },
        include: { user: { select: { role: true } } },
      });

      const isValid =
        current &&
        current.sessionId === sessionId &&
        current.expiresAt.getTime() > now &&
        (!current.usedAt || current.usedAt > cutoff);

      if (!isValid) {
        const { count } = await tx.refreshToken.deleteMany({
          where: { sessionId },
        });

        return { revoked: count };
      }

      await tx.refreshToken.update({
        where: { id: current.id },
        data: { usedAt: current.usedAt ?? new Date(now) },
      });

      // Older tokens no longer need a row: the session id is enough to catch them
      await tx.refreshToken.deleteMany({
        where: {
          sessionId,
          id: { not: current.id },
          OR: [
            { usedAt: { lt: cutoff } },
            { usedAt: null, createdAt: { lt: cutoff } },
          ],
        },
      });

      const next = this.newToken(sessionId);

      await tx.refreshToken.create({
        data: {
          ...next.data,
          userId: current.userId,
          admin: current.admin,
        },
      });

      return {
        token: next.token,
        userId: current.userId,
        // Both are needed: the session came through admin login, and they're still an admin
        admin: current.admin && current.user.role === Role.ADMIN,
      };
    });

    if ('revoked' in rotated) {
      if (rotated.revoked) {
        this.logger.warn(
          `Ended session ${sessionId}: expired or reused refresh token`,
        );
      }

      return null;
    }

    return rotated;
  }

  async revokeSession(token: unknown) {
    const sessionId = parseSessionId(token);
    if (!sessionId) return;

    const found = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash(token as string) },
    });

    if (found?.sessionId === sessionId) {
      await this.prisma.refreshToken.deleteMany({ where: { sessionId } });
    }
  }

  // Keeps the session behind exceptToken, so changing a password doesn't log out the person
  // doing it
  async revokeAll(
    userId: string,
    exceptToken?: unknown,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const keep =
      parseSessionId(exceptToken) &&
      (await client.refreshToken.findUnique({
        where: { tokenHash: hash(exceptToken as string) },
      }));

    await client.refreshToken.deleteMany({
      where: {
        userId,
        ...(keep && keep.userId === userId
          ? { sessionId: { not: keep.sessionId } }
          : {}),
      },
    });
  }
}
