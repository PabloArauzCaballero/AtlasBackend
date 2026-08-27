/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza convierte un comercio declarado en un partner verificable, con locales, cobro y terminales trazables.
 * @system valida en el borde el expediente del partner, sus QR de cobro y sus terminales de punto de venta.
 */
import { z } from 'zod';
import { PARTNER_BUSINESS_CATEGORIES, normalizeBusinessCategory } from './partner-business-categories.js';

/**
 * NIT boliviano: sólo dígitos, entre 7 y 15.
 *
 * Se valida la FORMA y no se pretende validar la existencia: comprobar que un NIT está activo es
 * una consulta al SIN, no una expresión regular, y fingir aquí esa comprobación daría una falsa
 * sensación de verificación. Lo que esto impide es lo que sí se puede impedir en el borde: un
 * campo con letras, con puntos o vacío entrando al expediente como si fuera un identificador
 * tributario.
 */
const nitSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{7,15}$/, 'El NIT debe tener entre 7 y 15 dígitos, sin puntos ni guiones.');

/**
 * El rubro, aceptado en cualquier caja y guardado siempre en su forma canónica.
 *
 * La normalización va ANTES de validar: asi `retail`, `Retail` y `RETAIL` son el mismo rubro —que
 * es lo que un usuario espera— sin que por eso entre a la base cualquier cadena. Lo que no está en
 * el catálogo se rechaza aqui, con la lista completa en el mensaje: quien se equivoca necesita
 * saber cuáles son las opciones, no solo que la suya no vale.
 */
const businessCategorySchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .transform((value) => normalizeBusinessCategory(value))
  .refine((value): value is (typeof PARTNER_BUSINESS_CATEGORIES)[number] => value !== null, {
    message: `El rubro debe ser uno de: ${PARTNER_BUSINESS_CATEGORIES.join(', ')}.`,
  });

export const startPartnerOnboardingSchema = z.object({
  legalName: z.string().trim().min(3).max(200),
  tradeName: z.string().trim().min(1).max(200).optional(),
  taxId: nitSchema,
  /** Matrícula de comercio. Opcional al iniciar: se completa antes de enviar el expediente. */
  commercialRegistry: z.string().trim().min(3).max(60).optional(),
  businessCategory: businessCategorySchema.optional(),
  contactEmail: z.string().trim().email().max(180),
  contactPhone: z.string().trim().min(6).max(40).optional(),
});
export type StartPartnerOnboardingDto = z.infer<typeof startPartnerOnboardingSchema>;

/**
 * Lo que el comercio puede corregir de su ficha DESPUES de estar aprobado.
 *
 * Deliberadamente no incluye razon social, NIT ni matricula: son los datos contra los que el
 * analista verifico el expediente, y dejar que cambien despues de la firma convierte la aprobacion
 * en una aprobacion de otra empresa. Lo que si cambia con el negocio vivo es como se presenta
 * —nombre de fachada, rubro, telefono de contacto—, y hoy eso solo se podia declarar al abrir el
 * expediente: un comercio que se equivocaba de rubro se quedaba mal catalogado para siempre.
 */
export const updateCommercialProfileSchema = z
  .object({
    tradeName: z.string().trim().min(1).max(200).optional(),
    businessCategory: businessCategorySchema.optional(),
    contactPhone: z.string().trim().min(6).max(40).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'No hay ningún cambio que aplicar.',
  });
export type UpdateCommercialProfileDto = z.infer<typeof updateCommercialProfileSchema>;

export const partnerIdParamsSchema = z.object({
  partnerId: z.string().regex(/^[1-9][0-9]*$/, 'Identificador de partner inválido.'),
});
export type PartnerIdParamsDto = z.infer<typeof partnerIdParamsSchema>;

export const branchIdParamsSchema = partnerIdParamsSchema.extend({
  branchId: z.string().regex(/^[1-9][0-9]*$/, 'Identificador de sucursal inválido.'),
});
export type BranchIdParamsDto = z.infer<typeof branchIdParamsSchema>;

/** Un terminal concreto: cuelga del partner, no de la sucursal, porque puede cambiar de local. */
export const terminalIdParamsSchema = partnerIdParamsSchema.extend({
  terminalId: z.string().regex(/^[1-9][0-9]*$/, 'Identificador de terminal inválido.'),
});
export type TerminalIdParamsDto = z.infer<typeof terminalIdParamsSchema>;

export const legalRepresentativeSchema = z.object({
  fullName: z.string().trim().min(3).max(200),
  documentType: z.enum(['ci', 'passport', 'foreign_id']),
  documentNumber: z.string().trim().min(3).max(60),
  /**
   * Objeto del poder notarial ya subido. Opcional aquí y EXIGIDO al enviar el expediente: se
   * permite guardar al representante antes de tener el papel escaneado, que es como ocurre de
   * verdad, pero no se puede enviar a revisión una representación sin respaldo.
   */
  powerOfAttorneyKey: z.string().trim().min(8).max(400).optional(),
});
export type LegalRepresentativeDto = z.infer<typeof legalRepresentativeSchema>;

