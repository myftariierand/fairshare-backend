import { Controller, Get, Header, Param, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';

import { Public } from 'src/auth/auth.decorators';

import { SseService } from 'src/sse/sse.service';

@Controller('sse')
export class SseController {
  constructor(private sseService: SseService) {}

  @Public()
  @Get('/subscribe/:id')
  @Sse()
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  subscribe(@Param() { id }): Observable<MessageEvent> {
    return this.sseService.subscribe(id);
  }
}
