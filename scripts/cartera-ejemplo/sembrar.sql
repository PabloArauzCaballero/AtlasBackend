-- Cartera de EJEMPLO para que los tableros de TEST enseñen algo que valga la pena.
--
-- Existe porque TEST se limpió de basura el 2026-09-18 y se quedó con dos créditos: los tableros
-- de Riesgo, Dirección y Finanzas salían en blanco o con una sola foto de créditos ya borrados.
-- Pablo eligió (2026-10-18) sembrar una cartera realista antes que rellenar huecos con texto.
--
-- Reglas que este guion respeta:
--   * Todo lleva prefijo `DEMO-` (clientes, comercios, productos, solicitudes, créditos, pagos):
--     `quitar.sql` lo retira entero y los tableros lo marcan como siembra (`es_semilla`), porque el
--     producto empieza por `DEMO-`.
--   * Sin datos personales: los clientes sólo tienen código; ni nombre, ni teléfono, ni correo.
--   * Ningún crédito de ejemplo cuelga de un cliente o un comercio real.
--   * Las cifras CUADRAN porque se derivan, no se escriben: el plan de cuotas sale de monto, plazo
--     y tasa; los pagos, de las cuotas; los totales del crédito, de los pagos; los días de atraso,
--     de la cuota impaga más vieja. Así la historia mes a mes (`historia-tableros.sql`) se puede
--     reconstruir desde las fechas de pago sin inventar nada más.
--   * Determinista: los sorteos salen de `md5`, así que dos corridas dan la misma cartera.
--
-- Se niega a correr sin `-v permitir=si`, para que nadie la siembre en PROD por un copia-pega.
--
--   psql ... -v ON_ERROR_STOP=1 -v permitir=si -f scripts/cartera-ejemplo/sembrar.sql

\if :{?permitir}
\else
  \set permitir no
\endif
SELECT :'permitir' = 'si' AS permitido \gset
\if :permitido
\else
  \echo 'Falta -v permitir=si: esta siembra es sólo para TEST.'
  \quit
\endif

BEGIN;

-- Lo anterior fuera primero: correrlo dos veces deja una sola cartera.
DELETE FROM credit.loan_payment_allocations
 WHERE loan_payment_id IN (SELECT _id FROM credit.loan_payments WHERE payment_code LIKE 'DEMO-%');
DELETE FROM credit.loan_payments WHERE payment_code LIKE 'DEMO-%';
DELETE FROM credit.loan_risk_ratings
 WHERE loan_id IN (SELECT _id FROM credit.loans WHERE loan_code LIKE 'DEMO-%');
DELETE FROM credit.loan_installments
 WHERE loan_id IN (SELECT _id FROM credit.loans WHERE loan_code LIKE 'DEMO-%');
DELETE FROM credit.loans WHERE loan_code LIKE 'DEMO-%';
DELETE FROM credit.customer_risk_ratings
 WHERE customer_id IN (SELECT _id FROM customer.customers WHERE customer_code LIKE 'DEMO-C-%');
DELETE FROM credit.credit_applications WHERE application_code LIKE 'DEMO-%';
DELETE FROM credit.credit_products WHERE product_code LIKE 'DEMO-%';
DELETE FROM partner.partner_profiles WHERE tax_id LIKE 'DEMO-%';
DELETE FROM telemetry.auth_events
 WHERE session_id IN (SELECT _id FROM telemetry.customer_sessions WHERE session_token_hash LIKE 'DEMO-%');
DELETE FROM telemetry.customer_sessions WHERE session_token_hash LIKE 'DEMO-%';
DELETE FROM customer.customers WHERE customer_code LIKE 'DEMO-C-%';

/* Un sorteo de 0 a 9999 a partir de un texto: determinista y sin correlación entre semillas. */
CREATE FUNCTION pg_temp.sorteo(semilla text) RETURNS int
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT (abs((('x' || substr(md5(semilla), 1, 8))::bit(32)::int)::bigint) % 10000)::int $$;

