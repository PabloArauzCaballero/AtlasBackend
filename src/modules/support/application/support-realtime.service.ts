/**
 * @file Servicio de aplicación: el bus efímero que hace que un mensaje aparezca solo.
 * @business Sin esto la conversación exige recargar, y un chat que hay que recargar no es un chat.
 * @system Subject en proceso + puente opcional por Redis; nada de esto es la fuente de verdad.
 */
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { Observable, Subject, filter, map } from 'rxjs';
import { REDIS_CLIENT } from '../../../common/redis/redis.module.js';

/** Canal de Redis por el que viajan los eventos entre instancias de la API. */
const BRIDGE_CHANNEL = 'atlas:support:events';

export type SupportRealtimeEventType =
  | 'message.created'
  | 'message.read'
  | 'agent.typing'
  | 'channel.assigned'
  | 'channel.closed'
  | 'case.status_changed';

export interface SupportRealtimeEvent {
  readonly type: SupportRealtimeEventType;
  readonly tenantId: string;
  readonly channelId: string;
  /** Qué se manda por el hilo. Nunca el cuerpo cifrado ni una nota interna a quien no la puede ver. */
  readonly payload: Record<string, unknown>;
  readonly emittedAt: string;
}

/**
 * Tiempo real que se puede perder sin que se pierda nada.
 *
 * ## Por qué SSE y no WebSocket
 *
 * La conversación de soporte es casi toda de servidor a cliente: los mensajes llegan, y lo que el
 * usuario envía ya tiene su `POST` idempotente. SSE es HTTP normal —atraviesa proxies corporativos,
 * reconecta solo, no necesita otra librería ni otro puerto— y deja el envío por donde ya está
 * probado. WebSocket habría añadido `socket.io`, un canal de escritura paralelo al `POST` y dos
 * formas distintas de escribir el mismo mensaje.
 *
 * ## Por qué el bus NO es la fuente de verdad
 *
 * Si este proceso muere, el que reconecte pide la transcripción por `beforeSequence` y recupera
 * todo: los mensajes están en PostgreSQL, no aquí. Eso es lo que permite que el bus sea un `Subject`
 * en memoria sin ninguna garantía de entrega — perder un evento cuesta un refresco, no un mensaje.
 *
 * ## El puente por Redis
 *
 * Con más de una instancia de API, el cliente puede estar colgado de una y el agente escribir en
 * otra. El puente reenvía los eventos entre ellas. Si Redis no está, el servicio sigue funcionando
 * en proceso: se degrada a «el tiempo real funciona dentro de tu instancia», que es exactamente lo
 * que ocurre hoy en desarrollo, y no rompe nada.
 */
@Injectable()
export class SupportRealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(SupportRealtimeService.name);
  private readonly events = new Subject<SupportRealtimeEvent>();
  private subscriber: Redis | null = null;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {
    this.connectBridge();
  }

  /**
   * Abre la conexión dedicada de escucha.
   *
   * ioredis exige una conexión APARTE para suscribirse: una vez en modo `subscribe` esa conexión ya
   * no admite comandos normales, y reutilizar la del resto del backend dejaría sin Redis a los
   * candados y al rate limiting.
   */
  private connectBridge(): void {
    if (!this.redis) return;
    try {
      this.subscriber = this.redis.duplicate();
      void this.subscriber.subscribe(BRIDGE_CHANNEL).catch((error: unknown) => {
        this.logger.warn(`Sin puente de tiempo real entre instancias: ${String(error)}`);
      });
      this.subscriber.on('message', (_channel: string, raw: string) => this.receiveFromBridge(raw));
      this.subscriber.on('error', () => undefined);
    } catch (error) {
      this.logger.warn(`No se pudo abrir el puente de tiempo real: ${String(error)}`);
      this.subscriber = null;
    }
  }

  private receiveFromBridge(raw: string): void {
    try {
      const event = JSON.parse(raw) as SupportRealtimeEvent;
      if (event?.channelId) this.events.next(event);
    } catch {
      // Un mensaje ilegible en el bus no puede tumbar la entrega del resto.
    }
  }

  /**
   * Emite un evento a quien esté escuchando esta conversación.
   *
   * Nunca falla hacia arriba: el mensaje ya se guardó cuando esto se llama, y un fallo del aviso no
   * puede deshacer lo que el cliente ya vio como enviado.
   */
  emit(event: Omit<SupportRealtimeEvent, 'emittedAt'>): void {
    const full: SupportRealtimeEvent = { ...event, emittedAt: new Date().toISOString() };
    this.events.next(full);

    if (!this.redis) return;
    void this.redis.publish(BRIDGE_CHANNEL, JSON.stringify(full)).catch(() => undefined);
  }

  /** El hilo de una conversación concreta, ya filtrado. */
  streamFor(tenantId: string, channelId: string): Observable<SupportRealtimeEvent> {
    return this.events.asObservable().pipe(filter((event) => event.channelId === channelId && event.tenantId === tenantId));
  }

  /**
   * El hilo tal como lo consume SSE, con el nombre de evento separado del dato.
   *
   * Se emite `data` como objeto y Nest lo serializa: mandar la cadena ya serializada haría que el
   * cliente recibiera JSON dentro de JSON, que es el error clásico de este endpoint.
   */
  sseFor(tenantId: string, channelId: string): Observable<{ type: string; data: Record<string, unknown> }> {
    return this.streamFor(tenantId, channelId).pipe(
      map((event) => ({ type: event.type, data: { ...event.payload, emittedAt: event.emittedAt } })),
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.events.complete();
    if (!this.subscriber) return;
    try {
      await this.subscriber.quit();
    } catch {
      this.subscriber.disconnect();
    }
  }
}
