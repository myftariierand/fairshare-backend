import { JsonLogger } from './json.logger';

describe('JsonLogger', () => {
  const logger = new JsonLogger();
  let out: jest.SpyInstance;
  let err: jest.SpyInstance;

  beforeEach(() => {
    out = jest.spyOn(process.stdout, 'write').mockImplementation();
    err = jest.spyOn(process.stderr, 'write').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  const line = (spy: jest.SpyInstance) => JSON.parse(spy.mock.calls[0][0]);

  it('writes one JSON line with the context pulled out', () => {
    logger.log('Started', 'Bootstrap');

    expect(out.mock.calls[0][0].endsWith('\n')).toBe(true);
    expect(line(out)).toMatchObject({
      level: 'info',
      context: 'Bootstrap',
      message: 'Started',
    });
    expect(Date.parse(line(out).time)).not.toBeNaN();
  });

  it('sends errors to stderr, keeping an error passed as detail', () => {
    logger.error('Failed to send', new Error('provider down'), 'OtpService');

    expect(out).not.toHaveBeenCalled();

    const written = line(err);
    expect(written.context).toBe('OtpService');
    expect(written.details[0].message).toBe('provider down');
    expect(written.details[0].stack).toContain('provider down');
  });

  it('keeps the message of an error logged by itself', () => {
    logger.error(new Error('boom'));

    expect(line(err).message).toBe('boom');
    expect(line(err).stack).toContain('boom');
  });

  it("doesn't lose the message when details can't be written", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    logger.warn('Careful', circular, 'Somewhere');

    expect(line(out)).toMatchObject({ level: 'warn', message: 'Careful' });
  });
});
