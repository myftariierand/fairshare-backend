import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';

import { PrismaExceptionFilter } from 'src/prisma-exception.filter';
import { HealthController } from 'src/health.controller';

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
import { AdminModule } from 'src/admin/admin.module';
import { TasksModule } from 'src/tasks/tasks.module';
import { DevicesModule } from 'src/devices/devices.module';

import { AuthGuard } from 'src/auth/auth.guard';
import { throttlerOptions } from 'src/throttling';
import { validateEnv } from 'src/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ validate: validateEnv }),
    ThrottlerModule.forRoot(throttlerOptions),
    CloudinaryModule,
    EmailModule,
    DatabaseModule,
    SseModule,
    AuthModule,
    UsersModule,
    GroupsModule,
    FriendshipsModule,
    TransactionsModule,
    ActivityLogsModule,
    BugReportsModule,
    AdminModule,
    TasksModule,
    DevicesModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: AuthGuard },
    // After AuthGuard, which sets the user id that logged-in requests are counted by
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
