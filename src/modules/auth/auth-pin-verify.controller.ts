/**
 * @file Controlador HTTP: expone el caso de uso por rutas versionadas.
 * @business Permite que la app vuelva a pedir el PIN antes de mostrar datos personales, sin cerrar ni abrir sesión.
 * @system valida la entrada con Zod y delega en `AuthPinVerifyService`; la identidad sale siempre del access token.
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
import { AuthPinVerifyService } from './auth-pin-verify.service.js';
import { PinVerifyDto, pinVerifySchema } from './auth.schemas.js';

/**
 * Re-autenticación del cliente en la app. Sólo el rol `customer`: es quien tiene PIN de cuatro dígitos y
 * a quien se le pide antes de ver sus datos (Privacidad → «Ver mis datos»).
 */
@ApiTags('auth')
@Controller('auth/pin')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AuthPinVerifyController {
  constructor(private readonly pinVerify: AuthPinVerifyService) {}

  // 5 por minuto por IP: es lo único que frena a quien tenga un token y pruebe PIN uno tras otro
  // (aquí el contador de bloqueo del login no suma, por la misma razón que en el cambio de contraseña).
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Roles('customer')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Volver a pedir el PIN',
    description:
      'Comprueba que el PIN escrito es el de la cuenta de la SESIÓN (la identidad sale del access token). No crea sesión, ' +
      'no envía correo y no abre ningún desafío. Responde `{ verified: true, verifiedAt }`; un PIN incorrecto es un 400 ' +
      '`PIN_INCORRECT` (no 401: la sesión sigue siendo válida). Cada intento queda en la bitácora de autenticación.',
  })
  @ApiBody({ schema: zodToApiSchema(pinVerifySchema) })
  @ApiResponse({ status: 200, description: 'PIN correcto — `{ verified: true, verifiedAt }`.' })
  @ApiResponse({ status: 400, description: '`PIN_INCORRECT`: el PIN no coincide.' })
  @ApiResponse({ status: 429, description: 'Más de 5 intentos en un minuto.' })
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(
    @Body(new ZodValidationPipe(pinVerifySchema)) body: PinVerifyDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    if (!currentUser.customerId) {
      throw new UnauthorizedException('El token no identifica a un cliente.');
    }
    return this.pinVerify.verify({
      actorType: 'customer',
      actorId: currentUser.customerId,
      tenantId: currentUser.tenantId ?? null,
      pin: body.pin,
      ip: request.ip ?? null,
      userAgent: userAgentFrom(request),
    });
  }
}
