/**
 * @file Controlador HTTP: expone endpoints y delega la lógica a servicios.
 * @business Esta pieza cierra el circuito de la revisión humana de riesgo hecha en el Motor.
 * @system recibe la resolución del Motor por clave compartida y la aplica al caso delegado por su ejecución.
 */
import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { assertEngineCallbackKey, ENGINE_CALLBACK_HEADER } from '../../common/utils/auth/engine-callback-key.util.js';
import { RiskManualReviewOutcomeService } from './application/risk-manual-review-outcome.service.js';

/**
 * `POST /internal/risk/manual-review-callback`: el Motor avisa cómo terminó la revisión de riesgo.
 *
 * Gemelo del de identidad y del de crédito. `@Public()` respecto al guard de SESIÓN: quien llama es
 * un servicio, y se identifica con la clave compartida que el handler exige; sin clave configurada
 * responde 401 en vez de quedar abierto.
 */
@Public()
@ApiExcludeController()
@Controller('internal/risk')
export class RiskReviewCallbackController {
  constructor(private readonly outcome: RiskManualReviewOutcomeService) {}

  @Post('manual-review-callback')
  @HttpCode(HttpStatus.OK)
  async aplicar(
    @CurrentTenant() tenantId: string,
    @Headers(ENGINE_CALLBACK_HEADER) clave: string | undefined,
    @Body() body: { executionId?: string; decision?: string; reason?: string; resolvedByInternalUserId?: string },
  ) {
    assertEngineCallbackKey(clave);

    const executionId = body.executionId?.trim();
    if (!executionId) throw new BadRequestException('Falta executionId.');
    if (body.decision !== 'APPROVE' && body.decision !== 'DECLINE') {
      return { applied: false, reason: 'DECISION_NO_APLICABLE' };
    }
    const revisadoPor = /^[1-9][0-9]*$/u.test(body.resolvedByInternalUserId ?? '') ? (body.resolvedByInternalUserId as string) : null;

    return this.outcome.apply({
      tenantId,
      executionId,
      decision: body.decision,
      reason: body.reason ?? 'Resuelto en el Motor de Decisión.',
      resolvedByInternalUserId: revisadoPor,
    });
  }
}
