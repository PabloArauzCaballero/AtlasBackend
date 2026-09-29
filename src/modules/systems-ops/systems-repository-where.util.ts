/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { Op, WhereOptions } from 'sequelize';
import { SystemsActionLogQueryDto, SystemsListQueryDto, SystemsStressProfileQueryDto } from './systems-ops.schemas.js';
import { containsPattern } from '../../common/utils/strings/like-pattern.util.js';

const ilike = (value: string) => ({ [Op.iLike]: containsPattern(value) });

export function buildEndpointTextWhere(query: SystemsListQueryDto): WhereOptions {
  const where: Record<string, unknown> = {
    ...(query.module ? { module: query.module } : {}),
    ...(query.block ? { systemCode: query.block } : {}),
    ...(query.backendService ? { backendService: query.backendService } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.riskLevel ? { riskLevel: query.riskLevel } : {}),
    ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
  };

  // El buscador de la pantalla promete «ruta, módulo o propósito»: el módulo y el método del
  // controlador (`handlerName`) no entraban, así que buscar `loans` o `createLoan` no devolvía nada.
  if (query.q) {
    where[Op.or as unknown as string] = [
      { code: ilike(query.q) },
      { fullPath: ilike(query.q) },
      { routeName: ilike(query.q) },
      { businessPurpose: ilike(query.q) },
      { module: ilike(query.q) },
      { handlerName: ilike(query.q) },
    ];
  }

  return where as WhereOptions;
}

export function buildToolWhere(query: SystemsListQueryDto): WhereOptions {
  const where: Record<string, unknown> = {
    ...(query.status ? { status: query.status } : {}),
  };

  // El placeholder de Herramientas prometía «proveedor» y sólo se buscaba en código y nombre.
  if (query.q) {
    where[Op.or as unknown as string] = [
      { code: ilike(query.q) },
      { name: ilike(query.q) },
      { provider: ilike(query.q) },
      { type: ilike(query.q) },
    ];
  }

  return where as WhereOptions;
}

export function buildDataEntityWhere(query: SystemsListQueryDto): WhereOptions {
  const where: Record<string, unknown> = {
    ...(query.module ? { module: query.module } : {}),
    ...(query.block ? { systemCode: query.block } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
  };

  if (query.q) {
    where[Op.or as unknown as string] = [
      { tableName: { [Op.iLike]: `%${query.q}%` } },
      { entityName: { [Op.iLike]: `%${query.q}%` } },
      { modelName: { [Op.iLike]: `%${query.q}%` } },
      // El esquema entra en la busqueda porque en un catalogo de tres bloques es lo que distingue
      // `atlas_accounting.invoice` de una tabla homonima de otro producto.
      { schemaName: { [Op.iLike]: `%${query.q}%` } },
    ];
  }

  return where as WhereOptions;
}

export function buildActionLogWhere(query: SystemsActionLogQueryDto): WhereOptions {
  const where: Record<string, unknown> = {
    ...(query.endpointId ? { endpointCatalogId: query.endpointId } : {}),
    ...(query.requestId ? { requestId: query.requestId } : {}),
    ...(query.correlationId ? { correlationId: query.correlationId } : {}),
    ...(query.method ? { method: query.method } : {}),
    ...(query.statusCode ? { responseStatusCode: query.statusCode } : {}),
    ...(query.actorType ? { actorType: query.actorType } : {}),
    ...(query.module ? { module: query.module } : {}),
    ...(query.riskLevel ? { riskLevel: query.riskLevel } : {}),
    ...(query.containsPii !== undefined ? { containsPii: query.containsPii } : {}),
  };

  // Búsqueda libre sobre lo que la tabla enseña: la ruta (plantilla y URL ya saneada) y el rol del
  // actor. Antes sólo se podía buscar un Request ID exacto, que nadie tiene a mano.
  if (query.q) {
    where[Op.or as unknown as string] = [
      { routeTemplate: ilike(query.q) },
      { resolvedUrlSanitized: ilike(query.q) },
      { actorRole: ilike(query.q) },
    ];
  }

  if (query.from || query.to) {
    where.occurredAt = {
      ...(query.from ? { [Op.gte]: new Date(query.from) } : {}),
      ...(query.to ? { [Op.lte]: new Date(query.to) } : {}),
    };
  }

  return where as WhereOptions;
}

export function buildStressProfileWhere(query: SystemsStressProfileQueryDto): WhereOptions {
  const where: Record<string, unknown> = {
    ...(query.endpointId ? { endpointId: query.endpointId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.enabled !== undefined ? { isEnabled: query.enabled } : {}),
  };

  if (query.q) {
    where[Op.or as unknown as string] = [
      { code: { [Op.iLike]: `%${query.q}%` } },
      { name: { [Op.iLike]: `%${query.q}%` } },
      { notes: { [Op.iLike]: `%${query.q}%` } },
    ];
  }

  return where as WhereOptions;
}
