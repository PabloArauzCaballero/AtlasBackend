/**
 * @file Adaptador HTTP: el catálogo con el que el equipo de soporte clasifica y cierra.
 * @business Los motivos, las colas y los códigos de resolución que la consola del agente ofrece.
 * @system sólo lectura; separado de `internal/support/cases` para no chocar con la ruta `:caseId`.
 */
import { Controller, Get, Headers, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import { SupportActorService } from './application/support-actor.service.js';
import { SupportDeskService } from './application/support-desk.service.js';

/**
 * Por qué es un controlador aparte y no dos rutas más en `internal/support/cases`.
 *
 * Porque aquel declara `@Get(':caseId')`, y en Nest gana la primera ruta que encaja: `categories`
 * habría entrado por el parámetro y el agente habría recibido «caso no encontrado» al pedir el
 * catálogo. El prefijo `internal/support` deja las tres rutas fuera de esa colisión sin reordenar
 * un controlador que ya funciona.
 */
@ApiTags('Interno · Soporte')
@ApiBearerAuth('access-token')
@Controller('internal/support')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin')
export class InternalSupportCatalogController {
  constructor(
    private readonly actors: SupportActorService,
    private readonly desk: SupportDeskService,
  ) {}

  @ApiOperation({ summary: 'Árbol de motivos para clasificar, con cola y sensibilidad' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 403, description: 'SUPPORT_AGENT_PROFILE_REQUIRED: el rol no basta, hace falta perfil.' })
  @Get('categories')
  async categories(@Headers('x-tenant-id') tenantIdHeader: string | undefined, @CurrentUser() currentUser: AuthenticatedUser) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.desk.listInternalCategories({ tenantId, actor });
  }

  @ApiOperation({ summary: 'Colas activas: destino de un triage, una transferencia o un escalado' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Get('queues')
  async queues(@Headers('x-tenant-id') tenantIdHeader: string | undefined, @CurrentUser() currentUser: AuthenticatedUser) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.desk.listQueues({ tenantId, actor });
  }

  /**
   * Los códigos de cierre, con su descripción.
   *
   * No consulta la base y aun así vive detrás del token: la taxonomía de causas raíz es política
   * interna de atención, y publicarla enseñaría de qué se queja la plataforma y con qué frecuencia.
   */
  @ApiOperation({ summary: 'Códigos de resolución, causa raíz y prioridad, con su significado' })
  @Get('codes')
  codes() {
    return this.desk.supportCodes();
  }
}
