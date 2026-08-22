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
import {
  CreateMerchantUserDto,
  ListMerchantUsersQueryDto,
  MerchantUserParamsDto,
  UpdateMerchantUserStatusDto,
  createMerchantUserSchema,
  listMerchantUsersQuerySchema,
  merchantUserParamsSchema,
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
  constructor(private readonly merchantUsersService: MerchantUsersService) {}

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

  @ApiOperation({ summary: 'Dar de alta la identidad de un usuario de comercio' })
  @ApiResponse({ status: 201, description: 'Identidad creada en estado `invited`, con credencial provisionada.' })
  @ApiResponse({ status: 409, description: 'MERCHANT_USER_EMAIL_TAKEN o WEAK_PASSWORD.' })
  @Post()
  @InternalPermissions('merchant.users.manage')
  create(
    @Body(new ZodValidationPipe(createMerchantUserSchema)) body: CreateMerchantUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.merchantUsersService.createMerchantUser(body, {
      tenantId: this.requireTenant(currentUser),
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
