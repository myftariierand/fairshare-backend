import { Logger } from '@nestjs/common';

import { EmailContext, EmailKind, renderEmail } from 'src/email/email.catalog';
import { EmailService } from 'src/email/email.service';

// For emails the request shouldn't wait for, usually after its change is already saved. Never
// rejects, so a problem with one is logged rather than failing the request or the process.
export const sendInBackground = async <K extends EmailKind>(
  emailService: EmailService,
  logger: Logger,
  to: string,
  kind: K,
  context: EmailContext<K>,
) => {
  try {
    await emailService.sendEmail({ to, ...renderEmail(kind, context) });
  } catch (error) {
    logger.error(`Failed to send ${kind} email`, error);
  }
};
