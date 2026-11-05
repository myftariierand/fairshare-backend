import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { SseService } from 'src/sse/sse.service';

// This has to be a guard. An error thrown in an @Sse handler comes after the 200 has been
// sent, so clients would never see the rejection and never ask for a new ticket.
@Injectable()
export class SseTicketGuard implements CanActivate {
  constructor(private sseService: SseService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    request.id = this.sseService.redeemTicket(request.query.ticket);

    return true;
  }
}
