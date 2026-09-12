/**
 * @file Contratos Zod del flujo móvil de verificación de identidad.
 * @business Esta pieza deja que una persona se verifique desde su teléfono con su carnet, sin pasar por una sucursal.
 * @system valida en el borde lo que llega del móvil y describe lo que se le contesta.
 */
import { z } from 'zod';

/**
 * Tope de cada imagen, en caracteres de base64.
 *
 * 8 MiB de base64 son unos 6 MiB de imagen, que es más que suficiente para una
 * foto de carnet de un teléfono actual y menos de lo que un cliente mal hecho
 * mandaría si no hubiera tope. El motor aplica además el suyo
 * (`IDENTITY_MAX_UPLOAD_BYTES`); éste existe para no arrastrar hasta allí un
 * cuerpo que ya se sabe inaceptable.
 */
const MAX_BASE64 = 8 * 1024 * 1024;

/**
 * Base64 de verdad, no «una cadena larga».
 *
 * `Buffer.from(x, 'base64')` ignora en silencio lo que no reconoce, así que sin
 * esta comprobación una cadena cualquiera llegaría al motor como una imagen de
 * trescientos bytes y volvería como «no es un documento»: un mensaje que manda a
 * quien está delante del móvil a repetir una foto que estaba perfectamente bien.
 */
const imagenBase64 = z
  .string()
  .trim()
  .min(64, 'La imagen está vacía o es demasiado pequeña para ser una foto.')
  .max(MAX_BASE64, 'La imagen supera el tamaño máximo admitido.')
  .regex(/^[A-Za-z0-9+/]+={0,2}$/u, 'La imagen no viene codificada en base64.');

export const startIdentityVerificationSchema = z.object({
  /** Anverso del carnet: la cara que lleva el retrato y los datos. */
  documentFront: imagenBase64,
  /**
   * Reverso. Opcional de verdad: aporta la MRZ y sus dígitos de control, pero un
   * anverso legible basta para leer y comparar. Exigirlo dejaría fuera capturas
   * válidas de quien no sabe que hay que fotografiar las dos caras.
   */
  documentBack: imagenBase64.optional(),
  /** Selfie en vivo con la que se compara el retrato del carnet. */
  selfie: imagenBase64,
  /** País emisor del documento. Elige el analizador y el vocabulario. */
  documentCountry: z
    .string()
    .trim()
    .length(2)
    .regex(/^[A-Za-z]{2}$/u)
    .transform((valor) => valor.toUpperCase())
    .default('BO'),
  /**
   * Cliente al que pertenece esta verificación, si ya existe.
   *
   * Opcional porque el flujo móvil verifica ANTES de que el alta esté completa:
   * exigirlo obligaría a crear el cliente con datos que todavía no se han
   * comprobado, que es justo el orden que este flujo evita.
   */
  customerId: z.string().trim().max(40).optional(),
});

export type StartIdentityVerificationDto = z.infer<typeof startIdentityVerificationSchema>;

export const identityVerificationIdParamsSchema = z.object({
  verificationId: z.string().trim().min(1).max(40),
});

export type IdentityVerificationIdParamsDto = z.infer<typeof identityVerificationIdParamsSchema>;

/** Estados que el móvil ve. Son del TRÁMITE, no del motor. */
export const IDENTITY_VERIFICATION_STATES = [
  /** Se aceptó y se está resolviendo. El móvil vuelve a preguntar. */
  'PENDING',
  /** Terminó: la persona es quien dice ser. */
  'VERIFIED',
  /** Terminó: no lo es, o el documento no era admisible. */
  'REJECTED',
  /** Terminó por ahora: lo está mirando una persona. */
  'IN_REVIEW',
  /** No se pudo preguntar. NO es un rechazo, y no debe leerse como uno. */
  'UNAVAILABLE',
] as const;

export type IdentityVerificationState = (typeof IDENTITY_VERIFICATION_STATES)[number];

/**
 * Lo que se le contesta al móvil.
 *
 * No lleva los campos leídos del carnet —nombre, fecha de nacimiento— y eso es
 * deliberado: el móvil pregunta si la persona quedó verificada, no quién es.
 * Devolver el expediente en la respuesta de un endpoint que se consulta en bucle
 * sería repartir datos de identidad por todos los registros del camino.
 */
export type IdentityVerificationView = {
  verificationId: string;
  status: IdentityVerificationState;
  /** Código explicable. Es lo que el móvil traduce a una instrucción concreta. */
  reason: string | null;
  /** Parecido biométrico, cuando lo hubo. */
  similarity: number | null;
  requestedAt: string | null;
  completedAt: string | null;
};
