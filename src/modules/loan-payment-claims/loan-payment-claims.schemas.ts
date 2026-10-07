/**
 * @file Contratos de entrada: valida y normaliza antes de que nada toque el dominio.
 * @business Lo que el cliente declara al avisar que pagó, y lo que el comercio responde.
 * @system esquemas Zod de los dos extremos del reclamo de pago.
 */
import { z } from 'zod';

/** Importe con dos decimales como texto: el mismo formato con el que viaja el resto del dinero. */
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,16}(\.\d{1,2})?$/u, 'Importe inválido.')
  // «0» y «0.00» pasaban el formato: un aviso por nada bloqueaba la cuota hasta que el comercio lo rechazara.
  .refine((value) => Number(value) > 0, 'El importe debe ser mayor que cero.');

/**
 * El ticket para subir el comprobante.
 *
 * Va aparte del de onboarding a propósito: aquel exige que el cliente esté en un estado editable
 * del alta, y quien paga una cuota ya está activo desde hace meses. Reutilizarlo habría rechazado
 * exactamente a las personas que necesitan usarlo.
 */
export const paymentProofTicketSchema = z.object({
  contentType: z.string().trim().min(3).max(100),
  sizeBytes: z.number().int().positive().max(15_000_000),
});
export type PaymentProofTicketDto = z.infer<typeof paymentProofTicketSchema>;

/**
 * El aviso de pago.
 *
 * `storageKey` viene del ticket anterior y el servidor comprueba el objeto real antes de creer sus
 * metadatos: quien sube el archivo es la parte interesada en que parezca lo que no es.
 */
export const submitPaymentClaimSchema = z.object({
  installmentId: z.string().regex(/^[1-9][0-9]*$/u),
  amount,
  /** La referencia del banco. Es lo que el comercio busca en su extracto para encontrarlo. */
  payerReference: z.string().trim().min(3).max(160).optional(),
  storageKey: z.string().trim().min(8).max(500),
  contentType: z.string().trim().min(3).max(100),
});
export type SubmitPaymentClaimDto = z.infer<typeof submitPaymentClaimSchema>;

/**
 * La respuesta del comercio.
 *
 * Rechazar exige motivo por lo mismo que en la revisión de crédito: quien queda sin su pago
 * reconocido tiene derecho a saber por qué, y sin motivo no hay forma de distinguir un error del
 * cliente de uno del comercio.
 */
export const decidePaymentClaimSchema = z
  .object({
    verified: z.boolean(),
    reason: z.string().trim().min(3).max(300).optional(),
  })
  .strict()
  .refine((valor) => valor.verified || valor.reason !== undefined, {
    message: 'Rechazar un comprobante exige un motivo.',
    path: ['reason'],
  });
export type DecidePaymentClaimDto = z.infer<typeof decidePaymentClaimSchema>;

export const claimsQuerySchema = z.object({
  onlyPending: z
    .enum(['true', 'false'])
    .default('true')
    .transform((valor) => valor === 'true'),
});
export type ClaimsQueryDto = z.infer<typeof claimsQuerySchema>;

/** Id numérico de una ruta (`:customerId`, `:partnerId`, `:installmentId`): si no lo es, 400 y no un 22P02 de PostgreSQL. */
export const numericIdParamSchema = z.string().regex(/^[1-9][0-9]*$/u);

export const claimIdParamsSchema = z.object({
  claimId: z.string().regex(/^[1-9][0-9]*$/u),
});
export type ClaimIdParamsDto = z.infer<typeof claimIdParamsSchema>;

/** Los tres estados reales del aviso (`credit.loan_payment_claims.status`). */
export const PAYMENT_CLAIM_STATUSES = ['pending_verification', 'verified', 'rejected'] as const;

const optionalPositiveId = z
  .string()
  .regex(/^[1-9][0-9]*$/u)
  .optional();

/**
 * La cola de avisos vista desde operaciones: todo el tenant, filtrable y paginada.
 *
 * `olderThanHours` responde a la pregunta de supervisión —«¿qué lleva demasiado esperando?»—: con
 * él sólo salen los avisos enviados hace más de esas horas. El tope de un año evita que un número
 * absurdo desborde la aritmética de fechas en la base.
 */
export const operationsClaimsQuerySchema = z.object({
  status: z.enum(PAYMENT_CLAIM_STATUSES).optional(),
  partnerId: optionalPositiveId,
  customerId: optionalPositiveId,
  olderThanHours: z.coerce.number().int().positive().max(8760).optional(),
  /** Parte del código del aviso, del código del cliente o del nombre (comercial o legal) del comercio. */
  q: z.string().trim().min(1).max(80).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type OperationsClaimsQueryDto = z.infer<typeof operationsClaimsQuerySchema>;
