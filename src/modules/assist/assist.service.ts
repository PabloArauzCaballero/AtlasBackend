/**
 * @file Servicio de aplicación: orquesta el chat del asistente del canal móvil.
 * @business Esta pieza responde dudas de uso de la app sin hacer esperar a una persona del equipo.
 * @system reenvía la pregunta al servicio de IA y traduce sus desenlaces al lenguaje del móvil.
 */
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { env } from '../../config/env.js';
import { AiAssistClient, type AiAssistResult } from './ai-assist.client.js';
import type { AssistChatDto, AssistChatView, AssistConversationView, AssistTurnView } from './assist.schemas.js';

/**
 * El error amable. En la pantalla lo lee un cliente, así que dice qué puede hacer —hablar con una
 * persona— y no qué proceso falló: nada de «servicio», «endpoint» ni códigos.
 */
const NO_DISPONIBLE = 'El asistente no está disponible en este momento. Puedes hablar con una persona desde Soporte.';

/** Apagado responde 404 en toda la superficie; la app lo lee como «esconde el botón». */
const APAGADO = { code: 'ASSIST_DISABLED', message: 'El asistente no está disponible.' };

@Injectable()
export class AssistService {
  private readonly logger = new Logger(AssistService.name);

  constructor(private readonly client: AiAssistClient) {}

  /** Pregunta al asistente y devuelve la respuesta ya guardada en la conversación del cliente. */
  async chat(tenantId: string, customerId: string, dto: AssistChatDto): Promise<AssistChatView> {
    this.exigirEncendido();
    const resultado = await this.llamar(() =>
      this.client.chat(actorRef(tenantId, customerId), {
        prompt: dto.prompt,
        clientMessageId: dto.clientMessageId,
        ...(dto.conversationId ? { conversationId: dto.conversationId } : {}),
        ...(dto.screen ? { screen: dto.screen } : {}),
      }),
    );
    if (resultado.ok) return vistaDeRespuesta(resultado.json);
    throw this.traducirFallo(resultado);
  }

  /**
   * La conversación vigente, para rehidratar la hoja al abrirla.
   *
   * Un historial que no se puede leer NO impide preguntar: se contesta el hilo vacío y queda en el
   * log. Propagar aquí un error convertiría un tropiezo de lectura en una hoja de chat rota, justo
   * cuando el chat en sí funciona.
   */
  async conversation(tenantId: string, customerId: string): Promise<AssistConversationView> {
    this.exigirEncendido();
    let resultado: AiAssistResult;
    try {
      resultado = await this.client.latestConversation(actorRef(tenantId, customerId));
    } catch (error) {
      this.logger.warn(`No se pudo leer la conversación del asistente: ${describir(error)}`);
      return { conversationId: null, turns: [] };
    }
    if (resultado.ok) return vistaDeConversacion(resultado.json);
    // El 404 es el interruptor del OTRO lado apagado: se propaga para que la app esconda el botón.
    if (resultado.status === 404) throw new NotFoundException(APAGADO);
    this.logger.warn(`El servicio de IA respondió ${resultado.status} al leer la conversación.`);
    return { conversationId: null, turns: [] };
  }

  /**
   * `ASSIST_ENABLED` es el interruptor de Core y contesta 404, no 503: apagado no es una avería,
   * es «este despliegue no tiene asistente», y la app lo usa para esconder el botón entero.
   */
  private exigirEncendido(): void {
    if (!env.ASSIST_ENABLED) throw new NotFoundException(APAGADO);
    if (!this.client.isConfigured) {
      // Encendido a medias no debería pasar el arranque (`env.assist.checks.ts`); si pasa, que se
      // vea como indisponibilidad y no como un botón que desaparece sin explicación.
      this.logger.error('ASSIST_ENABLED=true sin ATLAS_AI_SERVICE_URL/KEY: el asistente no puede contestar.');
      throw new ServiceUnavailableException({ code: 'ASSIST_UNAVAILABLE', message: NO_DISPONIBLE });
    }
  }

  /** Un servicio de IA que no contesta (red, timeout) es indisponibilidad, nunca un 500 crudo. */
  private async llamar(peticion: () => Promise<AiAssistResult>): Promise<AiAssistResult> {
    try {
      return await peticion();
    } catch (error) {
      this.logger.warn(`El servicio de IA no respondió: ${describir(error)}`);
      throw new ServiceUnavailableException({ code: 'ASSIST_UNAVAILABLE', message: NO_DISPONIBLE });
    }
  }

