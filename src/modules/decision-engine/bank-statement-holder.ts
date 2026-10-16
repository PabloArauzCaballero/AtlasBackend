/**
 * @file Contrato del titular exigido entre AtlasBackend y el worker de extractos del motor.
 * @business El extracto tiene que ser de una cuenta del cliente que lo sube (2026-10-16).
 * @system el tipo que viaja con el PDF y la ejecución sintética con la que se registra un conflicto de titular.
 */
import type { StatementRun } from './bank-statement-engine.client.js';

/**
 * El titular que se exige: el nombre legal del cliente que sube el extracto (2026-10-16). Es el ÚNICO dato
 * del cliente que viaja al motor con el documento; con él, el motor rechaza el extracto de otra persona.
 */
export interface ExpectedHolder {
  name: string;
  givenNames: string | null;
  surnames: string | null;
}

/** Lo que responde el motor cuando el mismo PDF ya está en curso para OTRO titular. */
export const HOLDER_CONFLICT = 'STATEMENT_HOLDER_CONFLICT';

/** La ejecución que se registra cuando el motor no deja usar un PDF que ya es de otro titular. */
export function holderConflictRun(): StatementRun {
  return {
    requestId: '',
    status: 'PDF_INVALID',
    errorCode: 'HOLDER_MISMATCH',
    errorMessage: 'El extracto ya está en curso en el motor para otro titular.',
    rejectionReason: 'HOLDER_MISMATCH',
    reviewReason: null,
    result: null,
  };
}
