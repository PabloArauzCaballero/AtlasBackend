/**
 * @file Pipe: valida o transforma datos antes de invocar el controlador.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de pipes sin introducir reglas de un dominio específico.
 */
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
