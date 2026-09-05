/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { z } from 'zod';
import { ALLOWED_EVIDENCE_MIME_TYPES, MAX_EVIDENCE_BYTES } from '../../common/storage/document-storage.service.js';
import {
  EMPLOYMENT_STATUS_VALUES,
  MAXIMUM_CUSTOMER_AGE_YEARS,
  MAXIMUM_REFERENCE_CONTACTS,
  MINIMUM_CUSTOMER_AGE_YEARS,
  SOURCE_OF_FUNDS_VALUES,
} from '../customers/customer-eligibility.constants.js';
import { calculateAgeInYears } from '../customers/application/customer-eligibility.evaluator.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD.');

/**
 * Fecha de nacimiento con edad válida.
 *
 * Antes NO existía ninguna validación de edad en el sistema: `birthDate` era opcional en el
 * registro y nada impedía dar de alta a un menor de edad en un backend de originación de crédito.
 */
export const birthDateSchema = isoDate.refine(
  (value) => {
    const age = calculateAgeInYears(value, new Date());
    return Number.isFinite(age) && age >= MINIMUM_CUSTOMER_AGE_YEARS && age <= MAXIMUM_CUSTOMER_AGE_YEARS;
  },
  { message: `La edad declarada debe estar entre ${MINIMUM_CUSTOMER_AGE_YEARS} y ${MAXIMUM_CUSTOMER_AGE_YEARS} años.` },
);

/**
 * Actualización parcial del perfil personal (N2).
 *
 * Todos los campos son opcionales A PROPÓSITO: este endpoint sostiene el guardado parcial, así que
 * valida el FORMATO de lo que llega, no la completitud. La obligatoriedad se verifica al enviar el
 * paquete (`POST .../onboarding/submit`) y en la regla de habilitación, que es donde realmente
 * importa. `.strict()` evita que el frontend crea estar guardando un campo que el backend ignora.
 */
export const updateProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(120).optional(),
    lastName: z.string().trim().min(1).max(120).optional(),
    birthDate: birthDateSchema.optional(),
    genderDeclared: z.enum(['female', 'male', 'other', 'undisclosed']).optional(),
    preferredLanguage: z.enum(['es', 'en', 'qu', 'ay']).optional(),
    marketingOptIn: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Se requiere al menos un campo para actualizar.' });

export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

const positiveAmount = z.number().finite().nonnegative().max(99_999_999);

/**
 * Perfil económico (N3). Se persiste en `customer_attribute_values` contra las definiciones
 * sembradas en `attribute_definitions`, en vez de agregar columnas nuevas a `customers`.
 */
export const financialProfileSchema = z
  .object({
    employmentStatus: z.enum(EMPLOYMENT_STATUS_VALUES).optional(),
    employerName: z.string().trim().min(1).max(180).optional(),
    employmentSeniorityMonths: z.number().int().nonnegative().max(960).optional(),
    monthlyIncomeDeclared: positiveAmount.optional(),
    otherMonthlyIncome: positiveAmount.optional(),
    monthlyExpensesDeclared: positiveAmount.optional(),
    economicActivityCode: z.string().trim().min(1).max(80).optional(),
    sourceOfFunds: z.enum(SOURCE_OF_FUNDS_VALUES).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Se requiere al menos un campo para actualizar.' })
  .refine((value) => value.employmentStatus !== 'employee' || value.employerName !== undefined, {
    message: 'employerName es obligatorio cuando employmentStatus es "employee".',
    path: ['employerName'],
  });

export type FinancialProfileDto = z.infer<typeof financialProfileSchema>;

/**
 * Referencias personales (N4).
 *
 * `consentBasis` es obligatorio y de catálogo cerrado porque el dato pertenece a un TERCERO que no
 * consintió el tratamiento: dejar la base legal implícita convertiría cada referencia en un riesgo
 * regulatorio silencioso.
 */
export const referenceContactSchema = z
  .object({
    relationshipType: z.enum(['family', 'friend', 'coworker', 'employer', 'commercial', 'other']),
    fullName: z.string().trim().min(3).max(180),
    phone: z.string().trim().min(6).max(40),
    consentBasis: z.enum(['customer_declared', 'legitimate_interest', 'reference_informed']),
  })
  .strict();

export const referenceContactsSchema = z.object({
  references: z.array(referenceContactSchema).min(1).max(MAXIMUM_REFERENCE_CONTACTS),
});

export type ReferenceContactsDto = z.infer<typeof referenceContactsSchema>;

export const referenceContactIdParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
  referenceId: z.string().regex(/^[1-9][0-9]*$/),
});