-- ── Catálogo ────────────────────────────────────────────────────────────────────────────────────

-- Los tres productos de la red: la compra del día, el electrodoméstico y la compra grande.
INSERT INTO credit.credit_products
  (_tenant_id, product_code, product_name, description, currency_code, min_amount, max_amount,
   min_term_months, max_term_months, annual_interest_rate, status)
VALUES
  (1, 'DEMO-CONSUMO-CORTO', 'Consumo corto (ejemplo)', 'Compra del día a día en una a tres cuotas.',
   'BOB', 300, 3000, 1, 3, 18, 'active'),
  (1, 'DEMO-SEIS-CUOTAS', 'Seis cuotas (ejemplo)', 'Electrodomésticos y equipos a seis meses.',
   'BOB', 1000, 12000, 6, 6, 22, 'active'),
  (1, 'DEMO-DOCE-CUOTAS', 'Doce cuotas (ejemplo)', 'Motos, muebles y compras grandes a un año.',
   'BOB', 3000, 30000, 12, 12, 26, 'active');

-- Cinco comercios inventados. `tax_id` con prefijo para que `quitar.sql` los encuentre.
INSERT INTO partner.partner_profiles
  (_tenant_id, legal_name, trade_name, tax_id, business_category, contact_email, onboarding_status,
   submitted_at, decided_at, mdr_rate_percent, mdr_rate_effective_at, _created_at)
SELECT 1, 'DEMO ' || c.nombre || ' S.R.L.', c.nombre, 'DEMO-NIT-' || c.n, c.rubro,
       'comercio' || c.n || '@ejemplo.invalid', 'approved',
       now() - interval '15 months', now() - interval '15 months' + interval '3 days',
       c.mdr, now() - interval '15 months', now() - interval '15 months'
  FROM (VALUES (1, 'Electro Hogar', 'Electrodomésticos', 3.5),
               (2, 'Motos del Oriente', 'Motocicletas', 4.0),
               (3, 'Muebles Chiquitano', 'Hogar', 3.0),
               (4, 'Farmacia Vida', 'Salud', 2.5),
               (5, 'Óptica Central', 'Salud visual', 3.0)) AS c(n, nombre, rubro, mdr);

-- ── Solicitudes ─────────────────────────────────────────────────────────────────────────────────

/*
 * Trece cosechas mensuales que CRECEN: 40 solicitudes el mes más viejo y 100 el último completo,
 * que es como se ve una financiera que está colocando. El mes en curso lleva la parte que ya pasó.
 */
CREATE TEMP TABLE sol ON COMMIT DROP AS
WITH meses AS (
  SELECT m,
         (date_trunc('month', current_date) - (m || ' months')::interval)::date AS inicio,
         CASE WHEN m = 0
              THEN GREATEST(1, round((40 + 12 * 5) * extract(day FROM current_date) / 31.0))::int
              ELSE 40 + (12 - m) * 5 END AS cuantas,
         CASE WHEN m = 0 THEN GREATEST(1, extract(day FROM current_date)::int - 1)
              ELSE extract(day FROM (date_trunc('month', current_date) - ((m - 1) || ' months')::interval
                                     - interval '1 day'))::int END AS dias
    FROM generate_series(0, 12) AS m
), crudas AS (
  SELECT me.m, g,
         me.inicio + (pg_temp.sorteo('dia:' || me.m || ':' || g) % me.dias)
           + make_interval(hours => 8 + pg_temp.sorteo('hora:' || me.m || ':' || g) % 12,
                           mins => pg_temp.sorteo('min:' || me.m || ':' || g) % 60) AS enviada
    FROM meses me, generate_series(1, me.cuantas) AS g
)
SELECT row_number() OVER (ORDER BY enviada, m, g)::int AS i, enviada::timestamptz AS enviada
  FROM crudas;

