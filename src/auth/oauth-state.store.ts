import { randomBytes, timingSafeEqual } from 'crypto';

import { CookieOptions, Request } from 'express';

export const OAUTH_STATE_COOKIE = '__Host-oauth_state';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 min to finish signing in on Google's page

// Lax, not Strict: the cookie has to come back on the redirect from Google, which is cross-site.
// The __Host- name makes browsers refuse this cookie if it was set by any other subdomain.
const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
};

// Ties a Google sign-in to the browser that started it, so an attacker can't send someone a link
// with the attacker's own Google code and leave them signed in to the attacker's account. There's
// no server session to hold the value, so it stays in a cookie only this browser has.
export class OAuthCookieStateStore {
  store(req: Request, callback: (err: Error | null, state?: string) => void) {
    const state = randomBytes(32).toString('base64url');

    req.res!.cookie(OAUTH_STATE_COOKIE, state, {
      ...cookieOptions,
      maxAge: OAUTH_STATE_TTL_MS,
    });

    callback(null, state);
  }

  verify(
    req: Request,
    state: unknown,
    callback: (err: Error | null, ok: boolean, info?: object) => void,
  ) {
    const expected = req.cookies?.[OAUTH_STATE_COOKIE];

    // Used up here, whatever the outcome
    req.res!.clearCookie(OAUTH_STATE_COOKIE, cookieOptions);

    if (!this.matches(state, expected)) {
      return callback(null, false, { message: 'Invalid sign-in state' });
    }

    callback(null, true);
  }

  private matches(state: unknown, expected: unknown) {
    if (typeof state !== 'string' || typeof expected !== 'string') return false;
    if (!state || !expected) return false;

    const a = Buffer.from(state);
    const b = Buffer.from(expected);

    return a.length === b.length && timingSafeEqual(a, b);
  }
}
