/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.
 * @system decide si una decisión sobre una versión de catálogo es válida desde su estado actual.
 */
import { UnprocessableEntityException } from '@nestjs/common';

/**
 * Estados desde los que NO se admite cada decisión, con el código que se devuelve.
 *
 * `publish` admite `pending_approval` además de `approved`, y `retire` admite `draft`: es el
 * comportamiento vigente y se conserva. Lo que no se admite es rechazar una versión ya publicada
 * (quedaría rechazada y vigente a la vez: se retira) ni retirar o rechazar dos veces.
 */
export function assertDecisionAllowed(decision: string, status: string | null | undefined): void {
  const actual = status ?? '';
  if (decision === 'publish' && !['approved', 'pending_approval'].includes(actual))
    throw new UnprocessableEntityException('CATALOG_VERSION_NOT_READY_TO_PUBLISH');
  if (decision === 'approve' && actual !== 'pending_approval')
    throw new UnprocessableEntityException('CATALOG_VERSION_NOT_PENDING_APPROVAL');
  if (decision === 'reject' && ['published', 'retired', 'rejected'].includes(actual))
    throw new UnprocessableEntityException('CATALOG_VERSION_NOT_REJECTABLE');
  if (decision === 'retire' && ['retired', 'rejected'].includes(actual))
    throw new UnprocessableEntityException('CATALOG_VERSION_NOT_RETIRABLE');
}
