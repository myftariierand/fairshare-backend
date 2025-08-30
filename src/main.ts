import { NestFactory } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';

import { AppModule } from 'src/app.module';

import { Prisma } from '@prisma/client';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  (Prisma.Decimal.prototype as any).toJSON = function () {
    return this.toNumber();
  };

  app.enableCors({
    origin: process.env.CLIENT_ORIGIN ?? true,
    credentials: true,
  });
  app.use(cookieParser());

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
