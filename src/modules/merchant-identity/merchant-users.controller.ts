/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza controla quién puede operar el canal del comercio afiliado y deja evidencia de cada alta.
 * @system implementa identidad del comercio, credenciales y ciclo de vida de sus usuarios.
 */
import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { InternalPermissionsGuard } from '../internal-users/guards/internal-permissions.guard.js';
import { InternalPermissions } from '../internal-users/internal-permissions.decorator.js';
import { MerchantUsersService } from './merchant-users.service.js';
import { MerchantUserRequestsService } from './merchant-user-requests.service.js';
import {
  ApproveMerchantUserRequestDto,
  EnqueueMerchantUserRequestDto,
  ListMerchantUserRequestsQueryDto,
  ListMerchantUsersQueryDto,
  MerchantUserParamsDto,
  MerchantUserRequestParamsDto,
  RejectMerchantUserRequestDto,
  UpdateMerchantUserStatusDto,
  approveMerchantUserRequestSchema,
  enqueueMerchantUserRequestSchema,
  listMerchantUserRequestsQuerySchema,
  listMerchantUsersQuerySchema,
  merchantUserParamsSchema,
  merchantUserRequestParamsSchema,
  rejectMerchantUserRequestSchema,
  updateMerchantUserStatusSchema,
} from './merchant-identity.schemas.js';

/**
 * Administración de las identidades del comercio (`/merchant/users`), por personal interno.
 *
 * No es el portal del comercio: aquí no entra un comercio. Es la contraparte de identidad del
 * onboarding que ya hace el rol `MERCHANT_OPERATIONS`, y por eso exige sus permisos.
 */
@ApiTags('merchant-users')
@ApiBearerAuth('access-token')
@Controller('merchant/users')
@UseGuards(JwtAuthGuard, InternalPermissionsGuard)
export class MerchantUsersController {
  constructor(
    private readonly merchantUsersService: MerchantUsersService,
    private readonly merchantUserRequestsService: MerchantUserRequestsService,
  ) {}

  /**
   * El tenant sale del token del operador interno, nunca del cuerpo de la petición: aceptarlo del
   * cliente permitiría dar de alta identidades en un tenant ajeno con un token válido del propio.
   */
  private requireTenant(currentUser: AuthenticatedUser): string {
    if (!currentUser.tenantId) {
      throw new ForbiddenException('El token no declara tenant: no es posible administrar identidades de comercio.');
    }
    return currentUser.tenantId;
  }

  /*
   * `POST /merchant/users` SE RETIRÓ. No es un olvido.
   *
   * Era el alta libre: un operador tecleaba correo, nombre y contraseña, y con eso nacía un usuario
   * de comercio que el ERP —dueño de la relación comercial— no había pedido y no conocía. El alta
   * es ahora la APROBACIÓN de una petición encolada por el ERP, más abajo. El corte está en el
   * controlador y en el servicio, no en la pantalla: una pantalla se salta con `curl`.
   */

  @ApiOperation({
    summary: 'Encolar una petición de alta de identidad de comercio',
    description:
      'La llama el ERP cuando registra a un usuario de comercio en su CRM. Es idempotente por `externalReference`: reintentar no duplica la petición.',
  })
  @ApiResponse({ status: 201, description: 'Petición encolada o actualizada, en estado `pending`.' })
  @ApiResponse({ status: 409, description: 'MERCHANT_PROVISIONING_REQUEST_PENDING_FOR_EMAIL.' })
  @Post('provisioning-requests')
  @InternalPermissions('merchant.users.request')
  enqueueRequest(
    @Body(new ZodValidationPipe(enqueueMerchantUserRequestSchema)) body: EnqueueMerchantUserRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.merchantUserRequestsService.enqueue(body, {
      // Quién pidió, visto desde ESTE lado: el actor del token. El ERP puede mandar además su
      // propio `requestedBy` —el correo del ejecutivo comercial—, que es el que el operador
      // reconoce; éste es el respaldo para cuando no lo manda.
      requestedBy: currentUser.internalUserId ?? currentUser.sub,
      tenantId: this.requireTenant(currentUser),
    });
  }

  @ApiOperation({ summary: 'Listar las peticiones de alta encoladas' })
  @ApiResponse({ status: 200, description: 'Lista paginada, con las pendientes y las más antiguas primero.' })
  @Get('provisioning-requests')
  @InternalPermissions('merchant.users.read')
  listRequests(
    @Query(new ZodValidationPipe(listMerchantUserRequestsQuerySchema)) query: ListMerchantUserRequestsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.merchantUserRequestsService.list(this.requireTenant(currentUser), query);
  }

