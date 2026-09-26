/**
 * @file Adaptador de infraestructura: habla con un sistema externo y traduce sus fallos.
 * @business Esta pieza responde dudas de uso de la app sin hacer esperar a una persona del equipo.
 * @system reenvía el chat del asistente a AtlasAIService con la clave de servicio de Core.
 */
import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env.js';

/**
 * Lo que devuelve el servicio de IA, sin interpretar: estado y cuerpo.
 *
 * El cliente NO decide qué significa un 409 o un 429; eso es semántica del asistente y vive en el
 * servicio de aplicación. Aquí sólo se garantiza que un cuerpo no-JSON no reviente y que el estado
 * llegue entero, porque el estado ES el dato útil cuando algo va mal.
 */
export type AiAssistResult = { status: number; ok: boolean; json: Record<string, unknown> };

/**
 * AtlasAIService, visto desde Core.
 *
 * ## Por qué no reutiliza `DecisionEngineClient` ni su transporte
 *
 * Porque no comparte ni credencial ni semántica de reintentos. El transporte del motor reintenta
 * con circuito porque una decisión de crédito que no llega deja un caso colgado; aquí un reintento
 * a ciegas duplicaría llamadas FACTURADAS al proveedor de IA, y la idempotencia por
 * `clientMessageId` ya garantiza que el reintento del MÓVIL —que es el legítimo— recoja la
 * respuesta guardada en vez de generar otra.
 *
 * ## La identidad del cliente viaja como referencia opaca
 *
 * `x-atlas-actor-ref` lleva `tenantId:customerId`, nunca el JWT del usuario: el servicio de IA no
 * verifica sesiones de personas (exige RS256 y este backend firma HS256) y no debe poder hacerse
 * pasar por nadie. Con la referencia le basta para particionar conversaciones.
 */
@Injectable()
export class AiAssistClient {
  private readonly logger = new Logger(AiAssistClient.name);

  /** Sin URL ni clave no hay asistente, y quien llame debe distinguirlo de un servicio caído. */
  get isConfigured(): boolean {
    return Boolean(env.ATLAS_AI_SERVICE_URL && env.ATLAS_AI_SERVICE_KEY);
  }

  /** Pregunta al asistente. La respuesta queda guardada en la conversación del actor. */
  async chat(
    actorRef: string,
    body: { prompt: string; clientMessageId: string; conversationId?: string; screen?: string },
  ): Promise<AiAssistResult> {
    return this.fetchOnce('POST', '/v1/assist/chat', actorRef, body);
  }

  /** La conversación más reciente del actor, para rehidratar la hoja al abrirla. */
  async latestConversation(actorRef: string): Promise<AiAssistResult> {
    return this.fetchOnce('GET', '/v1/assist/conversations/latest', actorRef);
  }

  private async fetchOnce(method: 'GET' | 'POST', path: string, actorRef: string, body?: unknown): Promise<AiAssistResult> {
    const base = (env.ATLAS_AI_SERVICE_URL ?? '').replace(/\/+$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.ATLAS_AI_SERVICE_TIMEOUT_MS);
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          'x-atlas-service-key': env.ATLAS_AI_SERVICE_KEY ?? '',
          'x-atlas-actor-ref': actorRef,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      return { status: response.status, ok: response.ok, json: await this.parseJson(response, path) };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseJson(response: Response, path: string): Promise<Record<string, unknown>> {
    const text = await response.text().catch(() => '');
    if (!text) return {};
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      // Un proxy delante del servicio puede contestar HTML; convertir eso en un error de parseo
      // escondería el código de estado, que es lo que hay que mirar.
      this.logger.warn(`El servicio de IA devolvió un cuerpo no-JSON (${response.status}) en ${path}.`);
    }
    return {};
  }
}
