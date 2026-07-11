import { z } from 'zod';

/**
 * ATLAS-AUDIT-014 (cerrado en este patch): movido desde `operations.schemas.ts`. La decisión
 * sobre un caso de fraude es responsabilidad del dominio `fraud`, no de `operations` — aunque
 * la ruta HTTP se mantiene bajo `/operations/fraud-cases/...` por compatibilidad (ver
 * `operations.controller.ts`, que delega en `FraudService`).
 */
export const fraudDecisionParamsSchema = z.object({
  caseId: z.string().regex(/^[1-9][0-9]*$/),
});

export const fraudDecisionSchema = z.object({
  decision: z.enum(['confirmed_fraud', 'false_positive', 'needs_more_investigation', 'blocked', 'escalated']),
  // Opcional a nivel de schema a propósito: `FraudService.decideFraudCase` solo exige
  // `reasonCode` para `confirmed_fraud`/`blocked` (FRAUD_REASON_REQUIRED). Antes este campo era
  // obligatorio aquí, así que ese chequeo condicional del service nunca se alcanzaba vía HTTP —
  // el `ZodValidationPipe` ya rechazaba con 400 cualquier decisión sin reasonCode, incluyendo
  // `false_positive`, que no debería necesitarlo.
  reasonCode: z.string().trim().min(1).max(120).optional(),
  applyWatchlist: z.boolean().default(false),
  nextCustomerStatus: z.enum(['blocked', 'pending_fraud_review', 'registered', 'approved_for_next_step']).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type FraudDecisionParamsDto = z.infer<typeof fraudDecisionParamsSchema>;
export type FraudDecisionDto = z.infer<typeof fraudDecisionSchema>;
