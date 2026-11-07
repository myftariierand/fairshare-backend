import { ConflictException, NotFoundException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { PrismaExceptionFilter } from './prisma-exception.filter';

describe('PrismaExceptionFilter', () => {
  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('table "User" column "secret"', {
      code,
      clientVersion: 'test',
    });

  const handled = (code: string) => {
    const base = jest
      .spyOn(BaseExceptionFilter.prototype, 'catch')
      .mockImplementation();

    new PrismaExceptionFilter().catch(prismaError(code), {} as any);

    const [exception] = base.mock.calls[0];
    base.mockRestore();

    return exception as any;
  };

  it.each([
    ['P2025', NotFoundException],
    ['P2002', ConflictException],
    ['P2003', ConflictException],
  ])('maps %s without repeating what Prisma said', (code, type) => {
    const exception = handled(code);

    expect(exception).toBeInstanceOf(type);
    expect(exception.message).not.toContain('secret');
  });

  it('leaves anything else as a real failure', () => {
    expect(handled('P2024')).toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });
});
