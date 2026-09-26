/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../../common/openapi/zod-to-schema.util.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AuthBrokerClient } from '../infrastructure/auth-broker/auth-broker.client.js';
import {
  providerCodeParamsSchema,
  ProviderCodeParamsDto,
  providerCredentialRevocationSchema,
  ProviderCredentialRevocationDto,
  providerCredentialRotationSchema,
  ProviderCredentialRotationDto,
} from '../external-data.schemas.js';

/**
 * Administración de la autenticación con proveedores externos.
 *
 * Vive en un controller propio y no dentro de `AdminExternalProvidersController` por dos razones:
 * el gate `check:file-size` (ese archivo ya fue troceado una vez por tamaño) y, sobre todo,
 * porque su superficie de riesgo es distinta — aquí se rota y se revoca material de credenciales,
 * no se ajustan políticas de costo.
 *
 * NINGÚN endpoint de este controller devuelve material de credencial. La ruta del broker que sí
 * lo hace (`/outbound/providers/:code/authorize`) no se expone: la consumen los adaptadores
 * dentro del proceso, nunca el portal.
 */
@ApiTags('external-data-admin')
@ApiBearerAuth('access-token')
@Controller('admin/external-providers')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('admin', 'platform_admin', 'risk_analyst', 'compliance_analyst')
export class ProviderAuthAdminController {
  constructor(private readonly authBroker: AuthBrokerClient) {}

  @ApiOperation({
    summary: 'Disponibilidad del worker de autenticación',
    description:
      'Indica si este despliegue delega la autenticación de proveedores en el broker y si el broker responde. No lanza: `configured: false` significa que la delegación aún no está activada.',
  })
  @ApiResponse({ status: 200, description: 'Estado del broker de autenticación.' })
  @Get('auth-broker/availability')
  availability() {
    return this.authBroker.availability();
  }

  @ApiOperation({
    summary: 'Estado de autenticación de todos los proveedores',
    description:
      'Estado de la credencial (activa, por rotar, vencida, revocada, ausente) y del token de acceso vigente de cada proveedor. Solo campos publicables: huellas, fechas y códigos de fallo.',
  })
  @ApiResponse({ status: 200, description: 'Estado de autenticación por proveedor.' })
  @ApiResponse({ status: 503, description: 'El broker de autenticación no está configurado o no responde.' })
  @Get('auth-state')
  listAuthStates() {
    return this.authBroker.listAuthStates().then((providers) => ({ providers }));
  }

  @ApiOperation({ summary: 'Credenciales que exigen rotación, ordenadas por urgencia' })
  @ApiResponse({ status: 200, description: 'Credenciales vencidas, revocadas, ausentes o por rotar.' })
  @Get('credentials/pending-rotation')
  pendingRotation() {
    return this.authBroker.pendingRotation().then((credentials) => ({ credentials }));
  }

  @ApiOperation({ summary: 'Estado de autenticación de un proveedor' })
  @ApiParam({ name: 'providerCode', schema: zodToApiSchema(providerCodeParamsSchema.shape.providerCode) })
  @ApiResponse({ status: 200, description: 'Estado de autenticación del proveedor.' })
  @Get(':providerCode/auth-state')
  authState(@Param(new ZodValidationPipe(providerCodeParamsSchema)) params: ProviderCodeParamsDto) {
    return this.authBroker.authStateFor(params.providerCode);
  }

  /**
   * Restringido a admin/platform_admin: el `@Roles` de clase da visibilidad de solo lectura a los
   * perfiles de investigación, pero sustituir el material de una credencial es una acción de
   * plataforma. El material viaja en el cuerpo y NO se persiste aquí: se reenvía al broker, que
   * es quien lo sella. Por eso este endpoint no escribe en base de datos ni registra el cuerpo.
   */
  @ApiOperation({
    summary: 'Rotar la credencial de un proveedor (solo admin)',
    description:
      'Envía material nuevo al broker, que lo sella e invalida el token cacheado. La respuesta devuelve la huella de la credencial resultante, nunca el material.',
  })
  @ApiParam({ name: 'providerCode', schema: zodToApiSchema(providerCodeParamsSchema.shape.providerCode) })
  @ApiBody({ schema: zodToApiSchema(providerCredentialRotationSchema) })
  @ApiResponse({ status: 200, description: 'Credencial rotada; devuelve huella y fecha.' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso (solo admin/platform_admin).' })
  @Roles('admin', 'platform_admin')
  @Post(':providerCode/credentials/rotate')
  @HttpCode(HttpStatus.OK)
  rotate(
    @Param(new ZodValidationPipe(providerCodeParamsSchema)) params: ProviderCodeParamsDto,
    @Body(new ZodValidationPipe(providerCredentialRotationSchema)) body: ProviderCredentialRotationDto,
  ) {
    return this.authBroker.rotateCredential(params.providerCode, body.field, body.material);
  }

  @ApiOperation({
    summary: 'Revocar la credencial de un proveedor (solo admin)',
    description: 'A partir de la revocación el broker se niega a autorizar llamadas al proveedor. Úsese ante sospecha de compromiso.',
  })
  @ApiParam({ name: 'providerCode', schema: zodToApiSchema(providerCodeParamsSchema.shape.providerCode) })
  @ApiBody({ schema: zodToApiSchema(providerCredentialRevocationSchema) })
  @ApiResponse({ status: 200, description: 'Credencial revocada.' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso (solo admin/platform_admin).' })
  @Roles('admin', 'platform_admin')
  @Post(':providerCode/credentials/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @Param(new ZodValidationPipe(providerCodeParamsSchema)) params: ProviderCodeParamsDto,
    @Body(new ZodValidationPipe(providerCredentialRevocationSchema)) body: ProviderCredentialRevocationDto,
  ) {
    return this.authBroker.revokeCredential(params.providerCode, body.reason);
  }

  @ApiOperation({
    summary: 'Forzar la renovación del token de un proveedor (solo admin)',
    description: 'Descarta el token cacheado en el broker; la próxima llamada pedirá uno nuevo.',
  })
  @ApiParam({ name: 'providerCode', schema: zodToApiSchema(providerCodeParamsSchema.shape.providerCode) })
  @ApiResponse({ status: 200, description: 'Token invalidado.' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso (solo admin/platform_admin).' })
  @Roles('admin', 'platform_admin')
  @Post(':providerCode/credentials/invalidate-token')
  @HttpCode(HttpStatus.OK)
  invalidateToken(@Param(new ZodValidationPipe(providerCodeParamsSchema)) params: ProviderCodeParamsDto) {
    return this.authBroker.invalidateToken(params.providerCode);
  }
}
