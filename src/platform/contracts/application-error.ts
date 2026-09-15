/**
 * @file Error de aplicación independiente del transporte (AT-013).
 * @business Un caso de uso decide «no elegible» o «ya existe» sin saber si quien lo llamó es HTTP, un
 *   job o una prueba; el código de negocio viaja con el error y el detalle nunca lleva secretos.
 * @system Valor inmutable con `kind` (familia), `code` (código de negocio estable) y `details`
 *   serializables. La traducción a excepciones Nest vive aquí, en `toHttpException`, y produce
 *   EXACTAMENTE el mismo mensaje que las excepciones que hoy lanzan los servicios (`CODE` o
 *   `CODE: detalle`), así que el contrato HTTP no cambia al migrar un caso.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

export type ApplicationErrorKind = 'invalid' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'unprocessable' | 'unavailable';

/** Sólo valores serializables y no sensibles: códigos, cantidades, identificadores públicos. */
export type SafeDetails = Readonly<Record<string, string | number | boolean | null | readonly string[]>>;

export class ApplicationError extends Error {
  readonly kind: ApplicationErrorKind;
  readonly code: string;
  readonly details: SafeDetails;
  /** Texto que se añade tras `CODE: ` en el mensaje público; opcional. */
  readonly publicDetail: string | null;

  constructor(input: { kind: ApplicationErrorKind; code: string; publicDetail?: string | null; details?: SafeDetails; cause?: unknown }) {
    const message = input.publicDetail ? `${input.code}: ${input.publicDetail}` : input.code;
    super(message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = 'ApplicationError';
    this.kind = input.kind;
    this.code = input.code;
    this.publicDetail = input.publicDetail ?? null;
    this.details = Object.freeze({ ...(input.details ?? {}) });
  }
}

export function isApplicationError(value: unknown): value is ApplicationError {
  return value instanceof ApplicationError;
}

/**
 * Traducción a la excepción Nest equivalente. El mensaje es el `message` del error, que es el
 * formato que ya usan los servicios (`CUSTOMER_NOT_ELIGIBLE: A, B`), de modo que un consumidor que
 * hoy lee `message` no nota la migración.
 */
export function toHttpException(error: ApplicationError): HttpException {
  switch (error.kind) {
    case 'invalid':
      return new BadRequestException(error.message);
    case 'unauthorized':
      return new UnauthorizedException(error.message);
    case 'forbidden':
      return new ForbiddenException(error.message);
    case 'not_found':
      return new NotFoundException(error.message);
    case 'conflict':
      return new ConflictException(error.message);
    case 'unprocessable':
      return new UnprocessableEntityException(error.message);
    case 'unavailable':
      return new ServiceUnavailableException(error.message);
  }
}

/** Estado HTTP por familia, para quien necesita el número sin construir la excepción. */
export const HTTP_STATUS_BY_KIND: Readonly<Record<ApplicationErrorKind, number>> = Object.freeze({
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  unavailable: 503,
});
