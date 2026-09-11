/**
 * @file Repositorio de la capa de datos: encapsula el acceso a PostgreSQL.
 * @business Esta pieza cuenta lo que impide certificar la documentación de flujos tal como está hoy.
 * @system consulta el catálogo de flujos, los hallazgos abiertos y las cargas del artefacto.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction, literal } from 'sequelize';
import { SystemFlowCatalogModel } from '../../database/models/system-flow-catalog.model.js';
import { SystemFlowFindingModel } from '../../database/models/system-flow-findings.model.js';
import { SystemFlowImportModel } from '../../database/models/system-flow-imports.model.js';
import { SystemScreenCatalogModel } from '../../database/models/system-screen-catalog.model.js';

@Injectable()
export class SystemFlowsGateRepository {
  constructor(
    @InjectModel(SystemFlowCatalogModel) private readonly flows: typeof SystemFlowCatalogModel,
    @InjectModel(SystemFlowFindingModel) private readonly findings: typeof SystemFlowFindingModel,
    @InjectModel(SystemFlowImportModel) private readonly imports: typeof SystemFlowImportModel,
    @InjectModel(SystemScreenCatalogModel) private readonly screens: typeof SystemScreenCatalogModel,
  ) {}

  /** CRITICAL que no están verificados SOBRE SU CÓDIGO ACTUAL: sin corridas, rotos, o verificados antes de cambiar. */
  async criticalNotCertified(): Promise<Array<{ systemCode: string; count: number }>> {
    const rows = await this.flows.count({
      where: { risk: 'CRITICAL', [Op.or]: [{ verification: { [Op.ne]: 'VERIFIED' } }, { freshness: 'STALE' }] },
      group: ['systemCode'],
    });
    return rows as unknown as Array<{ systemCode: string; count: number }>;
  }

  openFindingsOfKind(kind: string): Promise<number> {
    return this.findings.count({ where: { kind, status: 'open' } });
  }

  /** Pendientes Y rechazados de riesgo alto: un rechazo dice que el análisis de ese flujo está mal. */
  unresolvedHighReviews(): Promise<number> {
    return this.flows.count({
      where: { reviewStatus: { [Op.in]: ['NEEDS_REVIEW', 'REJECTED'] }, risk: { [Op.in]: ['CRITICAL', 'HIGH'] } },
    });
  }

  openFindingsOfSystem(systemCode: string, tx?: Transaction): Promise<number> {
    return this.findings.count({ where: { systemCode, status: 'open' }, transaction: tx });
  }

  /** Pantallas del cliente cuyo menú pide permiso o rol: lo que una carga sin puertas borraría. */
  gatedScreensOfClient(clientCode: string, tx?: Transaction): Promise<number> {
    const conPuerta = `(jsonb_typeof(nav_permissions) = 'array' AND jsonb_array_length(nav_permissions) > 0) OR (jsonb_typeof(nav_roles) = 'array' AND jsonb_array_length(nav_roles) > 0)`;
    return this.screens.count({ where: { clientCode, [Op.and]: [literal(conPuerta)] }, transaction: tx });
  }

  /** Qué (alcance, bloque o cliente) tiene al menos una carga del artefacto. */
  async importedScopes(): Promise<Set<string>> {
    const rows = await this.imports.findAll({ attributes: ['scope', 'systemCode'], group: ['scope', 'system_code'], raw: true });
    return new Set((rows as unknown as Array<{ scope: string; systemCode: string }>).map((row) => `${row.scope}:${row.systemCode}`));
  }
}