ALTER TABLE sol
  ADD COLUMN cliente int, ADD COLUMN score int, ADD COLUMN banda text, ADD COLUMN producto text,
  ADD COLUMN monto numeric, ADD COLUMN plazo int, ADD COLUMN tasa numeric, ADD COLUMN comercio int,
  ADD COLUMN estado text, ADD COLUMN motivo text, ADD COLUMN decidida timestamptz;

/*
 * Quién pide. Algo más de la mitad de las solicitudes son de gente nueva y el resto de clientes que
 * vuelven, todos los meses: si los clientes nacieran sólo al principio, «clientes nuevos» y la
 * activación a crédito del último mes saldrían vacías, y una financiera que no capta no existe.
 * El que vuelve es uno que ya había llegado antes.
 */
WITH marca AS (
  SELECT i, (i <= 40 OR pg_temp.sorteo('nuevo:' || i) % 100 < 55) AS nuevo FROM sol
), cuenta AS (
  SELECT i, nuevo, sum(CASE WHEN nuevo THEN 1 ELSE 0 END) OVER (ORDER BY i) AS llegados FROM marca
)
UPDATE sol SET cliente = CASE WHEN c.nuevo THEN c.llegados
                              ELSE 1 + pg_temp.sorteo('cli:' || sol.i) % c.llegados END
  FROM cuenta c WHERE c.i = sol.i;

UPDATE sol SET
  -- La media de dos sorteos: más gente en el medio que en las colas, como un score de verdad.
  score = 300 + ((pg_temp.sorteo('s1:' || i) % 651) + (pg_temp.sorteo('s2:' || i) % 651)) / 2,
  producto = CASE WHEN pg_temp.sorteo('prod:' || i) % 100 < 45 THEN 'DEMO-CONSUMO-CORTO'
                  WHEN pg_temp.sorteo('prod:' || i) % 100 < 80 THEN 'DEMO-SEIS-CUOTAS'
                  ELSE 'DEMO-DOCE-CUOTAS' END;

UPDATE sol SET
  banda = CASE WHEN score >= 720 THEN 'A' WHEN score >= 600 THEN 'B' WHEN score >= 500 THEN 'C' ELSE 'D' END,
  monto = CASE producto
            WHEN 'DEMO-CONSUMO-CORTO' THEN 300 + (pg_temp.sorteo('monto:' || i) % 271) * 10
            WHEN 'DEMO-SEIS-CUOTAS' THEN 1000 + (pg_temp.sorteo('monto:' || i) % 221) * 50
            ELSE 3000 + (pg_temp.sorteo('monto:' || i) % 271) * 100 END,
  plazo = CASE producto
            WHEN 'DEMO-CONSUMO-CORTO' THEN 1 + pg_temp.sorteo('plazo:' || i) % 3
            WHEN 'DEMO-SEIS-CUOTAS' THEN 6 ELSE 12 END,
  tasa = CASE producto WHEN 'DEMO-CONSUMO-CORTO' THEN 18 WHEN 'DEMO-SEIS-CUOTAS' THEN 22 ELSE 26 END,
  -- Cada producto se vende sobre todo donde tiene sentido: la moto en la concesionaria.
  comercio = CASE producto
               WHEN 'DEMO-DOCE-CUOTAS' THEN (ARRAY[2, 2, 3, 3, 1])[1 + pg_temp.sorteo('com:' || i) % 5]
               WHEN 'DEMO-SEIS-CUOTAS' THEN (ARRAY[1, 1, 1, 3, 5])[1 + pg_temp.sorteo('com:' || i) % 5]
               ELSE (ARRAY[1, 4, 4, 5, 3])[1 + pg_temp.sorteo('com:' || i) % 5] END;

/*
 * La decisión. Lo enviado en las últimas 48 horas sigue en revisión: una bandeja vacía es tan
 * irreal como una llena de cosas de hace un año. El resto se aprueba salvo score bajo o un motivo
 * de la política, repartido para que «motivos de rechazo» tenga algo que comparar.
 */
UPDATE sol SET
  estado = CASE WHEN enviada > now() - interval '48 hours' THEN 'under_review'
                WHEN score < 430 OR pg_temp.sorteo('rech:' || i) % 100 < 12 THEN 'rejected'
                ELSE 'approved' END;
