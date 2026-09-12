/**
 * @file Contratos Zod de la locución de bienvenida del canal móvil.
 * @business Esta pieza pone la voz de la marca en el momento en que alguien entra a la app.
 * @system valida en el borde lo que llega del móvil y describe lo que se le contesta.
 */
import { z } from 'zod';

/**
 * Estado de la locución tal como lo ve el móvil.
 *
 * Cuatro valores y no los ocho del worker: al teléfono sólo le importa si ya puede reproducir algo,
 * si tiene sentido volver a preguntar, o si hoy no hay saludo. `UNAVAILABLE` **no es un error** y
 * el móvil no debe pintarlo como tal; significa exactamente «entra en silencio».
 */
export const welcomeAudioStateSchema = z.enum(['PENDING', 'READY', 'UNAVAILABLE']);
export type WelcomeAudioState = z.infer<typeof welcomeAudioStateSchema>;

export type WelcomeAudioView = {
  requestId: string;
  status: WelcomeAudioState;
};

/**
 * El identificador de la ejecución en el motor: un UUID.
 *
 * Se valida la forma antes de reenviarlo. Sin esto, una cadena arbitraria del cliente acabaría
 * concatenada en la ruta de una petición al motor, y aunque va codificada, el sitio donde se
 * comprueba la forma de un identificador es el borde por el que entra.
 */
export const welcomeAudioIdParamsSchema = z.object({
  requestId: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F-]{16,64}$/u, 'El identificador de la locución no tiene la forma esperada.'),
});
export type WelcomeAudioIdParamsDto = z.infer<typeof welcomeAudioIdParamsSchema>;
