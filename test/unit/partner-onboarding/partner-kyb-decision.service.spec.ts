import { describe, expect, it, jest } from '@jest/globals';
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

  function build(options: { configured?: boolean; response?: Record<string, unknown>; fails?: boolean } = {}) {
    const client = {
      isConfigured: options.configured ?? true,
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
      const variables = service.buildVariables(perfil(), [{ requirement: 'power_of_attorney', detail: '' }], 1);
      expect(variables.kyb_representante_acreditado).toBe(false);
    });

    it('el correo probado y la antigüedad salen del expediente, no de los huecos', () => {
      const { service } = build();

      const sinCorreo = service.buildVariables(perfil({ emailVerifiedAt: null }), [], 1);
      expect(sinCorreo.kyb_correo_verificado).toBe(false);
      expect(sinCorreo.kyb_antiguedad_dias).toBe(30);
    });

    /* El hueco `branch` no es una variable: el artefacto cuenta sucursales, no si faltan. */
    it('no manda ningún dato del comercio: sólo booleanos y números', () => {
      const { service } = build();
      const variables = service.buildVariables(perfil({ taxId: '123456', legalName: 'Comercial X' }), [], 1);
      expect(Object.keys(variables).sort()).toEqual([
        'kyb_antiguedad_dias',
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

  describe('evaluate', () => {
    it('traduce el veredicto del Motor, con su ejecución, su versión y su caso', async () => {
      const { service, client } = build();

      const decision = await service.evaluate({ tenantId: '1', profile: perfil(), gaps: [], sucursales: 1, idempotencyKey: 'k1' });

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
      const decision = await service.evaluate({ tenantId: '1', profile: perfil(), gaps: [], sucursales: 1, idempotencyKey: 'k' });
      expect(decision.outcome).toBe('REVISION_MANUAL');
    });

    it('sin Motor configurado NO decide: responde 503', async () => {
      const { service, client } = build({ configured: false });

      await expect(
        service.evaluate({ tenantId: '1', profile: perfil(), gaps: [], sucursales: 1, idempotencyKey: 'k' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(client.execute).not.toHaveBeenCalled();
    });

    it('con el Motor caído NO decide: responde 503 y no inventa un veredicto', async () => {
      const { service } = build({ fails: true });

      await expect(
        service.evaluate({ tenantId: '1', profile: perfil(), gaps: [], sucursales: 1, idempotencyKey: 'k' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('una ejecución que no termina tampoco es un veredicto', async () => {
      const { service } = build({ response: { status: 'RUNNING' } });

      await expect(
        service.evaluate({ tenantId: '1', profile: perfil(), gaps: [], sucursales: 1, idempotencyKey: 'k' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('manda el artefacto que el portal eligió, no el del entorno', async () => {
      const { service, client, bindings } = build();
      bindings.resolve.mockResolvedValueOnce({ artifactCode: 'KYB_PILOTO', source: 'binding' } as never);

      await service.evaluate({ tenantId: '1', profile: perfil(), gaps: [], sucursales: 1, idempotencyKey: 'k' });

      expect(client.execute.mock.calls[0][0]).toBe('KYB_PILOTO');
    });
  });
});
