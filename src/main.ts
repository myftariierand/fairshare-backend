import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';

import { AppModule } from 'src/app.module';

import { Prisma } from '@prisma/client';

const logger = new Logger('Process');

// Node exits on an unhandled rejection by default. One failed background task shouldn't
// take the API down for everyone, so it gets logged as a bug to fix instead.
process.on('unhandledRejection', (reason) => {
  logger.error(
    'Unhandled promise rejection',
    reason instanceof Error ? reason.stack : reason,
  );
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  (Prisma.Decimal.prototype as any).toJSON = function () {
    return this.toNumber();
  };

  app.enableCors({
    origin: [
      process.env.CLIENT_ORIGIN ?? '',
      process.env.ADMIN_ORIGIN ?? '',
      process.env.MOBILE_ORIGIN ?? '',
    ],
    credentials: true,
  });
  app.use(cookieParser());

  await app.listen(process.env.PORT ?? 3000);
}

// Failing to start is different: the process must exit so the platform can report and restart it
bootstrap().catch((error) => {
  logger.error('Failed to start', error instanceof Error ? error.stack : error);
  process.exit(1);
});
