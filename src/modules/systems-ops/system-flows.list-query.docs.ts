/**
 * @file Documentación OpenAPI de los parámetros de consulta de Flujos que se buscan y paginan.
 * @business Esta pieza hace que el contrato publicado diga qué se puede buscar y filtrar en la deriva de permisos y el trabajo pendiente.
 * @system agrupa los `@ApiQuery` en decoradores para que el controlador no crezca con cada parámetro.
 */
import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { DRIFT_SEVERITIES, PENDING_WORK_STATES } from './system-flows.list-query.js';

const page = ApiQuery({ name: 'page', required: false, description: 'Página (1 por omisión). Sólo cuenta si se indica `limit`.' });

export const ApiPendingWorkQuery = () =>
  applyDecorators(
    ApiQuery({
      name: 'q',
      required: false,
      description: 'Texto libre: método, ruta y códigos de evento de cada flujo (sin distinguir mayúsculas; `%` y `_` son texto).',
    }),
    ApiQuery({
      name: 'state',
      required: false,
      enum: PENDING_WORK_STATES,
      description: 'Sólo flujos con pendientes (`pending`), con fallidos (`failed`) o que el consumidor saltó (`skipped`).',
    }),
    page,
    ApiQuery({
      name: 'limit',
      required: false,
      description: 'Filas por página (1 a 100). Sin él, `flows` llega entero (hasta el corte declarado en `truncated`) y sin `meta`.',
    }),
  );

export const ApiRbacDriftQuery = () =>
  applyDecorators(
    ApiQuery({
      name: 'q',
      required: false,
      description: 'Texto libre: cliente, pantalla, método, ruta y flujo de cada llamada (sin distinguir mayúsculas; `%` y `_` son texto).',
    }),
    ApiQuery({ name: 'severity', required: false, enum: DRIFT_SEVERITIES, description: 'Sólo llamadas de esa clase de desajuste.' }),
    ApiQuery({
      name: 'clientCode',
      required: false,
      description: 'Sólo llamadas desde pantallas de ese cliente (`summary.clients` lista los que hay).',
    }),
    page,
    ApiQuery({
      name: 'limit',
      required: false,
      description: 'Filas por página (1 a 100). Sin él, `items` trae todas las llamadas que cumplen los filtros y no hay `meta`.',
    }),
  );