UPDATE sol SET
  decidida = CASE WHEN estado = 'under_review' THEN NULL
                  ELSE enviada + make_interval(mins => 20 + pg_temp.sorteo('dec:' || i) % 600) END,
  motivo = CASE estado
             WHEN 'approved' THEN 'policy_pass'
             WHEN 'rejected' THEN
               CASE WHEN score < 430 THEN 'score_bajo'
                    ELSE (ARRAY['capacidad_pago_insuficiente', 'mora_vigente_otra_entidad',
                                'documentacion_incompleta', 'identidad_no_verificada'])
                         [1 + pg_temp.sorteo('mot:' || i) % 4] END
             ELSE NULL END;

-- ── Clientes ────────────────────────────────────────────────────────────────────────────────────

-- El cliente nace dos días antes de su primera solicitud; sólo código, ningún dato personal.
INSERT INTO customer.customers
  (_tenant_id, customer_code, customer_uuid, lifecycle_status, credit_eligibility_status,
   eligibility_evaluated_at, _created_at, _updated_at)
SELECT 1, 'DEMO-C-' || lpad(cliente::text, 5, '0'), gen_random_uuid(), 'active', 'eligible',
       min(enviada) - interval '1 day', min(enviada) - interval '2 days', min(enviada) - interval '2 days'
  FROM sol GROUP BY cliente;

INSERT INTO credit.credit_applications
  (_tenant_id, application_code, customer_id, credit_product_id, requested_amount,
   requested_term_months, currency_code, status, decision_reason_code, decided_at, submitted_at,
   decision_score, decision_risk_band, decision_mode, _created_at, _updated_at)
SELECT 1, 'DEMO-A-' || lpad(s.i::text, 5, '0'), c._id, p._id, s.monto, s.plazo, 'BOB', s.estado,
       s.motivo, s.decidida, s.enviada, s.score, s.banda, 'seed_demo', s.enviada,
       COALESCE(s.decidida, s.enviada)
  FROM sol s
  JOIN customer.customers c ON c.customer_code = 'DEMO-C-' || lpad(s.cliente::text, 5, '0')
  JOIN credit.credit_products p ON p.product_code = s.producto;

-- ── Créditos y su comportamiento ────────────────────────────────────────────────────────────────

/*
 * Cuántas cuotas deja de pagar cada crédito, en dos sorteos independientes: primero SI cae (la
 * mayoría no cae, y cae más el score malo y el crédito con más cuotas vencidas) y después CUÁNTAS.
 * La profundidad decae —la mayoría que se atrasa debe una cuota— porque una cartera con más
 * créditos en 60-89 que en 1-29 no existe.
 */
CREATE TEMP TABLE cred ON COMMIT DROP AS
SELECT s.*,
       'DEMO-L-' || lpad(s.i::text, 5, '0') AS codigo,
       s.decidida + interval '2 hours' AS desembolso,
       (SELECT count(*) FROM generate_series(1, s.plazo) k
         WHERE ((s.decidida + interval '2 hours')::date + make_interval(months => k))::date < current_date)::int AS vencidas
  FROM sol s WHERE s.estado = 'approved';

ALTER TABLE cred ADD COLUMN impagas int;
UPDATE cred SET impagas = CASE
  WHEN vencidas = 0 THEN 0
  WHEN pg_temp.sorteo('cae:' || i) % 100
       >= (CASE banda WHEN 'A' THEN 3 WHEN 'B' THEN 8 WHEN 'C' THEN 15 ELSE 26 END) * LEAST(1, vencidas / 3.0)
    THEN 0
  ELSE LEAST(vencidas, CASE WHEN pg_temp.sorteo('prof:' || i) % 100 < 55 THEN 1
                            WHEN pg_temp.sorteo('prof:' || i) % 100 < 78 THEN 2
                            WHEN pg_temp.sorteo('prof:' || i) % 100 < 90 THEN 3
                            ELSE 4 + pg_temp.sorteo('hondo:' || i) % 6 END)
  END;

