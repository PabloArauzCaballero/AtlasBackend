import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { env } from '../../../src/config/env.js';
import { ServiceUnavailableException } from '@nestjs/common';
import { PartnerKybDecisionService } from '../../../src/modules/partner-onboarding/application/partner-kyb-decision.service.js';

/**
 * El puente entre el expediente y el artefacto `PARTNER_KYB_REVIEW`.
 *
 * Dos cosas se prueban aquí y sólo aquí: que las siete variables se derivan del expediente sin
 * llevarse ningún documento, y que cuando el Motor no responde NO se decide en local. Lo segundo
 * es la diferencia con la evaluación de riesgo del alta de un cliente, donde degradar sí es lo
 * correcto: aquí una decisión local devolvería el veredicto a la consola, que es justo lo que este
 * trabajo desmonta.
 */
describe('PartnerKybDecisionService', () => {
  const perfil = (overrides: Record<string, unknown> = {}) =>
    ({
      id: '10',
      emailVerifiedAt: new Date('2026-01-01'),
      createdAtValue: new Date(Date.now() - 30 * 86_400_000),
      ...overrides,
    }) as never;

  function build(options: { configured?: boolean; response?: Record<string, unknown>; fails?: boolean; abierto?: unknown } = {}) {
    const client = {
      isConfigured: options.configured ?? true,
      manualReviews: {
        putOnboardingDossier: jest.fn(async (..._args: unknown[]) =>
          options.abierto
            ? { ok: true, status: 200, caseCode: (options.abierto as { caseCode: string }).caseCode, created: true }
            : { ok: false, status: null, reason: 'x', final: false },
        ),
      },
      execute: jest.fn(async (..._args: unknown[]) => {
        if (options.fails) throw new Error('ECONNREFUSED');
        return {
          status: 'SUCCEEDED',
          outcome: 'REVISION_MANUAL',
          executionId: 'exec-77',
          reasonCodes: [],
          output: {
            kyb_decision: 'REVISION_MANUAL',
            kyb_motivo: 'KYB_SENALES_OPERATIVAS',
            kyb_requisitos_faltantes: 0,
            kyb_senales_operativas: 1,
          },
          artifact: { versionId: '9' },
          manualReview: { caseCode: 'MRC-3' },
          ...options.response,
        };
      }),
    };
    const bindings = { resolve: jest.fn(async () => ({ artifactCode: 'PARTNER_KYB_REVIEW', source: 'binding' })) };
    return { service: new PartnerKybDecisionService(client as never, bindings as never), client, bindings };
  }

  describe('buildVariables', () => {
    it('deriva los cuatro requisitos duros de los huecos del expediente', () => {
      const { service } = build();

      const variables = service.buildVariables(
        perfil(),
        [
          { requirement: 'commercial_registry', detail: '' },
          { requirement: 'bank_qr', detail: '' },
        ],
        2,
        true,
      );

      expect(variables.kyb_tiene_matricula).toBe(false);
      expect(variables.kyb_qr_bancario).toBe(false);
      expect(variables.kyb_representante_acreditado).toBe(true);
      expect(variables.kyb_qr_negocio).toBe(true);
      expect(variables.kyb_sucursales).toBe(2);
    });

    /* Declarar al representante no es acreditarlo: el poder que falta invalida el mismo requisito. */
    it('el poder que falta invalida el requisito del representante', () => {
      const { service } = build();
      const variables = service.buildVariables(perfil(), [{ requirement: 'power_of_attorney', detail: '' }], 1, true);
      expect(variables.kyb_representante_acreditado).toBe(false);
    });

    it('el correo probado y la antigüedad salen del expediente, no de los huecos', () => {
      const { service } = build();

      const sinCorreo = service.buildVariables(perfil({ emailVerifiedAt: null }), [], 1, true);
      expect(sinCorreo.kyb_correo_verificado).toBe(false);
      expect(sinCorreo.kyb_antiguedad_dias).toBe(30);
    });

    /* El hueco `branch` no es una variable: el artefacto cuenta sucursales, no si faltan. */
    it('no manda ningún dato del comercio: sólo booleanos y números', () => {
      const { service } = build();
      const variables = service.buildVariables(perfil({ taxId: '123456', legalName: 'Comercial X' }), [], 1, true);
      expect(Object.keys(variables).sort()).toEqual([
        'kyb_antiguedad_dias',
        'kyb_contrato_legal_vigente',
        'kyb_correo_verificado',
        'kyb_qr_bancario',
        'kyb_qr_negocio',
        'kyb_representante_acreditado',
        'kyb_sucursales',
        'kyb_tiene_matricula',
      ]);
      expect(Object.values(variables).every((valor) => typeof valor === 'boolean' || typeof valor === 'number')).toBe(true);
    });
  });

  /**
   * Por omisión los comercios NO están en `DECISION_ENGINE_AUTO_APPLY`: el Motor se ejecuta igual
   * —la ejecución queda en su historial— pero nadie se habilita ni se rechaza sin una persona.
   */
  describe('evaluate por omisión (sólo el crédito se aplica solo)', () => {
    it('un APROBADO del Motor queda como propuesta en REVISION_MANUAL, con su ejecución', async () => {
      const { service, client } = build({ response: { output: { kyb_decision: 'aprobado', kyb_motivo: 'KYB_COMPLETO' } } });
      const decision = await service.evaluate({
        tenantId: '1',
        profile: perfil(),
        gaps: [],
        sucursales: 1,
        contratoVigente: true,
        idempotencyKey: 'k',
      });

      expect(client.execute).toHaveBeenCalledTimes(1);
      expect(decision.outcome).toBe('REVISION_MANUAL');
      expect(decision.reason).toBe('ENGINE_VERDICT_HELD_FOR_MANUAL_REVIEW:APROBADO:KYB_COMPLETO');
    });
  });

  /*
   * El caso que faltaba: el grafo dijo APROBADO (o la versión dice «revisión» sin nodo que abra
   * caso), Atlas retiene el veredicto, y el Motor NO tenía nada en su cola. El expediente esperaba
   * a una persona que no podía verlo.
   */
  describe('el caso del Motor existe siempre que el expediente espera a una persona', () => {
    const entrada = { tenantId: '1', profile: perfil(), gaps: [], sucursales: 1, contratoVigente: true, idempotencyKey: 'k' };

    it('un veredicto retenido sin caso lo abre en la cola MERCHANT_KYB y guarda su código', async () => {
      const { service, client } = build({
        response: { output: { kyb_decision: 'aprobado', kyb_motivo: 'KYB_COMPLETO' }, manualReview: null },
        abierto: { caseCode: 'MR-0000000077', status: 'OPEN' },
      });
      const decision = await service.evaluate(entrada);

      expect(client.manualReviews.putOnboardingDossier).toHaveBeenCalledWith(
        'exec-77',
        expect.objectContaining({ openIfMissing: expect.objectContaining({ queueCode: 'MERCHANT_KYB' }) }),
      );
      expect(decision.manualReviewCaseCode).toBe('MR-0000000077');
    });

    it('si el grafo ya abrió el caso le adjunta el anexo del comercio y conserva su código', async () => {
      // Con la versión del artefacto que abre caso sola, salir aquí dejaba al revisor sin un dato de la empresa.
      const { service, client } = build({ abierto: { caseCode: 'OTRO', status: 'OPEN' } });
      const decision = await service.evaluate({ ...entrada, dossier: { version: 1, comercio: { razonSocial: 'Tienda SRL' } } });

      expect(client.manualReviews.putOnboardingDossier).toHaveBeenCalledWith(
        'exec-77',
        expect.objectContaining({
          dossier: { version: 1, comercio: { razonSocial: 'Tienda SRL' }, origen: 'KYB_COMERCIO', expedienteId: '10' },
        }),
      );
      expect(decision.manualReviewCaseCode).toBe('MRC-3');
    });

    it('si el anexo no llega, el caso que abrió el grafo no se pierde', async () => {
      const { service } = build({ abierto: null });
      const decision = await service.evaluate(entrada);

      expect(decision.manualReviewCaseCode).toBe('MRC-3');
    });

    it('si el Motor no atiende la petición el código queda nulo —lo reintenta la sincronización— y nunca se aprueba solo', async () => {
      const { service } = build({ response: { manualReview: null }, abierto: null });
      const decision = await service.evaluate(entrada);

      expect(decision.manualReviewCaseCode).toBeNull();
      expect(decision.outcome).toBe('REVISION_MANUAL');
    });
  });

  describe('evaluate', () => {
    let anterior: unknown;
    beforeEach(() => {
      anterior = (env as Record<string, unknown>).DECISION_ENGINE_AUTO_APPLY;
      (env as Record<string, unknown>).DECISION_ENGINE_AUTO_APPLY = ['credit', 'partner'];
    });
    afterEach(() => {
      (env as Record<string, unknown>).DECISION_ENGINE_AUTO_APPLY = anterior;
    });

    it('traduce el veredicto del Motor, con su ejecución, su versión y su caso', async () => {
      const { service, client } = build();

      const decision = await service.evaluate({
        tenantId: '1',
        profile: perfil(),
        gaps: [],
        sucursales: 1,
        contratoVigente: true,
        idempotencyKey: 'k1',
      });

      expect(decision).toMatchObject({
        outcome: 'REVISION_MANUAL',
        reason: 'KYB_SENALES_OPERATIVAS',
        executionId: 'exec-77',
        artifactVersionId: '9',
        manualReviewCaseCode: 'MRC-3',
        senalesOperativas: 1,
      });
      // El sujeto es el EXPEDIENTE, no el comercio: el Motor puede atribuir el desenlace sin
      // recibir el NIT ni la razón social.
      const [, request] = client.execute.mock.calls[0] as [string, { subjectReference: string }];
      expect(request.subjectReference).toBe('partner:10');
    });

    it('el desenlace lo manda `kyb_decision`, la salida declarada, no el `outcome` del motor', async () => {
      const { service } = build({ response: { outcome: 'OTRA_COSA' } });
      const decision = await service.evaluate({
        tenantId: '1',
        profile: perfil(),
        gaps: [],
        sucursales: 1,
        contratoVigente: true,
        idempotencyKey: 'k',
      });
      expect(decision.outcome).toBe('REVISION_MANUAL');
    });

    /*
     * Lo que este código no conoce lo mira una persona, y se publica con un desenlace que TODOS los
     * consumidores entienden: antes salía tal cual (o vacío) y el ERP lo persistía sin poder
     * traducirlo a un estado del caso.
     */
    it('un desenlace desconocido —o vacío— se publica como REVISION_MANUAL con el valor original en el motivo', async () => {
      const entrada = { tenantId: '1', profile: perfil(), gaps: [], sucursales: 1, contratoVigente: true, idempotencyKey: 'k' };

      const nuevo = build({ response: { output: { kyb_decision: 'DESENLACE_NUEVO' } } });
      const decisionNueva = await nuevo.service.evaluate(entrada);
      expect(decisionNueva.outcome).toBe('REVISION_MANUAL');
      expect(decisionNueva.reason).toBe('DESENLACE_DESCONOCIDO:DESENLACE_NUEVO');

      const vacio = build({ response: { outcome: '', output: {} } });
      const decisionVacia = await vacio.service.evaluate(entrada);
      expect(decisionVacia.outcome).toBe('REVISION_MANUAL');
      expect(decisionVacia.reason).toBe('DESENLACE_DESCONOCIDO:vacio');

      // Y un desenlace conocido no se toca.
      const aprobado = build({ response: { output: { kyb_decision: 'aprobado', kyb_motivo: 'KYB_COMPLETO' } } });
      expect(await aprobado.service.evaluate(entrada)).toMatchObject({ outcome: 'APROBADO', reason: 'KYB_COMPLETO' });
    });

    it('sin Motor configurado NO decide: responde 503', async () => {
      const { service, client } = build({ configured: false });

      await expect(
        service.evaluate({ tenantId: '1', profile: perfil(), gaps: [], sucursales: 1, contratoVigente: true, idempotencyKey: 'k' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(client.execute).not.toHaveBeenCalled();
    });

    it('con el Motor caído NO decide: responde 503 y no inventa un veredicto', async () => {
      const { service } = build({ fails: true });

      await expect(
        service.evaluate({ tenantId: '1', profile: perfil(), gaps: [], sucursales: 1, contratoVigente: true, idempotencyKey: 'k' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('una ejecución que no termina tampoco es un veredicto', async () => {
      const { service } = build({ response: { status: 'RUNNING' } });

      await expect(
        service.evaluate({ tenantId: '1', profile: perfil(), gaps: [], sucursales: 1, contratoVigente: true, idempotencyKey: 'k' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('manda el artefacto que el portal eligió, no el del entorno', async () => {
      const { service, client, bindings } = build();
      bindings.resolve.mockResolvedValueOnce({ artifactCode: 'KYB_PILOTO', source: 'binding' } as never);

      await service.evaluate({ tenantId: '1', profile: perfil(), gaps: [], sucursales: 1, contratoVigente: true, idempotencyKey: 'k' });

      expect(client.execute.mock.calls[0][0]).toBe('KYB_PILOTO');
    });
  });
});
