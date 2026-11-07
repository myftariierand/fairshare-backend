import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';

export function configureApp(app: INestApplication) {
  // Exact for anything a Decimal(10, 2) column holds, and what the clients already expect
  (Prisma.Decimal.prototype as any).toJSON = function () {
    return this.toNumber();
  };

  // Lets the platform stop us between deploys without cutting off requests in progress
  app.enableShutdownHooks();

  // The default same-origin policy would stop browsers reading responses from the web and admin
  // apps, which live on other origins. CORS below is what decides who may call this.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.enableCors({
    origin: [
      process.env.CLIENT_ORIGIN ?? '',
      process.env.ADMIN_ORIGIN ?? '',
      process.env.MOBILE_ORIGIN ?? '',
    ],
    credentials: true,
  });
  app.use(cookieParser());
}
