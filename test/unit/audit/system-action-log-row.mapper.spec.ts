import { describe, expect, it } from '@jest/globals';
import { toSystemActionLogRow } from '../../../src/modules/audit/system-action-log-row.mapper.js';
import type { HttpActionLogInput } from '../../../src/modules/audit/http-action-log.service.js';

/**
 * Precedencia y protecciones de la fila de `system_action_logs`, ahora verificables sin ORM.
 *
 * Antes esto vivía dentro de `createSystemActionLog`, mezclado con la llamada a
 * `systemActionLogModel.create()`: comprobar "el catálogo gana sobre lo que declara el request"
 * obligaba a montar un doble del modelo Sequelize y espiar el argumento. La precedencia campo a
 * campo **es** la lógica de esta pieza, y es la que decide si una acción queda marcada como
 * sensible o no en la traza de auditoría.
 */
describe('toSystemActionLogRow', () => {
  const at = new Date('2026-08-06T10:00:00.000Z');

  const baseInput = {
    tenantId: '1',
    actorType: 'internal_user',
    actorInternalUserId: 'iu1',
    actorPlatformUserId: null,
    actionCode: 'customers.read',
    targetType: 'customer',
    targetId: '10',
    ipAddress: '10.0.0.1',
    userAgent: 'jest',
    payload: {},
    occurredAt: at,
  } as HttpActionLogInput;

  const endpoint = { id: 'ep1', module: 'customers', riskLevel: 'HIGH', containsPii: true } as never;

  /**
   * El catálogo es la fuente de verdad sobre la naturaleza del endpoint. Si el request pudiera
   * rebajar `containsPii` o `riskLevel`, cualquier llamada podría hacerse pasar por inocua en la
   * traza — justo lo que la traza existe para impedir.
   */
  describe('el catálogo manda sobre lo que declare el request', () => {
    it('riskLevel y containsPii del endpoint ganan al del input', () => {
      const row = toSystemActionLogRow({ ...baseInput, riskLevel: 'LOW', containsPii: false }, {}, endpoint);

      expect(row.riskLevel).toBe('HIGH');
      expect(row.containsPii).toBe(true);
      expect(row.module).toBe('customers');
      expect(row.endpointCatalogId).toBe('ep1');
    });

    it('sin endpoint catalogado se usa lo declarado, y si no, el default conservador', () => {
      const declared = toSystemActionLogRow({ ...baseInput, riskLevel: 'MEDIUM', containsPii: true }, {}, null);
      expect(declared.riskLevel).toBe('MEDIUM');
      expect(declared.containsPii).toBe(true);

      const bare = toSystemActionLogRow(baseInput, {}, null);
      expect(bare.riskLevel).toBe('LOW');
      expect(bare.containsPii).toBe(false);
      expect(bare.endpointCatalogId).toBeNull();
    });
  });

  /**
   * Una clave de idempotencia en claro dentro de la tabla de auditoría sería reutilizable por
   * cualquiera con acceso de lectura a la traza: permitiría reproducir el replay de una mutación.
   */
  describe('la clave de idempotencia nunca se guarda en claro', () => {
    it('persiste hash y últimos 4, no el valor', () => {
      const key = 'idem-key-secreta-1234';
      const row = toSystemActionLogRow({ ...baseInput, idempotencyKey: key }, {}, null);

      expect(row.idempotencyKeyHash).not.toBe(key);
      expect(row.idempotencyKeyHash).toEqual(expect.any(String));
      expect(row.idempotencyKeyLast4).toBe('1234');
      expect(JSON.stringify(row)).not.toContain(key);
    });

    it('sin clave, no inventa hash', () => {
      expect(toSystemActionLogRow(baseInput, {}, null).idempotencyKeyHash).toBeNull();
    });
  });

  it('guarda el payload saneado y el hash del original, para poder demostrar que no se alteró', () => {
    const sanitized = { path: '/api/v1/customers/10', password: '[REDACTED]' };
    const row = toSystemActionLogRow({ ...baseInput, payload: { password: 'secreta' } }, sanitized, null);

    expect(row.requestPayloadSanitized).toBe(sanitized);
    expect(row.requestPayloadHash).toEqual(expect.any(String));
    expect(JSON.stringify(row.requestPayloadSanitized)).not.toContain('secreta');
  });

  it('cae a la ruta saneada del payload cuando el request no trae URL resuelta', () => {
    expect(toSystemActionLogRow(baseInput, { path: '/api/v1/x' }, null).resolvedUrlSanitized).toBe('/api/v1/x');
    expect(toSystemActionLogRow(baseInput, {}, null).resolvedUrlSanitized).toBe('unknown');
    expect(toSystemActionLogRow(baseInput, {}, null).method).toBe('UNKNOWN');
  });

  it('requestId cae a correlationId para que la traza no quede sin hilo', () => {
    expect(toSystemActionLogRow({ ...baseInput, correlationId: 'corr-1' }, {}, null).requestId).toBe('corr-1');
    expect(toSystemActionLogRow({ ...baseInput, requestId: 'req-1', correlationId: 'corr-1' }, {}, null).requestId).toBe('req-1');
  });

  it('actorRole cae a actorType, y actionName a actionCode', () => {
    const row = toSystemActionLogRow(baseInput, {}, null);
    expect(row.actorRole).toBe('internal_user');
    expect(row.actionName).toBe('customers.read');
  });
});
