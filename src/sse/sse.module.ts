import { Global, Module } from '@nestjs/common';

import { SseService } from 'src/sse/sse.service';
import { SseController } from 'src/sse/sse.controller';

@Global()
@Module({
  providers: [SseService],
  controllers: [SseController],
  exports: [SseService],
})
export class SseModule {}
