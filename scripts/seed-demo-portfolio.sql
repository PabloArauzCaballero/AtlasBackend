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
  (date_trunc('month', now()) - ((g % 12) || ' months')::interval)::timestamptz,
  (date_trunc('month', now()) - ((g % 12) || ' months')::interval - interval '3 days')::timestamptz,
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
  SELECT ap.*,
         substring(ap.application_code from 8)::int AS n,
         (substring(ap.application_code from 8)::int % 12) AS antiguedad,
         GREATEST(0, (((substring(ap.application_code from 8)::int % 12) * 4)
                      + ((1000 - ap.decision_score) / 12) - 30
                      + ((substring(ap.application_code from 8)::int * 13) % 40) - 20))::int AS mora
    FROM credit.credit_applications ap WHERE ap.application_code LIKE 'DEMO-A-%'
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
  (date_trunc('month', now()) - ((g % 12) || ' months')::interval)::timestamptz,
  (date_trunc('month', now()) - ((g % 12) || ' months')::interval - interval '2 days')::timestamptz,
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
