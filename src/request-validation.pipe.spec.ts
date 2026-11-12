import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { RequestValidationPipe } from 'src/request-validation.pipe';

class OptionalDto extends createZodDto(
  z.object({ password: z.string().optional() }),
) {}

class RequiredDto extends createZodDto(z.object({ email: z.string() })) {}

const body = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'body',
  metatype,
});

describe('RequestValidationPipe', () => {
  const pipe = new RequestValidationPipe();

  it('treats a missing body as an empty one', () => {
    expect(pipe.transform(undefined, body(OptionalDto))).toEqual({});
  });

  it('still refuses a missing body when a field is required', () => {
    expect(() => pipe.transform(undefined, body(RequiredDto))).toThrow(
      BadRequestException,
    );
  });

  it('validates a body that was sent', () => {
    expect(pipe.transform({ email: 'a@b.c' }, body(RequiredDto))).toEqual({
      email: 'a@b.c',
    });
  });

  it('leaves a single body field undefined', () => {
    expect(
      pipe.transform(undefined, {
        type: 'body',
        data: 'refreshToken',
        metatype: String,
      }),
    ).toBeUndefined();
  });

  it('does not fill in a missing query', () => {
    expect(
      pipe.transform(undefined, { type: 'query', metatype: String }),
    ).toBeUndefined();
  });
});
