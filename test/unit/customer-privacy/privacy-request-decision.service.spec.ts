import { describe, expect, it, jest } from '@jest/globals';
import {
  MAX_ENGINE_ATTEMPTS,
  PRIVACY_DECISION_PURPOSE,
  PrivacyRequestDecisionService,
  toPrivacyVerdict,
} from '../../../src/modules/customer-privacy/application/privacy-request-decision.service.js';

/**
 * La opinión del Motor sobre las solicitudes del titular, en SOMBRA.
 *
 * Lo que tiene que ser cierto siempre: no cambia el estado de ninguna solicitud; sin artefacto asignado no lee nada; un
 * desenlace desconocido nunca se guarda como «aceptar»; y un Motor caído deja la solicitud para la pasada siguiente con
 * el error a la vista, sin inventar una decisión.
 */

const hechos = {
  lifecycleStatus: 'active',
  identidadVerificada: true,
  contactoCambiado7d: false,
  dispositivoNuevo7d: false,
  fraudeAbierto: false,
  casoAbierto: false,
  solicitudesIgualesAbiertas: 0,
  saldoPendiente: 350,
  prestamosActivos: 1,
  cuotasEnMora: 0,
  pagosEnConciliacion: 0,
  tuvoCredito: true,
  extractoEnRevision: false,
  cambiosDelCampo365d: 0,
};

function solicitud(cambios: Record<string, unknown> = {}) {
  const fila = {
    id: '41',
    tenantId: '1',
    customerId: '53',
    requestType: 'deletion',
    status: 'received',
    rectificationField: null,
    pinVerifiedAt: new Date('2026-10-04T12:00:00Z'),
    engineAttempts: 0,
    ...cambios,
    update: jest.fn(async (valores: Record<string, unknown>) => Object.assign(fila, valores)),
  };
  return fila;
}

function build(
  opciones: {
    configured?: boolean;
    artifactCode?: string | null;
    respuesta?: Record<string, unknown>;
    falla?: Error;
    filas?: unknown[];
    sinCliente?: boolean;
  } = {},
) {
  const filas = opciones.filas ?? [solicitud()];
  const requests = { findAll: jest.fn(async (..._args: unknown[]) => filas) };
  const facts = { hechos: jest.fn(async () => (opciones.sinCliente ? null : hechos)) };
  const client = {
    isConfigured: opciones.configured ?? true,
    execute: jest.fn(async (..._args: unknown[]) => {
      if (opciones.falla) throw opciones.falla;
      return {
        status: 'COMPLETED',
        outcome: 'RECHAZAR',
        executionId: 'exec-9',
        reasonCodes: [],
        artifact: { versionId: '12' },
        output: {
          dsr_decision: 'RECHAZAR',
          dsr_motivo: 'DSR_BORRADO_CON_DEUDA',
          dsr_accion: 'NINGUNA',
          dsr_senales_riesgo: 0,
          dsr_reevaluar_credito: false,
        },
        ...opciones.respuesta,
      };
    }),
  };
  const bindings = {
    resolve: jest.fn(async (..._args: unknown[]) => ({
      artifactCode: opciones.artifactCode === undefined ? 'PRIVACIDAD_SOLICITUD_TITULAR' : opciones.artifactCode,
    })),
  };
  const subjects = { register: jest.fn(async (..._args: unknown[]) => 'ref-opaca-abc') };
  const service = new PrivacyRequestDecisionService(
    requests as never,
    facts as never,
    client as never,
    bindings as never,
    subjects as never,
  );
  return { service, requests, facts, client, bindings, subjects, filas };
}

const now = new Date('2026-10-04T15:00:00Z');