/* El plan de cuotas: capital en partes iguales (la última absorbe el redondeo), interés plano mensual. */
CREATE TEMP TABLE cuota ON COMMIT DROP AS
SELECT c.codigo, k AS n,
       (c.desembolso::date + make_interval(months => k))::date AS vence,
       CASE WHEN k < c.plazo THEN round(c.monto / c.plazo, 2)
            ELSE c.monto - round(c.monto / c.plazo, 2) * (c.plazo - 1) END AS capital,
       round(c.monto * c.tasa / 100 / 12, 2) AS interes,
       -- Pagada: vencida y no entre las `impagas` más recientes.
       ((c.desembolso::date + make_interval(months => k))::date < current_date
         AND k <= c.vencidas - c.impagas) AS pagada,
       c.i
  FROM cred c, generate_series(1, c.plazo) AS k;

/*
 * Cuándo se pagó cada cuota pagada: casi todos unos días antes, uno de cada cinco con atraso que
 * luego se puso al día. Ese atraso curado es el que alimenta la peor mora histórica y los tránsitos.
 */
ALTER TABLE cuota ADD COLUMN pagada_en timestamptz;
UPDATE cuota SET pagada_en = LEAST(now() - interval '1 hour',
  vence::timestamptz + make_interval(hours => 10) + CASE
    WHEN pg_temp.sorteo('pago:' || codigo || ':' || n) % 100 < 70
      THEN -make_interval(days => pg_temp.sorteo('ant:' || codigo || ':' || n) % 6)
    WHEN pg_temp.sorteo('pago:' || codigo || ':' || n) % 100 < 80 THEN interval '0'
    ELSE make_interval(days => 1 + pg_temp.sorteo('atr:' || codigo || ':' || n) % 24) END)
 WHERE pagada;

/* Los días de atraso de hoy salen de la cuota impaga más vieja; más de 180 es castigo. */
ALTER TABLE cred ADD COLUMN mora int, ADD COLUMN castigo_en timestamptz;
UPDATE cred c SET mora = COALESCE((SELECT current_date - min(q.vence) FROM cuota q
                                    WHERE q.codigo = c.codigo AND NOT q.pagada AND q.vence < current_date), 0);
UPDATE cred c SET castigo_en = (SELECT min(q.vence) FROM cuota q WHERE q.codigo = c.codigo AND NOT q.pagada)
                               + interval '181 days'
 WHERE mora > 180;

INSERT INTO credit.loans
  (_tenant_id, loan_code, customer_id, credit_application_id, credit_product_id, currency_code,
   principal_amount, annual_interest_rate, term_months, status, disbursed_at, first_due_date,
   maturity_date, scheduled_principal, scheduled_interest, paid_principal, paid_interest,
   paid_late_fee, outstanding_principal, days_past_due, worst_days_past_due, delinquency_bucket,
   delinquency_evaluated_at, closed_at, written_off_at, written_off_amount, write_off_reason_code,
   partner_profile_id, _created_at, _updated_at)
