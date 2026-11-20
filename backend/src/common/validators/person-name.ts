import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export const NAME_MIN = 2;
export const NAME_MAX = 100;

/** Display name: trimmed (so whitespace-only is rejected), 2–100 characters. */
export function IsPersonName() {
  return applyDecorators(
    Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)),
    IsString(),
    MinLength(NAME_MIN, { message: `Name must be at least ${NAME_MIN} characters` }),
    MaxLength(NAME_MAX, { message: `Name must be at most ${NAME_MAX} characters` }),
  );
}
