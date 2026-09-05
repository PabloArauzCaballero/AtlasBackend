/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system valida entradas del ciclo del préstamo antes de que toquen el libro.
 */
import { z } from 'zod';

const databaseId = z.string().regex(/^[1-9][0-9]*$/);
const currency = z.string().trim().length(3).toUpperCase();

/**
 * Los importes viajan como TEXTO decimal, no como `number`.
 *
 * Un JSON con `12345.67` ya llega a `JSON.parse` como binario flotante, y ahí el céntimo se pierde
 * antes de que el backend pueda hacer nada. Con texto, la conversión a céntimos enteros es exacta y
 * ocurre una sola vez, en el borde.
 */
const decimalAmount = z
  .string()
  .trim()
  .regex(/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/, 'Importe con hasta dos decimales, sin signo.')
  .refine((value) => Number.parseFloat(value) > 0, { message: 'El importe debe ser mayor que cero.' });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD.');

export const loanIdParamsSchema = z.object({ loanId: databaseId });
export type LoanIdParamsDto = z.infer<typeof loanIdParamsSchema>;

export const loanPaymentParamsSchema = z.object({ loanId: databaseId, paymentId: databaseId });
export type LoanPaymentParamsDto = z.infer<typeof loanPaymentParamsSchema>;

export const loanApplicationParamsSchema = z.object({ applicationId: databaseId });
export type LoanApplicationParamsDto = z.infer<typeof loanApplicationParamsSchema>;

export const loanCustomerParamsSchema = z.object({ customerId: databaseId });
export type LoanCustomerParamsDto = z.infer<typeof loanCustomerParamsSchema>;

/**
 * Desembolso de una solicitud aprobada.
 *
 * La tasa se puede fijar aquí porque la del producto es la de catálogo y la pactada puede diferir
 * —una campaña, una renegociación—; si no viene, manda el producto. Lo que no se puede cambiar es
 * el monto ni el plazo: los aprobó la decisión, y alterarlos al desembolsar convertiría la
 * aprobación en un trámite.
 */
export const disburseLoanSchema = z
  .object({
    annualInterestRate: z.number().finite().nonnegative().max(999).optional(),
    disbursedAt: z.string().datetime().optional(),
    firstDueDate: isoDate.optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

export type DisburseLoanDto = z.infer<typeof disburseLoanSchema>;

export const registerPaymentSchema = z
  .object({
    amount: decimalAmount,
    currencyCode: currency,
    paymentMethod: z.enum(['cash', 'bank_transfer', 'card', 'qr', 'wallet', 'direct_debit', 'other']),
    externalReference: z.string().trim().max(160).optional(),
    receivedAt: z.string().datetime().optional(),
  })
  .strict();

export type RegisterPaymentDto = z.infer<typeof registerPaymentSchema>;

/** Reversar exige motivo: un cobro que desaparece sin explicación es indistinguible de un descuadre. */
export const reversePaymentSchema = z
  .object({
    reasonCode: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

export type ReversePaymentDto = z.infer<typeof reversePaymentSchema>;

export const writeOffLoanSchema = z
  .object({
    reasonCode: z.string().trim().min(1).max(120),
    notes: z.string().trim().min(1).max(2000),
  })
  .strict();

export type WriteOffLoanDto = z.infer<typeof writeOffLoanSchema>;

export const loanSweepSchema = z
  .object({
    limit: z.number().int().positive().max(1_000).default(200),
    tenantScoped: z.boolean().default(true),
  })
  .strict();

export type LoanSweepDto = z.infer<typeof loanSweepSchema>;

export const outcomeDispatchSchema = z.object({ limit: z.number().int().positive().max(500).default(100) }).strict();

export type OutcomeDispatchDto = z.infer<typeof outcomeDispatchSchema>;
