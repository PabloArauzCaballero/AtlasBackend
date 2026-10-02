/**
 * @file Adaptador HTTP: la vuelta del motor de decision cuando un analista resuelve una revision.
 * @business Cierra el circuito: aprobar la identidad en el motor deja al cliente verificado aqui.
 * @system autenticado con una clave compartida, no con sesion: quien llama es un servicio.
 */
import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, NotFoundException, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { IdentityManualReviewOutcomeService } from './application/identity-manual-review-outcome.service.js';
import { CustomerVerificationRepository } from './repositories/customer-verification.repository.js';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { assertEngineCallbackKey, ENGINE_CALLBACK_HEADER } from '../../common/utils/auth/engine-callback-key.util.js';

/**
 * La resolucion de una revision manual, de vuelta desde el motor.
 *
 * Existe porque hasta ahora no volvia. El analista aprobaba la identidad en el motor, el caso
 * quedaba `RESOLVED_APPROVED` alli, y aqui el intento seguia `IN_REVIEW` para siempre: el cliente
 * no podia pedir credito y nada avisaba de que faltaba un paso. Aplicar el resultado exigia que
 * alguien llamase a mano a otro endpoint, cosa que nadie hace porque nadie sabe que hay que hacerla.
 *
 * El motor no sabe de que CLIENTE es el caso —no tiene por que saberlo—, solo de que ejecucion. El
 * puente es `executionId`, que este lado guarda en el intento al pedirle la decision.
 *
 * Se autentica con clave compartida y no con sesion a proposito: quien llama es un servicio, no una
 * persona. Sin clave configurada el endpoint responde 401 en vez de quedar abierto: un circuito de
 * identidad que se puede cerrar sin credencial es peor que uno que no se cierra.
 */
/*
 * `@Public()` respecto al guard de SESIÓN, que no es lo mismo que abierto.
 *
 * Quien llama es el motor de decisión, un servicio: no tiene sesión de persona que ofrecer, y se
 * identifica con la clave compartida `x-engine-callback-key` que el propio handler exige debajo
 * —sin clave configurada responde 401 en vez de quedar abierto—. Con `JwtAuthGuard` global, sin
 * esta marca el guard rechazaría la llamada antes de que el handler pudiera comprobar la clave, y
 * el circuito de la revisión manual volvería a quedarse sin cerrar.
 */
@Public()
@ApiExcludeController()
@Controller('internal/identity')
export class IdentityReviewCallbackController {
  constructor(
    private readonly outcome: IdentityManualReviewOutcomeService,
    private readonly verifications: CustomerVerificationRepository,
  ) {}

  @Post('manual-review-callback')
  @HttpCode(HttpStatus.OK)
  async aplicar(
    @CurrentTenant() tenantId: string,
    @Headers(ENGINE_CALLBACK_HEADER) clave: string | undefined,
    @Body()
    body: {
      executionId?: string;
      /** El id del intento (`correlationId` de la ejecución) y el `requestId`: respaldo si el intento no guardó `executionId`. */
      correlationId?: string;
      requestId?: string;
      decision?: string;
      reason?: string;
      resolvedByInternalUserId?: string;
    },
  ) {
    // Misma regla y misma comparación en tiempo constante que crédito y riesgo.
    assertEngineCallbackKey(clave);

    const executionId = body.executionId?.trim();
    if (!executionId) throw new BadRequestException('Falta executionId.');
    if (body.decision !== 'APPROVE' && body.decision !== 'DECLINE') {
      /*
       * `CANCEL` no es una decision sobre la identidad: el caso se retira sin resolverla, y el
       * intento tiene que quedarse como esta para que alguien vuelva a mirarlo.
       */
      return { applied: false, reason: 'DECISION_NO_APLICABLE' };
    }

    const revisadoPor = /^[1-9][0-9]*$/u.test(body.resolvedByInternalUserId ?? '') ? (body.resolvedByInternalUserId as string) : null;
    const decision = body.decision === 'APPROVE' ? 'approved' : 'rejected';
    const notes = body.reason ?? 'Resuelto en el motor de decision.';

    const destino = await this.localizar(tenantId, executionId, body);
    if (!destino) throw new NotFoundException(`Ningun intento de identidad nacio de la ejecucion ${executionId}.`);
    const resolucion = { tenantId, decision, reviewedByInternalUserId: revisadoPor, notes } as const;
    return 'attemptId' in destino
      ? this.outcome.apply({ ...resolucion, attemptId: destino.attemptId })
      : this.outcome.applyForCustomer({ ...resolucion, customerId: destino.customerId });
  }

  /**
   * A quién se aplica la decisión: el intento por `executionId`; si no lo guardó, por `correlationId`
   * (id del intento) y, en último término, el cliente que lleva el `requestId`.
   *
   * RESPALDO: pasa cuando el Motor tardó más que el plazo del móvil. El intento se marcó `UNAVAILABLE`
   * sin conocer la ejecución, pero el Motor la terminó y abrió su caso; aprobarlo allí daba 404 y la
   * aprobación no llegaba nunca al expediente (cliente 53 de TEST, 2026-10-01). El `tenantId` va en la
   * búsqueda, no se comprueba después, y el `correlationId` sólo se consulta si es un id numérico.
   */
  private async localizar(
    tenantId: string,
    executionId: string,
    body: { correlationId?: string; requestId?: string },
  ): Promise<{ attemptId: string } | { customerId: string } | null> {
    const porEjecucion = await this.verifications.findAttemptByExecutionId(tenantId, executionId);
    if (porEjecucion) return { attemptId: String(porEjecucion.id) };

    const correlationId = body.correlationId?.trim() ?? '';
    if (/^[1-9][0-9]*$/u.test(correlationId)) {
      const porIntento = await this.verifications.findAttemptById(tenantId, correlationId);
      if (porIntento?.customerId) return { attemptId: String(porIntento.id) };
    }
    const cliente = /^identity-([1-9][0-9]*)-[0-9a-f-]{36}$/iu.exec(body.requestId?.trim() ?? '')?.[1];
    return cliente ? { customerId: cliente } : null;
  }
}
