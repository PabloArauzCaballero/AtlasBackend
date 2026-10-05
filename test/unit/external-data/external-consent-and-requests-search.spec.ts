import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { externalConsentSchema, providerProbeSchema } from '../../../src/modules/external-data/external-data.schemas.js';
import { ExternalProviderDashboardRepository } from '../../../src/modules/external-data/infrastructure/external-provider-dashboard.repository.js';

describe('Consentimiento externo: sólo se registra lo otorgado', () => {
  const base = { customerId: '12', purpose: 'kyc_check' };

  it('un accepted:false es 400: antes se grababa como consentimiento otorgado', () => {
    expect(externalConsentSchema.safeParse({ ...base, accepted: false }).success).toBe(false);
  });

  it('accepted:true o ausente se aceptan', () => {
    expect(externalConsentSchema.parse({ ...base, accepted: true }).accepted).toBe(true);
    expect(externalConsentSchema.parse(base).accepted).toBe(true);
  });

  it('legalTextVersion ya no se promete: se descarta en vez de fingir que queda en la evidencia', () => {
    expect('legalTextVersion' in externalConsentSchema.parse({ ...base, legalTextVersion: 'v9' })).toBe(false);
  });
});

describe('Probar proveedor: el cuerpo se valida', () => {
  it('normaliza queryType y decisionStage a mayúsculas para que casen con la política de costo', () => {
    expect(providerProbeSchema.parse({ queryType: 'credit_report', decisionStage: 'origination' })).toMatchObject({
      queryType: 'CREDIT_REPORT',
      decisionStage: 'ORIGINATION',
    });
  });

  it('un customerId no numérico es 400 (antes llegaba a la columna BIGINT); sin cuerpo vale {}', () => {
    expect(providerProbeSchema.safeParse({ customerId: 'abc' }).success).toBe(false);
    expect(providerProbeSchema.parse(undefined)).toEqual({});
  });

  it('approvedByAdminId del cuerpo se descarta: la aprobación la decide el rol del actor', () => {
    expect('approvedByAdminId' in providerProbeSchema.parse({ approvedByAdminId: '1' })).toBe(false);
  });
});

describe('Solicitudes a proveedores: búsqueda', () => {
  function build() {
    const findAndCountAll = jest.fn(async (_options: unknown) => ({ rows: [], count: 0 }));
    const repo = new ExternalProviderDashboardRepository({ findAndCountAll } as never, {} as never);
    return { repo, findAndCountAll };
  }
  const whereOf = (mock: jest.Mock) => (mock.mock.calls.at(-1)![0] as { where: Record<string | symbol, unknown> }).where;

  it('un q de sólo dígitos busca además el id exacto; con letras, no', async () => {
    const { repo, findAndCountAll } = build();
    await repo.listRequestsPage({ from: new Date(0), q: '123', limit: 10, offset: 0 });
    expect(whereOf(findAndCountAll)[Op.or]).toContainEqual({ id: '123' });
    await repo.listRequestsPage({ from: new Date(0), q: 'time_out', limit: 10, offset: 0 });
    const condiciones = whereOf(findAndCountAll)[Op.or] as unknown[];
    expect(condiciones).toEqual([
      { providerRequestRef: { [Op.iLike]: '%time\\_out%' } },
      { requestType: { [Op.iLike]: '%time\\_out%' } },
      { errorMessageSafe: { [Op.iLike]: '%time\\_out%' } },
    ]);
  });

  it('sin q no añade búsqueda', async () => {
    const { repo, findAndCountAll } = build();
    await repo.listRequestsPage({ from: new Date(0), limit: 10, offset: 0 });
    expect(whereOf(findAndCountAll)[Op.or]).toBeUndefined();
  });
});
