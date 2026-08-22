/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza deja constancia de quién verificó a un comercio y cuándo, que es lo que lo hace confiable.
 * @system expone a operaciones la decisión sobre el expediente del partner.
 */
import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { PartnerProfileService } from './application/partner-profile.service.js';
import { PartnerDecisionDto, partnerDecisionSchema, partnerIdParamsSchema } from './partner-onboarding.schemas.js';
import { toPartnerProfileDto } from './partner-onboarding.mapper.js';

/**
 * Quien firma que un comercio es de fiar.
 *
 * El expediente llegaba a `under_review` y **se quedaba ahí para siempre**: no había un solo camino
 * que escribiera `decided_at`. Sin esta decisión ningún comercio quedaba verificado, así que ningún
 * QR de caja resolvía y ninguna compra podía atribuirse a un comercio — el vínculo que sostiene la
 * categoría del gasto no tenía dónde empezar.
 *
 * NO admite el rol `merchant`, y es la diferencia con todo el resto del módulo: el onboarding es
 * autoservicio hasta el envío, y desde ahí en adelante es verificación. Un comercio que pudiera
 * aprobarse a sí mismo convertiría el trámite en un formulario.
 */
@ApiTags('partner-onboarding')
@ApiBearerAuth('access-token')
@Controller('operations/partners')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'admin', 'platform_admin')
export class PartnerOperationsController {
  constructor(private readonly profiles: PartnerProfileService) {}

  @ApiOperation({
    summary: 'Aprobar o rechazar el expediente de un comercio',
    description: 'Sólo desde `under_review`. Rechazar exige motivo; volver a decidir sobre un expediente resuelto responde 409.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiBody({ schema: zodToApiSchema(partnerDecisionSchema) })
  @ApiResponse({ status: 200, description: 'Expediente decidido.' })
  @ApiResponse({ status: 404, description: 'Expediente no encontrado.' })
  @ApiResponse({ status: 409, description: 'PARTNER_NOT_UNDER_REVIEW.' })
  @Post(':partnerId/decision')
  @HttpCode(HttpStatus.OK)
  async decide(
    @CurrentTenant() tenantId: string,
    @Param('partnerId') partnerId: string,
    @Body(new ZodValidationPipe(partnerDecisionSchema)) body: PartnerDecisionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const profile = await this.profiles.decide(tenantId, partnerId, {
      approved: body.approved,
      ...(body.rejectionReason ? { rejectionReason: body.rejectionReason } : {}),
      internalUserId: currentUser.internalUserId ?? null,
    });
    return toPartnerProfileDto(profile);
  }
}
