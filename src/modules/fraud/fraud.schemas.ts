/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza reduce pérdidas y habilita revisión humana explicable de señales sospechosas.
 * @system administra casos, decisiones y eventos de fraude dentro de transacciones auditables.
 */
import { z } from 'zod';

const LEGACY_NEXT_STATUS: Record<string, string> = {
  approved_for_next_step: 'active',
  pending_fraud_review: 'under_review',
};

/**
 * Schemas de decisión de fraude; la ruta HTTP compatible delega en `FraudService`.
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
  // Estados CANÓNICOS de la máquina de estados, como la revisión manual desde H1. Los nombres viejos
  // que enviaba el portal se traducen para no romper a quien aún los mande; `registered` no tiene
  // equivalente (volver al inicio no es una transición legal) y se rechaza.
  nextCustomerStatus: z.preprocess(
    (value) => (typeof value === 'string' && value in LEGACY_NEXT_STATUS ? LEGACY_NEXT_STATUS[value] : value),
    z.enum(['active', 'observed', 'under_review', 'rejected', 'blocked', 'suspended']).optional(),
  ),
  notes: z.string().trim().max(2000).optional(),
});

export type FraudDecisionParamsDto = z.infer<typeof fraudDecisionParamsSchema>;
export type FraudDecisionDto = z.infer<typeof fraudDecisionSchema>;
