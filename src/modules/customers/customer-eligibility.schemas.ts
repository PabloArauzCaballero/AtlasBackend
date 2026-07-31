/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import { z } from 'zod';

/**
 * Decisión administrativa de habilitación (N10).
 *
 * Vive en el módulo `customers` —y no junto a los schemas de onboarding— para que el controlador de
 * elegibilidad no tenga que importar nada de `customer-onboarding`: ese módulo ya depende de este, y
 * la dependencia inversa crearía un ciclo entre archivos.
 *
 * `notes` es obligatoria en toda decisión negativa: una observación, una suspensión o un rechazo sin
 * motivo escrito es exactamente el tipo de decisión que después nadie puede defender.
 */
export const eligibilityDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'observe', 'suspend', 'reinstate']),
    reasonCode: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((value) => value.decision === 'approve' || value.decision === 'reinstate' || value.notes !== undefined, {
    message: 'Toda decisión negativa exige una nota que la justifique.',
    path: ['notes'],
  });

export type EligibilityDecisionDto = z.infer<typeof eligibilityDecisionSchema>;
