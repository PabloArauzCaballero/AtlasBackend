/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza hace exigibles los derechos de privacidad y limita el uso de datos personales.
 * @system gestiona decisiones de tratamiento y solicitudes del titular con auditoría y aislamiento por tenant.
 */
import { z } from 'zod';

export const privacyCustomerParamsSchema = z.object({ customerId: z.string().regex(/^[1-9][0-9]*$/) });

export const consentDecisionsSchema = z.object({
  decisions: z
    .array(
      z.object({
        consentDocumentId: z.string().regex(/^[1-9][0-9]*$/),
        purposeCode: z.string().trim().min(1).max(80),
        decision: z.enum(['granted', 'declined', 'revoked']),
        decidedAt: z.string().datetime().optional(),
        sessionId: z
          .string()
          .regex(/^[1-9][0-9]*$/)
          .optional(),
      }),
    )
    .min(1)
    .max(20),
});

export const dataSubjectRequestSchema = z.object({
  // Sólo lo que Atlas ofrece desde la app: corregir un dato y borrar la cuenta. Llevarse los datos, limitar
  // el uso y retirar consentimientos NO se ofrecen (decisión de producto, 2026-10-02) y «ver mis datos» ya
  // no es una solicitud: es una pantalla siempre disponible tras volver a pedir el PIN. El vocabulario
  // completo —con lo histórico— sigue en `DATA_SUBJECT_REQUEST_TYPES`, que gobierna la cola de operaciones.
  requestType: z.enum(['rectification', 'deletion']),
  description: z.string().trim().min(5).max(1000).optional(),
});

export type PrivacyCustomerParamsDto = z.infer<typeof privacyCustomerParamsSchema>;
export type ConsentDecisionsDto = z.infer<typeof consentDecisionsSchema>;
export type DataSubjectRequestDto = z.infer<typeof dataSubjectRequestSchema>;
