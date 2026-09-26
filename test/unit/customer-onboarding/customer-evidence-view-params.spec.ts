import { onboardingAttemptIdParamsSchema } from '../../../src/modules/customer-onboarding/customer-onboarding.schemas.js';

/**
 * Regresión del 500 en `GET /customer-onboarding/identity-verifications/:attemptId/evidence-documents`.
 *
 * El parámetro no se validaba —a diferencia de su hermano `:customerId` en el mismo controlador— y
 * un identificador de otro dominio llegaba crudo a una columna `bigint`: PostgreSQL respondía
 * «invalid input syntax for type bigint» y la respuesta era 500 en vez de 400. Se midió con
 * `orig-BNPL-2026-0198` el 2026-09-06 y lo encontró Flujos al cruzar el catálogo con
 * `system_action_logs`.
 */
describe('onboardingAttemptIdParamsSchema', () => {
  it('rechaza el identificador de otro dominio que provocó el 500 en producción', () => {
    expect(onboardingAttemptIdParamsSchema.safeParse({ attemptId: 'orig-BNPL-2026-0198' }).success).toBe(false);
  });

  it.each(['0', '-1', '1.5', '', ' 12', '12 ', 'null', '007'])('rechaza %p, que no es un id de bigint válido', (attemptId) => {
    expect(onboardingAttemptIdParamsSchema.safeParse({ attemptId }).success).toBe(false);
  });

  it.each(['1', '42', '9007199254740993'])('acepta %p, incluido un bigint mayor que Number.MAX_SAFE_INTEGER', (attemptId) => {
    const result = onboardingAttemptIdParamsSchema.safeParse({ attemptId });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.attemptId).toBe(attemptId);
  });
});
