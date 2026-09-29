/**
 * @file Regla de dominio: qué solicitudes a proveedores externos admiten una aprobación manual.
 * @business Aprobar deja constancia de que una persona autorizó una consulta retenida; no la ejecuta.
 * @system se usa en `ExternalDataGovernanceService.approveRequest` antes de escribir nada.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * Estados en los que una solicitud ESPERA a una persona.
 *
 * Aprobar sólo deja constancia (no ejecuta nada): la solicitud se vuelve a lanzar después. Aprobar
 * una que ya terminó —MOCKED, COMPLETED, FAILED…— escribía «aprobada» sobre algo que nunca pidió
 * permiso y dejaba en la bitácora una aprobación sin objeto. `null`/`PENDING` se admiten porque así
 * nacen las solicitudes retenidas antes de que el proveedor responda.
 */
export const APPROVABLE_RESPONSE_STATUSES: ReadonlySet<string> = new Set(['MANUAL_APPROVAL_REQUIRED', 'BLOCKED_BY_COST_POLICY', 'PENDING']);

/** La solicitud existe y espera a una persona; si no, 404 o 409 antes de escribir nada. */
export function requireAwaitingApproval<T extends { responseStatus?: string | null }>(request: T | null): T {
  if (!request) throw new NotFoundException('Solicitud de provider externo no encontrada.');
  if (request.responseStatus && !APPROVABLE_RESPONSE_STATUSES.has(request.responseStatus)) {
    throw new ConflictException({
      code: 'EXTERNAL_REQUEST_NOT_AWAITING_APPROVAL',
      message: 'Esta consulta no está esperando aprobación: ya terminó o no necesitaba permiso.',
    });
  }
  return request;
}
