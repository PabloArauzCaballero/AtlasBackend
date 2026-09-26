-- Cartera de DEMOSTRACIÓN para las vistas de riesgo, comercial y contabilidad.
--
-- Existe porque las vistas de `read_api` son correctas y estaban todas vacías: `credit.loans` y
-- `credit.credit_applications` tenían cero filas. Una reportería de un prestamista sin préstamos
-- no demuestra nada — enseña cabeceras.
--
-- Lo que siembra NO es ruido uniforme, y ahí está el trabajo: si todos los créditos fueran
-- iguales, las cuatro vistas de riesgo saldrían planas y no se vería que funcionan. La mora crece
-- con la ANTIGÜEDAD de la cosecha y empeora en las bandas de score malas, que es como se comporta
-- una cartera de verdad; así la calibración ordena y las cosechas viejas se ven peor que las
-- nuevas por el motivo correcto.
--
-- Es IDEMPOTENTE: borra lo suyo por prefijo de código antes de insertar, así que correrlo dos
-- veces no duplica. Sólo toca filas con los prefijos `DEMO-`.
--
--   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < scripts/seed-demo-portfolio.sql

BEGIN;

DELETE FROM credit.loan_payments   WHERE payment_code     LIKE 'DEMO-%';
DELETE FROM credit.loan_installments WHERE loan_id IN (SELECT _id FROM credit.loans WHERE loan_code LIKE 'DEMO-%');
DELETE FROM credit.loans           WHERE loan_code        LIKE 'DEMO-%';
DELETE FROM credit.credit_applications WHERE application_code LIKE 'DEMO-%';
DELETE FROM credit.credit_products WHERE product_code     LIKE 'DEMO-%';

-- Tres productos: los tres precios y plazos que hacen que «por producto» signifique algo.
INSERT INTO credit.credit_products
  (_tenant_id, product_code, product_name, description, currency_code,
   min_amount, max_amount, min_term_months, max_term_months, annual_interest_rate, status)
VALUES
  (1, 'DEMO-CONSUMO',  'Crédito de consumo',   'Libre disponibilidad a 12-24 meses.', 'BOB',  1000,  50000,  6, 24, 24.0, 'active'),
  (1, 'DEMO-MICRO',    'Microcrédito',          'Capital de trabajo para comercio.',   'BOB',   500,  20000,  3, 18, 32.0, 'active'),
  (1, 'DEMO-VEHICULO', 'Crédito vehicular',     'Compra de vehículo con garantía.',    'BOB', 20000, 250000, 12, 60, 16.0, 'active');

/*
 * Doce cosechas mensuales, y las solicitudes ANTES que los creditos.
 *
 * El orden no es de estilo: `loans.credit_application_id` es obligatorio, asi que un credito no
 * puede existir sin la solicitud que lo origino. El modelo esta diciendo algo cierto del negocio
 * —no se presta sin que alguien lo haya pedido y alguien lo haya aprobado— y el sembrado tiene que
 * respetarlo o siembra una historia que no pudo ocurrir.
 *
 * `serie` es el mes hacia atras (0 = este mes) y por tanto la antiguedad. La probabilidad de mora
 * sube con ella porque un credito recien desembolsado no ha tenido ocasion de caer: sin esa
 * relacion todas las cosechas saldrian iguales y la vista de vintage —cuyo proposito es compararlas—
 * no ensenaria nada.
 */
INSERT INTO credit.credit_applications
  (_tenant_id, application_code, customer_id, credit_product_id, requested_amount,
   requested_term_months, currency_code, status, decision_reason_code, decided_at, submitted_at,
   decision_score, decision_risk_band)
SELECT
  1,
  'DEMO-A-' || lpad(g::text, 5, '0'),
  (SELECT _id FROM customer.customers WHERE _tenant_id = 1 AND _deleted = false
    ORDER BY _id LIMIT 1 OFFSET (g % 10)),
  (SELECT _id FROM credit.credit_products WHERE product_code LIKE 'DEMO-%' ORDER BY _id LIMIT 1 OFFSET (g % 3)),
  (1000 + ((g * 3571) % 40000))::numeric,
  12, 'BOB', 'approved', 'policy_pass',
  /*
   * Las cohortes al día 15 y no al día 1.
   *
   * La solicitud se envía unos días ANTES de decidirse, así que con la cohorte en el día 1 el envío
   * caía en el mes anterior: la vista de conversión agrupa por envío y la ejecutiva por desembolso,
   * y el mes en curso salía con una sola solicitud mientras la cartera enseñaba 35 créditos. No era
   * un error de las vistas —cada una agrupa por lo que le toca—, era un sembrado que ponía las dos
   * fechas a caballo del corte.
   *
   * Y acotado con `LEAST(..., ahora)`: el día 15 del mes EN CURSO todavía no ha llegado si hoy es
   * 12, y una cohorte fechada en el futuro no la cuenta ninguna vista — el mes actual salía vacío.
   */
  LEAST(date_trunc('month', now()) - ((g % 12) || ' months')::interval + interval '14 days',
        now() - interval '1 day')::timestamptz,
  LEAST(date_trunc('month', now()) - ((g % 12) || ' months')::interval + interval '11 days',
        now() - interval '4 days')::timestamptz,
  ((g * 7919) % 1000),
  CASE WHEN ((g * 7919) % 1000) >= 750 THEN 'A' WHEN ((g * 7919) % 1000) >= 550 THEN 'B'
       WHEN ((g * 7919) % 1000) >= 350 THEN 'C' ELSE 'D' END