  /**
   * Cada desenlace del servicio de IA, en el idioma del móvil.
   *
   * - 400: el texto ya viene redactado para la persona (datos sensibles, tope de tamaño); se reenvía.
   * - 404: el interruptor del servicio apagado → mismo 404 que el de Core.
   * - 409: la MISMA consulta sigue en curso; el móvil reintenta en silencio con el mismo
   *   `clientMessageId` y recoge la respuesta guardada. No es un error de la persona.
   * - 429: hay tope de llamadas simultáneas al proveedor; se pide esperar unos segundos.
   * - 401/403: la clave de servicio no coincide. Es configuración nuestra, jamás culpa del cliente:
   *   se registra como error y la persona ve indisponibilidad.
   * - resto (5xx): indisponibilidad amable.
   */
  private traducirFallo(resultado: AiAssistResult): HttpException {
    const mensaje = mensajeDe(resultado.json);
    switch (resultado.status) {
      case 400:
        return new BadRequestException({ code: 'ASSIST_REJECTED', message: mensaje ?? 'No se pudo enviar tu pregunta.' });
      case 404:
        return new NotFoundException(APAGADO);
      case 409:
        return new ConflictException({ code: 'ASSIST_IN_FLIGHT', message: 'Tu consulta sigue en curso; dame unos segundos.' });
      case 429:
        return new HttpException(
          { code: 'ASSIST_BUSY', message: 'El asistente está atendiendo muchas consultas. Espera unos segundos y vuelve a intentar.' },
          429,
        );
      case 401:
      case 403:
        this.logger.error('El servicio de IA rechazó la clave de servicio de Core: revisar ATLAS_AI_SERVICE_KEY en ambos lados.');
        return new ServiceUnavailableException({ code: 'ASSIST_UNAVAILABLE', message: NO_DISPONIBLE });
      default:
        this.logger.warn(`El servicio de IA respondió ${resultado.status}.`);
        return new ServiceUnavailableException({ code: 'ASSIST_UNAVAILABLE', message: NO_DISPONIBLE });
    }
  }
}

/**
 * La referencia opaca con la que el servicio de IA particiona conversaciones. Lleva el inquilino
 * para que el mismo UUID en dos inquilinos jamás comparta hilo; nunca lleva el JWT.
 */
function actorRef(tenantId: string, customerId: string): string {
  return `${tenantId}:${customerId}`;
}

/**
 * Lo que se le enseña al móvil de una respuesta: el texto, si amerita ofrecer el chat humano, y los
 * identificadores para continuar el hilo. `usage`, modelo y latencia se quedan en el servidor.
 */
function vistaDeRespuesta(json: Record<string, unknown>): AssistChatView {
  const reply = typeof json.reply === 'string' ? json.reply.trim() : '';
  if (!reply) {
    // Un 200 sin texto no es una respuesta: mejor indisponibilidad honesta que una burbuja vacía.
    throw new ServiceUnavailableException({ code: 'ASSIST_UNAVAILABLE', message: NO_DISPONIBLE });
  }
  return {
    reply,
    suggestHandoff: json.suggestHandoff === true,
    conversationId: typeof json.conversationId === 'string' ? json.conversationId : null,
    turnId: typeof json.turnId === 'string' ? json.turnId : null,
  };
}

function vistaDeConversacion(json: Record<string, unknown>): AssistConversationView {
  const turnsCrudos = Array.isArray(json.turns) ? json.turns : [];
  const turns: AssistTurnView[] = [];
  for (const crudo of turnsCrudos) {
    if (!crudo || typeof crudo !== 'object') continue;
    const turno = crudo as Record<string, unknown>;
    if (typeof turno.turnId !== 'string' || typeof turno.prompt !== 'string' || typeof turno.reply !== 'string') continue;
    turns.push({
      turnId: turno.turnId,
      prompt: turno.prompt,
      reply: turno.reply,
      suggestHandoff: turno.suggestHandoff === true,
      createdAt: typeof turno.createdAt === 'string' ? turno.createdAt : '',
    });
  }
  return { conversationId: typeof json.conversationId === 'string' ? json.conversationId : null, turns };
}

/** El `message` del cuerpo de error de Nest, si vino y es texto. */
function mensajeDe(json: Record<string, unknown>): string | null {
  if (typeof json.message === 'string' && json.message.trim()) return json.message;
  return null;
}

function describir(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
