/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Frena en la misma pantalla del alta al que teclea un carnet que ya pertenece a otra cuenta, antes de pedirle fotos.
 * @system delega en `IdentityDocumentDuplicateService`, que bloquea la IP si el documento ya está registrado a otro cliente.
 */
import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../common/utils/auth/ownership.util.js';
import { RequestWithNetwork } from '../../common/utils/http/headers.util.js';
import { IdentityDocumentDuplicateService } from './application/identity-document-duplicate.service.js';
import { IdentityDocumentCheckDto, identityDocumentCheckSchema } from './customer-onboarding-profile.schemas.js';
import { OnboardingCustomerIdParamsDto, onboardingCustomerIdParamsSchema } from './customer-onboarding.schemas.js';
import { OnboardingIpBlockGuard } from './onboarding-ip-block.guard.js';

@ApiTags('customer-onboarding')
@ApiBearerAuth('access-token')
@Controller('customer-onboarding')
@UseGuards(OnboardingIpBlockGuard, JwtAuthGuard, TenantGuard, RolesGuard)
export class CustomerIdentityDocumentCheckController {
  constructor(private readonly duplicateService: IdentityDocumentDuplicateService) {}

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Roles('customer')
  @ApiOperation({
    summary: 'Comprobar que el carnet no pertenece a otra cuenta',
    description:
      'Compara el número con los documentos de OTROS clientes del tenant. Si ya figura en otro, la IP queda bloqueada en el alta ' +
      '(`ONBOARDING_IP_BLOCKED`, 403) porque casi siempre es un intento de suplantación. No confirma que el carnet exista: ' +
      'la respuesta es la misma para quien sondea números. El número no se guarda.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(identityDocumentCheckSchema) })
  @ApiResponse({ status: 200, description: 'El carnet no figura en otra cuenta — puede continuar.' })
  @ApiResponse({ status: 403, description: 'ONBOARDING_IP_BLOCKED — el carnet ya figura en otra cuenta o la IP ya estaba bloqueada.' })
  @Post(':customerId/identity-document/check')
  @HttpCode(HttpStatus.OK)
  async check(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(identityDocumentCheckSchema)) body: IdentityDocumentCheckDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    assertOwnCustomerResourceOrInternalOperational(currentUser, params.customerId);
    await this.duplicateService.assertNotRegisteredToAnotherCustomer({
      tenantId,
      customerId: params.customerId,
      documentNumber: body.documentNumber,
      ipAddress: request.ip ?? null,
    });
    return { available: true };
  }
}
