/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza deja constancia de quién verificó a un comercio y cuándo, que es lo que lo hace confiable.
 * @system expone a operaciones la decisión sobre el expediente del partner.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { InternalPermissions } from '../internal-users/internal-permissions.decorator.js';
import { InternalPermissionsGuard } from '../internal-users/guards/internal-permissions.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { PartnerProfileService } from './application/partner-profile.service.js';
import {
  FindPartnerQueryDto,
  findPartnerQuerySchema,
  LinkErpAccountDto,
  linkErpAccountSchema,
  ListPartnerQueueQueryDto,
  listPartnerQueueQuerySchema,
  PartnerDecisionDto,
  partnerDecisionSchema,
  partnerIdParamsSchema,
  RequestKybReviewDto,
  requestKybReviewSchema,
} from './partner-onboarding.schemas.js';
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
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, InternalPermissionsGuard)
/*
 * El ERP llega por PERMISO, no por rol de aplicación.
 *
 * `operations_manager` es un rol interno del RBAC (`internal_rbac.roles`), no uno de los roles de
 * aplicación que `@Roles` entiende, así que la puerta del ERP se abre con `partner.kyb.request` en
 * las dos rutas que necesita —pedir la verificación y enlazar su cuenta—, mientras `@Roles` de la
 * clase sigue gobernando el resto. El ERP pide y NO decide: `POST :partnerId/decision` no lleva ese
 * permiso, la misma separación que ya rige el alta de identidades de comercio
 * (`merchant.users.request` frente a `merchant.users.manage`).
 */
@Roles('internal_operator', 'risk_analyst', 'admin', 'platform_admin')
export class PartnerOperationsController {
  constructor(private readonly profiles: PartnerProfileService) {}

