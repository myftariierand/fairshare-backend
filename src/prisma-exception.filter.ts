import {
  ArgumentsHost,
  Catch,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';

// What's left after a service handles the cases it has something specific to say about. The
// messages are fixed because Prisma's own mention table and column names. Any other code is a real
// failure, which the base filter logs and answers with a plain 500.
const toHttpException = (
  error: Prisma.PrismaClientKnownRequestError,
): HttpException | undefined => {
  switch (error.code) {
    case 'P2025':
      return new NotFoundException('Not found or no longer available');
    case 'P2002':
      return new ConflictException('This already exists');
    case 'P2003':
      return new ConflictException(
        "This can't be done because it's linked to other data",
      );
  }
};

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter extends BaseExceptionFilter {
  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    super.catch(toHttpException(error) ?? error, host);
  }
}
