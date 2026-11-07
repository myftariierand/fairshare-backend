import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

import { text } from 'src/schema/common';

const RegisterDeviceSchema = z.object({
  // Only ever delivered through Expo, so anything else could never receive a notification
  token: text(512).refine(
    (token) => /^Expo(nent)?PushToken\[.+\]$/.test(token),
    'Invalid push token',
  ),
  platform: z.enum(['ios', 'android', 'web']),
});

export class RegisterDeviceDto extends createZodDto(RegisterDeviceSchema) {}
