/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza dice al cliente en qué comercio verificado está comprando, antes de que confirme nada.
 * @system resuelve el token del QR de caja al expediente del partner que lo emitió.
 */
import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PartnerCommerceService } from './application/partner-commerce.service.js';
import { ResolveMerchantQrDto, resolveMerchantQrSchema } from './partner-onboarding.schemas.js';

/**
 * La única puerta del expediente del partner que mira al CLIENTE.
 *
 * Va en su propio controlador y no junto a las de comercio por una razón concreta: aquéllas están
 * bajo `PartnerOwnershipGuard`, que exige que quien pregunta sea el dueño del `:partnerId` de la
 * URL. Aquí no hay `:partnerId` que comprobar —el cliente no sabe a qué comercio pertenece el QR,
 * justamente por eso pregunta—, así que colgarla de aquel controlador obligaría a abrirle un hueco
 * al guard, y un guard con excepciones deja de ser una garantía.
 *
 * Lo que se devuelve es deliberadamente poco: nombre, rubro y que está verificado. Bastante para
 * que el cliente reconozca la tienda donde está parado, y nada que convierta el endpoint en un
 * directorio de comercios para quien vaya probando tokens.
 */
@ApiTags('partner-onboarding')
@ApiBearerAuth('access-token')
@Controller('merchant-qr')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class MerchantQrController {
  constructor(private readonly commerce: PartnerCommerceService) {}

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({ summary: 'Resolver el QR de caja al comercio que lo emitió' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(resolveMerchantQrSchema) })
  @ApiResponse({ status: 200, description: 'Comercio verificado: nombre, rubro y terminal.' })
  @ApiResponse({ status: 404, description: 'QR_NOT_RECOGNIZED.' })
  @ApiResponse({ status: 422, description: 'QR_REVOKED o QR_EXPIRED.' })
  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  resolve(@CurrentTenant() tenantId: string, @Body(new ZodValidationPipe(resolveMerchantQrSchema)) body: ResolveMerchantQrDto) {
    return this.commerce.resolveMerchantQr(tenantId, body.token);
  }
}
