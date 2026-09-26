/**
 * @file Controlador HTTP: receptor S2S de los eventos del outbox del ERP (P-14 · B20).
 * @business Cierra el circuito ERP → Core: la cobertura que ATLAS pagó y lo que se recuperó llegan a
 *   Core una sola vez aunque el ERP reintente. El 2xx es el ACK duradero: sólo sale tras el commit.
 * @system Pública respecto al guard de SESIÓN (quien llama es un servicio, no una persona); `SignedEventGuard` con
 *   `@SignedEventSource('atlas-erp')` es la regla de autorización (firma HMAC + ventana anti-replay).
 *   Contrato: contracts/atlas-integration-v1 (sobre `atlas.erp.outbox/1`). 400 (sobre) y 422 (payload)
 *   = el evento, tal cual, no se aceptará nunca (el ERP lo manda a DEAD, visible); 401/503 = configuración (el ERP reintenta).
 */
import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { EVENT_KEY_HEADER } from '../../platform/security/signed-event.js';
import { ErpEventInboxService } from './erp-event-inbox.service.js';
import { integrationEnvelopeSchema, type IntegrationEnvelope } from './integration-envelope.schemas.js';
import { SignedEventGuard, SignedEventSource } from './signed-event.guard.js';

export const ERP_EVENTS_PATH = 'internal/integration/erp/events';

/** Un backlog del ERP que converge tras una caída llega en ráfaga: el tope general (100/min) lo frenaría. */
const RECEIVER_RATE_LIMIT = { default: { limit: 6_000, ttl: 60_000 } };

@Public()
@ApiExcludeController()
@UseGuards(SignedEventGuard)
@SignedEventSource('atlas-erp')
@Controller('internal/integration/erp')
export class ErpEventsController {
  constructor(private readonly inbox: ErpEventInboxService) {}

  @Post('events')
  @HttpCode(HttpStatus.OK)
  @Throttle(RECEIVER_RATE_LIMIT)
  async receive(
    @Headers(EVENT_KEY_HEADER) eventKeyHeader: string | undefined,
    @Body(new ZodValidationPipe(integrationEnvelopeSchema)) envelope: IntegrationEnvelope,
  ): Promise<{ eventKey: string; outcome: string }> {
    if (eventKeyHeader && eventKeyHeader !== envelope.eventKey) throw new BadRequestException('EVENT_KEY_HEADER_MISMATCH');
    const { outcome } = await this.inbox.receive(envelope);
    return { eventKey: envelope.eventKey, outcome };
  }
}
