/**
 * @file Servicio de aplicación: cifras agregadas del catálogo de tablas, rutas y suites, contadas en la base.
 * @business Gobierno de datos y la preparación del release leen cuántas tablas y rutas son sensibles o están documentadas.
 * @system una consulta `COUNT … FILTER` por familia sobre el catálogo entero, sin paginar por el camino.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

/** Estados de revisión que cuentan como «pendiente», los mismos que usa el mapa de dominios. */
const PENDING = `review_status IN ('NEEDS_REVIEW', 'AUTO_DETECTED')`;
const HAS_PURPOSE = `NULLIF(btrim(business_purpose), '') IS NOT NULL`;

const TABLES_SQL = `
SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE ${HAS_PURPOSE})::int AS "withPurpose",
       COUNT(*) FILTER (WHERE contains_pii)::int AS pii,
       COUNT(*) FILTER (WHERE contains_financial_data)::int AS financial,
       COUNT(*) FILTER (WHERE contains_risk_data)::int AS risk,
       COUNT(*) FILTER (WHERE contains_risk_data OR contains_financial_data)::int AS "financialOrRisk",
       COUNT(*) FILTER (WHERE contains_legal_data)::int AS legal,
       COUNT(*) FILTER (WHERE contains_device_data OR contains_location_data)::int AS "deviceOrLocation",
       COUNT(*) FILTER (WHERE is_audit_critical)::int AS "auditCritical",
       COUNT(*) FILTER (WHERE contains_pii OR contains_legal_data OR contains_location_data OR contains_device_data)::int AS "personalData",
       COUNT(*) FILTER (WHERE ${PENDING})::int AS "pendingReview"
  FROM system_data_entity_catalog`;

const ENDPOINTS_SQL = `
SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE ${HAS_PURPOSE})::int AS "withPurpose",
       COUNT(*) FILTER (WHERE is_testable_from_portal)::int AS "testableFromPortal",
       COUNT(*) FILTER (WHERE contains_pii)::int AS pii,
       COUNT(*) FILTER (WHERE contains_pii OR jsonb_array_length(COALESCE(pii_fields, '[]'::jsonb)) > 0)::int AS "personalData",
       COUNT(*) FILTER (WHERE is_destructive)::int AS destructive,
       COUNT(*) FILTER (WHERE risk_level IN ('HIGH', 'CRITICAL'))::int AS "highOrCritical",
       COUNT(*) FILTER (WHERE ${PENDING})::int AS "pendingReview"
  FROM system_endpoint_catalog`;

const SUITES_SQL = `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_enabled)::int AS enabled FROM system_test_suites`;

export type CatalogSummary = {
  generatedAt: string;
  tables: Record<string, number>;
  endpoints: Record<string, number>;
  testSuites: { total: number; enabled: number };
};

/**
 * «Gobierno de datos» y la preparación del release calculaban estas cifras en el navegador: el
 * primero bajando el catálogo entero página a página (y repitiéndolo en cada tecla del registro de
 * datos personales), el segundo sobre las primeras 100 filas de cada listado —los porcentajes de
 * «Cobertura tablas/endpoints» y «QA testable» salían de un corte sin decirlo—. Aquí se cuentan en la
 * base, enteras, con tres consultas.
 */
@Injectable()
export class SystemsCatalogSummaryService {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async summary(): Promise<CatalogSummary> {
    const [tables, endpoints, suites] = await Promise.all([
      this.one<Record<string, number>>(TABLES_SQL),
      this.one<Record<string, number>>(ENDPOINTS_SQL),
      this.one<{ total: number; enabled: number }>(SUITES_SQL),
    ]);
    return { generatedAt: new Date().toISOString(), tables, endpoints, testSuites: suites };
  }

  private async one<T extends object>(sql: string): Promise<T> {
    const rows = await this.sequelize.query<T>(sql, { type: QueryTypes.SELECT });
    const row = (rows[0] ?? {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value ?? 0)])) as T;
  }
}
