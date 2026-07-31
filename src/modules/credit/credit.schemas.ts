/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.
 * @system coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.
 */
import { z } from 'zod';

const amount = z.number().finite().positive().max(99_999_999);
const currency = z.string().trim().length(3).toUpperCase();

/**
 * Alta de un producto crediticio (operaciones).
 *
 * Las condiciones comerciales son dato administrado por negocio, no constantes del backend. Este
 * schema solo garantiza que un producto no pueda existir con rangos incoherentes.
 */
export const createCreditProductSchema = z
  .object({
    productCode: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9_-]+$/, 'productCode admite minúsculas, dígitos, guion y guion bajo.'),
    productName: z.string().trim().min(3).max(180),
    description: z.string().trim().max(2000).optional(),
    currencyCode: currency,
    minAmount: amount,
    maxAmount: amount,
    minTermMonths: z.number().int().positive().max(360),
    maxTermMonths: z.number().int().positive().max(360),
    annualInterestRate: z.number().finite().nonnegative().max(999).optional(),
    minMonthlyIncome: z.number().finite().nonnegative().max(99_999_999).optional(),
    requiresManualReview: z.boolean().default(false),
    effectiveFrom: z.string().datetime().optional(),
    effectiveUntil: z.string().datetime().optional(),
  })
  .strict()
  .refine((value) => value.maxAmount >= value.minAmount, {
    message: 'maxAmount debe ser mayor o igual que minAmount.',
    path: ['maxAmount'],
  })
  .refine((value) => value.maxTermMonths >= value.minTermMonths, {
    message: 'maxTermMonths debe ser mayor o igual que minTermMonths.',
    path: ['maxTermMonths'],
  });

export type CreateCreditProductDto = z.infer<typeof createCreditProductSchema>;

export const creditProductStatusSchema = z
  .object({ status: z.enum(['draft', 'active', 'suspended', 'retired']), reasonCode: z.string().trim().min(1).max(120) })
  .strict();

export type CreditProductStatusDto = z.infer<typeof creditProductStatusSchema>;

export const creditProductIdParamsSchema = z.object({ productId: z.string().regex(/^[1-9][0-9]*$/) });
export type CreditProductIdParamsDto = z.infer<typeof creditProductIdParamsSchema>;

export const creditCustomerIdParamsSchema = z.object({ customerId: z.string().regex(/^[1-9][0-9]*$/) });
export type CreditCustomerIdParamsDto = z.infer<typeof creditCustomerIdParamsSchema>;

export const creditApplicationParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
  applicationId: z.string().regex(/^[1-9][0-9]*$/),
});
export type CreditApplicationParamsDto = z.infer<typeof creditApplicationParamsSchema>;

/** Creación de una solicitud de crédito por parte del cliente. */
export const createCreditApplicationSchema = z
  .object({
    productId: z.string().regex(/^[1-9][0-9]*$/),
    requestedAmount: amount,
    requestedTermMonths: z.number().int().positive().max(360),
    purposeCode: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export type CreateCreditApplicationDto = z.infer<typeof createCreditApplicationSchema>;

/** Decisión de operaciones sobre una solicitud. */
export const creditApplicationDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'request_more_information']),
    reasonCode: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((value) => value.decision === 'approve' || value.notes !== undefined, {
    message: 'Rechazar o pedir más información exige una nota que lo justifique.',
    path: ['notes'],
  });

export type CreditApplicationDecisionDto = z.infer<typeof creditApplicationDecisionSchema>;
