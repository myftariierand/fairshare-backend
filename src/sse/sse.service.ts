import {
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { finalize, Observable, Subject } from 'rxjs';

import type { SseEventType } from 'src/types/sse';

type UserStream = {
  subject: Subject<MessageEvent>;
  connections: number;
};

@Injectable()
export class SseService implements OnModuleDestroy {
  // EventSource can't send headers, so the stream URL carries a ticket instead. It ends up
  // in access logs, which is why it only works once and only for a few seconds.
  private readonly TICKET_TTL_MS = 30 * 1000;
  private readonly MAX_CONNECTIONS_PER_USER = 10;

  private tickets = new Map<string, { userId: string; expiresAt: number }>();
  private userStreams = new Map<string, UserStream>();

  // An open stream never finishes by itself, so the server could never stop without this. Clients
  // reconnect on their own.
  onModuleDestroy() {
    for (const { subject } of this.userStreams.values()) subject.complete();
  }

  createTicket(userId: string): string {
    const now = Date.now();

    for (const [ticket, { expiresAt }] of this.tickets) {
      if (expiresAt <= now) this.tickets.delete(ticket);
    }

    const ticket = randomBytes(32).toString('base64url');
    this.tickets.set(ticket, { userId, expiresAt: now + this.TICKET_TTL_MS });

    return ticket;
  }

  redeemTicket(ticket: string): string {
    const found = this.tickets.get(ticket);
    this.tickets.delete(ticket);

    if (!found || found.expiresAt <= Date.now()) {
      throw new UnauthorizedException('Invalid or expired ticket');
    }

    const connections = this.userStreams.get(found.userId)?.connections ?? 0;

    if (connections >= this.MAX_CONNECTIONS_PER_USER) {
      throw new HttpException(
        'Too many open connections',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return found.userId;
  }

  subscribe(userId: string): Observable<MessageEvent> {
    const stream = this.userStreams.get(userId) ?? {
      subject: new Subject<MessageEvent>(),
      connections: 0,
    };

    stream.connections++;
    this.userStreams.set(userId, stream);

    return stream.subject.asObservable().pipe(
      finalize(() => {
        stream.connections--;
        if (stream.connections === 0) this.userStreams.delete(userId);
      }),
    );
  }

  emit(receivers: string[], type: SseEventType, message: string) {
    receivers.forEach((receiver) => {
      this.userStreams.get(receiver)?.subject.next(
        new MessageEvent('event', {
          data: { type, message },
        }),
      );
    });
  }
}
