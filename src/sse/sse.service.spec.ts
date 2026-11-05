import { SseService } from './sse.service';

import { SseEventType } from '../types/sse';

const event = SseEventType.TRANSACTION_ADDED;

describe('SseService', () => {
  let service: SseService;

  const streamCount = () => (service as any).userStreams.size;
  const ticketCount = () => (service as any).tickets.size;
  const open = (ticket: string) =>
    service.subscribe(service.redeemTicket(ticket));

  beforeEach(() => {
    service = new SseService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('tickets', () => {
    it('opens the stream of the user it was issued to', () => {
      const received: unknown[] = [];

      open(service.createTicket('alice')).subscribe((message) =>
        received.push(message.data),
      );
      service.emit(['alice'], event, 'hello');

      expect(received).toEqual([{ type: event, message: 'hello' }]);
    });

    it('only delivers events to the user they are for', () => {
      const received: unknown[] = [];

      open(service.createTicket('alice')).subscribe((message) =>
        received.push(message),
      );
      service.emit(['bob'], event, 'not for alice');

      expect(received).toEqual([]);
    });

    it('works only once', () => {
      const ticket = service.createTicket('alice');

      open(ticket);

      expect(() => open(ticket)).toThrow('Invalid or expired ticket');
    });

    it('rejects unknown and missing tickets', () => {
      expect(() => open('made-up')).toThrow('Invalid or expired ticket');
      expect(() => open(undefined as unknown as string)).toThrow(
        'Invalid or expired ticket',
      );
    });

    it('expires after 30 seconds', () => {
      jest.useFakeTimers();
      const ticket = service.createTicket('alice');

      jest.advanceTimersByTime(30 * 1000);

      expect(() => open(ticket)).toThrow('Invalid or expired ticket');
    });

    it('still works just before it expires', () => {
      jest.useFakeTimers();
      const ticket = service.createTicket('alice');

      jest.advanceTimersByTime(29 * 1000);

      expect(() => open(ticket)).not.toThrow();
    });

    it('forgets expired tickets that were never used', () => {
      jest.useFakeTimers();
      service.createTicket('alice');
      service.createTicket('alice');

      jest.advanceTimersByTime(31 * 1000);
      service.createTicket('bob');

      expect(ticketCount()).toBe(1);
    });
  });

  describe('connections', () => {
    const connect = (userId: string) =>
      open(service.createTicket(userId)).subscribe();

    it('removes the stream when the last connection closes', () => {
      const first = connect('alice');
      const second = connect('alice');
      expect(streamCount()).toBe(1);

      first.unsubscribe();
      expect(streamCount()).toBe(1);

      second.unsubscribe();
      expect(streamCount()).toBe(0);
    });

    it('keeps delivering to the other devices when one disconnects', () => {
      const received: unknown[] = [];
      const phone = connect('alice');
      open(service.createTicket('alice')).subscribe((message) =>
        received.push(message),
      );

      phone.unsubscribe();
      service.emit(['alice'], event, 'hello');

      expect(received).toHaveLength(1);
    });

    it('limits how many connections one user can hold', () => {
      for (let i = 0; i < 10; i++) connect('alice');

      expect(() => connect('alice')).toThrow('Too many open connections');
      expect(() => connect('bob')).not.toThrow();
    });

    it('frees up a connection slot on disconnect', () => {
      const connections = Array.from({ length: 10 }, () => connect('alice'));

      connections[0].unsubscribe();

      expect(() => connect('alice')).not.toThrow();
    });

    it('ignores events for users with no connection', () => {
      expect(() => service.emit(['nobody'], event, 'hello')).not.toThrow();
      expect(streamCount()).toBe(0);
    });
  });
});
