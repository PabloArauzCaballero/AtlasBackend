/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza deja que una persona se verifique desde su teléfono con su carnet, sin pasar por una sucursal.
 * @system expone el par aceptar/consultar que un cliente móvil necesita para un trámite que tarda.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { requireIdempotencyKey } from '../../common/utils/http/headers.util.js';
import { MobileIdentityService } from './mobile-identity.service.js';
import {
  identityVerificationIdParamsSchema,
  IdentityVerificationIdParamsDto,
  startIdentityVerificationSchema,
  StartIdentityVerificationDto,
} from './mobile-identity.schemas.js';

/**
 * Verificación de identidad desde el móvil.
 *
 * Dos endpoints y no uno, porque el trámite tarda: verificar de verdad son
 * segundos, y un caso que acaba delante de una persona son horas. Se acepta, se
 * devuelve un identificador y el móvil pregunta por él. Un endpoint síncrono
 * obligaría a elegir entre colgar la petición o mentir sobre el resultado.
 */
@ApiTags('mobile-identity')
@Controller('mobile/identity-verifications')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class MobileIdentityController {
  constructor(private readonly service: MobileIdentityService) {}

  /*
   * Cinco intentos por minuto. Es un endpoint que recibe imágenes y dispara una
   * cadena cara —lectura, biometría, una decisión versionada—, así que el tope
   * es más estricto que el de un formulario: sin él, un cliente con un bucle mal
   * escrito consume la cuota del motor de todo el inquilino.
   */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Enviar carnet y selfie para verificar la identidad',
    description:
      'Acepta las imágenes y devuelve el identificador con el que consultar el resultado. NO espera al veredicto: la verificación ' +
      'tarda segundos, y un caso derivado a revisión humana tarda horas. Las imágenes NO se almacenan aquí; viajan al motor de ' +
      'decisión, que las descarta al cerrar su ejecución.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true, description: 'Tenant al que pertenece la verificación.' })
  @ApiHeader({ name: 'x-idempotency-key', required: true, description: 'Evita cobrar dos veces la misma verificación ante un reintento.' })
  @ApiBody({ schema: zodToApiSchema(startIdentityVerificationSchema) })
  @ApiResponse({ status: 202, description: 'Aceptada — devuelve verificationId y estado PENDING.' })
  @ApiResponse({ status: 400, description: 'x-tenant-id/x-idempotency-key ausente, o imágenes inválidas.' })
  @ApiResponse({ status: 503, description: 'DECISION_ENGINE_NOT_CONFIGURED — esta instalación no tiene el motor conectado.' })
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  start(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(startIdentityVerificationSchema)) body: StartIdentityVerificationDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.start(tenantId, body, requireIdempotencyKey(idempotencyKey), currentUser);
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Consultar el resultado de una verificación',
    description:
      'Devuelve el estado del trámite: PENDING mientras se resuelve, VERIFIED, REJECTED, IN_REVIEW cuando lo está mirando una ' +
      'persona, o UNAVAILABLE si no se pudo preguntar al motor. `UNAVAILABLE` NO es un rechazo y el cliente no debe pintarlo como tal.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true, description: 'Tenant al que pertenece la verificación.' })
  @ApiParam({ name: 'verificationId', description: 'El identificador devuelto al enviar las imágenes.' })
  @ApiResponse({ status: 200, description: 'Estado actual de la verificación.' })
  @ApiResponse({ status: 404, description: 'IDENTITY_VERIFICATION_NOT_FOUND — no existe en este tenant.' })
  @Get(':verificationId')
  get(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(identityVerificationIdParamsSchema)) params: IdentityVerificationIdParamsDto,
  ) {
    return this.service.get(tenantId, params.verificationId);
  }
}
