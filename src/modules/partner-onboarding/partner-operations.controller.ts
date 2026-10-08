/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza deja constancia de quién verificó a un comercio y cuándo, que es lo que lo hace confiable.
 * @system expone a operaciones la decisión sobre el expediente del partner.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { InternalPermissions } from '../internal-users/internal-permissions.decorator.js';
import { InternalPermissionsGuard } from '../internal-users/guards/internal-permissions.guard.js';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { PartnerProfileService } from './application/partner-profile.service.js';
import { PartnerQrReviewService } from './application/partner-qr-review.service.js';
import { PartnerVerificationService } from './application/partner-verification.service.js';
import {
  partnerIdParamsSchema,
  PartnerIdParamsDto,
  qrIdParamsSchema,
  QrIdParamsDto,
  reviewQrSchema,
  ReviewQrDto,
} from './partner-onboarding.schemas.js';
import {
  FindPartnerQueryDto,
  findPartnerQuerySchema,
  LinkErpAccountDto,
  linkErpAccountSchema,
  ListPartnerQueueQueryDto,
  listPartnerQueueQuerySchema,
  ListPendingQrQueryDto,
  listPendingQrQuerySchema,
  PartnerDecisionDto,
  partnerDecisionSchema,
  RequestKybReviewDto,
  requestKybReviewSchema,
} from './partner-operations.schemas.js';
import { toPartnerProfileDto, toPartnerQrDto } from './partner-onboarding.mapper.js';

/**
 * Quien firma que un comercio es de fiar.
 *
 * Sin esta decisión el expediente se quedaba en `under_review` para siempre: ningún QR de caja
 * resolvía. NO admite el rol `merchant`: el onboarding es autoservicio hasta el envío y desde ahí
 * es verificación; un comercio que pudiera aprobarse a sí mismo convertiría el trámite en formulario.
 */
@ApiTags('partner-onboarding')
@ApiBearerAuth('access-token')
@Controller('operations/partners')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, InternalPermissionsGuard)
/*
 * El ERP llega por PERMISO, no por rol de aplicación: `operations_manager` es un rol interno del
 * RBAC que `@Roles` no entiende, así que `partner.kyb.request` abre las dos rutas que necesita
 * (pedir la verificación y enlazar su cuenta). El ERP pide y NO decide: `POST :partnerId/decision`
 * exige `partner.kyb.decide` (como `merchant.users.request` frente a `merchant.users.manage`).
 */
@Roles('internal_operator', 'risk_analyst', 'admin', 'platform_admin')
export class PartnerOperationsController {
  constructor(
    private readonly profiles: PartnerProfileService,
    private readonly verification: PartnerVerificationService,
    private readonly qr: PartnerQrReviewService,
  ) {}

