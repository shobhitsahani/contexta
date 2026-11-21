import type { z } from 'zod';
import { AppError } from './errors.js';

export function parseOrThrow<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): z.output<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path?.length ? `${first.path.join('.')}: ` : '';
    throw AppError.validation(
      `${path}${first?.message ?? 'Invalid request.'}`,
    );
  }
  return parsed.data;
}
