import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * 400 validation_failed (Brief P9). The detail names the fields that are wrong and why in a word, never their values: a body can hold a
 * phone number or a message (rule 5). ProblemFilter answers it from `status` and `code`.
 */
export class ValidationFailedError extends Error {
  readonly status = 400;
  readonly code = 'validation_failed';
  constructor(readonly fields: readonly string[]) {
    super(`Invalid request: ${fields.join(', ')}.`);
    this.name = 'ValidationFailedError';
  }
}

/** `field.path: reason` for each issue, at most 10; the path is the client's own field names, the reason Zod's issue code. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues
    .slice(0, 10)
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.code}`);
}

/** Validates and converts a body, a query or a parameter with a Zod schema: `@Body(new ZodPipe(Schema))`. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) throw new ValidationFailedError(describeIssues(parsed.error));
    return parsed.data;
  }
}