  /**
   * La cola de QR de cobro esperando revisión.
   *
   * Es una cola aparte de la de expedientes: un comercio ya APROBADO sube o cambia su QR cuando
   * quiere, y ese QR también tiene que pasar por una persona. Sin esta lista, un QR subido después
   * de la verificación no aparecía en ninguna bandeja y se quedaba en `pending_review` para siempre.
   */
  @ApiOperation({
    summary: 'Los QR de cobro que esperan revisión',
    description:
      'Una página de los QR en `pending_review` del tenant, el más antiguo primero, con el comercio y la sucursal a los que pertenecen, `meta` con el total del filtro y `summary` con el de toda la cola (por tipo y el más antiguo).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({
    name: 'q',
    required: false,
    description:
      'Busca por partes en la razón social, el nombre comercial y el NIT del comercio; el nombre, código y ciudad de la sucursal; la entidad, la cuenta enmascarada y la huella del QR; y el n.º del QR y del comercio.',
    schema: zodObjectPropertySchemas(listPendingQrQuerySchema).q,
  })
  @ApiQuery({
    name: 'qrKind',
    required: false,
    description: 'Sólo el QR del negocio (`business`) o sólo el de una cuenta bancaria (`bank`).',
    schema: zodObjectPropertySchemas(listPendingQrQuerySchema).qrKind,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Página (desde 1).',
    schema: zodObjectPropertySchemas(listPendingQrQuerySchema).page,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'QR por página (máx. 50): cada tarjeta descarga su imagen.',
    schema: zodObjectPropertySchemas(listPendingQrQuerySchema).limit,
  })
  @ApiResponse({ status: 200, description: 'Página de QR pendientes.' })
  @Get('qr-codes/pending')
  listQrPendingReview(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(listPendingQrQuerySchema)) query: ListPendingQrQueryDto,
  ) {
    return this.qr.listPendingReview(tenantId, query);
  }

  /**
   * Una persona aprueba o rechaza el QR de cobro de un comercio.
   *
   * Un QR nace `active` (`markQrActive`); esta ruta sólo resuelve los que quedaron en
   * `pending_review` tras retirarse la revisión (2026-10-02). 409 en el servicio si no lo está.
   */
  @InternalPermissions('partner.qr.review')
  @ApiOperation({
    summary: 'Aprobar o rechazar un QR de cobro',
    description:
      'Aprobar lo activa y archiva como `replaced` el que estuviera activo en el mismo ámbito. Rechazar exige `note`: es lo que el comercio lee para corregir. ' +
      'Sólo sobre QR en `pending_review`; en otro estado responde 409 QR_NOT_PENDING_REVIEW.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiParam({ name: 'qrId', schema: zodToApiSchema(qrIdParamsSchema.shape.qrId) })
  @ApiBody({ schema: zodToApiSchema(reviewQrSchema) })
  @ApiResponse({ status: 200, description: 'QR revisado.' })
  @ApiResponse({ status: 404, description: 'QR_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'QR_NOT_PENDING_REVIEW.' })
  @Post(':partnerId/qr-codes/:qrId/review')
  @HttpCode(HttpStatus.OK)
  async reviewQr(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(qrIdParamsSchema)) params: QrIdParamsDto,
    @Body(new ZodValidationPipe(reviewQrSchema)) body: ReviewQrDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const reviewed = await this.qr.review(tenantId, params.partnerId, params.qrId, {
      ...body,
      internalUserId: currentUser.internalUserId ?? null,
    });
    return toPartnerQrDto(reviewed);
  }

  @ApiOperation({
    summary: 'La cola de expedientes esperando decisión',
    description:
      'Expedientes en `under_review`, el más antiguo primero. Sin esto la pantalla de verificación obligaba a TECLEAR el identificador del comercio, sacado de otra vista.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Parte del nombre legal, del nombre comercial o del NIT del comercio.',
    schema: zodObjectPropertySchemas(listPartnerQueueQuerySchema).q,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Página (desde 1).',
    schema: zodObjectPropertySchemas(listPartnerQueueQuerySchema).page,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Filas por página (máx. 100).',
    schema: zodObjectPropertySchemas(listPartnerQueueQuerySchema).limit,
  })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de expedientes pendientes, con `summary` {total, oldestSubmittedAt} de toda la cola.',
  })
  @Get('queue')
  listQueue(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(listPartnerQueueQuerySchema)) query: ListPartnerQueueQueryDto) {
    return this.verification.listAwaitingDecision(tenantId, query);
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
    return this.verification.findByExternalKeys(tenantId, query);
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
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) { partnerId }: PartnerIdParamsDto,
    @Body(new ZodValidationPipe(linkErpAccountSchema)) body: LinkErpAccountDto,
  ) {
    return toPartnerProfileDto(await this.verification.linkErpAccount(tenantId, partnerId, body.erpAccountId));
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
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) { partnerId }: PartnerIdParamsDto,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(requestKybReviewSchema)) body: RequestKybReviewDto,
  ) {
    const { profile, decision } = await this.verification.requestKybReview(tenantId, partnerId, {
      // Sin llave del que llama, una por petición: reintentar entonces SÍ produce otra ejecución, y
      // es lo correcto —el Motor deduplica por llave y no puede adivinar que dos llamadas son la misma—.
      idempotencyKey: idempotencyKey ?? `kyb-${partnerId}-${Date.now()}`,
      ...(body.reason ? { reason: body.reason } : {}),
    });
    return { ...toPartnerProfileDto(profile), decision };
  }

  @Roles('internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  // `internal_operator` lo comparten soporte y cobranza, y aprobar habilita al comercio a cobrar.
  @InternalPermissions('partner.kyb.decide')
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
  @ApiResponse({ status: 403, description: 'Falta el permiso partner.kyb.decide.' })
  @ApiResponse({ status: 409, description: 'PARTNER_NOT_UNDER_REVIEW | PARTNER_DECISION_DELEGADA_AL_MOTOR.' })
  @Post(':partnerId/decision')
  @HttpCode(HttpStatus.OK)
  async decide(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) { partnerId }: PartnerIdParamsDto,
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
