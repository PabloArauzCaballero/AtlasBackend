/**
 * Tabla homogénea (F) · políticas de notificación contra PostgreSQL REAL.
 *
 * Lo que un doble no demuestra: que `q` casa con las cuatro columnas de verdad (código, nombre,
 * categoría y descripción), que `%` y `_` no actúan de comodín, que el total es el del filtro y no el
 * de la página, que el resumen agrupado cuenta el catálogo entero aunque se filtre, y que sin `limit`
 * responde todo como antes.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { NotificationPolicyModel, TenantModel } from '../../../src/database/models/index.js';
import { NotificationPoliciesRepository } from '../../../src/modules/notifications/notification-policies.repository.js';
import { buildLoanBookHarness, type LoanBookHarness } from '../credit/support/loan-book-harness.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let otherTenantId: string | null = null;
let h: LoanBookHarness | null = null;
const token = runToken().toUpperCase();

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) h = await buildLoanBookHarness(database.sequelize);
});

afterAll(async () => {
  try {
    if (h) await NotificationPolicyModel.destroy({ where: { tenantId: h.tenantId } });
    if (otherTenantId) {
      await NotificationPolicyModel.destroy({ where: { tenantId: otherTenantId } });
      await TenantModel.destroy({ where: { id: otherTenantId } });
    }
  } finally {
    await h?.cleanup().catch(() => undefined);
    await database?.close();
  }
});

const now = new Date();

describe('Tabla homogénea (F) · políticas de notificación (PostgreSQL real)', () => {
  it('busca por partes en código, nombre, categoría y explicación, filtra, pagina y resume el catálogo entero', async () => {
    if (!h) return;
    const tenantId = h.tenantId;
    const policy = (
      eventCode: string,
      channel: string,
      label: string,
      extra: { category?: string; description?: string | null; isMandatory?: boolean; isActive?: boolean; displayOrder?: number } = {},
    ) =>
      NotificationPolicyModel.create({
        tenantId,
        eventCode: `${eventCode}_${token}`,
        channel,
        label,
        description: extra.description ?? null,
        category: extra.category ?? 'pagos',
        isMandatory: extra.isMandatory ?? false,
        mandatoryReason: extra.isMandatory ? 'Obligación de avisar cobros' : null,
        defaultEnabled: true,
        displayOrder: extra.displayOrder ?? 100,
        isActive: extra.isActive ?? true,
        createdAtValue: now,
        deleted: false,
      } as never);
    await policy('MORA', 'push', 'Aviso de mora', { isMandatory: true, displayOrder: 1 });
    await policy('MORA', 'sms', 'Aviso de mora por SMS', { isMandatory: true, displayOrder: 2 });
    await policy('CUOTA', 'push', 'Descuento del 50% en tu cuota', { description: 'Pagando antes del vencimiento', displayOrder: 3 });
    await policy('CUOTAX', 'email', 'Descuento del 50X en tu cuota', { displayOrder: 4 });
    await policy('OFERTA', 'email', 'Ofertas', {
      category: 'novedades',
      description: 'Promos de user_id fijo',
      isActive: false,
      displayOrder: 5,
    });
    await policy('OFERTAX', 'in_app', 'Ofertas 2', { category: 'novedades', description: 'Promos de userXid fijo', displayOrder: 6 });
    // Ajena al tenant: no debe aparecer ni contar.
    const other = await TenantModel.create({
      tenantCode: `itf-${token.toLowerCase()}`,
      legalName: `Otro inquilino ${token}`,
      countryCode: 'BO',
      status: 'active',
      createdAtValue: now,
      updatedAtValue: now,
      deleted: false,
    });
    otherTenantId = String(other.id);
    await NotificationPolicyModel.create({
      tenantId: otherTenantId,
      eventCode: `MORA_${token}`,
      channel: 'push',
      label: 'Aviso de mora ajeno',
      category: 'pagos',
      isMandatory: true,
      mandatoryReason: 'Obligación de avisar cobros',
      defaultEnabled: true,
      displayOrder: 1,
      isActive: true,
      createdAtValue: now,
      deleted: false,
    } as never);
    const repo = new NotificationPoliciesRepository(NotificationPolicyModel);
    const codes = (rows: NotificationPolicyModel[]) => rows.map((row) => `${row.eventCode.replace(`_${token}`, '')}:${row.channel}`);

    // Comodines literales: «50%» no casa con «50X»; «user_id» no casa con «userXid».
    expect(codes((await repo.listPage(tenantId, { q: '50%', page: 1, limit: 10 })).rows)).toEqual(['CUOTA:push']);
    expect(codes((await repo.listPage(tenantId, { q: 'user_id', page: 1, limit: 10 })).rows)).toEqual(['OFERTA:email']);

    // Cada campo real se busca: código, nombre, categoría y descripción; sin distinguir mayúsculas.
    expect(codes((await repo.listPage(tenantId, { q: `mora_${token.toLowerCase()}`, page: 1, limit: 10 })).rows)).toEqual([
      'MORA:push',
      'MORA:sms',
    ]);
    expect(codes((await repo.listPage(tenantId, { q: 'por sms', page: 1, limit: 10 })).rows)).toEqual(['MORA:sms']);
    expect(codes((await repo.listPage(tenantId, { q: 'novedades', page: 1, limit: 10 })).rows)).toEqual(['OFERTA:email', 'OFERTAX:in_app']);
    expect(codes((await repo.listPage(tenantId, { q: 'antes del vencimiento', page: 1, limit: 10 })).rows)).toEqual(['CUOTA:push']);

    // Filtros que filtran.
    expect(codes((await repo.listPage(tenantId, { channel: 'email', page: 1, limit: 10 })).rows)).toEqual(['OFERTA:email', 'CUOTAX:email']);
    expect(codes((await repo.listPage(tenantId, { mandatory: true, page: 1, limit: 10 })).rows)).toEqual(['MORA:push', 'MORA:sms']);
    expect(codes((await repo.listPage(tenantId, { active: false, page: 1, limit: 10 })).rows)).toEqual(['OFERTA:email']);
    expect(codes((await repo.listPage(tenantId, { category: 'novedades', active: true, page: 1, limit: 10 })).rows)).toEqual([
      'OFERTAX:in_app',
    ]);

    // Paginación: el total es el del filtro, no el de la página.
    const p1 = await repo.listPage(tenantId, { category: 'pagos', page: 1, limit: 2 });
    expect(p1.meta).toEqual({ page: 1, limit: 2, total: 4, totalPages: 2 });
    expect(codes(p1.rows)).toEqual(['MORA:push', 'MORA:sms']);
    expect(codes((await repo.listPage(tenantId, { category: 'pagos', page: 2, limit: 2 })).rows)).toEqual(['CUOTA:push', 'CUOTAX:email']);

    // El resumen es del catálogo entero: no cambia con el buscador ni con el filtro.
    const filtrado = await repo.listPage(tenantId, { mandatory: true, q: 'mora', page: 1, limit: 1 });
    expect(filtrado.summary).toEqual({
      total: 6,
      mandatory: 2,
      active: 5,
      inactive: 1,
      byChannel: { push: 2, sms: 1, email: 2, in_app: 1 },
      byCategory: [
        { category: 'novedades', count: 2 },
        { category: 'pagos', count: 4 },
      ],
    });
    expect((await repo.listPage(tenantId, { page: 1, limit: 10 })).summary).toEqual(filtrado.summary);

    // Sin limit: todo el catálogo, como antes de paginar.
    const todo = await repo.listPage(tenantId, { page: 1 });
    expect(todo.rows).toHaveLength(6);
    expect(todo.meta).toEqual({ page: 1, limit: 6, total: 6, totalPages: 1 });
  });
});
