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
    MailerModule.forRootAsync({
      useFactory: async () => {
        const isProd = process.env.NODE_ENV === 'production';

        return {
          transport: isProd
            ? {
                service: 'gmail',
                auth: {
                  user: process.env.MAIL_USER,
                  pass: process.env.MAIL_PASS,
                },
              }
            : {
                host: 'localhost',
                port: 1025,
                ignoreTLS: true,
                secure: false,
              },
          defaults: {
            from: isProd
              ? '"FairShare" <myftariierand@gmail.com>'
              : '"FairShare" <no-reply@fairshare.local>',
          },
          template: {
            dir: join(__dirname, '..', 'templates'),
            adapter: new HandlebarsAdapter(),
            options: {
              strict: true,
            },
          },
        };
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
