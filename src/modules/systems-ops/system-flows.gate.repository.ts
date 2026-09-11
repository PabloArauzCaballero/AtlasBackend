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

  /** Rutas del cliente cuyo menú pide permiso o rol: lo que una carga podría dejar sin puerta. */
  async gatedScreensOfClient(clientCode: string, tx?: Transaction): Promise<string[]> {
    const conPuerta = `(jsonb_typeof(nav_permissions) = 'array' AND jsonb_array_length(nav_permissions) > 0) OR (jsonb_typeof(nav_roles) = 'array' AND jsonb_array_length(nav_roles) > 0)`;
    const rows = await this.screens.findAll({
      attributes: ['route'],
      where: { clientCode, [Op.and]: [literal(conPuerta)] },
      transaction: tx,
      raw: true,
    });
    return (rows as unknown as Array<{ route: string }>).map((row) => row.route);
  }

  /** Todas las rutas del cliente en el catálogo: sirve para distinguir una pantalla nueva de una que ya estaba. */
  async screenRoutesOfClient(clientCode: string, tx?: Transaction): Promise<string[]> {
    const rows = await this.screens.findAll({ attributes: ['route'], where: { clientCode }, transaction: tx, raw: true });
    return (rows as unknown as Array<{ route: string }>).map((row) => row.route);
  }

  /** Cuándo se generó el artefacto más reciente cargado para este alcance y bloque; null si ninguna carga lo dijo. */
  async lastArtifactGeneratedAt(scope: string, systemCode: string, tx?: Transaction): Promise<Date | null> {
    // Las filas fechadas en el futuro NO cuentan: una sola (cargada antes de que existiera el guardián, o por una
    // máquina con el reloj adelantado) dejaba el alcance pidiendo confirmación en cada carga hasta llegar esa fecha.
    const value: unknown = await this.imports.max('artifactGeneratedAt', {
      where: { scope, systemCode, artifactGeneratedAt: { [Op.lte]: new Date() } },
      transaction: tx,
    });
    return value ? new Date(value as string | Date) : null;
  }

  /** Qué (alcance, bloque o cliente) tiene al menos una carga del artefacto. */
  async importedScopes(): Promise<Set<string>> {
    const rows = await this.imports.findAll({ attributes: ['scope', 'systemCode'], group: ['scope', 'system_code'], raw: true });
    return new Set((rows as unknown as Array<{ scope: string; systemCode: string }>).map((row) => `${row.scope}:${row.systemCode}`));
  }
}
