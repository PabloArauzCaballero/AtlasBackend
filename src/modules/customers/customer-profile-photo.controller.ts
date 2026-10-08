/**
 * @file Controlador HTTP: traduce el contrato público hacia casos de uso de la capa de aplicación.
 * @business La persona sube, cambia o quita su foto de perfil desde la app.
 * @system permiso de subida firmado, confirmación con verificación del objeto, lectura de los bytes por la API y borrado.
 */
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Put, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { CustomerProfilePhotoService } from './application/customer-profile-photo.service.js';
import {
  customerIdParamsSchema,
  CustomerIdParamsDto,
  profilePhotoConfirmSchema,
  ProfilePhotoConfirmDto,
  profilePhotoUploadUrlSchema,
  ProfilePhotoUploadUrlDto,
} from './customers.schemas.js';

@ApiTags('customers')
@ApiBearerAuth('access-token')
@Controller('customers')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CustomerProfilePhotoController {
  constructor(private readonly photos: CustomerProfilePhotoService) {}

  @Roles('customer')
  @ApiOperation({
    summary: 'Permiso para subir la foto de perfil',
    description: 'URL prefirmada de un solo uso (PUT) bajo la carpeta del propio cliente. JPEG o PNG, máximo 5 MB.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(profilePhotoUploadUrlSchema) })
  @ApiResponse({ status: 201, description: 'Permiso de subida — `{ storageKey, uploadUrl, method, requiredHeaders, expiresAt }`.' })
  @ApiResponse({ status: 422, description: 'PROFILE_PHOTO_TOO_LARGE.' })
  @Post(':customerId/profile-photo/upload-url')
  @HttpCode(HttpStatus.CREATED)
  createUploadUrl(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @Body(new ZodValidationPipe(profilePhotoUploadUrlSchema)) body: ProfilePhotoUploadUrlDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.photos.createUploadUrl({ tenantId, customerId: params.customerId, ...body, currentUser });
  }

  @Roles('customer')
  @ApiOperation({
    summary: 'Fijar la foto de perfil subida',
    description: 'Comprueba el objeto (es una imagen JPEG/PNG, tamaño y antivirus), lo fija como foto y borra la anterior.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(profilePhotoConfirmSchema) })
  @ApiResponse({ status: 200, description: '`{ hasPhoto: true, updatedAt }`.' })
  @ApiResponse({ status: 400, description: 'PROFILE_PHOTO_KEY_NOT_ALLOWED — la clave no es de la carpeta de fotos de este cliente.' })
  @ApiResponse({
    status: 422,
    description: 'PROFILE_PHOTO_NOT_UPLOADED, PROFILE_PHOTO_NOT_AN_IMAGE, PROFILE_PHOTO_TOO_LARGE o PROFILE_PHOTO_REJECTED.',
  })
  @Put(':customerId/profile-photo')
  @HttpCode(HttpStatus.OK)
  confirm(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @Body(new ZodValidationPipe(profilePhotoConfirmSchema)) body: ProfilePhotoConfirmDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.photos.confirm({ tenantId, customerId: params.customerId, storageKey: body.storageKey, currentUser });
  }

  @Roles('customer')
  @ApiOperation({ summary: 'Quitar la foto de perfil', description: 'Deja la cuenta sin foto y borra el objeto del almacén.' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: '`{ hasPhoto: false }`.' })
  @Delete(':customerId/profile-photo')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.photos.remove({ tenantId, customerId: params.customerId, currentUser });
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'La foto de perfil (imagen)',
    description: 'Los bytes de la foto, servidos por la API con el token: el teléfono nunca recibe una URL del almacén.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'image/jpeg o image/png.' })
  @ApiResponse({ status: 404, description: 'PROFILE_PHOTO_NOT_FOUND — el cliente no tiene foto.' })
  @Get(':customerId/profile-photo')
  async read(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Res() response: Response,
  ) {
    const foto = await this.photos.read({ tenantId, customerId: params.customerId, currentUser });
    if (!foto) throw new NotFoundException('PROFILE_PHOTO_NOT_FOUND');
    response.setHeader('content-type', foto.contentType);
    response.setHeader('content-length', String(foto.buffer.length));
    // Privada: la foto es de la persona. La app la pide con `?v=<updatedAt>`, así que cambiarla invalida la caché.
    response.setHeader('cache-control', 'private, max-age=86400');
    response.end(foto.buffer);
  }
}
