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
