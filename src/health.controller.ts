import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from 'src/auth/auth.decorators';
import { DatabaseService } from 'src/database/database.service';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: DatabaseService) {}

  // The platform polls this, so it must never be rate limited
  @Public()
  @SkipThrottle({ default: true, email: true })
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.error('Health check failed', error);
      throw new ServiceUnavailableException();
    }

    return { status: 'ok' };
  }
}
