/**
 * @file Documentación OpenAPI de las rutas de calidad de datos del portal interno.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { ApiPortalFacetQuery, ApiPortalListQuery } from './internal-portal.schemas.js';

/**
 * Los decoradores de estas tres rutas viven aquí y no en el controller para que éste quepa en el
 * límite de tamaño: documentar bien la deprecación y los filtros ocupa más que el propio handler.
 */
export function ApiDataQualityRulesDocs(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Listar reglas de calidad de datos',
      description:
        '`q` busca en código, nombre, tabla y campo. `summary` (total, críticas, activas e incidencias pendientes) cuenta ' +
        'TODAS las reglas del filtro, no sólo la página. El conteo de incidencias pendientes (sin revisar o reconocidas) está ' +
        'acotado al tenant del token. `frequency` y `owner` van vacíos: la tabla no guarda ni frecuencia ni dueño.',
    }),
    ApiPortalListQuery(),
    ApiPortalFacetQuery('severity', 'Severidad de la regla (LOW, MEDIUM, HIGH, CRITICAL); no distingue mayúsculas.'),
    ApiQuery({
      name: 'status',
      required: false,
      schema: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
      description: 'Estado de la definición de la regla (activa o apagada). Las reglas no se ejecutan: no es un estado de ejecución.',
    }),
    ApiResponse({ status: 200, description: 'Lista paginada de reglas de calidad de datos con `summary`.' }),
  );
}

export function ApiDeprecatedAlertsDocs(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Listar alertas del panel interno (DEPRECADO)',
      description:
        'DEPRECADO desde 2026-09-29: las «alertas» son las incidencias de `data_quality_issues`, que el portal lista en ' +
        '`GET /operations/data-quality/issues` (búsqueda, filtros y `summary`). Sigue respondiendo igual para no romper ' +
        'clientes. Acotado al tenant del token.',
      deprecated: true,
    }),
    ApiPortalListQuery(),
    ApiPortalFacetQuery('status', 'Estado exacto de la alerta (OPEN, ACKNOWLEDGED, RESOLVED…).'),
    ApiPortalFacetQuery('severity', 'Severidad exacta de la regla que la levantó (LOW, MEDIUM, HIGH, CRITICAL).'),
    ApiResponse({ status: 200, description: 'Lista de alertas.' }),
  );
}

export function ApiDeprecatedAcknowledgeDocs(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Reconocer (acknowledge) una alerta (DEPRECADO)',
      description:
        'DEPRECADO desde 2026-09-29: reconocer es una resolución más de `POST /operations/data-quality/issues/:issueId/resolve` ' +
        '(`resolution: acknowledged`), con motivo y notas en la auditoría. Sigue funcionando: es idempotente (repetirlo no ' +
        'duplica la nota), no reabre una incidencia ya cerrada (409) y una incidencia reconocida sigue contando como ' +
        'pendiente. Solo alertas del propio tenant; una de otro tenant responde 404, igual que una inexistente.',
      deprecated: true,
    }),
    ApiParam({ name: 'alertId' }),
    ApiResponse({ status: 200, description: 'Alerta reconocida.' }),
    ApiResponse({ status: 404, description: 'DATA_QUALITY_ISSUE_NOT_FOUND.' }),
    ApiResponse({ status: 409, description: 'DATA_QUALITY_ISSUE_ALREADY_RESOLVED.' }),
  );
}
