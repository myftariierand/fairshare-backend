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
import { ActivityLogsModule } from 'src/activity-logs/activity.module';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import { BugReportsModule } from 'src/bug-reports/bug-reports.module';

import { AuthGuard } from 'src/auth/auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot(),
    CloudinaryModule,
    EmailModule,
    MailerModule.forRootAsync({
      useFactory: async () => {
        const isProd = process.env.NODE_ENV === 'production';

        return {
          transport: isProd
            ? {
                host: 'smtp.gmail.com',
                port: 587,
                secure: false,
                auth: {
                  user: process.env.GMAIL_USER,
                  pass: process.env.GMAIL_APP_PASSWORD,
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
    ActivityLogsModule,
    BugReportsModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
  ],
})
export class AppModule {}
