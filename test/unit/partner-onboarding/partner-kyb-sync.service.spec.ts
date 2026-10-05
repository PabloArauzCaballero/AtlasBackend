import { describe, expect, it, jest } from '@jest/globals';
import { PartnerKybSyncService } from '../../../src/modules/partner-onboarding/application/partner-kyb-sync.service.js';

/**
 * La vuelta del circuito: lo que un analista resuelve en la cola del MOTOR tiene que llegar al
 * expediente, que es lo que hace que el QR de caja del comercio resuelva. Sin esto, un comercio
 * aprobado seguía figurando «en revisión» en Atlas para siempre y nadie lo notaba, porque las dos
 * pantallas decían la verdad de su propio lado.
 */
describe('PartnerKybSyncService', () => {
  function expediente(overrides: Record<string, unknown> = {}) {
    return {
      id: '10',
      tenantId: '1',
      manualReviewCaseCode: 'MRC-1',
      decisionReason: 'KYB_SENALES_OPERATIVAS',
      ...overrides,
    };
  }

  function build(options: { configured?: boolean; profiles?: ReturnType<typeof expediente>[]; caso?: unknown; filas?: number }) {
    const profiles = options.profiles ?? [expediente()];
    /*
     * El UPDATE condicional del modelo: devuelve cuántas filas casaron. `filas: 0` es el expediente
     * que alguien decidió por otro camino mientras se consultaba el Motor.
     */
    const profileModel = {
      findAll: jest.fn(async () => profiles),
      update: jest.fn(async (..._a: unknown[]) => [options.filas ?? 1] as [number]),
    };
    const client = {
      isConfigured: options.configured ?? true,
      getManualReviewCase: jest.fn(async () => options.caso ?? null),
    };
    return { service: new PartnerKybSyncService(profileModel as never, client as never), profiles, client, profileModel };
  }

  it('un caso aprobado en el Motor habilita el expediente, sin atribuírselo a nadie de este lado', async () => {
    const { service, profileModel } = build({
      caso: {
        caseCode: 'MRC-1',
        status: 'RESOLVED_APPROVED',
        resolution: { reason: 'Documentación completa' },
        resolvedAt: '2026-09-08T10:00:00.000Z',
        assignedTo: 'ana',
      },
    });

    const resultado = await service.syncPendingReviews({ tenantId: '1', limit: 10 });

    expect(resultado).toMatchObject({ checked: 1, approved: 1 });
    const escrito = (profileModel.update.mock.calls[0] as [Record<string, unknown>])[0];
    expect(escrito.onboardingStatus).toBe('approved');
    expect(escrito.decisionOutcome).toBe('APROBADO');
    // Quién firmó consta en el caso, que es donde ocurrió: poner aquí un usuario interno de Atlas
    // atribuiría la decisión a alguien de este lado que no la tomó.
    expect(escrito.decidedByInternalUserId).toBeNull();
    expect(escrito.rejectionReason).toBeNull();
  });

  it('un caso rechazado trae el motivo escrito por quien lo resolvió', async () => {
    const { service, profileModel } = build({
      caso: {
        caseCode: 'MRC-1',
        status: 'RESOLVED_DECLINED',
        resolution: { comments: 'El poder no acredita al firmante' },
        resolvedAt: null,
        assignedTo: null,
      },
    });

    const resultado = await service.syncPendingReviews({ tenantId: '1', limit: 10 });

    expect(resultado).toMatchObject({ rejected: 1 });
    const escrito = (profileModel.update.mock.calls[0] as [Record<string, unknown>])[0];
    expect(escrito.onboardingStatus).toBe('rejected');
    // Es lo que el comercio verá y lo que le dice qué corregir.
    expect(escrito.rejectionReason).toBe('El poder no acredita al firmante');
  });

  /*
   * Cancelar NO es rechazar: es «este caso no era el camino». El expediente vuelve a quedar sin
   * caso y la decisión manual local vuelve a estar disponible, que es la degradación para la que
   * existe. Condenar al comercio por un problema administrativo sería el error fácil aquí.
   */
  it('un caso cancelado devuelve el expediente a la decisión local, no lo rechaza', async () => {
    const { service, profileModel } = build({
      caso: { caseCode: 'MRC-1', status: 'CANCELLED', resolution: null, resolvedAt: null, assignedTo: null },
    });

    const resultado = await service.syncPendingReviews({ tenantId: '1', limit: 10 });

    expect(resultado).toMatchObject({ cancelled: 1 });
    const escrito = (profileModel.update.mock.calls[0] as [Record<string, unknown>])[0];
    expect(escrito.manualReviewCaseCode).toBeNull();
    expect(escrito.onboardingStatus).toBeUndefined();
  });

  it('un caso todavía abierto no toca el expediente', async () => {
    const { service, profileModel } = build({
      caso: { caseCode: 'MRC-1', status: 'ASSIGNED', resolution: null, resolvedAt: null, assignedTo: 'ana' },
    });

    const resultado = await service.syncPendingReviews({ tenantId: '1', limit: 10 });

    expect(resultado).toMatchObject({ pending: 1, approved: 0, rejected: 0 });
    // Sólo se marca como consultado (para rotar la cola): ni estado ni veredicto.
    const escrito = (profileModel.update.mock.calls[0] as [Record<string, unknown>])[0];
    expect(Object.keys(escrito)).toEqual(['updatedAtValue']);
  });

  it('con el Motor sin responder no decide nada: lo cuenta y lo reintentará la pasada siguiente', async () => {
    const { service, profileModel } = build({ caso: null });

    const resultado = await service.syncPendingReviews({ tenantId: '1', limit: 10 });

    expect(resultado).toMatchObject({ unreachable: 1 });
    const escrito = (profileModel.update.mock.calls[0] as [Record<string, unknown>])[0];
    expect(Object.keys(escrito)).toEqual(['updatedAtValue']);
  });

  it('sin Motor configurado no consulta nada', async () => {
    const { service, client, profileModel } = build({ configured: false });

    const resultado = await service.syncPendingReviews({ tenantId: '1', limit: 10 });

    expect(resultado.checked).toBe(0);
    expect(profileModel.findAll).not.toHaveBeenCalled();
    expect(client.getManualReviewCase).not.toHaveBeenCalled();
  });

  it('sólo mira expedientes en revisión CON caso abierto, del tenant que le toca', async () => {
    const { service, profileModel } = build({
      caso: { caseCode: 'MRC-1', status: 'ASSIGNED', resolution: null, resolvedAt: null, assignedTo: null },
    });

    await service.syncPendingReviews({ tenantId: '7', limit: 25 });

    const [[options]] = profileModel.findAll.mock.calls as unknown as [[{ where: Record<string, unknown>; limit: number }]];
    expect(options.where).toMatchObject({ tenantId: '7', onboardingStatus: 'under_review', deleted: false });
    expect(options.limit).toBe(25);
  });

  /*
   * Entre la lectura y la escritura hay una llamada HTTP al Motor. Si en ese hueco el expediente se
   * decidió por otro camino, escribir sobre la instancia leída pisaba esa decisión.
   */
  it('escribe con condición: sólo si sigue en revisión con el mismo caso', async () => {
    const { service, profileModel } = build({
      caso: { caseCode: 'MRC-1', status: 'RESOLVED_APPROVED', resolution: null, resolvedAt: null, assignedTo: null },
    });

    await service.syncPendingReviews({ tenantId: '1', limit: 10 });

    const [, opciones] = profileModel.update.mock.calls[0] as [unknown, { where: Record<string, unknown> }];
    expect(opciones.where).toMatchObject({ id: '10', tenantId: '1', onboardingStatus: 'under_review', manualReviewCaseCode: 'MRC-1' });
  });

  it('si el expediente ya cambió, no lo cuenta como aprobado', async () => {
    const { service } = build({
      filas: 0,
      caso: { caseCode: 'MRC-1', status: 'RESOLVED_APPROVED', resolution: null, resolvedAt: null, assignedTo: null },
    });

    const resultado = await service.syncPendingReviews({ tenantId: '1', limit: 10 });

    expect(resultado).toMatchObject({ checked: 1, approved: 0 });
  });

  /*
   * Ordenada por la antigüedad del caso, la pasada leía siempre los mismos casos abiertos y nunca
   * llegaba a los demás. Ahora rota por la última consulta.
   */
  it('rota por la última consulta, no por la antigüedad del caso', async () => {
    const { service, profileModel } = build({ caso: null });

    await service.syncPendingReviews({ tenantId: '1', limit: 10 });

    const [[options]] = profileModel.findAll.mock.calls as unknown as [[{ order: unknown }]];
    expect(options.order).toEqual([['_updated_at', 'ASC NULLS FIRST']]);
  });
});
