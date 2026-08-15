/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza publica las medidas con las que se gobierna una cartera de crédito.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

/**
 * Las cuatro preguntas que un analista de riesgo hace todas las semanas.
 *
 * `read_api` tenía siete vistas y ninguna respondía a la razón por la que existe una cartera de
 * crédito: si se está deteriorando, dónde, y si el modelo que la origina sigue ordenando bien.
 * Quien quisiera saberlo tenía que escribir el `JOIN` y las ventanas de mora a mano cada vez — y
 * dos personas que las escriben a mano obtienen dos números distintos para la misma pregunta, que
 * es exactamente lo que una superficie gobernada existe para impedir.
 *
 * Las cuatro comparten tres reglas, y las tres vienen de errores que ya se han cometido aquí:
 *
 * 1. **El denominador SIEMPRE viaja.** Un 100 % sobre tres créditos y un 100 % sobre veinte mil son
 *    idénticos si sólo se manda el porcentaje. Ninguna vista publica una tasa sin el conteo del que
 *    sale.
 * 2. **`NULL` no es cero.** Una cosecha sin observaciones devuelve `NULL` en su tasa, no `0`:
 *    pintar de verde una cosecha que aún no ha vencido su primera cuota es peor que no medirla.
 * 3. **Se acota por inquilino.** Todas publican `tenant_id`, porque sin él la consola no puede
 *    servirlas y porque una medida de cartera de dos organizaciones sumadas no significa nada.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  /*
   * COSECHAS. La pregunta: ¿la cartera originada este mes se comporta peor que la del anterior?
   *
   * Se agrupa por mes de DESEMBOLSO y no de solicitud: el riesgo empieza a correr cuando el dinero
   * sale. `meses_en_libros` es lo que hace comparables dos cosechas de distinta antigüedad — sin
   * él, la de hace un año siempre parece peor, y no es que sea peor: es que ha tenido doce meses
   * para deteriorarse y la nueva ha tenido uno.
   */
  await queryInterface.sequelize.query(`
    CREATE OR REPLACE VIEW read_api.v_risk_vintage_performance_v1 AS
    SELECT
      l._tenant_id                                             AS tenant_id,
      date_trunc('month', l.disbursed_at)::date                AS cosecha,
      l.credit_product_id                                      AS credit_product_id,
      count(*)                                                 AS creditos,
      sum(l.principal_amount)                                  AS monto_desembolsado,
      sum(l.outstanding_principal)                             AS saldo_vivo,
      count(*) FILTER (WHERE l.days_past_due >= 30)            AS creditos_mora_30,
      count(*) FILTER (WHERE l.days_past_due >= 90)            AS creditos_mora_90,
      count(*) FILTER (WHERE l.written_off_at IS NOT NULL)     AS creditos_castigados,
      sum(l.written_off_amount)                                AS monto_castigado,
      -- Tasas con su denominador al lado, nunca solas. \`NULLIF\` deja NULL una cosecha vacia en
      -- vez de dividir por cero y publicar un cero que se leeria como «sin mora».
      round(count(*) FILTER (WHERE l.days_past_due >= 30)::numeric
            / NULLIF(count(*), 0) * 100, 2)                    AS tasa_mora_30_pct,
      round(count(*) FILTER (WHERE l.days_past_due >= 90)::numeric
            / NULLIF(count(*), 0) * 100, 2)                    AS tasa_mora_90_pct,
      -- Meses en libros: sin esto, dos cosechas de distinta edad no son comparables.
      --
      -- \`min(disbursed_at)\` y no la columna a secas: aunque el GROUP BY agrupe por
      -- \`date_trunc('month', disbursed_at)\`, Postgres no reconoce la expresion repetida dentro de
      -- otra funcion y exige un agregado. Dentro del grupo todas las filas caen en el mismo mes,
      -- asi que el minimo ES la cosecha.
      round(EXTRACT(EPOCH FROM (now() - date_trunc('month', min(l.disbursed_at)))) / 2592000)::int
                                                               AS meses_en_libros
    FROM credit.loans l
    WHERE l._deleted = false AND l.disbursed_at IS NOT NULL
    GROUP BY 1, 2, 3
  `);

  /*
   * MORA POR TRAMOS. La foto de HOY, que es la que se mira antes de decidir si se aprieta la
   * política. Los tramos son los estándar de cobranza porque son los que marcan el cambio de
   * gestión: llamada, gestor, prejudicial, castigo.
   */
  await queryInterface.sequelize.query(`
    CREATE OR REPLACE VIEW read_api.v_risk_delinquency_aging_v1 AS
    SELECT
      l._tenant_id                                  AS tenant_id,
      CASE
        WHEN l.days_past_due IS NULL OR l.days_past_due <= 0 THEN '00_al_dia'
        WHEN l.days_past_due <= 30  THEN '01_1_30'
        WHEN l.days_past_due <= 60  THEN '02_31_60'
        WHEN l.days_past_due <= 90  THEN '03_61_90'
        ELSE '04_mas_90'
      END                                           AS tramo_mora,
      l.credit_product_id                           AS credit_product_id,
      count(*)                                      AS creditos,
      sum(l.outstanding_principal)                  AS saldo_vivo,
      -- El PEOR tramo alcanzado, no el actual: un credito que estuvo 90 dias en mora y se puso al
      -- dia no es lo mismo que uno que nunca cayo, y la foto de hoy sola no distingue los dos.
      count(*) FILTER (WHERE l.worst_days_past_due >= 90) AS creditos_peor_90,
      avg(l.days_past_due)::numeric(10, 2)          AS dias_mora_promedio
    FROM credit.loans l
    WHERE l._deleted = false AND l.status <> 'cancelled'
    GROUP BY 1, 2, 3
  `);

  /*
   * CALIBRACIÓN DEL SCORE. Dos preguntas distintas y la vista responde a las dos:
   * ¿ORDENA? (¿las bandas malas tienen más mora que las buenas?) y ¿está CALIBRADO?
   * (¿la mora observada se parece a la que el modelo predijo?).
   *
   * Es la vista que convierte «el modelo va bien» en un número que alguien puede discutir.
   */
  await queryInterface.sequelize.query(`
    CREATE OR REPLACE VIEW read_api.v_risk_score_calibration_v1 AS
    SELECT
      a._tenant_id                                          AS tenant_id,
      a.decision_risk_band                                  AS banda_riesgo,
      width_bucket(a.decision_score, 0, 1000, 10)           AS tramo_score,
      count(*)                                              AS solicitudes,
      count(l._id)                                          AS desembolsados,
      count(*) FILTER (WHERE l.days_past_due >= 90)         AS malos_90,
      -- La tasa de malos se calcula sobre los DESEMBOLSADOS, no sobre las solicitudes: un rechazo
      -- no tiene desenlace observable, y meterlo en el denominador diluye la mora hasta volverla
      -- irreconocible. Es el sesgo de seleccion, y aqui se evita por construccion.
      round(count(*) FILTER (WHERE l.days_past_due >= 90)::numeric
            / NULLIF(count(l._id), 0) * 100, 2)             AS tasa_malos_90_pct,
      avg(a.decision_score)::numeric(10, 2)                 AS score_promedio,
      min(a.decided_at)                                     AS desde,
      max(a.decided_at)                                     AS hasta
    FROM credit.credit_applications a
    LEFT JOIN credit.loans l
           ON l.credit_application_id = a._id
          AND l._tenant_id = a._tenant_id
          AND l._deleted = false
    WHERE a._deleted = false AND a.decision_score IS NOT NULL
    GROUP BY 1, 2, 3
  `);

  /*
   * EMBUDO DE DECISIÓN. Dónde se cae la gente y con qué motivo.
   *
   * La tasa de aprobación sola no dice nada: puede bajar porque el modelo aprieta o porque llegan
   * peores solicitudes. Agrupando por motivo se ve cuál de las dos cosas está pasando, que es la
   * diferencia entre tocar la política y no tocarla.
   */
  await queryInterface.sequelize.query(`
    CREATE OR REPLACE VIEW read_api.v_risk_decision_funnel_v1 AS
    SELECT
      a._tenant_id                                              AS tenant_id,
      date_trunc('month', a.submitted_at)::date                 AS mes,
      a.credit_product_id                                       AS credit_product_id,
      a.status                                                  AS estado,
      a.decision_reason_code                                    AS motivo,
      count(*)                                                  AS solicitudes,
      sum(a.requested_amount)                                   AS monto_solicitado,
      avg(a.decision_score)::numeric(10, 2)                     AS score_promedio,
      -- Cuantas de este grupo llegaron a desembolsarse: el embudo termina en el dinero, no en el
      -- estado de la solicitud.
      count(l._id)                                              AS desembolsados
    FROM credit.credit_applications a
    LEFT JOIN credit.loans l
           ON l.credit_application_id = a._id
          AND l._tenant_id = a._tenant_id
          AND l._deleted = false
    WHERE a._deleted = false
    GROUP BY 1, 2, 3, 4, 5
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  for (const vista of [
    'v_risk_decision_funnel_v1',
    'v_risk_score_calibration_v1',
    'v_risk_delinquency_aging_v1',
    'v_risk_vintage_performance_v1',
  ]) {
    await queryInterface.sequelize.query(`DROP VIEW IF EXISTS read_api.${vista}`);
  }
}
