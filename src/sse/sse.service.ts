import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

@Injectable()
export class SseService {
  private static userStreams: Record<string, Subject<MessageEvent>> = {};

  subscribe(userId: string): Observable<MessageEvent> {
    if (!SseService.userStreams[userId])
      SseService.userStreams[userId] = new Subject<MessageEvent>();

    return SseService.userStreams[userId].asObservable();
  }

  emit(receiverId: string, type: string, message: string) {
    if (SseService.userStreams[receiverId]) {
      SseService.userStreams[receiverId].next(
        new MessageEvent('event', {
          data: { type, message },
        }),
      );
    }
  }
}
