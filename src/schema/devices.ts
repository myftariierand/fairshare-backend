import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

import { text } from 'src/schema/common';

const RegisterDeviceSchema = z.object({
  token: text(512),
  platform: z.enum(['ios', 'android', 'web']),
});

export class RegisterDeviceDto extends createZodDto(RegisterDeviceSchema) {}
