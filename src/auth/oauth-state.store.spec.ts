import { OAUTH_STATE_COOKIE, OAuthCookieStateStore } from './oauth-state.store';

describe('OAuthCookieStateStore', () => {
  const store = new OAuthCookieStateStore();

  const makeReq = (cookies?: Record<string, string>) =>
    ({
      cookies,
      res: { cookie: jest.fn(), clearCookie: jest.fn() },
    }) as any;

  const verify = (state: unknown, cookie?: string) => {
    const req = makeReq(
      cookie === undefined ? {} : { [OAUTH_STATE_COOKIE]: cookie },
    );
    const callback = jest.fn();

    store.verify(req, state, callback);

    return { req, ok: callback.mock.calls[0][1] };
  };

  it('puts the state it returns in a cookie the page cannot read', () => {
    const req = makeReq();
    const callback = jest.fn();

    store.store(req, callback);

    const state = callback.mock.calls[0][1];
    expect(state.length).toBeGreaterThanOrEqual(40);
    expect(req.res.cookie).toHaveBeenCalledWith(
      OAUTH_STATE_COOKIE,
      state,
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      }),
    );
  });

  it('gives each sign-in its own state', () => {
    const states = [makeReq(), makeReq()].map((req) => {
      const callback = jest.fn();
      store.store(req, callback);
      return callback.mock.calls[0][1];
    });

    expect(states[0]).not.toBe(states[1]);
  });

  it('accepts a state matching the cookie', () => {
    expect(verify('abc', 'abc').ok).toBe(true);
  });

  it.each([
    ['no cookie', 'abc', undefined],
    ['a different state', 'abd', 'abc'],
    ['a different length', 'abcd', 'abc'],
    ['no state', undefined, 'abc'],
    ['a repeated state', ['abc', 'abc'], 'abc'],
    ['both empty', '', ''],
  ])('refuses %s', (_name, state, cookie) => {
    expect(verify(state, cookie).ok).toBe(false);
  });

  it('refuses when the cookie parser has not run', () => {
    const callback = jest.fn();

    store.verify(makeReq(undefined), 'abc', callback);

    expect(callback.mock.calls[0][1]).toBe(false);
  });

  it('uses up the cookie whatever the outcome', () => {
    expect(verify('abc', 'abc').req.res.clearCookie).toHaveBeenCalledTimes(1);
    expect(verify('nope', 'abc').req.res.clearCookie).toHaveBeenCalledTimes(1);
  });
});
