/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza publica la reportería con la que cada área de la empresa mira el negocio.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

/**
 * La reportería de los demás cargos: comercial, contabilidad, cobranzas y dirección.
 *
 * Riesgo ya tenía las suyas (cosechas, mora, calibración, embudo). Éstas responden a las preguntas
 * que hacen los OTROS, que son distintas aunque salgan de las mismas tablas: el comercial pregunta
 * cuánto se colocó y cuánto convirtió; el contador, cuánto hay que provisionar y qué se recaudó;
 * cobranzas, a quién llamar primero; y dirección, las cinco cifras de una pantalla.
 *
 * Las tres reglas de las de riesgo se mantienen porque no son de riesgo, son de honestidad:
 * el denominador viaja con la tasa, `NULL` no es cero, y todas publican `tenant_id`.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  /*
   * COMERCIAL · Colocación. Cuánto se desembolsó, de qué producto y a qué precio.
   *
   * El ticket medio va al lado del monto a propósito: dos meses con el mismo desembolso y ticket
   * distinto son negocios distintos —uno colocó pocos créditos grandes y el otro muchos pequeños—
   * y sólo el total no los distingue.
   */
  await queryInterface.sequelize.query(`
    CREATE OR REPLACE VIEW read_api.v_commercial_origination_v1 AS
    SELECT
      l._tenant_id                                    AS tenant_id,
      date_trunc('month', l.disbursed_at)::date       AS mes,
      p.product_code                                  AS producto,
      p.product_name                                  AS producto_nombre,
      count(*)                                        AS creditos,
      sum(l.principal_amount)                         AS monto_desembolsado,
      round(avg(l.principal_amount), 2)               AS ticket_medio,
      round(avg(l.annual_interest_rate), 2)           AS tasa_promedio,
      round(avg(l.term_months), 1)                    AS plazo_promedio_meses,
      count(DISTINCT l.customer_id)                   AS clientes
    FROM credit.loans l
    JOIN credit.credit_products p ON p._id = l.credit_product_id AND p._tenant_id = l._tenant_id
    WHERE l._deleted = false AND l.disbursed_at IS NOT NULL
    GROUP BY 1, 2, 3, 4
  `);

  /*
   * COMERCIAL · Conversión. De cada cien solicitudes, cuántas terminan en dinero.
   *
   * La tasa se publica CON los dos conteos. Un 40 % sobre diez solicitudes y un 40 % sobre mil son
   * el mismo número y decisiones muy distintas: el primero no es una tasa, es ruido.
   */
  await queryInterface.sequelize.query(`
    CREATE OR REPLACE VIEW read_api.v_commercial_conversion_v1 AS
    SELECT
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
      -- Conversión a DINERO, no a aprobación: una solicitud aprobada que nunca se desembolsa no es
      -- negocio, y la diferencia entre las dos tasas es justo lo que se pierde después del sí.
      round(count(l._id)::numeric / NULLIF(count(*), 0) * 100, 2)         AS tasa_desembolso_pct
    FROM credit.credit_applications a
    JOIN credit.credit_products p ON p._id = a.credit_product_id AND p._tenant_id = a._tenant_id
    LEFT JOIN credit.loans l ON l.credit_application_id = a._id AND l._deleted = false
    WHERE a._deleted = false
    GROUP BY 1, 2, 3
  `);

  /*
   * CONTABILIDAD · Cartera y provisión.
   *
   * Los porcentajes de provisión por tramo son los de una escala estándar de riesgo de crédito y
   * están AQUÍ, a la vista, no escondidos en un informe: quien audite tiene que poder discutir el
   * número, y para discutirlo tiene que verlo. No pretenden ser la norma de ningún regulador
   * concreto — son un punto de partida explícito que se cambia en un sitio.
   */
  await queryInterface.sequelize.query(`
    CREATE OR REPLACE VIEW read_api.v_accounting_portfolio_v1 AS
    SELECT
      l._tenant_id                                            AS tenant_id,
      l.delinquency_bucket                                    AS tramo,
      l.status                                                AS estado,
      p.product_code                                          AS producto,
      count(*)                                                AS creditos,
      sum(l.outstanding_principal)                            AS saldo_capital,
      sum(l.paid_principal)                                   AS capital_recuperado,
      sum(l.paid_interest)                                    AS interes_percibido,
      sum(l.scheduled_interest - l.paid_interest)             AS interes_por_devengar,
      sum(COALESCE(l.written_off_amount, 0))                  AS castigado,
      -- Provision estimada por tramo. La escala se lee aqui mismo, no en un anexo.
      round(sum(l.outstanding_principal * CASE l.delinquency_bucket
        WHEN 'current'     THEN 0.01
        WHEN 'dpd_1_29'    THEN 0.05
        WHEN 'dpd_30_59'   THEN 0.20
        WHEN 'dpd_60_89'   THEN 0.50
        WHEN 'dpd_90_plus' THEN 0.80
        WHEN 'written_off' THEN 1.00
        ELSE 0.01 END), 2)                                    AS provision_estimada
    FROM credit.loans l
    JOIN credit.credit_products p ON p._id = l.credit_product_id AND p._tenant_id = l._tenant_id
    WHERE l._deleted = false
    GROUP BY 1, 2, 3, 4
  `);

  /*
   * CONTABILIDAD · Recaudo. Qué entró, por qué canal y cuánto se revirtió.
   *
   * Las reversiones se cuentan aparte y no se restan del total en silencio: un mes con mucho
   * recaudo y muchas reversiones no es un buen mes, y un neto solo lo haría parecer uno mediano.
   */
  await queryInterface.sequelize.query(`
    CREATE OR REPLACE VIEW read_api.v_accounting_collections_v1 AS
    SELECT
      pay._tenant_id                                                  AS tenant_id,
      date_trunc('month', pay.received_at)::date                      AS mes,
      pay.payment_method                                              AS metodo,
      pay.status                                                      AS estado,
      count(*)                                                        AS pagos,
      sum(pay.amount)                                                 AS monto,
      count(*) FILTER (WHERE pay.reversed_at IS NOT NULL)             AS reversiones,
      sum(pay.amount) FILTER (WHERE pay.reversed_at IS NOT NULL)      AS monto_revertido,
      count(DISTINCT pay.loan_id)                                     AS creditos_con_pago
    FROM credit.loan_payments pay
    WHERE pay._deleted = false
    GROUP BY 1, 2, 3, 4
  `);

  /*
   * COBRANZAS · A quién llamar primero.
   *
   * Ordenar por saldo o por días de mora por separado da dos listas malas: la del saldo manda a
   * gestionar créditos grandes que apenas se atrasaron, y la de los días, deudas viejas de importe
   * ridículo. `prioridad` multiplica las dos, que es como se decide de verdad a quién se llama.
   */
  await queryInterface.sequelize.query(`
    CREATE OR REPLACE VIEW read_api.v_operations_collections_queue_v1 AS
    SELECT
      l._tenant_id                                              AS tenant_id,
      l.loan_code                                               AS credito,
      l.customer_id                                             AS customer_id,
      p.product_code                                            AS producto,
      l.delinquency_bucket                                      AS tramo,
      l.days_past_due                                           AS dias_mora,
      l.worst_days_past_due                                     AS peor_dias_mora,
      l.outstanding_principal                                   AS saldo_capital,
      l.disbursed_at                                            AS desembolsado_en,
      (SELECT max(pg.received_at) FROM credit.loan_payments pg
        WHERE pg.loan_id = l._id AND pg._deleted = false)       AS ultimo_pago_en,
      round(l.outstanding_principal * l.days_past_due / 1000.0, 2) AS prioridad
    FROM credit.loans l
    JOIN credit.credit_products p ON p._id = l.credit_product_id AND p._tenant_id = l._tenant_id
    WHERE l._deleted = false AND l.days_past_due > 0 AND l.status = 'active'
  `);

  /*
   * DIRECCIÓN · Las cifras de una pantalla.
   *
   * Una fila por mes y nada más: si no cabe de un vistazo, deja de ser un resumen ejecutivo y pasa
   * a ser otro informe que nadie abre.
   */
  await queryInterface.sequelize.query(`
    CREATE OR REPLACE VIEW read_api.v_executive_summary_v1 AS
    SELECT
      l._tenant_id                                                          AS tenant_id,
      date_trunc('month', l.disbursed_at)::date                             AS mes,
      count(*)                                                              AS creditos_desembolsados,
      sum(l.principal_amount)                                               AS monto_desembolsado,
      sum(l.outstanding_principal)                                          AS cartera_viva,
      count(DISTINCT l.customer_id)                                         AS clientes_activos,
      round(sum(l.outstanding_principal) FILTER (WHERE l.days_past_due >= 30)
            / NULLIF(sum(l.outstanding_principal), 0) * 100, 2)             AS cartera_en_riesgo_pct,
      round(count(*) FILTER (WHERE l.days_past_due >= 90)::numeric
            / NULLIF(count(*), 0) * 100, 2)                                 AS tasa_mora_90_pct,
      sum(COALESCE(l.written_off_amount, 0))                                AS castigado
    FROM credit.loans l
    WHERE l._deleted = false AND l.disbursed_at IS NOT NULL
    GROUP BY 1, 2
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  for (const vista of [
    'v_executive_summary_v1',
    'v_operations_collections_queue_v1',
    'v_accounting_collections_v1',
    'v_accounting_portfolio_v1',
    'v_commercial_conversion_v1',
    'v_commercial_origination_v1',
  ]) {
    await queryInterface.sequelize.query(`DROP VIEW IF EXISTS read_api.${vista}`);
  }
}