SELECT 1, c.codigo, a.customer_id, a._id, a.credit_product_id, 'BOB', c.monto, c.tasa, c.plazo,
       CASE WHEN c.castigo_en IS NOT NULL THEN 'written_off'
            WHEN t.pagadas = c.plazo THEN 'paid_off' ELSE 'active' END,
       c.desembolso, t.primera, t.ultima, c.monto, t.interes_total, t.capital_pagado, t.interes_pagado,
       0, c.monto - t.capital_pagado, c.mora,
       GREATEST(c.mora, t.peor_atraso),
       CASE WHEN c.castigo_en IS NOT NULL THEN 'written_off' WHEN c.mora = 0 THEN 'current'
            WHEN c.mora <= 29 THEN 'dpd_1_29' WHEN c.mora <= 59 THEN 'dpd_30_59'
            WHEN c.mora <= 89 THEN 'dpd_60_89' ELSE 'dpd_90_plus' END,
       now(),
       CASE WHEN t.pagadas = c.plazo THEN t.ultimo_pago END,
       c.castigo_en,
       CASE WHEN c.castigo_en IS NOT NULL THEN c.monto - t.capital_pagado END,
       CASE WHEN c.castigo_en IS NOT NULL THEN 'incobrable' END,
       pp._id, c.desembolso, now()
  FROM cred c
  JOIN credit.credit_applications a ON a.application_code = 'DEMO-A-' || lpad(c.i::text, 5, '0')
  JOIN partner.partner_profiles pp ON pp.tax_id = 'DEMO-NIT-' || c.comercio
  JOIN LATERAL (
    SELECT min(q.vence) AS primera, max(q.vence) AS ultima, sum(q.interes) AS interes_total,
           COALESCE(sum(q.capital) FILTER (WHERE q.pagada), 0) AS capital_pagado,
           COALESCE(sum(q.interes) FILTER (WHERE q.pagada), 0) AS interes_pagado,
           count(*) FILTER (WHERE q.pagada)::int AS pagadas,
           max(q.pagada_en) AS ultimo_pago,
           COALESCE(max(GREATEST(q.pagada_en::date - q.vence, 0)), 0)::int AS peor_atraso
      FROM cuota q WHERE q.codigo = c.codigo
  ) t ON true;

INSERT INTO credit.loan_installments
  (_tenant_id, loan_id, installment_number, due_date, principal_amount, interest_amount,
   late_fee_amount, paid_principal, paid_interest, paid_late_fee, status, days_past_due, settled_at)
SELECT 1, l._id, q.n, q.vence, q.capital, q.interes, 0,
       CASE WHEN q.pagada THEN q.capital ELSE 0 END,
       CASE WHEN q.pagada THEN q.interes ELSE 0 END, 0,
       CASE WHEN q.pagada THEN 'paid'
            WHEN l.status = 'written_off' THEN 'written_off'
            WHEN q.vence < current_date THEN 'overdue' ELSE 'pending' END,
       CASE WHEN NOT q.pagada AND q.vence < current_date THEN current_date - q.vence ELSE 0 END,
       q.pagada_en
  FROM cuota q JOIN credit.loans l ON l.loan_code = q.codigo;

-- Un pago por cuota pagada, por el medio que usa la gente: el QR manda.
INSERT INTO credit.loan_payments
  (_tenant_id, loan_id, payment_code, amount, currency_code, payment_method, received_at, status,
   _created_at, _updated_at)
SELECT 1, l._id, 'DEMO-P-' || substring(q.codigo FROM 8) || '-' || lpad(q.n::text, 2, '0'),
       q.capital + q.interes, 'BOB',
       (ARRAY['qr', 'qr', 'qr', 'transferencia', 'transferencia', 'efectivo', 'debito_automatico'])
         [1 + pg_temp.sorteo('medio:' || q.codigo || ':' || q.n) % 7],
       q.pagada_en, 'applied', q.pagada_en, q.pagada_en
  FROM cuota q JOIN credit.loans l ON l.loan_code = q.codigo
 WHERE q.pagada;

/*
 * Algunos pagos rebotan (uno de cada setenta): QR que se acreditó y se devolvió. Quedan como pago
 * revertido aparte, con su imputación anulada, y la cuota se pagó después con el pago bueno.
 */
INSERT INTO credit.loan_payments
  (_tenant_id, loan_id, payment_code, amount, currency_code, payment_method, received_at, status,
   reversed_at, reversal_reason_code, _created_at, _updated_at)
SELECT 1, l._id, 'DEMO-P-' || substring(q.codigo FROM 8) || '-' || lpad(q.n::text, 2, '0') || '-R',
       q.capital + q.interes, 'BOB', 'qr', q.pagada_en - interval '2 days', 'reversed',
       q.pagada_en - interval '1 day', 'fondos_devueltos', q.pagada_en - interval '2 days', q.pagada_en
  FROM cuota q JOIN credit.loans l ON l.loan_code = q.codigo
 WHERE q.pagada AND pg_temp.sorteo('rebote:' || q.codigo || ':' || q.n) % 70 = 0;

