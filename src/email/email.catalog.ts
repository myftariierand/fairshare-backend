import { Severity } from '@prisma/client';

import { renderTemplate, renderTextTemplate } from 'templates/render-template';

type PasswordNoticeVariant = 'changed' | 'reset' | 'added' | 'admin';

type EmailContexts = {
  'verify-email': { email: string; code: string; expiresInMinutes: number };
  welcome: { email: string; name: string };
  'reset-password': { email: string; resetUrl: string; hasPassword: boolean };
  'password-notice': {
    email: string;
    variant: PasswordNoticeVariant;
    changedAt: Date;
  };
  'account-deleted': { email: string; byAdmin: boolean; deletedAt: Date };
  'new-user-registered': {
    name: string;
    email: string;
    provider: string;
    registeredAt: Date;
  };
  'bug-report-notification': {
    severity: Severity;
    title: string;
    description: string;
    device?: string | null;
    name?: string | null;
    email?: string | null;
    createdAt: Date;
  };
};

export type EmailKind = keyof EmailContexts;
export type EmailContext<K extends EmailKind> = EmailContexts[K];

type Entry<C> = {
  subject: (context: C) => string;
  preheader: (context: C) => string;
  internal?: boolean;
  // Anything the templates need that callers shouldn't have to work out
  view?: (context: C) => Record<string, unknown>;
};

// The server doesn't know anyone's timezone, so times say which one they're in
const formatDateTime = (date: Date) =>
  `${new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date)} UTC`;

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(date);

const firstName = (name: string) => name.trim().split(/\s+/)[0];

const passwordNotice = (variant: PasswordNoticeVariant, changedAt: string) =>
  ({
    changed: {
      subject: 'Your FairShare password was changed',
      preheader: 'If this wasn’t you, reset it now.',
      heading: 'Your password was changed',
      intro: `The password for your account was changed on ${changedAt}. Your other devices have been signed out.`,
      action: 'If this wasn’t you, reset your password now.',
      buttonLabel: 'Reset password',
    },
    reset: {
      subject: 'Your FairShare password was reset',
      preheader: 'If this wasn’t you, reset it now.',
      heading: 'Your password was reset',
      intro: `Your password was reset using an email link on ${changedAt}. All your devices have been signed out.`,
      action: 'If this wasn’t you, reset your password again now.',
      buttonLabel: 'Reset password',
    },
    added: {
      subject: 'You added a password to FairShare',
      preheader: 'You can now sign in with Google or your password.',
      heading: 'You added a password',
      intro: `You can now sign in with Google or your password. It was set on ${changedAt}, and your other devices have been signed out.`,
      action: 'If this wasn’t you, reset your password now.',
      buttonLabel: 'Reset password',
    },
    admin: {
      subject: 'A FairShare admin reset your password',
      preheader: 'You’ve been signed out on every device.',
      heading: 'An admin reset your password',
      intro: `A FairShare administrator set a new password for your account on ${changedAt}. You’ve been signed out on every device.`,
      action: 'You can choose your own password now.',
      buttonLabel: 'Choose a new password',
    },
  })[variant];

const SEVERITY_TONE: Record<
  Severity,
  { toneClass: string; toneColor: string }
> = {
  CRITICAL: { toneClass: 'x-bad', toneColor: '#c8372d' },
  MAJOR: { toneClass: 'x-owe', toneColor: '#b45309' },
  MINOR: { toneClass: 'x-muted', toneColor: '#5f646b' },
  COSMETIC: { toneClass: 'x-muted', toneColor: '#5f646b' },
};

const CATALOG: { [K in EmailKind]: Entry<EmailContexts[K]> } = {
  'verify-email': {
    subject: ({ code }) => `${code} is your FairShare code`,
    preheader: ({ expiresInMinutes }) =>
      `It expires in ${expiresInMinutes} minutes.`,
  },
  welcome: {
    subject: ({ name }) => `Welcome to FairShare, ${firstName(name)}`,
    preheader: () => 'Split your first bill in under a minute.',
    view: ({ name }) => ({ firstName: firstName(name) }),
  },
  'reset-password': {
    subject: ({ hasPassword }) =>
      hasPassword
        ? 'Reset your FairShare password'
        : 'Set a password for FairShare',
    preheader: () => 'This link works for 1 hour.',
  },
  'password-notice': {
    subject: ({ variant, changedAt }) =>
      passwordNotice(variant, formatDateTime(changedAt)).subject,
    preheader: ({ variant, changedAt }) =>
      passwordNotice(variant, formatDateTime(changedAt)).preheader,
    view: ({ variant, changedAt }) => ({
      ...passwordNotice(variant, formatDateTime(changedAt)),
      forgotPasswordUrl: `${process.env.CLIENT_ORIGIN}/forgot-password`,
    }),
  },
  'account-deleted': {
    subject: () => 'Your FairShare account has been deleted',
    preheader: ({ byAdmin }) =>
      byAdmin
        ? 'A FairShare administrator deleted your account.'
        : 'This is the last email you’ll get from us.',
    view: ({ deletedAt }) => ({
      deletedOn: formatDate(deletedAt),
      supportEmail: process.env.SUPPORT_EMAIL,
    }),
  },
  'new-user-registered': {
    subject: ({ name, provider }) =>
      `New sign-up: ${name} (${provider === 'google' ? 'Google' : 'email'})`,
    preheader: ({ email }) => email,
    internal: true,
    view: ({ provider, registeredAt }) => ({
      providerLabel: provider === 'google' ? 'Google' : 'Email and password',
      registeredOn: formatDateTime(registeredAt),
    }),
  },
  'bug-report-notification': {
    subject: ({ severity, title }) => `[${severity}] ${title}`,
    preheader: ({ description }) => description.slice(0, 140),
    internal: true,
    view: ({ severity, createdAt }) => ({
      ...SEVERITY_TONE[severity],
      submittedOn: formatDateTime(createdAt),
    }),
  },
};

const ACCOUNT_FOOTER = (email: string) =>
  `You got this email because it is about your FairShare account, ${email}. These emails can’t be turned off.`;
const INTERNAL_FOOTER =
  'Internal notification. Sent to the address in NOTIFICATION_EMAIL.';

// Report titles and descriptions can hold line breaks, which don't belong in these two
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export const renderEmail = <K extends EmailKind>(
  kind: K,
  context: EmailContexts[K],
) => {
  const entry = CATALOG[kind] as Entry<EmailContexts[K]>;
  const subject = oneLine(entry.subject(context));
  const preheader = oneLine(entry.preheader(context));
  const view = {
    ...context,
    ...entry.view?.(context),
    appUrl: process.env.CLIENT_ORIGIN,
  };
  const layout = {
    subject,
    preheader,
    appUrl: view.appUrl,
    internal: entry.internal,
    footer: entry.internal
      ? INTERNAL_FOOTER
      : ACCOUNT_FOOTER((context as { email: string }).email),
  };

  return {
    subject,
    html: renderTemplate('layouts/base', {
      ...layout,
      body: renderTemplate(kind, view),
    }),
    text: renderTextTemplate('layouts/base', {
      ...layout,
      body: renderTextTemplate(kind, view).trim(),
    }).replace(/\n{3,}/g, '\n\n'),
  };
};
