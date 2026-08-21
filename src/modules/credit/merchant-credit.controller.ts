/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza deja que el comercio acepte o rechace en su portal la compra que el motor aprobó.
 * @system expone al rol merchant las solicitudes de su propio expediente y su aceptación.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { CreditBusinessAcceptanceService } from './application/credit-business-acceptance.service.js';
import {
  CreditBusinessAcceptanceDto,
  MerchantApplicationsQueryDto,
  MerchantPartnerApplicationParamsDto,
  MerchantPartnerParamsDto,
  creditBusinessAcceptanceSchema,
  merchantApplicationsQuerySchema,
  merchantPartnerApplicationParamsSchema,
  merchantPartnerParamsSchema,
} from './credit.schemas.js';

/**
 * El portal del comercio, no la consola de operaciones.
 *
 * La aceptación del negocio ya existía, pero sólo bajo `operations/credit`, con el rol
 * `internal_operator`. Es decir: la pregunta «¿quieres esta operación?» se la respondía **personal
 * de Atlas al comercio**, que es justo al revés. Aquí la responde quien tiene la mercadería
 * delante.
 *
 * Va en su propio controlador y no ampliando los roles del de operaciones a propósito: aquel
 * controlador declara `@Roles` a nivel de clase, y añadir `merchant` allí abriría de una vez todos
 * sus endpoints —incluida la decisión manual que anula al motor—. Un controlador aparte no puede
 * equivocarse en esa dirección.
 *
 * El expediente viaja como `:partnerId` y la propiedad se comprueba dentro del servicio, contra el
 * dueño del expediente. No basta con ser `merchant`: hay que ser el de ESTE comercio.
 */
@ApiTags('credit')
@ApiBearerAuth('access-token')
@Controller('merchant/partners/:partnerId/credit-applications')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
export class MerchantCreditController {
  constructor(private readonly businessAcceptance: CreditBusinessAcceptanceService) {}

  @ApiOperation({
    summary: 'Solicitudes de este comercio, por defecto sólo las que esperan su respuesta',
    description: 'No incluye la identidad del solicitante: el comercio decide sobre la operación, no sobre quién la pide.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(merchantPartnerParamsSchema.shape.partnerId) })
  @ApiQuery({ name: 'onlyPending', required: false, enum: ['true', 'false'] })
  @ApiResponse({ status: 200, description: 'Solicitudes del comercio, más recientes primero.' })
  @ApiResponse({ status: 403, description: 'El expediente no pertenece a este comercio.' })
  @Get()
  list(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(merchantPartnerParamsSchema)) params: MerchantPartnerParamsDto,
    @Query(new ZodValidationPipe(merchantApplicationsQuerySchema)) query: MerchantApplicationsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.businessAcceptance.listForPartner({
      tenantId,
      partnerProfileId: params.partnerId,
      onlyPending: query.onlyPending,
      currentUser,
    });
  }

  @ApiOperation({ summary: 'Aceptar o rechazar una compra que el motor aprobó' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(creditBusinessAcceptanceSchema) })
  @ApiResponse({ status: 200, description: 'Aceptación registrada.' })
  @ApiResponse({ status: 403, description: 'La solicitud no nació en este comercio.' })
  @ApiResponse({ status: 404, description: 'CREDIT_APPLICATION_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'CREDIT_BUSINESS_ACCEPTANCE_NOT_PENDING.' })
  @Post(':applicationId/acceptance')
  @HttpCode(HttpStatus.OK)
  decide(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(merchantPartnerApplicationParamsSchema)) params: MerchantPartnerApplicationParamsDto,
    @Body(new ZodValidationPipe(creditBusinessAcceptanceSchema)) body: CreditBusinessAcceptanceDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.businessAcceptance.decide({ tenantId, applicationId: params.applicationId, body, currentUser });
  }
}
