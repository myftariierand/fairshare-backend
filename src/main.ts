import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import { JsonLogger } from 'src/json.logger';

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
  const app = await NestFactory.create(
    AppModule,
    process.env.NODE_ENV === 'production' ? { logger: new JsonLogger() } : {},
  );

  configureApp(app);

  await app.listen(process.env.PORT ?? 3000);
}

// Failing to start is different: the process must exit so the platform can report and restart it
bootstrap().catch((error) => {
  logger.error('Failed to start', error instanceof Error ? error.stack : error);
  process.exit(1);
});
