/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza hace observable y gobernable el ECOSISTEMA entero, no sólo este backend.
 * @system publica los bloques del ecosistema, su federación de catálogo y la salud de la red.
 */
import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { AccessToken } from '../../common/decorators/access-token.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { SystemsOpsControllerSecurity } from './systems-controller.decorators.js';
import { SYSTEMS_OPS_GOVERNANCE_ROLES } from './systems-ops.constants.js';
import { systemsBlockParamsSchema, SystemsBlockParamsDto } from './systems-ops.schemas.js';
import { DecisionEngineArtifactsService } from './decision-engine-artifacts.service.js';
import { PlatformCatalogFederationService } from './platform-catalog-federation.service.js';
import { SystemsNetworkHealthService } from './systems-network-health.service.js';

/**
 * Controlador aparte y no más métodos en `SystemsCatalogController`.
 *
 * Aquel contesta «qué hay catalogado»; éste contesta «de quién es y está el ecosistema completo».
 * Son dos preguntas con dueños distintos —el catálogo lo revisa gobierno de datos, la red la mira
 * operaciones— y separarlas mantiene cada archivo por debajo del trinquete de tamaño sin partir
 * ningún caso de uso por la mitad.
 */
@Controller('systems')
@SystemsOpsControllerSecurity()
export class SystemsNetworkController {
  constructor(
    private readonly network: SystemsNetworkHealthService,
    private readonly federation: PlatformCatalogFederationService,
    private readonly artifacts: DecisionEngineArtifactsService,
  ) {}

  @ApiOperation({ summary: 'Listar los bloques del ecosistema con lo que cada uno aporta al catálogo' })
  @ApiResponse({ status: 200, description: 'Bloques con sus contadores de endpoints y entidades.' })
  @Get('blocks')
  listBlocks() {
    return this.network.listBlocks();
  }

  @ApiOperation({ summary: 'Salud de la RED: estado de cada bloque y de su federación de catálogo' })
  @ApiResponse({ status: 200, description: 'Reporte de salud del ecosistema por bloque.' })
  @Get('health/network')
  getNetworkHealth() {
    return this.network.getNetworkHealth();
  }

  @ApiOperation({ summary: 'Refederar el catálogo de todos los bloques del ecosistema' })
  @ApiResponse({ status: 201, description: 'Desenlace de la federación por bloque.' })
  @Post('blocks/federate')
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  federateAll(@AccessToken() callerToken: string | null) {
    return this.federation.federateAll(callerToken);
  }

  @ApiOperation({ summary: 'Refederar el catálogo de un bloque concreto' })
  @ApiParam({ name: 'systemCode', schema: zodToApiSchema(systemsBlockParamsSchema.shape.systemCode) })
  @ApiResponse({ status: 201, description: 'Desenlace de la federación del bloque.' })
  @Post('blocks/:systemCode/federate')
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  federateBlock(
    @Param(new ZodValidationPipe(systemsBlockParamsSchema)) params: SystemsBlockParamsDto,
    @AccessToken() callerToken: string | null,
  ) {
    return this.federation.federateBlock(params.systemCode, callerToken);
  }

  @ApiOperation({ summary: 'Artefactos ACTIVOS del motor de decisión, con su despliegue vigente' })
  @ApiResponse({ status: 200, description: 'Artefactos con despliegue activo, ambiente y reparto de tráfico.' })
  @Get('decision-engine/artifacts')
  listActiveArtifacts(@AccessToken() callerToken: string | null) {
    return this.artifacts.listActiveArtifacts(callerToken);
  }
}