INSERT INTO credit.loan_payment_allocations
  (_tenant_id, loan_payment_id, loan_installment_id, principal_applied, interest_applied,
   late_fee_applied, reversed, _created_at)
SELECT 1, p._id, li._id, li.principal_amount, li.interest_amount, 0, p.status = 'reversed', p.received_at
  FROM credit.loan_payments p
  JOIN credit.loans l ON l._id = p.loan_id
  JOIN credit.loan_installments li
    ON li.loan_id = l._id
   AND li.installment_number = split_part(p.payment_code, '-', 4)::int
 WHERE p.payment_code LIKE 'DEMO-P-%';

-- ── Calificación de riesgo ──────────────────────────────────────────────────────────────────────

/* La calificación vigente de cada crédito con deuda, con la escala de la política activa. */
INSERT INTO credit.loan_risk_ratings
  (_tenant_id, loan_id, customer_id, policy_version_id, grade, grade_label, severity_rank,
   days_past_due, delinquency_bucket, exposure_amount, provision_rate, provision_amount,
   rating_reason, is_current, rated_at, _created_at)
SELECT 1, l._id, l.customer_id, b.policy_version_id, b.grade, b.grade_label, b.severity_rank,
       l.days_past_due, l.delinquency_bucket, l.outstanding_principal, b.provision_rate,
       round(l.outstanding_principal * b.provision_rate, 2),
       CASE WHEN l.status = 'written_off' THEN 'written_off' ELSE 'days_past_due' END,
       true, now(), now()
  FROM credit.loans l
  JOIN risk.rating_policy_versions v ON v.status = 'active'
  JOIN risk.rating_policy_bands b
    ON b.policy_version_id = v._id
   AND l.days_past_due >= b.min_days_past_due
   AND (b.max_days_past_due IS NULL OR l.days_past_due <= b.max_days_past_due)
 WHERE l.loan_code LIKE 'DEMO-L-%' AND l.status IN ('active', 'written_off');

/* Y la del cliente: la de su peor operación abierta, o A si ya no debe nada. */
INSERT INTO credit.customer_risk_ratings
  (_tenant_id, customer_id, policy_version_id, grade, grade_label, severity_rank,
   worst_days_past_due, rated_loan_count, total_exposure_amount, total_provision_amount,
   driving_loan_id, rating_reason, is_current, rated_at, _created_at)
SELECT 1, c._id, v._id,
       COALESCE(peor.grade, a.grade), COALESCE(peor.grade_label, a.grade_label),
       COALESCE(peor.severity_rank, a.severity_rank),
       COALESCE(peor.days_past_due, 0), COALESCE(tot.n, 0), COALESCE(tot.exp, 0), COALESCE(tot.prov, 0),
       peor.loan_id,
       CASE WHEN peor.loan_id IS NULL THEN 'no_open_debt' ELSE 'worst_operation' END,
       true, now(), now()
  FROM customer.customers c
  JOIN risk.rating_policy_versions v ON v.status = 'active'
  JOIN risk.rating_policy_bands a ON a.policy_version_id = v._id AND a.severity_rank = 0
  LEFT JOIN LATERAL (
    SELECT r.loan_id, r.grade, r.grade_label, r.severity_rank, r.days_past_due
      FROM credit.loan_risk_ratings r
     WHERE r.customer_id = c._id AND r.is_current
     ORDER BY r.severity_rank DESC, r.exposure_amount DESC LIMIT 1
  ) peor ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS n, sum(r.exposure_amount) AS exp, sum(r.provision_amount) AS prov
      FROM credit.loan_risk_ratings r WHERE r.customer_id = c._id AND r.is_current
  ) tot ON true
 WHERE c.customer_code LIKE 'DEMO-C-%';

-- ── Uso de la app ───────────────────────────────────────────────────────────────────────────────

