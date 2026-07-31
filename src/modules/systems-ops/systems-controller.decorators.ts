/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { SYSTEMS_OPS_ROLES } from './systems-ops.constants.js';

export function SystemsOpsControllerSecurity() {
  return applyDecorators(
    ApiTags('systems-ops'),
    ApiBearerAuth('access-token'),
    UseGuards(JwtAuthGuard, RolesGuard),
    Roles(...SYSTEMS_OPS_ROLES),
  );
}
