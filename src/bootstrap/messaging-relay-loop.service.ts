/**
 * @file Bucle del relay del worker de Mensajería (AT-057/AT-059).
 * @business El piloto sólo entrega cuando `context_ownership` lo nombra dueño de Mensajería; mientras
 *   el dueño sea el monolito, el bucle late pero no reclama nada (cercado), y lo dice en el log.
 * @system `setInterval` con `unref()`; cada tick llama a `OutboxRelayService.run` con la identidad
 *   `messaging-worker`. Sin solape: si un tick sigue en curso, el siguiente se salta.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { env } from '../config/env.js';
import { OutboxRelayService, type RelayRunResult } from '../platform/events/outbox-relay.service.js';

export const MESSAGING_OWNER_ID = 'messaging-worker';
export const MESSAGING_CONTEXT = 'messaging';

@Injectable()
export class MessagingRelayLoopService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagingRelayLoopService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastResult: RelayRunResult | null = null;

  constructor(private readonly relay: OutboxRelayService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), env.MESSAGING_RELAY_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Último resultado (para la sonda): `fenced` = el piloto no es dueño todavía. */
  status(): RelayRunResult | null {
    return this.lastResult;
  }

  async tick(): Promise<RelayRunResult | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const result = await this.relay.run({
        tenantId: null,
        limit: env.RUNTIME_JOBS_BATCH_LIMIT,
        workerId: `${MESSAGING_OWNER_ID}-${process.pid}`,
        ownership: { context: MESSAGING_CONTEXT, owner: MESSAGING_OWNER_ID },
      });
      this.lastResult = result;
      return result;
    } catch (error) {
      this.logger.error(`MESSAGING_RELAY_TICK_FAILED: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      this.running = false;
    }
  }
}
