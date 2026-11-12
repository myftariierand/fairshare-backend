import { ArgumentMetadata, Injectable } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

// Express 5 leaves req.body undefined when a request has no body it can parse. Without this, a
// DTO whose fields are all optional would refuse those requests, and a missing field would be
// reported as a missing body. Deleting a Google account sends no password, for one.
@Injectable()
export class RequestValidationPipe extends ZodValidationPipe {
  transform(value: unknown, metadata: ArgumentMetadata) {
    const isWholeBody = metadata.type === 'body' && !metadata.data;

    return super.transform(isWholeBody ? (value ?? {}) : value, metadata);
  }
}
