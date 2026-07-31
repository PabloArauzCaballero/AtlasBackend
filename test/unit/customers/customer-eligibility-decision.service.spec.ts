import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { CustomerEligibilityDecisionService } from '../../../src/modules/customers/application/customer-eligibility-decision.service.js';

/**
 * Decisión administrativa de habilitación.
 *
 * Lo importante aquí no es que un analista pueda aprobar: es que aprobar CON bloqueadores
 * pendientes quede registrado como excepción autorizada, con la lista exacta de lo que se omitió.
 * Una excepción que no se distingue de una aprobación normal es una excepción que nadie audita.
 */
describe('CustomerEligibilityDecisionService', () => {
  function build(eligible: boolean, blockers: Array<{ code: string }> = []) {
    const customersRepository = { findById: jest.fn(async () => ({ id: 'c1', lifecycleStatus: 'under_review' })) };
    const lifecycleService = {
      transition: jest.fn(async () => ({ previousStatus: 'under_review', newStatus: 'active', changed: true })),
    };
    const eligibilityService = {
      evaluate: jest.fn(async () => ({ eligible, blockers })),
      evaluateAndRecord: jest.fn(async () => ({ eligible, blockers, evaluatedAt: 'now' })),
    };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    const service = new CustomerEligibilityDecisionService(
      customersRepository as never,
      lifecycleService as never,
      eligibilityService as never,
      sequelize as never,
    );
    return { service, customersRepository, lifecycleService, eligibilityService };
  }

  const analyst = { role: 'risk_analyst', internalUserId: 'iu1', customerId: undefined } as never;
  const baseInput = { tenantId: 't1', customerId: 'c1', reasonCode: 'kyc_ok', notes: null, currentUser: analyst };

  it('lanza NotFoundException cuando el cliente no existe', async () => {
    const { service, customersRepository } = build(true);
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(service.decide({ ...baseInput, decision: 'approve' })).rejects.toThrow(NotFoundException);
  });

  it('traduce cada decisión al estado destino correcto', async () => {
    const cases: Array<[Parameters<typeof service.decide>[0]['decision'], string]> = [
      ['approve', 'active'],
      ['reject', 'rejected'],
      ['observe', 'observed'],
      ['suspend', 'suspended'],
      ['reinstate', 'under_review'],
    ];
    const { service } = build(true);
    for (const [decision, expected] of cases) {
      const { service: fresh, lifecycleService } = build(true);
      await fresh.decide({ ...baseInput, decision });
      expect(lifecycleService.transition).toHaveBeenCalledWith(expect.objectContaining({ toStatus: expected }));
    }
    expect(service).toBeDefined();
  });

  it('una aprobación limpia se registra como decisión manual, sin excepciones', async () => {
    const { service, eligibilityService } = build(true);
    const result = await service.decide({ ...baseInput, decision: 'approve' });
    expect(eligibilityService.evaluateAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({ decisionSource: 'manual_decision', reasonCode: 'kyc_ok' }),
    );
    expect(result.overriddenBlockers).toEqual([]);
  });

  it('aprobar con bloqueadores se registra como manual_override y deja constancia de cuáles se omitieron', async () => {
    const { service, eligibilityService } = build(false, [{ code: 'IDENTITY_NOT_VERIFIED' }, { code: 'REFERENCES_INSUFFICIENT' }]);

    const result = await service.decide({ ...baseInput, decision: 'approve', notes: 'Cliente conocido de sucursal.' });

    const recorded = (eligibilityService.evaluateAndRecord as jest.Mock).mock.calls[0][0] as { decisionSource: string; notes: string };
    expect(recorded.decisionSource).toBe('manual_override');
    expect(recorded.notes).toContain('EXCEPCIÓN AUTORIZADA');
    expect(recorded.notes).toContain('IDENTITY_NOT_VERIFIED, REFERENCES_INSUFFICIENT');
    expect(recorded.notes).toContain('Cliente conocido de sucursal.');
    expect(result.overriddenBlockers).toEqual(['IDENTITY_NOT_VERIFIED', 'REFERENCES_INSUFFICIENT']);
  });

  it('rechazar con bloqueadores NO es una excepción: es la decisión esperada', async () => {
    const { service, eligibilityService } = build(false, [{ code: 'IDENTITY_NOT_VERIFIED' }]);
    const result = await service.decide({ ...baseInput, decision: 'reject', notes: 'Documento ilegible.' });
    const recorded = (eligibilityService.evaluateAndRecord as jest.Mock).mock.calls[0][0] as { decisionSource: string };
    expect(recorded.decisionSource).toBe('manual_decision');
    expect(result.overriddenBlockers).toEqual([]);
  });

  it('devuelve el estado anterior y el nuevo, para que el portal muestre la transición real', async () => {
    const { service } = build(true);
    const result = await service.decide({ ...baseInput, decision: 'approve' });
    expect(result).toMatchObject({ previousStatus: 'under_review', lifecycleStatus: 'active', statusChanged: true });
  });
});