FROM generate_series(1, 420) AS g;

INSERT INTO credit.loans
  (_tenant_id, loan_code, customer_id, credit_application_id, credit_product_id, currency_code,
   principal_amount, annual_interest_rate, term_months, status, disbursed_at, first_due_date,
   maturity_date, scheduled_principal, scheduled_interest, paid_principal, paid_interest,
   paid_late_fee, outstanding_principal, days_past_due, worst_days_past_due, delinquency_bucket,
   delinquency_evaluated_at, written_off_at, written_off_amount, write_off_reason_code)
SELECT
  1,
  'DEMO-L-' || lpad(n::text, 5, '0'),
  a.customer_id,
  a._id,
  a.credit_product_id,
  'BOB',
  a.requested_amount,
  24.0,
  12,
  CASE WHEN mora > 180 THEN 'written_off'
       WHEN antiguedad >= 11 AND mora = 0 THEN 'paid_off' ELSE 'active' END,
  a.decided_at,
  (a.decided_at + interval '1 month')::date,
  (a.decided_at + interval '12 months')::date,
  a.requested_amount,
  round(a.requested_amount * 0.24, 2),
  round(a.requested_amount * LEAST(1, antiguedad / 12.0) * CASE WHEN mora > 0 THEN 0.4 ELSE 1 END, 2),
  round(a.requested_amount * 0.24 * LEAST(1, antiguedad / 12.0) * 0.8, 2),
  CASE WHEN mora > 30 THEN round(a.requested_amount * 0.01, 2) ELSE 0 END,
  round(a.requested_amount * (1 - LEAST(1, antiguedad / 12.0) * CASE WHEN mora > 0 THEN 0.4 ELSE 1 END), 2),
  mora,
  GREATEST(mora, ((n * 17) % 120)),
  -- Los tramos son los que la tabla ADMITE (`ck_loans_bucket`), no los que uno inventaria: el
  -- modelo ya fijo su vocabulario y sembrar con otro habria fallado al insertar — o peor, habria
  -- pasado y dejado dos vocabularios para lo mismo.
  CASE WHEN mora > 180 THEN 'written_off' WHEN mora = 0 THEN 'current' WHEN mora <= 29 THEN 'dpd_1_29'
       WHEN mora <= 59 THEN 'dpd_30_59' WHEN mora <= 89 THEN 'dpd_60_89'
       ELSE 'dpd_90_plus' END,
  now(),
  CASE WHEN mora > 180 THEN a.decided_at + interval '10 months' ELSE NULL END,
  CASE WHEN mora > 180 THEN round(a.requested_amount * 0.6, 2) ELSE NULL END,
  CASE WHEN mora > 180 THEN 'incobrable' ELSE NULL END
