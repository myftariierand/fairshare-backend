import { Controller, Get, Header, Post, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';

import { Public } from 'src/auth/auth.decorators';

import { UserId } from 'src/users/user.decorator';

import { SseService } from 'src/sse/sse.service';
import { SseTicketGuard } from 'src/sse/sse-ticket.guard';

@Controller('sse')
export class SseController {
  constructor(private sseService: SseService) {}

  @Post('ticket')
  createTicket(@UserId() userId: string) {
    return { ticket: this.sseService.createTicket(userId) };
  }

  // Public because EventSource can't send an access token: the ticket is the credential
  @Public()
  @UseGuards(SseTicketGuard)
  @Get('subscribe')
  @Sse()
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  subscribe(@UserId() userId: string): Observable<MessageEvent> {
    return this.sseService.subscribe(userId);
  }
}
