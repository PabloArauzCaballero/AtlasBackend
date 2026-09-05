/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aporta trazabilidad verificable de acciones y cambios para investigación, cumplimiento y soporte.
 * @system consolida consultas y persistencia de eventos de auditoría sin exponer modelos ORM al transporte.
 */
import { SystemEndpointCatalogModel } from '../../database/models/index.js';
import { hashPayload, idempotencyLast4, sanitizeForSystemsOps } from '../systems-ops/systems-sanitizer.js';
import type { HttpActionLogInput } from './http-action-log.service.js';

/**
 * Traducción de una acción HTTP observada a fila de `system_action_logs`.
 *
 * Extraída de `HttpActionLogService.createSystemActionLog`, que tenía **complejidad ciclomática 30**:
 * un solo objeto con ~35 campos y una cascada de `??` decidiendo, campo a campo, de dónde sale cada
 * valor —del endpoint catalogado, del input, o de un default—. Esa precedencia **es** la lógica, y
 * estaba mezclada con la llamada al ORM, de modo que comprobar "el catálogo gana sobre lo que
 * declara el request" exigía un doble del modelo Sequelize.
 *
 * Tres reglas quedan ahora explícitas y verificables sin base de datos:
 *
 * 1. **El catálogo manda.** `module`, `riskLevel` y `containsPii` se toman del endpoint catalogado
 *    si existe; lo que diga el request es solo un respaldo. Un endpoint marcado como `containsPii`
 *    no puede desmarcarse desde la petición.
 * 2. **La clave de idempotencia nunca se guarda en claro**: solo su hash y sus últimos 4 caracteres,
 *    suficientes para correlacionar en una investigación sin poder reutilizarla.
 * 3. **El payload viaja saneado y hasheado**: el sanitizado para poder leerlo, el hash del original
 *    para poder demostrar que no se alteró.
 */
export function toSystemActionLogRow(
  input: HttpActionLogInput,
  sanitizedPayload: Record<string, unknown>,
  endpoint: SystemEndpointCatalogModel | null,
) {
  return {
    tenantId: input.tenantId,
    requestId: input.requestId ?? input.correlationId ?? null,
    correlationId: input.correlationId ?? null,
    endpointCatalogId: endpoint?.id ?? null,
    actorUserId: input.actorUserId ?? null,
    actorType: input.actorType,
    actorRole: input.actorRole ?? input.actorType,
    actorInternalUserId: input.actorInternalUserId,
    actorPlatformUserId: input.actorPlatformUserId,
    method: input.method ?? 'UNKNOWN',
    routeTemplate: input.routeTemplate ?? null,
    resolvedUrlSanitized: input.resolvedUrlSanitized ?? String(sanitizedPayload.path ?? 'unknown'),
    // Regla 1: el catálogo gana sobre lo que declare el request.
    module: endpoint?.module ?? input.module ?? null,
    actionName: input.actionName ?? input.actionCode,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    targetType: input.targetType,
    targetId: input.targetId,
    merchantId: null,
    customerId: input.payload.customerId ? String(input.payload.customerId) : null,
    // Regla 3: saneado para leerlo, hash del original para demostrar que no se alteró.
    requestPayloadSanitized: sanitizedPayload,
    requestPayloadHash: hashPayload(input.payload),
    responseStatusCode: input.responseStatusCode ?? null,
    responseSummarySanitized: sanitizeForSystemsOps({ statusCode: input.responseStatusCode, errorCode: input.errorCode }),
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    durationMs: input.durationMs ?? null,
    // Regla 2: nunca la clave en claro.
    idempotencyKeyHash: input.idempotencyKey ? hashPayload(input.idempotencyKey) : null,
    idempotencyKeyLast4: idempotencyLast4(input.idempotencyKey),
    riskLevel: endpoint?.riskLevel ?? input.riskLevel ?? 'LOW',
    containsPii: endpoint?.containsPii ?? input.containsPii ?? false,
    occurredAt: input.occurredAt,
    createdAtValue: input.occurredAt,
  };
}
