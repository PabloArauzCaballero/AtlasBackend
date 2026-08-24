/**
 * @file Controlador HTTP: expone la configuración de qué artefacto decide cada cosa.
 * @business Permite a Riesgo elegir la política vigente sin pedir un despliegue.
 * @system lee y escribe `catalog.decision_artifact_bindings` con el catálogo del motor como origen.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, UnprocessableEntityException } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import { DECISION_TYPES, DecisionArtifactBindingService } from './decision-artifact-binding.service.js';

const assignSchema = z
  .object({
    decisionType: z.enum(DECISION_TYPES),
    artifactCode: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();
type AssignDto = z.infer<typeof assignSchema>;

/**
 * Qué artefacto decide la identidad, el crédito y el riesgo.
 *
 * Hasta ahora esto vivía en variables de entorno, así que cambiar la política que evalúa un crédito
 * exigía editar un fichero y reiniciar un contenedor —y nadie podía VER desde el portal cuál estaba
 * decidiendo—. Es una decisión de negocio, no de infraestructura.
 *
 * Sólo roles internos: elegir con qué política se evalúa a los clientes no es una preferencia de
 * usuario, es gobierno del riesgo.
 */
@ApiTags('decision-engine')
@ApiBearerAuth('access-token')
@Roles('internal_operator', 'risk_analyst', 'admin', 'platform_admin')
@Controller('internal/decision-artifacts')
export class DecisionArtifactBindingController {
  constructor(private readonly bindings: DecisionArtifactBindingService) {}

  @ApiOperation({ summary: 'Qué artefacto decide cada cosa, y de dónde salió' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Asignación vigente por tipo de decisión.' })
  @Get()
  async list(@Headers('x-tenant-id') tenantIdHeader: string | undefined) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    const [bindings, available] = await Promise.all([
      this.bindings.list(tenantId),
      this.bindings.availableArtifacts(),
    ]);
    return { bindings, availableArtifacts: available };
  }

  @ApiOperation({ summary: 'Elegir el artefacto que decide un tipo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Asignación guardada.' })
  @ApiResponse({ status: 422, description: 'DECISION_ARTIFACT_NOT_PUBLISHED — el motor no publica ese código.' })
  @Post()
  @HttpCode(HttpStatus.OK)
  async assign(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(assignSchema)) body: AssignDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    try {
      return await this.bindings.assign({
        tenantId: tenantIdFromHeader(tenantIdHeader),
        decisionType: body.decisionType,
        artifactCode: body.artifactCode,
        internalUserId: currentUser.internalUserId ? String(currentUser.internalUserId) : null,
        notes: body.notes,
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message.startsWith('DECISION_ARTIFACT_NOT_PUBLISHED')) throw new UnprocessableEntityException(message);
      throw error;
    }
  }
}
