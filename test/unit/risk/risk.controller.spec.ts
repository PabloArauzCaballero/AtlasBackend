import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { RiskController } from '../../../src/modules/risk/risk.controller.js';
import type { RiskService } from '../../../src/modules/risk/risk.service.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';
import type { CreateRiskAssessmentDto, CustomerRiskParamsDto } from '../../../src/modules/risk/risk.schemas.js';

/**
 * Fase 3 — test unitario del RiskController REAL (service mockeado).
 *
 * El endpoint POST /customers/:customerId/risk-assessments es crítico de negocio:
 * origina evaluaciones de riesgo. Este test cubre la lógica que vive en el
 * controller mismo (los guards y pipes tienen sus propios tests):
 * - Idempotencia obligatoria: sin X-Idempotency-Key → 400 explícito.
 * - Tenant obligatorio: x-tenant-id inválido → 400 (parsePositiveId).
 * - Happy path: delega al RiskService con los argumentos correctos.
 */

describe('RiskController (unit, real controller)', () => {
  let controller: RiskController;
  let riskService: { createRiskAssessment: jest.Mock };

  const currentUser: AuthenticatedUser = {
    sub: 'cust-1',
    role: 'customer',
    customerId: '1',
    tenantId: '1',
  };

  const params: CustomerRiskParamsDto = { customerId: '1' } as CustomerRiskParamsDto;

  const body: CreateRiskAssessmentDto = {
    assessmentType: 'onboarding_initial',
    channel: 'mobile_app',
  } as CreateRiskAssessmentDto;

  beforeEach(() => {
    riskService = {
      createRiskAssessment: jest.fn(async () => ({
        riskAssessmentRunId: '1',
        status: 'approved',
      })),
    };
    controller = new RiskController(riskService as unknown as RiskService);
  });

  it('rechaza con 400 si falta X-Idempotency-Key (previene evaluaciones duplicadas)', () => {
    expect(() => controller.createRiskAssessment('1', undefined, params, body, currentUser)).toThrow(BadRequestException);
    expect(() => controller.createRiskAssessment('1', undefined, params, body, currentUser)).toThrow(/X-Idempotency-Key/);
    expect(riskService.createRiskAssessment).not.toHaveBeenCalled();
  });

  it('rechaza con 400 si x-tenant-id no es un id positivo válido', () => {
    expect(() => controller.createRiskAssessment(undefined, 'idem-key-1', params, body, currentUser)).toThrow(BadRequestException);
    expect(() => controller.createRiskAssessment('abc', 'idem-key-1', params, body, currentUser)).toThrow(BadRequestException);
    expect(riskService.createRiskAssessment).not.toHaveBeenCalled();
  });

  it('happy path: delega al RiskService con tenantId parseado, customerId e idempotencyKey', async () => {
    await controller.createRiskAssessment('1', 'idem-key-001', params, body, currentUser);

    expect(riskService.createRiskAssessment).toHaveBeenCalledTimes(1);
    const callArg = riskService.createRiskAssessment.mock.calls[0]?.[0] as {
      tenantId: unknown;
      customerId: string;
      idempotencyKey: string;
      currentUser: AuthenticatedUser;
    };
    expect(callArg.customerId).toBe('1');
    expect(callArg.idempotencyKey).toBe('idem-key-001');
    expect(callArg.currentUser.sub).toBe('cust-1');
  });
});
