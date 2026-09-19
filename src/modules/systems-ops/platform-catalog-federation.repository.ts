/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system escribe el catálogo federado de otros bloques y la bitácora de cada federación.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { fn, Op } from 'sequelize';
import { SystemBlockFederationStateModel, SystemDataEntityCatalogModel, SystemEndpointCatalogModel } from '../../database/models/index.js';
import { FederationOutcome } from './platform-catalog-manifest.types.js';

@Injectable()
export class PlatformCatalogFederationRepository {
  constructor(
    @InjectModel(SystemEndpointCatalogModel) private readonly endpointModel: typeof SystemEndpointCatalogModel,
    @InjectModel(SystemDataEntityCatalogModel) private readonly dataEntityModel: typeof SystemDataEntityCatalogModel,
    @InjectModel(SystemBlockFederationStateModel) private readonly stateModel: typeof SystemBlockFederationStateModel,
  ) {}

  /**
   * Inserta o actualiza una fila del catálogo por su clave natural.
   *
   * `structural` es lo que el bloque remoto sabe de verdad y vuelve a escribirse en cada federación.
   * `insertOnly` sólo se aplica al CREAR: son los campos de gobierno —dueño, estado de revisión,
   * confianza— que a partir de ahí pertenecen a quien los revise aquí. Sobreescribirlos devolvería
   * a «auto detectado» cada tabla que una persona ya aprobó, borrando ese trabajo en silencio en
   * cada refresco.
   *
   * Se busca primero y se decide después, en vez de usar `upsert`: el `upsert` de Sequelize deriva
   * su `ON CONFLICT` de las claves únicas DECLARADAS EN EL MODELO, y la de entidades de datos vive
   * sólo en la base (`ux_..._block_schema_table`). Confiar en él aquí insertaría una fila nueva en
   * cada federación hasta que la base lo rechazara, y el error llegaría al panel disfrazado de
   * fallo del bloque remoto.
   */
  async upsertEndpointRow(structural: Record<string, unknown>, insertOnly: Record<string, unknown>): Promise<void> {
    const existing = await this.endpointModel.findOne({ where: { code: String(structural.code) } });
    if (existing) await existing.update(reactivate(existing.status, structural));
    else await this.endpointModel.create({ ...insertOnly, ...structural } as never);
  }

  async upsertDataEntityRow(structural: Record<string, unknown>, insertOnly: Record<string, unknown>): Promise<void> {
    const existing = await this.dataEntityModel.unscoped().findOne({
      where: {
        systemCode: String(structural.systemCode),
        schemaName: String(structural.schemaName),
        tableName: String(structural.tableName),
      },
    });
    if (existing) await existing.update(reactivate(existing.status, structural));
    else await this.dataEntityModel.create({ ...insertOnly, ...structural } as never);
  }

  /**
   * Marca como DEPRECATED lo que el bloque dejó de reportar, en vez de borrarlo.
   *
   * Borrar rompería lo que ya cuelga de esas filas —impactos, revisiones, notas de gobierno— y,
   * sobre todo, borraría la evidencia de que la ruta o la tabla existió. Un catálogo que olvida lo
   * retirado no sirve para contestar «¿dónde estuvo este dato el trimestre pasado?», que es
   * exactamente lo que una auditoría viene a preguntar.
   */
  async deprecateMissingEndpoints(systemCode: string, keptCodes: readonly string[]): Promise<number> {
    const rows = await this.endpointModel.findAll({
      where: { systemCode, status: { [Op.ne]: 'DEPRECATED' } },
      attributes: ['id', 'code'],
    });
    const kept = new Set(keptCodes);
    const stale = rows.filter((row) => !kept.has(row.code));
    for (const row of stale) await row.update({ status: 'DEPRECATED', updatedAtValue: new Date() });
    return stale.length;
  }

  async deprecateMissingDataEntities(systemCode: string, keptKeys: readonly string[]): Promise<number> {
    const rows = await this.dataEntityModel.findAll({
      where: { systemCode, status: { [Op.ne]: 'DEPRECATED' } },
      attributes: ['id', 'schemaName', 'tableName'],
    });
    const kept = new Set(keptKeys);
    const stale = rows.filter((row) => !kept.has(`${row.schemaName}.${row.tableName}`));
    for (const row of stale) await row.update({ status: 'DEPRECATED', updatedAtValue: new Date() });
    return stale.length;
  }

  countEndpoints(systemCode: string): Promise<number> {
    return this.endpointModel.count({ where: { systemCode } });
  }

  countDataEntities(systemCode: string): Promise<number> {
    return this.dataEntityModel.count({ where: { systemCode } });
  }

  /** Una sola pasada por tabla: el panel necesita las cuentas de TODOS los bloques a la vez. */
  async countsByBlock(): Promise<{ endpoints: Map<string, number>; dataEntities: Map<string, number> }> {
    const [endpointRows, entityRows] = await Promise.all([
      this.endpointModel.findAll({
        attributes: ['systemCode', [fn('COUNT', '*'), 'count']],
        group: ['system_code'],
        raw: true,
      }),
      this.dataEntityModel.findAll({
        attributes: ['systemCode', [fn('COUNT', '*'), 'count']],
        group: ['system_code'],
        raw: true,
      }),
    ]);
    return { endpoints: toCountMap(endpointRows), dataEntities: toCountMap(entityRows) };
  }

  listStates(): Promise<SystemBlockFederationStateModel[]> {
    return this.stateModel.findAll();
  }

  async recordOutcome(outcome: FederationOutcome): Promise<void> {
    const now = new Date();
    const existing = await this.stateModel.findOne({ where: { systemCode: outcome.systemCode } });
    const values = {
      systemCode: outcome.systemCode,
      lastAttemptAt: now,
      // El instante del último ÉXITO sobrevive a los fallos posteriores a propósito: «funcionó hace
      // diez minutos» y «no ha funcionado nunca» son diagnósticos distintos, y perder el primero al
      // primer fallo dejaría al operador sin el dato que decide si esto es una caída o una avería.
      lastSuccessAt: outcome.status === 'OK' ? now : (existing?.lastSuccessAt ?? null),
      lastStatus: outcome.status,
      lastMessage: outcome.message,
      endpointsImported: outcome.endpointsImported,
      dataEntitiesImported: outcome.dataEntitiesImported,
      remoteVersion: outcome.remoteVersion,
      remoteCommit: outcome.remoteCommit,
      updatedAtValue: now,
    };
    if (existing) await existing.update(values);
    else await this.stateModel.create({ ...values, createdAtValue: now } as never);
  }
}

/**
 * Devuelve a ACTIVE lo que estaba DEPRECATED y el bloque ha vuelto a reportar.
 *
 * Sólo desde DEPRECATED, y nunca desde `BLOCKED` ni `DRAFT`: aquellos son decisiones de una persona
 * sobre una ruta que existe, y una federación no puede revocarlas. `DEPRECATED` en cambio lo pone
 * esta misma federación cuando el bloque deja de reportar algo, así que deshacerlo cuando reaparece
 * es cerrar su propio ciclo, no pisar el criterio de nadie.
 */
function reactivate(currentStatus: string, structural: Record<string, unknown>): Record<string, unknown> {
  return currentStatus === 'DEPRECATED' ? { ...structural, status: 'ACTIVE' } : structural;
}

function toCountMap(rows: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const record = row as { systemCode?: string; count?: number | string };
    if (record.systemCode) map.set(record.systemCode, Number(record.count ?? 0));
  }
  return map;
}