  @ApiOperation({
    summary: 'Consultar una petición de alta',
    description: 'La consulta el ERP para saber si ya hay identidad detrás y con qué `merchantUserId` enlazar.',
  })
  @ApiParam({ name: 'requestId', schema: zodToApiSchema(merchantUserRequestParamsSchema.shape.requestId) })
  @ApiResponse({ status: 404, description: 'MERCHANT_PROVISIONING_REQUEST_NOT_FOUND.' })
  @ApiResponse({ status: 200, description: 'La petición de alta con su estado y su decisión.' })
  @Get('provisioning-requests/:requestId')
  @InternalPermissions('merchant.users.read')
  getRequest(
    @Param(new ZodValidationPipe(merchantUserRequestParamsSchema)) params: MerchantUserRequestParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.merchantUserRequestsService.get(this.requireTenant(currentUser), params.requestId);
  }

  @ApiOperation({
    summary: 'Conceder el acceso pedido: crear la identidad con los datos de la petición',
    description:
      'La contraseña provisional se genera aquí y viaja UNA sola vez, en esta respuesta. No hay ninguna lectura posterior que la devuelva.',
  })
  @ApiParam({ name: 'requestId', schema: zodToApiSchema(merchantUserRequestParamsSchema.shape.requestId) })
  @ApiResponse({ status: 201, description: 'Identidad creada en estado `invited` y petición cerrada como `provisioned`.' })
  @ApiResponse({ status: 409, description: 'MERCHANT_PROVISIONING_REQUEST_ALREADY_DECIDED o MERCHANT_USER_EMAIL_TAKEN.' })
  @Post('provisioning-requests/:requestId/approve')
  @InternalPermissions('merchant.users.manage')
  approveRequest(
    @Param(new ZodValidationPipe(merchantUserRequestParamsSchema)) params: MerchantUserRequestParamsDto,
    @Body(new ZodValidationPipe(approveMerchantUserRequestSchema)) body: ApproveMerchantUserRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.merchantUserRequestsService.approve(this.requireTenant(currentUser), params.requestId, body, {
      internalUserId: currentUser.internalUserId ?? null,
    });
  }

  @ApiOperation({
    summary: 'Rechazar una petición de alta',
    description: 'El motivo es obligatorio: es lo que el ERP lee para saber qué corregir antes de volver a pedirlo.',
  })
  @ApiParam({ name: 'requestId', schema: zodToApiSchema(merchantUserRequestParamsSchema.shape.requestId) })
  @ApiResponse({ status: 409, description: 'MERCHANT_PROVISIONING_REQUEST_ALREADY_DECIDED.' })
  @ApiResponse({ status: 201, description: 'Petición rechazada, con el motivo registrado.' })
  @Post('provisioning-requests/:requestId/reject')
  @InternalPermissions('merchant.users.manage')
  rejectRequest(
    @Param(new ZodValidationPipe(merchantUserRequestParamsSchema)) params: MerchantUserRequestParamsDto,
    @Body(new ZodValidationPipe(rejectMerchantUserRequestSchema)) body: RejectMerchantUserRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.merchantUserRequestsService.reject(this.requireTenant(currentUser), params.requestId, body, {
      internalUserId: currentUser.internalUserId ?? null,
    });
  }

  @ApiOperation({ summary: 'Listar identidades de comercio del tenant' })
  @ApiResponse({ status: 200, description: 'Lista paginada.' })
  @Get()
  @InternalPermissions('merchant.users.read')
  list(
    @Query(new ZodValidationPipe(listMerchantUsersQuerySchema)) query: ListMerchantUsersQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.merchantUsersService.listMerchantUsers(this.requireTenant(currentUser), query);
  }

  @ApiOperation({ summary: 'Consultar una identidad de comercio' })
  @ApiParam({
    name: 'merchantUserId',
    description: 'Identificador de la identidad de comercio dentro del tenant.',
    schema: zodToApiSchema(merchantUserParamsSchema.shape.merchantUserId),
  })
  @ApiResponse({ status: 200, description: 'Perfil de la identidad de comercio.' })
  @ApiResponse({ status: 404, description: 'MERCHANT_USER_NOT_FOUND.' })
  @Get(':merchantUserId')
  @InternalPermissions('merchant.users.read')
  get(
    @Param(new ZodValidationPipe(merchantUserParamsSchema)) params: MerchantUserParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.merchantUsersService.getMerchantUser(this.requireTenant(currentUser), params.merchantUserId);
  }

  @ApiOperation({
    summary: 'Activar, suspender o dar de baja el acceso de un usuario de comercio',
    description: 'Suspender corta la sesión en la siguiente rotación del refresh token.',
  })
  @ApiParam({ name: 'merchantUserId', schema: zodToApiSchema(merchantUserParamsSchema.shape.merchantUserId) })
  @ApiResponse({ status: 200, description: 'Estado actualizado.' })
  @Patch(':merchantUserId/status')
  @InternalPermissions('merchant.users.manage')
  updateStatus(
    @Param(new ZodValidationPipe(merchantUserParamsSchema)) params: MerchantUserParamsDto,
    @Body(new ZodValidationPipe(updateMerchantUserStatusSchema)) body: UpdateMerchantUserStatusDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.merchantUsersService.updateStatus(this.requireTenant(currentUser), params.merchantUserId, body, {
      internalUserId: currentUser.internalUserId ?? null,
    });
  }
}