FROM (
  SELECT b.*,
         GREATEST(0, (
           CASE
             -- Castigados: los peores de las cosechas viejas. Pocos, y sólo donde el tiempo da para
             -- llegar a 180 días — sin ellos «cartera castigada» no tendría nada que medir.
             WHEN b.antiguedad >= 9 AND b.sorteo_cae < 3 THEN 190 + (b.sorteo_dias % 40)
             /*
              * Por encima del umbral, al día. El umbral sube con la ANTIGÜEDAD —un crédito recién
              * desembolsado no ha tenido ocasión de caer— y con el score malo, que es donde esas dos
              * variables mandan de verdad.
              */
             WHEN b.sorteo_cae >= (1.5 + b.antiguedad * 0.4 + ((1000 - b.decision_score) / 100.0) * 0.7)
               THEN 0
             /*
              * Y la profundidad DECAE: 55 / 23 / 13 / 9. La mayoría del que se atrasa cura en el
              * primer tramo y sólo una fracción pasa al siguiente; una cartera con más créditos en
              * 60-89 que en 1-29 no existe.
              */
             WHEN b.sorteo_dias < 55 THEN 5 + (b.sorteo_dias % 25)
             WHEN b.sorteo_dias < 78 THEN 31 + (b.sorteo_dias % 29)
             WHEN b.sorteo_dias < 91 THEN 61 + (b.sorteo_dias % 29)
             ELSE 91 + (b.sorteo_dias % 60)
           END
         ))::int AS mora
    FROM (
  SELECT ap.*,
         substring(ap.application_code from 8)::int AS n,
         (substring(ap.application_code from 8)::int % 12) AS antiguedad,
         /*
          * La mora, y por qué NO es una fórmula que se aplica a todos.
          *
          * La versión anterior sumaba antigüedad y score y restaba una constante, así que el crédito
          * TÍPICO nacía con ~35 días de atraso: PAR 30 del 54 % y mora 90 en 0 % a la vez — una
          * cartera que ningún prestamista sobrevive y que además es internamente imposible. Un
          * tablero de demostración con esa cartera es peor que uno vacío: el vacío se explica, la
          * cartera rota se discute.
          *
          * Una cartera real tiene dos pasos, no uno: primero SI el crédito cae en mora (la mayoría
          * no cae), y sólo después CUÁNTOS días lleva. `r` es el sorteo —determinista, para que el
          * sembrado sea reproducible— y el umbral es la probabilidad de caer, que sube con la
          * antigüedad (un crédito recién desembolsado no ha tenido ocasión) y con el score malo.
          *
          * Los días crecen con la antigüedad porque el que cayó hace un año lleva un año cayendo:
          * así las cosechas viejas llegan a 90+ y las nuevas se quedan en el primer tramo, que es lo
          * que la vista de cosechas existe para enseñar.
          */
         /*
          * La mora, en DOS sorteos independientes, que es como se comporta una cartera.
          *
          * Primero SI el crédito cae —la mayoría no cae— y después CUÁNTOS días lleva. Fundirlo en
          * una sola fórmula, como estaba, hacía que el crédito TÍPICO naciera con 35 días de atraso:
          * PAR 30 del 54 % con mora 90 en 0 %, una cartera que ningún prestamista sobrevive y que
          * además es imposible. Un tablero de demostración con esa cartera es peor que uno vacío: el
          * vacío se explica solo, la cartera rota se discute.
          *
          * Los sorteos salen de un HASH y no de aritmética modular sobre `n`. Con `(n*7919)%100` y
          * `(n*31)%100` los dos quedaban correlacionados —el segundo no era uniforme sobre los `n`
          * que el primero seleccionaba— y los tramos de 30-59 y 60-89 días salían VACÍOS: el
          * gráfico de antigüedad tenía huecos que no significaban nada. `md5` no tiene esa
          * estructura y sigue siendo determinista, así que el sembrado es reproducible.
          */
         (abs(('x' || md5('cae:' || ap.application_code))::bit(32)::int) % 100) AS sorteo_cae,
         (abs(('x' || md5('dias:' || ap.application_code))::bit(32)::int) % 100) AS sorteo_dias
    FROM credit.credit_applications ap WHERE ap.application_code LIKE 'DEMO-A-%'
    ) b
) a
WHERE a.customer_id IS NOT NULL AND a.credit_product_id IS NOT NULL;

-- Rechazadas: sin crédito detrás, con motivos distintos para que el embudo se pueda desglosar.
INSERT INTO credit.credit_applications
  (_tenant_id, application_code, customer_id, credit_product_id, requested_amount,
   requested_term_months, currency_code, status, decision_reason_code, decided_at, submitted_at,
   decision_score, decision_risk_band)
SELECT
  1,
  'DEMO-R-' || lpad(g::text, 5, '0'),
  (SELECT _id FROM customer.customers WHERE _tenant_id = 1 AND _deleted = false
    ORDER BY _id LIMIT 1 OFFSET (g % 10)),
  (SELECT _id FROM credit.credit_products WHERE product_code LIKE 'DEMO-%' ORDER BY _id LIMIT 1 OFFSET (g % 3)),
  (1000 + ((g * 2917) % 30000))::numeric,
  12, 'BOB', 'rejected',
  (ARRAY['score_bajo','ingreso_insuficiente','mora_vigente','documentacion_incompleta'])[1 + (g % 4)],
  LEAST(date_trunc('month', now()) - ((g % 12) || ' months')::interval + interval '14 days',
        now() - interval '1 day')::timestamptz,
  LEAST(date_trunc('month', now()) - ((g % 12) || ' months')::interval + interval '12 days',
        now() - interval '3 days')::timestamptz,
  ((g * 4409) % 400),
  CASE WHEN ((g * 4409) % 400) >= 350 THEN 'C' ELSE 'D' END
FROM generate_series(1, 180) AS g;

-- Pagos: uno por crédito que amortizó algo. Alimentan conciliación y recaudo.
INSERT INTO credit.loan_payments
  (_tenant_id, loan_id, payment_code, amount, currency_code, payment_method, received_at, status)
SELECT 1, l._id,
  'DEMO-P-' || substring(l.loan_code from 8),
  GREATEST(l.paid_principal + l.paid_interest, 1),
  'BOB',
  (ARRAY['transferencia','efectivo','qr'])[1 + (substring(l.loan_code from 8)::int % 3)],
  l.disbursed_at + interval '35 days',
  'applied'
FROM credit.loans l
WHERE l.loan_code LIKE 'DEMO-L-%' AND (l.paid_principal + l.paid_interest) > 0;

COMMIT;
