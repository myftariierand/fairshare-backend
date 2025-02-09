import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import type { SseEventType } from 'src/types/sse';

@Injectable()
export class SseService {
  private static userStreams: Record<string, Subject<MessageEvent>> = {};

  subscribe(userId: string): Observable<MessageEvent> {
    if (!SseService.userStreams[userId])
      SseService.userStreams[userId] = new Subject<MessageEvent>();

    return SseService.userStreams[userId].asObservable();
  }

  emit(receivers: string[], type: SseEventType, message: string) {
    receivers.forEach((receiver) => {
      if (SseService.userStreams[receiver]) {
        SseService.userStreams[receiver].next(
          new MessageEvent('event', {
            data: { type, message },
          }),
        );
      }
    });
  }
}
