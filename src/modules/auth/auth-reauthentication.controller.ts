/**
 * @file Controlador HTTP: expone el caso de uso por rutas versionadas.
 * @business Cambiar el correo con el que el cliente entra y recupera su cuenta exige repetir su PIN: una sesión robada ya no basta.
 * @system valida la entrada con Zod y delega en `AuthReauthenticationService`; la identidad sale siempre del access token.
 */
import { Body, Controller, HttpCode, HttpStatus, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { RequestWithNetwork, userAgentFrom } from '../../common/utils/http/headers.util.js';
import { AuthReauthenticationService, REAUTH_TTL_SECONDS } from './auth-reauthentication.service.js';
import { CustomerReauthenticateDto, customerReauthenticateSchema } from './auth.schemas.js';

/**
 * Prueba de reautenticación del CLIENTE. Es el mismo mecanismo que usa el comercio antes de cambiar su
 * cuenta de cobro (`POST /merchant/auth/reauthenticate`): sin él, una sesión robada bastaba para poner un
 * correo ajeno como principal y pedir desde ahí un PIN nuevo.
 *
 * A diferencia de `POST /auth/pin/verify` —que sólo responde si el PIN es el correcto—, esto devuelve una
 * prueba que la operación sensible COMPRUEBA y GASTA en el servidor: un «sí» del cliente no se puede creer.
 */
@ApiTags('auth')
@Controller('auth')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AuthReauthenticationController {
  constructor(private readonly reauthentication: AuthReauthenticationService) {}

  // 5 por minuto por IP, como el comercio: además cada fallo cuenta en el bloqueo del login.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Roles('customer')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Reautenticación del cliente',
    description:
      'Valida la credencial (el PIN) del cliente AUTENTICADO y devuelve una prueba de un solo uso, válida ' +
      `${REAUTH_TTL_SECONDS} s y ligada a ese cliente, que se envía en la cabecera \`x-reauth-token\` de la ` +
      'operación sensible (declarar un correo nuevo). Cada intento errado cuenta en el bloqueo del login.',
  })
  @ApiBody({ schema: zodToApiSchema(customerReauthenticateSchema) })
  @ApiResponse({ status: 200, description: '`{ reauthToken, expiresInSeconds, expiresAt }`.' })
  @ApiResponse({ status: 400, description: 'REAUTH_INVALID_PASSWORD: el PIN no es correcto.' })
  @ApiResponse({ status: 401, description: 'El token no identifica a un cliente, o la cuenta ya no está disponible.' })
  @ApiResponse({ status: 429, description: 'ACCOUNT_LOCKED (con `lockedUntil`) o demasiadas peticiones.' })
  @Post('reauthenticate')
  @HttpCode(HttpStatus.OK)
  reauthenticate(
    @Body(new ZodValidationPipe(customerReauthenticateSchema)) body: CustomerReauthenticateDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    if (!currentUser.customerId) {
      throw new UnauthorizedException('El token no identifica a un cliente.');
    }
    return this.reauthentication.issue({
      actorType: 'customer',
      actorId: currentUser.customerId,
      tenantId: currentUser.tenantId ?? null,
      password: body.password,
      ip: request.ip ?? null,
      userAgent: userAgentFrom(request),
    });
  }
}
