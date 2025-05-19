import { join } from 'path';
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';

import { DatabaseModule } from 'src/database/database.module';
import { SseModule } from 'src/sse/sse.module';
import { AuthModule } from 'src/auth/auth.module';
import { UsersModule } from 'src/users/users.module';
import { GroupsModule } from 'src/groups/groups.module';
import { FriendshipsModule } from 'src/friendships/friendships.module';
import { TransactionsModule } from 'src/transactions/transactions.module';
import { EmailModule } from 'src/email/email.module';

import { AuthGuard } from 'src/auth/auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot(),
    EmailModule,
    MailerModule.forRoot({
      transport: {
        host: 'localhost',
        port: 1025,
        ignoreTLS: true,
        secure: false,
      },
      defaults: {
        from: '"FairShare" <no-reply@fairshare.local>',
      },
      template: {
        dir: join(__dirname, '..', 'templates'),
        adapter: new HandlebarsAdapter(),
        options: {
          strict: true,
        },
      },
    }),
    DatabaseModule,
    SseModule,
    AuthModule,
    UsersModule,
    GroupsModule,
    FriendshipsModule,
    TransactionsModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
  ],
})
export class AppModule {}
