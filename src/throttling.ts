import { applyDecorators, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Throttle, ThrottlerModuleOptions } from '@nestjs/throttler';

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;

const THROTTLE_BY_EMAIL = 'throttleByEmail';

// Logged-in users count separately, so people sharing a network don't use up each other's limit.
// Railway's edge overwrites X-Real-IP on every public request, so callers can't forge it. Behind
// the proxy the socket address is the proxy's, which would make every user share one limit.
const getClientTracker = (req: Record<string, any>): string =>
  req.id ?? req.headers['x-real-ip'] ?? req.ip;

const getEmailTracker = (req: Record<string, any>): string => {
  const email = req.body?.email;

  return typeof email === 'string'
    ? email.trim().toLowerCase()
    : getClientTracker(req);
};

export const throttlerOptions: ThrottlerModuleOptions = {
  errorMessage: 'Too many requests. Please try again shortly.',
  getTracker: getClientTracker,
  throttlers: [
    { name: 'default', ttl: MINUTE, limit: 300 },
    {
      name: 'email',
      ttl: HOUR,
      limit: 5,
      getTracker: getEmailTracker,
      skipIf: (context: ExecutionContext) =>
        !Reflect.getMetadata(THROTTLE_BY_EMAIL, context.getHandler()),
    },
  ],
};

export const ThrottleByClient = (limit: number, ttl = MINUTE) =>
  Throttle({ default: { limit, ttl } });

// Also limits by the email in the body: someone with many IPs could otherwise flood one inbox,
// or guess a code for one account
export const ThrottleByEmail = (limit: number, ttl = HOUR) =>
  applyDecorators(
    SetMetadata(THROTTLE_BY_EMAIL, true),
    Throttle({ email: { limit, ttl } }),
  );
