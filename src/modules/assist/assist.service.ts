/**
 * @file Servicio de aplicación: orquesta el chat del asistente en el móvil y en los portales.
 * @business Esta pieza responde dudas de uso de la app y de los portales sin hacer esperar a una persona del equipo.
 * @system reenvía la pregunta al servicio de IA y traduce sus desenlaces al lenguaje de quien pregunta.
 */
import { createHash } from 'node:crypto';
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
import type {
  AssistChatDto,
  AssistChatView,
  AssistConversationView,
  AssistTurnView,
  PortalAssistChatDto,
  PortalAssistChatView,
  PortalAssistSurface,
} from './assist.schemas.js';

/** A quién se le habla. Cambia la salida que se le ofrece cuando el asistente falla, no el diagnóstico. */
export type AssistAudience = 'cliente' | 'personal' | 'comercio';

/**
 * El error amable. Dice qué puede hacer la persona y no qué proceso falló: nada de «servicio»,
 * «endpoint» ni códigos. La salida depende de quién lee: el cliente tiene el chat humano de
 * Soporte; el personal interno no tiene a quién escalar una duda de uso, así que se le dice que
 * vuelva a probar; el comercio tiene «Soporte y tutoriales» en su propio portal.
 */
const NO_DISPONIBLE: Record<AssistAudience, string> = {
  cliente: 'El asistente no está disponible en este momento. Puedes hablar con una persona desde Soporte.',
  personal: 'El asistente no está disponible en este momento. Prueba de nuevo en unos minutos.',
  comercio: 'El asistente no está disponible en este momento. Puedes escribir a soporte desde «Soporte y tutoriales» del portal.',
};

/** Apagado responde 404 en toda la superficie; la app y los portales lo leen como «esconde el botón». */
const APAGADO = { code: 'ASSIST_DISABLED', message: 'El asistente no está disponible.' };

/** Quién pregunta desde un portal, YA autorizado para esa superficie por el controlador. */
export type PortalAssistActor = {
  surface: PortalAssistSurface;
  tenantId: string;
  userId: string;
  audience: Exclude<AssistAudience, 'cliente'>;
};

/** Por dónde viaja una consulta: la referencia opaca, la superficie (sólo portales) y a quién se le habla. */
type Canal = { actorRef: string; surface?: PortalAssistSurface; audience: AssistAudience };

type Pregunta = Pick<AssistChatDto, 'prompt' | 'clientMessageId' | 'conversationId'> & { screen?: string };

@Injectable()
export class AssistService {
  private readonly logger = new Logger(AssistService.name);

  constructor(private readonly client: AiAssistClient) {}

  /** Pregunta al asistente y devuelve la respuesta ya guardada en la conversación del cliente. */
  async chat(tenantId: string, customerId: string, dto: AssistChatDto): Promise<AssistChatView> {
    const json = await this.preguntar(canalMovil(tenantId, customerId), dto);
    return vistaDeRespuesta(json, 'cliente');
  }

  /**
   * Lo mismo desde un portal. Además de la vista del móvil se reenvía `mode: 'sin-ia'`: en un
   * portal se le dice a quien trabaja que la respuesta salió del catálogo y no del modelo. El
   * móvil no lo recibe porque su contrato no lo tiene.
   */
  async chatEnPortal(actor: PortalAssistActor, dto: PortalAssistChatDto): Promise<PortalAssistChatView> {
    const json = await this.preguntar(canalDePortal(actor), dto);
    const vista = vistaDeRespuesta(json, actor.audience);
    return json.mode === 'sin-ia' ? { ...vista, mode: 'sin-ia' } : vista;
  }

  /**
   * La conversación vigente, para rehidratar la hoja al abrirla.
   *
   * Un historial que no se puede leer NO impide preguntar: se contesta el hilo vacío y queda en el
   * log. Propagar aquí un error convertiría un tropiezo de lectura en una hoja de chat rota, justo
   * cuando el chat en sí funciona.
   */
  async conversation(tenantId: string, customerId: string): Promise<AssistConversationView> {
    return this.leerConversacion(canalMovil(tenantId, customerId));
  }

  /** La conversación vigente de ESA superficie: cada portal tiene su hilo aunque la persona sea la misma. */
  async conversationEnPortal(actor: PortalAssistActor): Promise<AssistConversationView> {
    return this.leerConversacion(canalDePortal(actor));
  }

  private async preguntar(canal: Canal, dto: Pregunta): Promise<Record<string, unknown>> {
    this.exigirEncendido(canal.audience);
    const cuerpo = {
      prompt: dto.prompt,
      clientMessageId: dto.clientMessageId,
      ...(dto.conversationId ? { conversationId: dto.conversationId } : {}),
      ...(dto.screen ? { screen: dto.screen } : {}),
    };
    // Sin superficie la llamada es exactamente la del móvil: la cabecera sólo existe en los portales.
    const resultado = await this.llamar(canal.audience, () =>
      canal.surface ? this.client.chat(canal.actorRef, cuerpo, canal.surface) : this.client.chat(canal.actorRef, cuerpo),
    );
    if (resultado.ok) return resultado.json;
    throw this.traducirFallo(resultado, canal.audience);
  }