/*
 * Sesiones e inicios de sesión de los clientes de ejemplo, semana a semana desde que se dieron de
 * alta. Quien tiene un crédito vivo entra más (consulta la cuota, paga con QR); quien ya pagó todo
 * entra de vez en cuando. Sin esto, «usuarios activos» y «sesiones por usuario» se quedaban en los
 * cuatro usuarios reales de TEST, por debajo de la muestra mínima. El hash de sesión lleva `DEMO-`
 * para que `quitar.sql` las encuentre.
 */
CREATE TEMP TABLE uso ON COMMIT DROP AS
SELECT c._id AS cliente, s.inicio
  FROM customer.customers c
  CROSS JOIN LATERAL (
    SELECT EXISTS (SELECT 1 FROM credit.loans l WHERE l.customer_id = c._id AND l.status = 'active') AS vivo
  ) v
  CROSS JOIN LATERAL generate_series(c._created_at, now() - interval '1 hour', interval '7 days') AS w(semana)
  CROSS JOIN LATERAL generate_series(1, 1 + pg_temp.sorteo('ses:' || c._id || ':' || w.semana) % 3) AS k(n)
  CROSS JOIN LATERAL (
    SELECT LEAST(now() - interval '1 hour',
                 w.semana + make_interval(days => pg_temp.sorteo('dia:' || c._id || ':' || w.semana || ':' || k.n) % 7,
                                          hours => 7 + pg_temp.sorteo('h:' || c._id || ':' || w.semana || ':' || k.n) % 15)) AS inicio
  ) s
 WHERE c.customer_code LIKE 'DEMO-C-%'
   AND pg_temp.sorteo('activo:' || c._id || ':' || w.semana) % 100 < CASE WHEN v.vivo THEN 55 ELSE 20 END;

INSERT INTO telemetry.customer_sessions
  (_tenant_id, customer_id, session_token_hash, channel, auth_method, started_at, ended_at,
   last_activity_at, user_agent, session_status, _created_at)
SELECT 1, cliente, 'DEMO-' || md5(cliente || ':' || inicio), 'mobile_app',
       CASE WHEN pg_temp.sorteo('met:' || cliente || ':' || inicio) % 4 = 0 THEN 'password' ELSE 'restored_session' END, inicio,
       inicio + make_interval(mins => 2 + pg_temp.sorteo('dur:' || cliente || ':' || inicio) % 12),
       inicio + make_interval(mins => 2 + pg_temp.sorteo('dur:' || cliente || ':' || inicio) % 12),
       'cartera-ejemplo', 'ended', inicio
  FROM uso;

INSERT INTO telemetry.auth_events
  (_tenant_id, customer_id, session_id, event_type, login_successful, occurred_at, _created_at)
SELECT 1, customer_id, _id, 'login', true, started_at, started_at
  FROM telemetry.customer_sessions WHERE session_token_hash LIKE 'DEMO-%';

-- Lo que quedó, para leerlo en la salida y no suponerlo.
SELECT 'solicitudes' AS que, count(*)::text AS cuantas FROM credit.credit_applications WHERE application_code LIKE 'DEMO-%'
UNION ALL SELECT 'créditos ' || status, count(*)::text FROM credit.loans WHERE loan_code LIKE 'DEMO-%' GROUP BY status
UNION ALL SELECT 'tramo ' || delinquency_bucket, count(*)::text FROM credit.loans WHERE loan_code LIKE 'DEMO-%' AND status <> 'paid_off' GROUP BY delinquency_bucket
UNION ALL SELECT 'cartera viva Bs', round(sum(outstanding_principal))::text FROM credit.loans WHERE loan_code LIKE 'DEMO-%' AND status = 'active'
UNION ALL SELECT 'pagos', count(*)::text FROM credit.loan_payments WHERE payment_code LIKE 'DEMO-%'
UNION ALL SELECT 'sesiones en la app', count(*)::text FROM telemetry.customer_sessions WHERE session_token_hash LIKE 'DEMO-%';

COMMIT;
