/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../common/utils/auth/ownership.util.js';

/**
 * Helpers compartidos por los controllers de external-data.
 *
 * Extraídos de `external-data.controller.ts` (Fase 2.2 del plan 10/10) sin cambios: ese archivo
 * agrupaba 9 clases de controller y estos helpers eran privados del módulo. Al separar los verticales
 * en archivos propios, pasan a ser compartidos explícitamente.
 */

export function actorId(currentUser: AuthenticatedUser): string | undefined {
  return currentUser.internalUserId ?? currentUser.platformUserId ?? currentUser.customerId;
}

export function assertCustomerAccess(currentUser: AuthenticatedUser, customerId?: string): void {
  if (customerId) assertOwnCustomerResource(currentUser, customerId);
}

export function customerScopeForConsentMutation(currentUser: AuthenticatedUser): string | undefined {
  if (currentUser.role !== 'customer') return undefined;
  if (!currentUser.customerId) throw new ForbiddenException('El token de cliente no contiene customerId.');
  return currentUser.customerId;
}

/**
 * La petición de «Probar proveedor» del portal interno, con valores por defecto para un body vacío.
 *
 * - Sin cliente, la prueba va SIN cliente. Antes se inventaba `'1'`, y `customer_id` tiene FK a
 *   `customers`: en una base sin ese cliente (TEST está limpia) toda prueba moría con 23503.
 * - `forceRefresh`: la huella de la caché mira `input`, no el escenario, así que pedir «señal de
 *   fraude» tras «normal» devolvía la respuesta normal cacheada. Una prueba llama siempre.
 * - `syntheticProbe`: sin cliente y contra el emulador no hay consentimiento que pedir (ver
 *   `ExternalDataExecutionService.validateConsent`).
 */
export function providerProbeRequest(
  tenantId: string,
  providerCode: string,
  body: Record<string, unknown>,
  currentUser: AuthenticatedUser,
) {
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  return {
    tenantId,
    body: {
      providerCode,
      customerId: text(body.customerId),
      queryType: typeof body.queryType === 'string' ? body.queryType : 'IDENTITY_VERIFICATION',
      purpose: typeof body.purpose === 'string' ? body.purpose : 'MANUAL_REVIEW',
      decisionStage: typeof body.decisionStage === 'string' ? body.decisionStage : 'MANUAL_REVIEW',
      input: typeof body.input === 'object' && body.input !== null ? (body.input as Record<string, unknown>) : {},
      scenario: typeof body.scenario === 'string' ? body.scenario : undefined,
      approvedByAdminId: actorId(currentUser),
      forceRefresh: true,
    },
    requestedByUserId: actorId(currentUser),
    syntheticProbe: true,
  };
}
