import { EmailContext, EmailKind, renderEmail } from './email.catalog';

const now = new Date('2026-11-07T14:32:00Z');

const SAMPLES: { [K in EmailKind]: EmailContext<K>[] } = {
  'verify-email': [
    { email: 'a@test.dev', code: '482915', expiresInMinutes: 5 },
  ],
  welcome: [{ email: 'a@test.dev', name: 'Maya Chen' }],
  'reset-password': [
    {
      email: 'a@test.dev',
      resetUrl: 'https://web.test/reset-password?token=abc',
      hasPassword: true,
    },
    {
      email: 'a@test.dev',
      resetUrl: 'https://web.test/reset-password?token=abc',
      hasPassword: false,
    },
  ],
  'password-notice': (['changed', 'reset', 'added', 'admin'] as const).map(
    (variant) => ({ email: 'a@test.dev', variant, changedAt: now }),
  ),
  'account-deleted': [
    { email: 'a@test.dev', byAdmin: false, deletedAt: now },
    { email: 'a@test.dev', byAdmin: true, deletedAt: now },
  ],
  'new-user-registered': [
    {
      name: 'Maya',
      email: 'a@test.dev',
      provider: 'google',
      registeredAt: now,
    },
  ],
  'bug-report-notification': [
    {
      severity: 'CRITICAL',
      title: 'It broke',
      description: 'Line one\nLine two',
      device: 'iPhone',
      name: 'Maya',
      email: 'a@test.dev',
      createdAt: now,
    },
    {
      severity: 'MINOR',
      title: 'It broke',
      description: 'Line one',
      createdAt: now,
    },
  ],
};

describe('renderEmail', () => {
  const clientOrigin = process.env.CLIENT_ORIGIN;

  beforeAll(() => {
    process.env.CLIENT_ORIGIN = 'https://web.test';
  });

  afterAll(() => {
    process.env.CLIENT_ORIGIN = clientOrigin;
  });

  const cases = (Object.keys(SAMPLES) as EmailKind[]).flatMap((kind) =>
    SAMPLES[kind].map((context, i) => [`${kind} #${i + 1}`, kind, context]),
  ) as [string, EmailKind, never][];

  it.each(cases)('%s has every part filled in', (_, kind, context) => {
    const { subject, html, text } = renderEmail(kind, context);

    expect(subject).toBeTruthy();
    expect(subject).not.toMatch(/\n|undefined/);
    expect(html).toContain('FairShare');
    expect(html).toContain('https://web.test/email/logo-64.png');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(text).toContain('FairShare');

    for (const part of [html, text]) {
      expect(part).not.toContain('{{');
      expect(part).not.toContain('undefined');
    }

    // Plain text is read as written, so nothing in it should be HTML or escaped for it
    expect(text).not.toMatch(/<[a-z]|&#|&amp;/);
    expect(text).not.toMatch(/\n{3}/);
  });

  it('escapes what people typed in the HTML but not in the text', () => {
    const name = '<img src=x onerror=alert(1)>';
    const { html, text } = renderEmail('new-user-registered', {
      name,
      email: 'a@test.dev',
      provider: 'local',
      registeredAt: now,
    });

    expect(html).not.toContain(name);
    expect(text).toContain(name);
  });

  it('keeps a reset link usable in both versions', () => {
    const resetUrl = 'https://web.test/reset-password?token=a.b-c_d';
    const { html, text } = renderEmail('reset-password', {
      email: 'a@test.dev',
      resetUrl,
      hasPassword: true,
    });

    expect(text).toContain(resetUrl);
    expect(html.replace(/&#x3D;/g, '=')).toContain(`href="${resetUrl}"`);
  });

  it('writes dates in UTC rather than as a raw Date', () => {
    const { text } = renderEmail('new-user-registered', {
      name: 'Maya',
      email: 'a@test.dev',
      provider: 'local',
      registeredAt: now,
    });

    expect(text).toContain('When: 7 Nov 2026, 14:32 UTC');
    expect(text).toContain('Signed up with: Email and password');
  });

  it('puts a multi-line report title on one subject line', () => {
    const { subject } = renderEmail('bug-report-notification', {
      severity: 'MAJOR',
      title: 'Two\nlines',
      description: 'Long enough',
      createdAt: now,
    });

    expect(subject).toBe('[MAJOR] Two lines');
  });

  it('colours severities differently and shows anonymous reports', () => {
    const render = (severity: 'CRITICAL' | 'MAJOR' | 'MINOR') =>
      renderEmail('bug-report-notification', {
        severity,
        title: 'It broke',
        description: 'Long enough',
        createdAt: now,
      });

    expect(render('CRITICAL').html).toContain('color:#c8372d');
    expect(render('MAJOR').html).toContain('color:#b45309');
    expect(render('MINOR').html).not.toContain('color:#c8372d');
    expect(render('MINOR').text).toContain('Reported by: Anonymous');
  });

  it('only shows a support address when there is one', () => {
    const context = { email: 'a@test.dev', byAdmin: false, deletedAt: now };

    delete process.env.SUPPORT_EMAIL;
    expect(renderEmail('account-deleted', context).text).not.toContain(
      'Didn’t do this',
    );

    process.env.SUPPORT_EMAIL = 'help@test.dev';
    expect(renderEmail('account-deleted', context).text).toContain(
      'Didn’t do this? Email help@test.dev.',
    );
    delete process.env.SUPPORT_EMAIL;
  });
});
