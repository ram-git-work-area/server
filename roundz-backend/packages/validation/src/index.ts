import { z, type ZodError, type ZodSchema } from 'zod';
import { AppError } from '@roundz/errors';

export { z };

function toValidationDetails(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

export function validate<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    throw new AppError(
      'Validation failed',
      400,
      'VALIDATION_ERROR',
      toValidationDetails(result.error),
    );
  }

  return result.data;
}