  private async leerConversacion(canal: Canal): Promise<AssistConversationView> {
    this.exigirEncendido(canal.audience);
    let resultado: AiAssistResult;
    try {
      resultado = canal.surface
        ? await this.client.latestConversation(canal.actorRef, canal.surface)
        : await this.client.latestConversation(canal.actorRef);
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
  private exigirEncendido(audience: AssistAudience): void {
    if (!env.ASSIST_ENABLED) throw new NotFoundException(APAGADO);
    if (!this.client.isConfigured) {
      // Encendido a medias no debería pasar el arranque (`env.assist.checks.ts`); si pasa, que se
      // vea como indisponibilidad y no como un botón que desaparece sin explicación.
      this.logger.error('ASSIST_ENABLED=true sin ATLAS_AI_SERVICE_URL/KEY: el asistente no puede contestar.');
      throw indisponible(audience);
    }
  }

  /** Un servicio de IA que no contesta (red, timeout) es indisponibilidad, nunca un 500 crudo. */
  private async llamar(audience: AssistAudience, peticion: () => Promise<AiAssistResult>): Promise<AiAssistResult> {
    try {
      return await peticion();
    } catch (error) {
      this.logger.warn(`El servicio de IA no respondió: ${describir(error)}`);
      throw indisponible(audience);
    }
  }

  /**
   * Cada desenlace del servicio de IA, en el idioma de quien pregunta.
   *
   * - 400: el texto ya viene redactado para la persona (datos sensibles, tope de tamaño); se reenvía.
   * - 404: el interruptor del servicio apagado → mismo 404 que el de Core.
   * - 409: la MISMA consulta sigue en curso; el móvil reintenta en silencio con el mismo
   *   `clientMessageId` y recoge la respuesta guardada. No es un error de la persona.
   * - 429: hay tope de llamadas simultáneas al proveedor; se pide esperar unos segundos.
   * - 401/403: la clave de servicio no coincide. Es configuración nuestra, jamás culpa del cliente:
   *   se registra como error y la persona ve indisponibilidad.
   * - resto (5xx): indisponibilidad amable, con la salida que corresponde a su audiencia.
   */
  private traducirFallo(resultado: AiAssistResult, audience: AssistAudience): HttpException {
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
        return indisponible(audience);
      default:
        this.logger.warn(`El servicio de IA respondió ${resultado.status}.`);
        return indisponible(audience);
    }
  }
}

function indisponible(audience: AssistAudience): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: 'ASSIST_UNAVAILABLE', message: NO_DISPONIBLE[audience] });
}

/**
 * La referencia opaca con la que el servicio de IA particiona conversaciones. Lleva el inquilino
 * para que el mismo UUID en dos inquilinos jamás comparta hilo; nunca lleva el JWT.
 */
function canalMovil(tenantId: string, customerId: string): Canal {
  return { actorRef: `${tenantId}:${customerId}`, audience: 'cliente' };
}

/** Lo que el servicio de IA admite en un segmento de la referencia, sin `:` que la partiría. */
const SEGMENTO_SEGURO = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `<superficie>:<tenantId>:<userId>`. La superficie va DELANTE para que la misma persona tenga un
 * hilo por portal: lo que preguntó en Tableros no aparece al abrir el asistente del Motor, y un
 * usuario de comercio nunca comparte hilo con uno interno aunque sus ids coincidan.
 *
 * El servicio exige `[A-Za-z0-9:_-]{1,128}`. Un id con otros caracteres (un `sub` con `@` o `.`)
 * se sustituye por un hash corto y estable: sigue identificando a la misma persona sin viajar tal
 * cual y sin partir la referencia.
 */
function canalDePortal(actor: PortalAssistActor): Canal {
  const id = SEGMENTO_SEGURO.test(actor.userId) ? actor.userId : createHash('sha256').update(actor.userId).digest('hex').slice(0, 16);
  return { actorRef: `${actor.surface}:${actor.tenantId}:${id}`, surface: actor.surface, audience: actor.audience };
}

/**
 * Lo que se le enseña a quien pregunta: el texto, si amerita ofrecer el chat humano, y los
 * identificadores para continuar el hilo. `usage`, modelo y latencia se quedan en el servidor.
 */
function vistaDeRespuesta(json: Record<string, unknown>, audience: AssistAudience): AssistChatView {
  const reply = typeof json.reply === 'string' ? json.reply.trim() : '';
  if (!reply) {
    // Un 200 sin texto no es una respuesta: mejor indisponibilidad honesta que una burbuja vacía.
    throw indisponible(audience);
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
