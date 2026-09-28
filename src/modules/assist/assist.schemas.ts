/**
 * @file Contratos Zod de Atlas Assist en el canal móvil.
 * @business Esta pieza responde dudas de uso de la app sin hacer esperar a una persona del equipo.
 * @system valida en el borde lo que llega del móvil y describe lo que se le contesta.
 */
import { z } from 'zod';

/**
 * Desde qué pantalla escribe la persona. Es el MISMO vocabulario que el catálogo del servicio de
 * IA (`ASSIST_SCREENS` en AtlasAIService): sirve para que «aquí» y «esta pantalla» signifiquen
 * algo, y nada más. No es telemetría ni lleva datos de la cuenta.
 */
export const ASSIST_SCREENS = ['inicio', 'escanear', 'pagos', 'avisos', 'perfil', 'otra'] as const;
export type AssistScreen = (typeof ASSIST_SCREENS)[number];

/**
 * Lo que el móvil manda al preguntar.
 *
 * `clientMessageId` es la clave de idempotencia del mensaje: el móvil REUSA la misma al reintentar,
 * y así un timeout seguido de reintento recoge la respuesta ya guardada en vez de pagar una segunda
 * llamada al proveedor. Los topes de tamaño son los del servicio de IA; validarlos aquí evita
 * pagarle una petición a quien ya sabemos que va a recibir un 400.
 */
export const assistChatSchema = z.object({
  prompt: z.string().trim().min(1, 'Escribe tu pregunta.').max(2000, 'La pregunta es demasiado larga (máximo 2000 caracteres).'),
  clientMessageId: z.string().uuid('clientMessageId debe ser un UUID.'),
  conversationId: z.string().uuid('conversationId debe ser un UUID.').optional(),
  screen: z.enum(ASSIST_SCREENS).optional(),
});
export type AssistChatDto = z.infer<typeof assistChatSchema>;

/** La respuesta del asistente tal como la ve el móvil. Sin `usage` ni modelo: son del servidor. */
export type AssistChatView = {
  reply: string;
  /** Si la respuesta amerita ofrecer el chat humano en primer plano (reclamos, fraude, «una persona»). */
  suggestHandoff: boolean;
  conversationId: string | null;
  turnId: string | null;
};

/**
 * Los portales en los que vive el asistente, una «superficie» por audiencia. Es el MISMO
 * vocabulario que `PORTAL_SURFACES` en AtlasAIService: cada superficie tiene allí su propio
 * catálogo de hechos y su propio historial. La app del cliente no está en la lista a propósito:
 * es `consumer-app` y llega por `/mobile/assist/*` sin cabecera de superficie.
 */
export const PORTAL_ASSIST_SURFACES = ['admin-portal', 'erp-staff', 'merchant-portal', 'risk-portal', 'dashboards'] as const;
export type PortalAssistSurface = (typeof PORTAL_ASSIST_SURFACES)[number];

/** La única superficie de un usuario de comercio. Las demás son del personal interno. */
export const MERCHANT_ASSIST_SURFACE: PortalAssistSurface = 'merchant-portal';

/**
 * En qué sección del portal está la persona: «Solicitudes», «Contabilidad › Cierres».
 *
 * A diferencia del móvil no es un catálogo cerrado —los portales tienen cientos de pantallas y
 * cambian más rápido que este contrato—, así que se acota por FORMA: corto y sólo con lo que
 * aparece en un título de menú. Así no se cuela un párrafo, una URL con parámetros ni un dato de
 * la cuenta por el campo que el asistente lee como «aquí».
 */
// `\p{M}`: una tilde puede llegar como letra + acento combinado (NFD) y sigue siendo una tilde.
const SECCION_DE_PORTAL = /^[\p{L}\p{M}\p{N} ›/·_().,-]+$/u;

export const portalAssistScreenSchema = z
  .string()
  .trim()
  .min(1, 'screen no puede estar vacía.')
  .max(80, 'screen admite hasta 80 caracteres.')
  .regex(SECCION_DE_PORTAL, 'screen sólo admite letras, números, espacios y › / · _ - ( ) . ,');

const portalAssistSurfaceSchema = z.enum(PORTAL_ASSIST_SURFACES, {
  error: `surface debe ser una de: ${PORTAL_ASSIST_SURFACES.join(', ')}.`,
});

/**
 * Lo que un portal manda al preguntar: el contrato del móvil con la superficie delante y la
 * sección en texto libre acotado. Los topes de `prompt` y la idempotencia por `clientMessageId`
 * son los mismos, porque el servicio de IA de detrás es el mismo.
 */
export const portalAssistChatSchema = assistChatSchema.omit({ screen: true }).extend({
  surface: portalAssistSurfaceSchema,
  screen: portalAssistScreenSchema.optional(),
});
export type PortalAssistChatDto = z.infer<typeof portalAssistChatSchema>;

export const portalAssistConversationQuerySchema = z.object({ surface: portalAssistSurfaceSchema });
export type PortalAssistConversationQueryDto = z.infer<typeof portalAssistConversationQuerySchema>;

/**
 * La respuesta en un portal: la del móvil y, si el servicio contestó sin modelo (proveedor caído o
 * tope diario agotado), `mode: 'sin-ia'` para que el portal lo diga en vez de fingir que pensó.
 */
export type PortalAssistChatView = AssistChatView & { mode?: 'sin-ia' };

/** Un turno ya guardado, para rehidratar la hoja al abrirla. */
export type AssistTurnView = {
  turnId: string;
  prompt: string;
  reply: string;
  suggestHandoff: boolean;
  createdAt: string;
};

export type AssistConversationView = {
  conversationId: string | null;
  turns: AssistTurnView[];
};
