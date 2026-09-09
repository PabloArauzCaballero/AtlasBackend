/**
 * @file Esquemas Zod de lo que operaciones y el ERP piden sobre el expediente de un comercio.
 * @business Separa lo que el comercio declara de sí mismo de lo que un tercero decide sobre él.
 * @system valida en el borde las entradas de `operations/partners`, que tienen otro público y otros roles.
 */
import { z } from 'zod';

/*
 * Estos esquemas viven aparte de `partner-onboarding.schemas.ts` porque su PÚBLICO es otro: aquél
 * valida lo que el comercio declara de sí mismo en el autoservicio; éste, lo que operaciones y el
 * ERP deciden o preguntan SOBRE él. Mezclados, el archivo pasaba de las 300 líneas del gate y, peor,
 * había que leer los dos vocabularios juntos para encontrar cualquiera de los dos.
 */

/**
 * La decisión de operaciones sobre el expediente del comercio.
 *
 * Rechazar exige motivo y aprobar no, por lo mismo que en la aceptación de un crédito: el motivo de
 * aprobar es el expediente que se acaba de revisar; un rechazo sin explicación es el que se vuelve
 * a preguntar y el que nadie sabe justificar medio año después.
 */
export const partnerDecisionSchema = z
  .object({
    approved: z.boolean(),
    rejectionReason: z.string().trim().min(3).max(200).optional(),
  })
  .strict()
  .refine((value) => value.approved || Boolean(value.rejectionReason), {
    message: 'Rechazar un expediente exige motivo.',
    path: ['rejectionReason'],
  });
export type PartnerDecisionDto = z.infer<typeof partnerDecisionSchema>;

/**
 * La tasa de comisión (MDR) del comercio, fijada desde el ERP interno de Atlas.
 *
 * Entre 0 y 100 %, con dos decimales. Es el término comercial que se negocia en el onboarding: por
 * cada venta financiada, el porcentaje que Atlas cobra sobre lo que el cliente paga.
 */
export const setMdrRateSchema = z
  .object({
    mdrRatePercent: z.number().min(0).max(100),
  })
  .strict();
export type SetMdrRateDto = z.infer<typeof setMdrRateSchema>;

/**
 * La consulta de la cola de verificación.
 *
 * Sin `status`: la cola es por definición lo que está en `under_review`, que es el único estado
 * sobre el que `decide()` acepta trabajar. Ver `PartnerOperationsController.listQueue`.
 */
export const listPartnerQueueQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
});
export type ListPartnerQueueQueryDto = z.infer<typeof listPartnerQueueQuerySchema>;

/**
 * La búsqueda de un expediente por su lado del ERP.
 *
 * El ERP origina la cuenta B2B y no conoce el `partnerId`: el puente `partner_profiles.erp_account_id`
 * va en el otro sentido y nace nulo. Sin esta búsqueda, enlazar los dos sistemas exigía que alguien
 * copiara un identificador a mano de una pantalla a otra, que es como se enlazaban antes las
 * identidades de comercio — y el resultado fue un `user_id` nulo para siempre por un dedazo.
 *
 * Exige AL MENOS uno de los dos criterios: sin ninguno, esto sería un listado completo de comercios
 * con otro nombre.
 */
export const findPartnerQuerySchema = z
  .object({
    erpAccountId: z.string().trim().min(1).max(64).optional(),
    taxId: z.string().trim().min(1).max(40).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(25),
  })
  .refine((value) => Boolean(value.erpAccountId ?? value.taxId), {
    message: 'Indica erpAccountId o taxId: esta búsqueda no lista comercios.',
    path: ['erpAccountId'],
  });
export type FindPartnerQueryDto = z.infer<typeof findPartnerQuerySchema>;

/**
 * El enlace con la cuenta del ERP, escrito por el ERP al contratar.
 *
 * Es de una vía y no se reescribe: un expediente que ya apunta a una cuenta y de pronto apunta a
 * otra son dos verificaciones distintas del mismo comercio, y la que gane será la que alguien mire
 * primero. Cambiarlo es un caso nuevo, no un PATCH.
 */
export const linkErpAccountSchema = z
  .object({
    erpAccountId: z.string().trim().min(1).max(64),
  })
  .strict();
export type LinkErpAccountDto = z.infer<typeof linkErpAccountSchema>;

/**
 * La petición de verificación. `reason` es opcional y sólo deja constancia de POR QUÉ se pidió
 * —«el ERP dio de alta la cuenta», «se reintenta tras subir el poder»—: quién y cuándo ya los
 * registra la auditoría de la llamada.
 */
export const requestKybReviewSchema = z
  .object({
    reason: z.string().trim().min(3).max(200).optional(),
  })
  .strict();
export type RequestKybReviewDto = z.infer<typeof requestKybReviewSchema>;

/**
 * Decisión sobre el expediente de un comercio.
 *
 * Rechazar exige motivo y aprobar no: el motivo de un sí es el expediente completo que se acaba de
 * revisar, mientras que un comercio rechazado sin explicación es el que vuelve a preguntar —y seis
 * meses después nadie sabe qué se miró—. Lo dice el propio `decide()` del servicio; aquí se hace
 * cumplir en el borde, antes de tocar la base.
 */
export const decidePartnerSchema = z
  .object({
    approved: z.boolean(),
    rejectionReason: z.string().trim().min(3).max(500).optional(),
  })
  .refine((value) => value.approved || value.rejectionReason !== undefined, {
    message: 'Rechazar un expediente exige declarar el motivo.',
    path: ['rejectionReason'],
  });
export type DecidePartnerDto = z.infer<typeof decidePartnerSchema>;

/**
 * Publicar una versión del contrato legal por defecto.
 *
 * `version` NO se acepta: la calcula el backend. Pedirla desde fuera invita a repetirla o a
 * saltársela, y el número de versión de un contrato es justo lo que después se cita en una
 * reclamación.
 */
export const publishContractTemplateSchema = z
  .object({
    templateCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_-]{3,60}$/, 'El código va en mayúsculas, sin espacios: identifica el MISMO contrato entre versiones.'),
    name: z.string().trim().min(3).max(160),
    body: z.string().trim().min(50).max(200_000),
    /** Publicar sin marcar por defecto sirve para preparar un texto antes de que entre en vigor. */
    makeDefault: z.boolean().default(true),
  })
  .strict();
export type PublishContractTemplateDto = z.infer<typeof publishContractTemplateSchema>;
