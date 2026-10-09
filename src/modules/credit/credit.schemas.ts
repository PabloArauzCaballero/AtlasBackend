/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.
 * @system coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.
 */
import { z } from 'zod';

/**
 * Importe en moneda: a lo sumo dos decimales y al menos un centavo. Se guarda con `toFixed(2)`, así que un
 * `1000.005` o un `0.001` se redondeaban en silencio a algo distinto de lo pedido; se rechazan en el borde.
 */
const amount = z
  .number()
  .finite()
  .positive()
  .max(99_999_999)
  .refine((valor) => Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6 && Math.round(valor * 100) >= 1, {
    message: 'El importe admite hasta dos decimales y debe ser de al menos 0.01.',
  });
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

/** Id numérico de una ruta (`:applicationId`, `:customerId`): si no lo es, 400 y no un 22P02 de PostgreSQL. */
export const numericIdParamSchema = z.string().regex(/^[1-9][0-9]*$/u);

export const creditProductIdParamsSchema = z.object({ productId: z.string().regex(/^[1-9][0-9]*$/) });
export type CreditProductIdParamsDto = z.infer<typeof creditProductIdParamsSchema>;

export const creditCustomerIdParamsSchema = z.object({ customerId: z.string().regex(/^[1-9][0-9]*$/) });
export type CreditCustomerIdParamsDto = z.infer<typeof creditCustomerIdParamsSchema>;

export const bankStatementFileParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
  reviewId: z.string().regex(/^[1-9][0-9]*$/),
});
export type BankStatementFileParamsDto = z.infer<typeof bankStatementFileParamsSchema>;

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
    /*
     * El comercio donde se hace la compra, resuelto antes por el lector de QR. Opcional porque no
     * toda solicitud nace en un comercio —una renovación o una alta desde el portal interno no lo
     * tienen— y exigirlo rompería a quien ya llama sin él. Cuando viene, el servidor comprueba que
     * el expediente existe y está aprobado: el identificador lo elige el cliente, así que aquí sólo
     * se valida la FORMA, nunca la existencia.
     */
    partnerProfileId: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .optional(),
    /*
     * La caja donde se escaneó el QR, resuelta por el lector junto al comercio. Igual que aquél:
     * opcional, y el servidor comprueba que el terminal pertenezca a ESTE comercio antes de guardarlo
     * —el identificador lo trae el cliente, así que la pertenencia no se da por buena—.
     */
    posTerminalId: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .optional(),
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

/**
 * La aceptación del NEGOCIO sobre una solicitud que el motor ya aprobó.
 *
 * Declinar exige motivo; aceptar no. No es asimetría gratuita: el motivo de aceptar ya lo dio el
 * motor —está en su análisis—, mientras que una operación declinada sin explicación es la que se
 * reclama seis meses después y nadie sabe justificar.
 */
export const creditBusinessAcceptanceSchema = z
  .object({
    accepted: z.boolean(),
    reasonCode: z.string().trim().min(1).max(120).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((value) => value.accepted || value.reasonCode !== undefined, {
    message: 'Declinar una operación aprobada por el motor exige un motivo.',
    path: ['reasonCode'],
  });

export type CreditBusinessAcceptanceDto = z.infer<typeof creditBusinessAcceptanceSchema>;

/** El comercio en la ruta del portal, y qué subconjunto de sus solicitudes se pide. */
export const merchantPartnerParamsSchema = z.object({
  partnerId: z.string().regex(/^[1-9][0-9]*$/),
});
export type MerchantPartnerParamsDto = z.infer<typeof merchantPartnerParamsSchema>;

export const merchantPartnerApplicationParamsSchema = merchantPartnerParamsSchema.extend({
  applicationId: z.string().regex(/^[1-9][0-9]*$/),
});
export type MerchantPartnerApplicationParamsDto = z.infer<typeof merchantPartnerApplicationParamsSchema>;

/*
 * `onlyPending` llega como texto porque viene de la query, y por defecto es TRUE: la pantalla que
 * importa es la de lo que espera respuesta, y abrir el portal sobre el histórico completo entierra
 * justo lo accionable. Quien quiera todo lo pide explícitamente.
 */
export const merchantApplicationsQuerySchema = z.object({
  onlyPending: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value !== 'false'),
});
export type MerchantApplicationsQueryDto = z.infer<typeof merchantApplicationsQuerySchema>;

/**
 * El extracto que el cliente acaba de subir.
 *
 * Solo la clave del objeto: el archivo ya viajo por el permiso de subida firmado, y el contenido
 * nunca pasa por este endpoint. Pedir aqui el importe o los movimientos dejaria que el cliente
 * declarara su propio extracto, que es justo lo que el extracto viene a evitar.
 */
export const submitBankStatementSchema = z
  .object({
    storageKey: z.string().trim().min(1).max(500),
  })
  .strict();

export type SubmitBankStatementDto = z.infer<typeof submitBankStatementSchema>;

/**
 * El aviso del pago INICIAL de una compra (el 60 % que se paga directo al comercio al comprar).
 *
 * Es el mismo gesto que avisar una cuota —comprobante + referencia del banco— pero ocurre antes de que exista un
 * préstamo, así que cuelga de la SOLICITUD de crédito. `amount` es lo que el cliente dice haber pagado: aquí sólo
 * se valida su forma; el servicio lo compara con el inicial que sale de la compra (60/40 sobre el financiado,
 * `domain/down-payment.ts`) y rechaza con 422 `DOWN_PAYMENT_AMOUNT_MISMATCH` uno distinto. Que el dinero entró lo
 * comprueba después el comercio contra su cuenta. `storageKey` viene del ticket de subida de comprobantes.
 */
export const submitDownPaymentSchema = z
  .object({
    amount: z
      .string()
      .trim()
      .regex(/^\d{1,16}(\.\d{1,2})?$/u, 'Importe inválido.'),
    payerReference: z.string().trim().min(3).max(160).optional(),
    storageKey: z.string().trim().min(8).max(500),
    contentType: z.string().trim().min(3).max(100),
  })
  .strict();
export type SubmitDownPaymentDto = z.infer<typeof submitDownPaymentSchema>;

/** La respuesta del comercio sobre el pago inicial. Rechazar exige motivo: quien no ve reconocido su pago tiene derecho a saber por qué. */
export const decideDownPaymentSchema = z
  .object({
    verified: z.boolean(),
    reason: z.string().trim().min(3).max(300).optional(),
  })
  .strict()
  .refine((valor) => valor.verified || valor.reason !== undefined, {
    message: 'Rechazar un pago exige un motivo.',
    path: ['reason'],
  });
export type DecideDownPaymentDto = z.infer<typeof decideDownPaymentSchema>;
