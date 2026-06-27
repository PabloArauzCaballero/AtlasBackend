import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodError, ZodType } from 'zod';

type ValidationIssue = {
  path: string;
  message: string;
};

function formatZodError(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

@Injectable()
export class ZodValidationPipe implements PipeTransform<unknown, unknown> {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const parsed = this.schema.safeParse(value);

    if (!parsed.success) {
      throw new BadRequestException({
        message: `Entrada inválida en ${metadata.type}.`,
        issues: formatZodError(parsed.error),
      });
    }

    return parsed.data;
  }
}
