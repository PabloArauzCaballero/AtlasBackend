/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Finanzas necesita saber cuánto DINERO está aprobado y todavía no desembolsado, no
 *   cuántas solicitudes: es caja comprometida que aún no salió.
 * @system añade a `read_api.v_commercial_conversion_v1` el monto de las aprobadas y el de las
 *   aprobadas sin crédito desembolsado. Sólo columnas nuevas al final: `CREATE OR REPLACE VIEW`
 *   las admite sin tirar la vista ni sus permisos de lectura.
 */
import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

/*
 * No existe un «monto aprobado» distinto del solicitado: la solicitud no cambia de importe al
 * aprobarse (no hay columna para ello), así que el aprobado ES el solicitado de las aprobadas. Se
 * nombra así en la vista para que quien la lea sepa qué está sumando.
 */
const COLUMNAS_COMUNES = `
      a._tenant_id                                                        AS tenant_id,
      date_trunc('month', a.submitted_at)::date                           AS mes,
      p.product_code                                                      AS producto,
      count(*)                                                            AS solicitudes,
      count(*) FILTER (WHERE a.status = 'approved')                       AS aprobadas,
      count(*) FILTER (WHERE a.status = 'rejected')                       AS rechazadas,
      count(l._id)                                                        AS desembolsadas,
      sum(a.requested_amount)                                             AS monto_solicitado,
      sum(l.principal_amount)                                             AS monto_desembolsado,
      round(count(*) FILTER (WHERE a.status = 'approved')::numeric
            / NULLIF(count(*), 0) * 100, 2)                               AS tasa_aprobacion_pct,
      round(count(l._id)::numeric / NULLIF(count(*), 0) * 100, 2)         AS tasa_desembolso_pct`;

const DESDE = `
    FROM credit.credit_applications a
    JOIN credit.credit_products p ON p._id = a.credit_product_id AND p._tenant_id = a._tenant_id
    LEFT JOIN credit.loans l ON l.credit_application_id = a._id AND l._deleted = false
    WHERE a._deleted = false
    GROUP BY 1, 2, 3`;

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    CREATE OR REPLACE VIEW read_api.v_commercial_conversion_v1 AS
    SELECT${COLUMNAS_COMUNES},
      sum(a.requested_amount) FILTER (WHERE a.status = 'approved')        AS monto_aprobado,
      sum(a.requested_amount) FILTER (WHERE a.status = 'approved' AND l._id IS NULL)
                                                                          AS monto_aprobado_sin_desembolso
    ${DESDE}
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  /* Quitar columnas exige recrear la vista: `CREATE OR REPLACE` no las elimina. */
  await queryInterface.sequelize.query('DROP VIEW IF EXISTS read_api.v_commercial_conversion_v1');
  await queryInterface.sequelize.query(`
    CREATE VIEW read_api.v_commercial_conversion_v1 AS
    SELECT${COLUMNAS_COMUNES}
    ${DESDE}
  `);
}