/**
 * Permiso de subida para un documento del expediente.
 *
 * Hoy sólo el poder notarial, y por eso `documentKind` es una lista cerrada de uno: el tipo viaja
 * a la RUTA del objeto en el almacenamiento, así que aceptar texto libre dejaría que el cliente
 * eligiera dónde escribe. Se acepta PDF además de imagen porque un poder es un documento
 * escaneado, no una foto de un cartel.
 */
export const partnerDocumentUploadUrlSchema = z.object({
  documentKind: z.enum(['power-of-attorney']),
  contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
});
export type PartnerDocumentUploadUrlDto = z.infer<typeof partnerDocumentUploadUrlSchema>;

export const commercialRegistrySchema = z.object({
  commercialRegistry: z.string().trim().min(3).max(60),
});
export type CommercialRegistryDto = z.infer<typeof commercialRegistrySchema>;

/** El código que llega por correo. Seis dígitos, como el que se emite. */
export const contactVerificationSubmitSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, 'El código son seis dígitos.'),
});
export type ContactVerificationSubmitDto = z.infer<typeof contactVerificationSubmitSchema>;

export const registerBranchSchema = z.object({
  branchCode: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'El código de sucursal admite letras, dígitos, guion y guion bajo.'),
  name: z.string().trim().min(2).max(200),
  addressLine: z.string().trim().min(4).max(300).optional(),
  city: z.string().trim().min(2).max(120).optional(),
  /**
   * Coordenadas del local. Se aceptan sólo dentro del rango válido del planeta: un `0,0` o un
   * `999` entran silenciosamente en cualquier campo numérico y ponen la sucursal en el Golfo de
   * Guinea, que es el fallo clásico de este dato y no lo detecta nadie hasta que se dibuja un mapa.
   */
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  erpBranchId: z.string().trim().min(1).max(64).optional(),
});
export type RegisterBranchDto = z.infer<typeof registerBranchSchema>;

/** Los tipos de imagen que un QR puede tener. Un PDF no se acepta: un QR es una imagen. */
export const QR_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;

export const qrUploadUrlSchema = z.object({
  qrKind: z.enum(['business', 'bank']),
  contentType: z.enum(QR_CONTENT_TYPES),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
});
export type QrUploadUrlDto = z.infer<typeof qrUploadUrlSchema>;

export const registerQrSchema = z
  .object({
    qrKind: z.enum(['business', 'bank']),
    /** Ausente = QR de toda la empresa. Presente = el QR de ese local. */
    branchId: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .optional(),
    /** La ruta que devolvió `upload-url`. El servidor la impone; el cliente sólo la devuelve. */
    storageKey: z.string().trim().min(8).max(400),
    /**
     * Sigla ASFI de la entidad del QR bancario. Es lo que permite cruzarlo con el padrón del
     * regulador y frenar un cobro contra una entidad sin licencia vigente.
     */
    bankInstitutionCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{2,16}$/)
      .optional(),
    /** Cuenta ENMASCARADA. El expediente prueba de quién es la cuenta, no necesita operarla. */
    accountNumberMasked: z.string().trim().min(4).max(40).optional(),
  })
  .refine((value) => value.qrKind !== 'bank' || value.bankInstitutionCode !== undefined, {
    message: 'El QR bancario debe declarar la entidad financiera (sigla ASFI).',
    path: ['bankInstitutionCode'],
  })
  /*
   * La entidad sólo tiene sentido en el bancario. Aceptarla en el del negocio dejaría filas que
   * afirman una relación con un banco que nadie declaró ni verificó.
   */
  .refine((value) => value.qrKind !== 'business' || value.bankInstitutionCode === undefined, {
    message: 'El QR del negocio no lleva entidad financiera.',
    path: ['bankInstitutionCode'],
  });
export type RegisterQrDto = z.infer<typeof registerQrSchema>;

export const registerPosTerminalSchema = z.object({
  terminalSerial: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[A-Za-z0-9-]+$/, 'El serial admite letras, dígitos y guion.'),
  terminalAlias: z.string().trim().min(2).max(120).optional(),
  provider: z.string().trim().min(2).max(80).optional(),
  model: z.string().trim().min(1).max(80).optional(),
});
export type RegisterPosTerminalDto = z.infer<typeof registerPosTerminalSchema>;

export const posTerminalStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'retired']),
});
export type PosTerminalStatusDto = z.infer<typeof posTerminalStatusSchema>;

/**
 * El token que el cliente lee del QR de Atlas pegado en la caja.
 *
 * Es el serial del terminal, y viaja opaco a propósito: el QR no lleva ni el nombre del comercio ni
 * la cuenta donde cobra, así que fotografiarlo no revela nada y cambiarlo por el de otro comercio
 * sólo consigue que el servidor resuelva ese otro comercio —que es lo que el cliente vería en
 * pantalla antes de confirmar—. El mínimo de 8 coincide con el que la app exige al dictarlo a mano.
 */
export const resolveMerchantQrSchema = z
  .object({
    token: z.string().trim().min(8).max(120),
  })
  .strict();
export type ResolveMerchantQrDto = z.infer<typeof resolveMerchantQrSchema>;

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
