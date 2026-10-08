/**
 * @file Los ids de ruta de crédito y avisos de pago se validan en el borde: `abc` es 400, no un 22P02 de PostgreSQL.
 */
import { describe, expect, it } from '@jest/globals';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { ZodValidationPipe } from '../../../src/common/pipes/zod-validation.pipe.js';
import { CreditOperationsController } from '../../../src/modules/credit/credit-operations.controller.js';
import { numericIdParamSchema } from '../../../src/modules/credit/credit.schemas.js';
import { MerchantPaymentClaimsController } from '../../../src/modules/loan-payment-claims/merchant-payment-claims.controller.js';
import { MobilePaymentClaimsController } from '../../../src/modules/loan-payment-claims/mobile-payment-claims.controller.js';

type ArgMeta = Record<string, { data?: string; pipes: unknown[] }>;

function pipesDeParams(controller: new (...args: never[]) => unknown, method: string): Record<string, unknown[]> {
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) as ArgMeta;
  return Object.fromEntries(Object.values(meta).flatMap((arg) => (arg.data ? [[arg.data, arg.pipes]] : [])));
}

describe('ids de ruta numéricos', () => {
  it('el esquema acepta enteros positivos y rechaza el resto', () => {
    expect(numericIdParamSchema.safeParse('42').success).toBe(true);
    for (const malo of ['abc', '0', '-1', '1.5', '1; drop', '']) {
      expect(numericIdParamSchema.safeParse(malo).success).toBe(false);
    }
  });

  it.each([
    [CreditOperationsController, 'decideApplication', ['applicationId']],
    [CreditOperationsController, 'getApplicationDetail', ['applicationId']],
    [CreditOperationsController, 'recalculateCreditLine', ['customerId']],
    [MobilePaymentClaimsController, 'instruction', ['customerId', 'installmentId']],
    [MobilePaymentClaimsController, 'submit', ['customerId']],
    [MerchantPaymentClaimsController, 'proof', ['partnerId', 'claimId']],
    [MerchantPaymentClaimsController, 'decide', ['partnerId', 'claimId']],
  ] as const)('%p.%s valida %j con Zod', (controller, method, nombres) => {
    const pipes = pipesDeParams(controller as never, method);
    for (const nombre of nombres) {
      expect(pipes[nombre]?.some((p) => p instanceof ZodValidationPipe)).toBe(true);
    }
  });
});