describe('PrivacyRequestDecisionService.sweepShadow', () => {
  it('sin artefacto asignado para privacidad no lee ni una solicitud: así se apaga', async () => {
    const { service, requests, client, bindings } = build({ artifactCode: null });
    const resultado = await service.sweepShadow({ tenantId: '1', limit: 25, now });
    expect(resultado).toEqual({ skipped: 'unset', scanned: 0, decided: 0, failed: 0 });
    expect(bindings.resolve).toHaveBeenCalledWith('1', 'privacy');
    expect(requests.findAll).not.toHaveBeenCalled();
    expect(client.execute).not.toHaveBeenCalled();
  });

  it('sin Motor configurado tampoco', async () => {
    const { service, requests } = build({ configured: false });
    expect(await service.sweepShadow({ tenantId: '1', limit: 25, now })).toMatchObject({ skipped: 'engine_not_configured' });
    expect(requests.findAll).not.toHaveBeenCalled();
  });

  it('sólo pide las abiertas de corregir o borrar, sin opinión y con intentos disponibles, la más antigua primero', async () => {
    const { service, requests } = build();
    await service.sweepShadow({ tenantId: '1', limit: 7, now });
    const opciones = requests.findAll.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(opciones[0]).toMatchObject({ limit: 7, order: [['requestedAt', 'ASC']] });
    expect(opciones[0]).toMatchObject({ where: { tenantId: '1', engineDecidedAt: null, deleted: false } });
    const where = opciones[0].where as Record<string, Record<symbol, unknown>>;
    const valores = (campo: string) => Object.getOwnPropertySymbols(where[campo]).map((s) => where[campo][s]);
    expect(valores('status')).toEqual([['received', 'in_progress']]);
    expect(valores('requestType')).toEqual([['rectification', 'deletion']]);
    expect(valores('engineAttempts')).toEqual([MAX_ENGINE_ATTEMPTS]);
  });

  it('guarda la opinión en sombra y NO toca el estado de la solicitud', async () => {
    const { service, filas } = build();
    const resultado = await service.sweepShadow({ tenantId: '1', limit: 25, now });
    expect(resultado).toEqual({ scanned: 1, decided: 1, failed: 0 });
    const fila = filas[0] as ReturnType<typeof solicitud>;
    const guardado = fila.update.mock.calls[0][0];
    expect(guardado).toMatchObject({
      decisionMode: 'shadow',
      engineDecision: 'RECHAZAR',
      engineReasonCode: 'DSR_BORRADO_CON_DEUDA',
      engineAction: 'NINGUNA',
      engineRiskSignals: 0,
      engineReevaluateCredit: false,
      engineExecutionId: 'exec-9',
      engineArtifactCode: 'PRIVACIDAD_SOLICITUD_TITULAR',
      engineArtifactVersionId: '12',
      engineDecidedAt: now,
      engineAttempts: 1,
      engineLastError: null,
    });
    expect(guardado).not.toHaveProperty('status');
    expect(guardado).not.toHaveProperty('resolvedAt');
    expect(guardado.engineInputsJson).toMatchObject({ dsr_tipo: 'BORRADO', dsr_saldo_pendiente: 350 });
  });

  it('el Motor conoce al sujeto por una referencia opaca de privacidad, no por su id', async () => {
    const { service, client, subjects } = build();
    await service.sweepShadow({ tenantId: '1', limit: 25, now });
    expect(subjects.register).toHaveBeenCalledWith({ tenantId: '1', customerId: '53', purposeCode: PRIVACY_DECISION_PURPOSE });
    const [artefacto, peticion] = client.execute.mock.calls[0] as [string, Record<string, unknown>];
    expect(artefacto).toBe('PRIVACIDAD_SOLICITUD_TITULAR');
    expect(peticion).toMatchObject({ subjectReference: 'ref-opaca-abc', idempotencyKey: 'dsr-41-1', requestId: 'dsr-41-1' });
    expect(JSON.stringify(peticion)).not.toContain('"53"');
  });

  it('cada variable lleva cuándo se leyó', async () => {
    const { service, client } = build();
    await service.sweepShadow({ tenantId: '1', limit: 25, now });
    const peticion = (client.execute.mock.calls[0] as [string, { variables: object; variableMetadata: Record<string, unknown> }])[1];
    expect(Object.keys(peticion.variableMetadata).sort()).toEqual(Object.keys(peticion.variables).sort());
    expect(peticion.variableMetadata.dsr_saldo_pendiente).toEqual({ fetchedAt: now.toISOString() });
  });

  it('con el Motor caído no inventa una decisión: cuenta el intento y deja el error a la vista', async () => {
    const { service, filas } = build({ falla: new Error('ECONNREFUSED') });
    const resultado = await service.sweepShadow({ tenantId: '1', limit: 25, now });
    expect(resultado).toEqual({ scanned: 1, decided: 0, failed: 1 });
    const fila = filas[0] as ReturnType<typeof solicitud>;
    expect(fila.update).toHaveBeenCalledWith({ engineAttempts: 1, engineLastError: 'ECONNREFUSED' });
  });

  it('una respuesta que no es un veredicto cuenta como fallo', async () => {
    const { service, filas } = build({ respuesta: { status: 'FAILED' } });
    expect(await service.sweepShadow({ tenantId: '1', limit: 25, now })).toMatchObject({ decided: 0, failed: 1 });
    const fila = filas[0] as ReturnType<typeof solicitud>;
    expect(fila.update.mock.calls[0][0]).toMatchObject({ engineAttempts: 1, engineLastError: expect.stringContaining('FAILED') });
  });

  it('un cliente borrado es un fallo explicado, no una consulta al Motor', async () => {
    const { service, client, filas } = build({ sinCliente: true });
    await service.sweepShadow({ tenantId: '1', limit: 25, now });
    expect(client.execute).not.toHaveBeenCalled();
    const fila = filas[0] as ReturnType<typeof solicitud>;
    expect(fila.update.mock.calls[0][0]).toMatchObject({ engineLastError: expect.stringContaining('no existe') });
  });

  it('cada intento lleva su propia clave: reusar la del primero daría 409 IDEMPOTENCY_PAYLOAD_MISMATCH en el Motor', async () => {
    const { service, client } = build({ filas: [solicitud({ engineAttempts: 2 })] });
    await service.sweepShadow({ tenantId: '1', limit: 25, now });
    const peticion = (client.execute.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(peticion).toMatchObject({ idempotencyKey: 'dsr-41-3', requestId: 'dsr-41-3' });
  });
});

describe('toPrivacyVerdict', () => {
  const respuesta = (output: Record<string, unknown>, outcome = '') =>
    ({ status: 'COMPLETED', outcome, executionId: 'e', reasonCodes: [], output, artifact: { versionId: '3' } }) as never;

  it('manda la salida declarada (dsr_decision), no outcome', () => {
    expect(
      toPrivacyVerdict(respuesta({ dsr_decision: 'ACEPTAR', dsr_motivo: 'DSR_BORRADO_TOTAL', dsr_accion: 'BORRAR_TODO' }, 'OTRA')),
    ).toMatchObject({ decision: 'ACEPTAR', reasonCode: 'DSR_BORRADO_TOTAL', action: 'BORRAR_TODO' });
  });

  it('un desenlace desconocido se guarda como revisión humana, nunca como aceptar', () => {
    expect(toPrivacyVerdict(respuesta({ dsr_decision: 'APROBADO', dsr_accion: 'BORRAR_TODO' }))).toMatchObject({
      decision: 'REVISION_HUMANA',
      reasonCode: 'DESCONOCIDO:APROBADO',
      action: 'NINGUNA',
    });
    expect(toPrivacyVerdict(respuesta({}))).toMatchObject({ decision: 'REVISION_HUMANA', reasonCode: 'DESCONOCIDO:vacio' });
  });

  it('señales y recálculo sólo si el Motor los dio con su tipo', () => {
    expect(toPrivacyVerdict(respuesta({ dsr_decision: 'RECHAZAR', dsr_senales_riesgo: 'x', dsr_reevaluar_credito: 'si' }))).toMatchObject({
      riskSignals: null,
      reevaluateCredit: null,
    });
  });
});