  @ApiOperation({
    summary: 'La cola de expedientes esperando decisión',
    description:
      'Expedientes en `under_review`, el más antiguo primero. Sin esto la pantalla de verificación obligaba a TECLEAR el identificador del comercio, sacado de otra vista.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Lista paginada de expedientes pendientes.' })
  @Get('queue')
  listQueue(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(listPartnerQueueQuerySchema)) query: ListPartnerQueueQueryDto) {
    return this.profiles.listAwaitingDecision(tenantId, query);
  }

  @ApiOperation({
    summary: 'Buscar el expediente de un comercio por su cuenta del ERP o su NIT',
    description:
      'El ERP origina la cuenta B2B y no conoce el partnerId: el puente `erp_account_id` va en el otro sentido y nace nulo. ' +
      'Sin coincidencias responde 200 con `items: []`, nunca 404: «esta cuenta todavía no tiene expediente» es una respuesta.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Expedientes que coinciden, con su procedencia de decisión.' })
  @ApiResponse({ status: 400, description: 'Sin erpAccountId ni taxId: esta búsqueda no lista comercios.' })
  @Get()
  find(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(findPartnerQuerySchema)) query: FindPartnerQueryDto) {
    return this.profiles.findByExternalKeys(tenantId, query);
  }

  @ApiOperation({
    summary: 'Enlazar el expediente con la cuenta del ERP',
    description:
      'De una vía: si ya apunta a otra cuenta responde 409. Reescribir el puente convertiría el historial de verificación ' +
      'de un comercio en el de otro, y nada lo delataría después.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiBody({ schema: zodToApiSchema(linkErpAccountSchema) })
  @ApiResponse({ status: 200, description: 'Expediente enlazado.' })
  @ApiResponse({ status: 409, description: 'PARTNER_ERP_ACCOUNT_ALREADY_LINKED.' })
  @Patch(':partnerId/erp-account')
  @InternalPermissions('partner.kyb.request')
  @HttpCode(HttpStatus.OK)
  async linkErpAccount(
    @CurrentTenant() tenantId: string,
    @Param('partnerId') partnerId: string,
    @Body(new ZodValidationPipe(linkErpAccountSchema)) body: LinkErpAccountDto,
  ) {
    return toPartnerProfileDto(await this.profiles.linkErpAccount(tenantId, partnerId, body.erpAccountId));
  }

  @ApiOperation({
    summary: 'Pedir al Motor que verifique el expediente',
    description:
      'Ejecuta el artefacto PARTNER_KYB_REVIEW y aplica su veredicto: APROBADO habilita al comercio, RECHAZADO dice qué falta, ' +
      'REVISION_MANUAL lo deja esperando con el caso que el Motor abrió. Es el MISMO camino que dispara el envío del expediente: ' +
      'existe para que el ERP y operaciones puedan pedirla sin que haya una segunda forma de decidir lo mismo. ' +
      'Con el Motor caído responde 503 y el expediente queda como estaba: no se decide en local.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: false, description: 'Reintentar con la misma llave no produce una segunda ejecución.' })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiBody({ schema: zodToApiSchema(requestKybReviewSchema), required: false })
  @ApiResponse({ status: 200, description: 'Veredicto del Motor y expediente actualizado.' })
  @ApiResponse({ status: 409, description: 'PARTNER_NOT_UNDER_REVIEW.' })
  @ApiResponse({ status: 503, description: 'DECISION_ENGINE_UNAVAILABLE.' })
  @Post(':partnerId/kyb-review')
  @InternalPermissions('partner.kyb.request')
  @HttpCode(HttpStatus.OK)
  async requestKybReview(
    @CurrentTenant() tenantId: string,
    @Param('partnerId') partnerId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(requestKybReviewSchema)) body: RequestKybReviewDto,
  ) {
    const { profile, decision } = await this.profiles.requestKybReview(tenantId, partnerId, {
      // Sin llave del que llama, una por petición: reintentar entonces SÍ produce otra ejecución, y
      // es lo correcto —el Motor deduplica por llave y no puede adivinar que dos llamadas son la misma—.
      idempotencyKey: idempotencyKey ?? `kyb-${partnerId}-${Date.now()}`,
      ...(body.reason ? { reason: body.reason } : {}),
    });
    return { ...toPartnerProfileDto(profile), decision };
  }

  @Roles('internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Aprobar o rechazar el expediente de un comercio',
    description:
      'La DEGRADACIÓN, no el camino normal: sólo cuando el Motor no abrió caso (una decisión automática suya, o el Motor ' +
      'caído cuando se envió). Con caso abierto responde 409 PARTNER_DECISION_DELEGADA_AL_MOTOR y se resuelve allí. ' +
      'Sólo desde `under_review`; rechazar exige motivo.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiBody({ schema: zodToApiSchema(partnerDecisionSchema) })
  @ApiResponse({ status: 200, description: 'Expediente decidido.' })
  @ApiResponse({ status: 404, description: 'Expediente no encontrado.' })
  @ApiResponse({ status: 409, description: 'PARTNER_NOT_UNDER_REVIEW | PARTNER_DECISION_DELEGADA_AL_MOTOR.' })
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

  /*
   * `PATCH /operations/partners/:partnerId/mdr-rate` SE RETIRÓ. No es un olvido.
   *
   * El MDR es un TÉRMINO COMERCIAL, y los términos comerciales son del ERP: allí viven
   * `atlas_sales.mdr_rules` —con su regla por cuenta y por sucursal—, el `expected_mdr_rate` de la
   * oportunidad y los términos de contrato de tipo `MDR`. Este endpoint escribía un único
   * porcentaje plano en `partner_profiles`, así que la misma pregunta («¿qué comisión le cobramos a
   * este comercio?») tenía dos respuestas que nadie conciliaba, y ganaba la que consultara primero
   * quien preguntara.
   *
   * La verificación del expediente —lo que SÍ se queda aquí— responde otra cosa: si el comercio es
   * quien dice ser. Negociar cuánto se le cobra no es parte de comprobarlo.
   *
   * `PartnerProfileService.setMdrRate` sigue existiendo para la lectura y para las semillas; lo que
   * desaparece es la puerta HTTP que dejaba autoría comercial en la consola interna.
   */
}