export type ReferenceContactIdParamsDto = z.infer<typeof referenceContactIdParamsSchema>;

/** Alta de un método de contacto adicional o corrección de uno mal escrito (N6). */
export const addContactMethodSchema = z
  .object({
    contactType: z.enum(['phone', 'email']),
    value: z.string().trim().min(6).max(180),
    label: z.string().trim().min(1).max(60).optional(),
  })
  .strict()
  .refine((input) => input.contactType !== 'email' || z.string().email().safeParse(input.value).success, {
    message: 'El valor debe ser un correo electrónico válido cuando contactType es "email".',
    path: ['value'],
  });

export type AddContactMethodDto = z.infer<typeof addContactMethodSchema>;

/** Envío del paquete de onboarding a revisión (N8). */
export const submitOnboardingSchema = z
  .object({
    acknowledgement: z.literal(true, { message: 'Se requiere confirmar que la información declarada es correcta.' }),
  })
  .strict();

export type SubmitOnboardingDto = z.infer<typeof submitOnboardingSchema>;

/**
 * Permiso de subida de evidencia documental (N5).
 *
 * El cliente declara QUÉ va a subir; el servidor decide DÓNDE. `storageKey` desapareció del
 * contrato de entrada a propósito: mientras lo eligiera el cliente, la ruta del objeto era una
 * decisión suya y no del sistema que la custodia.
 */
export const uploadUrlRequestSchema = z
  .object({
    // `bank_statement` entra en la misma custodia cifrada que el carnet: es el documento mas
    // sensible que el cliente entrega —sus movimientos— y no puede viajar por otro camino.
    documentType: z.enum(['identity_front', 'identity_back', 'selfie', 'proof_of_address', 'bank_statement', 'other']),
    contentType: z.enum(ALLOWED_EVIDENCE_MIME_TYPES),
    sizeBytes: z.number().int().positive().max(MAX_EVIDENCE_BYTES),
  })
  .strict();

export type UploadUrlRequestDto = z.infer<typeof uploadUrlRequestSchema>;

/** Resolución de la verificación de identidad y de la evidencia asociada (operaciones). */
export const identityDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reasonCode: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((value) => value.decision === 'approve' || value.notes !== undefined, {
    message: 'Rechazar la identidad exige una nota que lo justifique.',
    path: ['notes'],
  });

export type IdentityDecisionDto = z.infer<typeof identityDecisionSchema>;

/** Descarte de coincidencias en listas restrictivas (cumplimiento). */
export const clearWatchlistMatchesSchema = z
  .object({ reasonCode: z.string().trim().min(1).max(120), notes: z.string().trim().min(1).max(2000) })
  .strict();

export type ClearWatchlistMatchesDto = z.infer<typeof clearWatchlistMatchesSchema>;

/** Job de cierre de onboardings abandonados. */
export const markAbandonedFlowsSchema = z
  .object({
    olderThanDays: z.number().int().positive().max(365).optional(),
    limit: z.number().int().positive().max(2000).optional(),
  })
  .strict();

export type MarkAbandonedFlowsDto = z.infer<typeof markAbandonedFlowsSchema>;

/**
 * Verificación automática de identidad contra el proveedor externo.
 *
 * `documentNumber` viaja en claro porque es lo que el registro estatal necesita para responder, y
 * NO se persiste: se usa para consultar y para comprobar por hash que corresponde al documento ya
 * declarado en el paquete de identidad.
 *
 * NO existe aquí un campo `scenario`. Lo hubo, y era el agujero más grande del flujo automático: un
 * token de rol `customer` podía enviar `scenario: 'happy_path'` y, con el simulador de proveedores
 * activo (el modo por defecto), el registro externo respondía `FOUND / verified`. Es decir, el
 * sujeto evaluado elegía el veredicto de su propia verificación de identidad — el mismo patrón del
 * literal `'123456'` que una auditoría previa ya había retirado del OTP.
 *
 * Forzar un escenario sigue siendo posible donde corresponde: `POST /admin/external-providers/
 * :providerCode/test`, restringido a roles internos.
 */
export const verifyIdentitySchema = z
  .object({
    documentNumber: z.string().trim().min(3).max(30),
    documentComplement: z.string().trim().max(10).optional(),
  })
  .strict();

export type VerifyIdentityDto = z.infer<typeof verifyIdentitySchema>;
