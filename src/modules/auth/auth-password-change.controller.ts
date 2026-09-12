/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza impide que una contraseña se cambie con solo tener la sesión abierta.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */
import { Body, Controller, HttpCode, HttpStatus, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { RequestWithNetwork, userAgentFrom } from '../../common/utils/http/headers.util.js';
import { AuthPasswordChangeService } from './auth-password-change.service.js';
import {
  PasswordChangeConfirmDto,
  PasswordChangeRequestDto,
  passwordChangeConfirmSchema,
  passwordChangeRequestSchema,
} from './auth.schemas.js';
import type { ActorType } from './auth-vocabulary.js';

/**
 * Cambio de contraseña del actor autenticado, en su propio controlador.
 *
 * Está separado de `AuthController` porque aquel archivo llegó al límite de 300 líneas del
 * trinquete de tamaño, y porque estas dos rutas se distinguen del resto en algo que conviene ver de
 * un vistazo: son las ÚNICAS de autenticación que no son `@Public()`. Aquí siempre hay una sesión
 * detrás, y de ella —no del cuerpo— sale la identidad de quien cambia la contraseña.
 */
@ApiTags('auth')
@Controller('auth/password')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AuthPasswordChangeController {
  constructor(private readonly passwordChange: AuthPasswordChangeService) {}

  // 5 por minuto por IP: cada solicitud válida dispara un correo real, y limita el ritmo al que se
  // puede probar la contraseña actual (que aquí no incrementa el bloqueo de la credencial).
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Solicitar cambio de contraseña',
    description:
      'Primer paso del cambio de contraseña de la cuenta AUTENTICADA. Valida la contraseña actual y envía un código ' +
      'de un solo uso al correo registrado del actor. Responde `{ pinChallengeRequired, challengeToken, expiresInMinutes }` — ' +
      'la misma forma que el desafío de `POST /auth/login` — y se completa con `POST /auth/password/change/confirm`. ' +
      'Quién cambia la contraseña se toma del access token: no hay forma de cambiar la de otra cuenta por este endpoint.',
  })
  @ApiBody({ schema: zodToApiSchema(passwordChangeRequestSchema) })
  @ApiResponse({ status: 200, description: 'Código enviado — `{ pinChallengeRequired, challengeToken, expiresInMinutes }`.' })
  @ApiResponse({
    status: 401,
    description: 'La contraseña actual no es correcta, se pidió otro código antes del minuto, o la cuenta ya no está disponible.',
  })
  @ApiResponse({ status: 503, description: 'No hay canal de correo configurado: no se cambia una contraseña sin segundo factor.' })
  @Post('change/request')
  @HttpCode(HttpStatus.OK)
  requestPasswordChange(
    @Body(new ZodValidationPipe(passwordChangeRequestSchema)) body: PasswordChangeRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.passwordChange.requestPasswordChange({
      ...requesterFrom(currentUser),
      currentPassword: body.currentPassword,
      ip: request.ip ?? null,
      userAgent: userAgentFrom(request),
    });
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Confirmar cambio de contraseña',
    description:
      'Segundo paso: canjea el `challengeToken` más el código de 6 dígitos recibido por correo por la contraseña nueva. ' +
      'Al completarse se revocan TODAS las sesiones del actor —incluida la que hizo la llamada— y se baja la bandera ' +
      '`mustChangePassword`. El cliente debe volver al login con la contraseña nueva.',
  })
  @ApiBody({ schema: zodToApiSchema(passwordChangeConfirmSchema) })
  @ApiResponse({ status: 200, description: 'Contraseña cambiada — `{ passwordChanged: true }`. Todas las sesiones quedaron revocadas.' })
  @ApiResponse({
    status: 401,
    description: 'Código inválido/expirado, desafío de otra cuenta u otro propósito, contraseña débil, o igual a la actual.',
  })
  @Post('change/confirm')
  @HttpCode(HttpStatus.OK)
  confirmPasswordChange(
    @Body(new ZodValidationPipe(passwordChangeConfirmSchema)) body: PasswordChangeConfirmDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.passwordChange.confirmPasswordChange({
      ...requesterFrom(currentUser),
      challengeToken: body.challengeToken,
      code: body.code,
      newPassword: body.newPassword,
      ip: request.ip ?? null,
      userAgent: userAgentFrom(request),
    });
  }
}

/**
 * Traduce los claims del access token a la pareja `(actorType, actorId)` con la que trabajan el
 * resolver y el repositorio.
 *
 * El orden importa y no es alfabético: un token lleva exactamente uno de estos ids, pero si alguna
 * vez llevara más de uno, el más específico debe ganar. Un token sin ninguno no identifica a nadie
 * y se rechaza en vez de asumir `platform_user`, que es el actor con más alcance de todos —
 * `AuthController.getMe` sí hace esa suposición y aquí sería la diferencia entre informar mal un
 * perfil y escribir la contraseña de la cuenta equivocada.
 */
function requesterFrom(user: AuthenticatedUser): { actorType: ActorType; actorId: string; tenantId: string | null } {
  const tenantId = user.tenantId ?? null;
  if (user.customerId) return { actorType: 'customer', actorId: user.customerId, tenantId };
  if (user.merchantUserId) return { actorType: 'merchant_user', actorId: user.merchantUserId, tenantId };
  if (user.internalUserId) return { actorType: 'internal_user', actorId: user.internalUserId, tenantId };
  if (user.platformUserId) return { actorType: 'platform_user', actorId: user.platformUserId, tenantId };
  throw new UnauthorizedException('El token no identifica a ningún actor con contraseña propia.');
}
