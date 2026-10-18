-- La foto por préstamo de la cartera de ejemplo en cada fecha pasada, para la base de TABLEROS.
--
-- Los tableros guardan su propia historia (`dashboards.loan_daily_snapshot`) porque el núcleo
-- sobreescribe la mora cada día. Una cartera sembrada hoy no tiene esa historia, y sin ella las
-- cosechas, la matriz de tránsitos, el deterioro y lo recuperado salen vacíos. Aquí se reconstruye
-- desde lo único que sí tiene fecha: cuándo vence cada cuota y cuándo se pagó. En una fecha E:
--   * pagado        = cuotas con `settled_at` hasta E;
--   * saldo         = capital − capital pagado hasta E;
--   * días de atraso = E − vencimiento de la cuota impaga más vieja en E;
--   * castigado     = `written_off_at` hasta E.
-- Es exactamente lo que el job de tableros habría escrito esa noche, con el mismo `loan_ref`
-- (sha256 del código) para que la foto de mañana se empareje con éstas.
--
-- Fechas: el cierre de cada uno de los últimos 13 meses y cada uno de los últimos 40 días.
-- Sale como COPY a la salida estándar; `cargar-en-test.sh` la vuelca en la base de tableros.

COPY (
  WITH fechas AS (
    SELECT DISTINCT e::date AS e FROM (
      SELECT (date_trunc('month', current_date) - (m || ' months')::interval - interval '1 day') AS e
        FROM generate_series(0, 12) AS m
      UNION ALL
      SELECT current_date - d FROM generate_series(0, 40) AS d
    ) x
  ), foto AS (
    SELECT f.e, l.loan_code, p.product_code, to_char(l.disbursed_at, 'YYYY-MM') AS cohorte,
           l.principal_amount,
           (l.written_off_at IS NOT NULL AND l.written_off_at::date <= f.e) AS castigado,
           COALESCE(sum(i.principal_amount) FILTER (WHERE i.settled_at::date <= f.e), 0) AS capital_pagado,
           COALESCE(sum(i.interest_amount) FILTER (WHERE i.settled_at::date <= f.e), 0) AS interes_pagado,
           COALESCE(f.e - min(i.due_date) FILTER (
             WHERE i.due_date < f.e AND (i.settled_at IS NULL OR i.settled_at::date > f.e)), 0) AS mora
      FROM fechas f
      JOIN credit.loans l ON l.disbursed_at::date <= f.e
      JOIN credit.credit_products p ON p._id = l.credit_product_id
      JOIN credit.loan_installments i ON i.loan_id = l._id
     WHERE l.loan_code LIKE 'DEMO-L-%'
     GROUP BY f.e, l._id, l.loan_code, p.product_code, l.disbursed_at, l.principal_amount, l.written_off_at
  )
  SELECT 1 AS tenant_id, e AS at, encode(sha256(loan_code::bytea), 'hex') AS loan_ref, product_code,
         cohorte,
         CASE WHEN castigado THEN 'written_off' WHEN mora = 0 THEN 'current'
              WHEN mora <= 29 THEN 'dpd_1_29' WHEN mora <= 59 THEN 'dpd_30_59'
              WHEN mora <= 89 THEN 'dpd_60_89' ELSE 'dpd_90_plus' END AS bucket,
         mora AS days_past_due,
         principal_amount - capital_pagado AS saldo_capital,
         capital_pagado AS paid_principal,
         interes_pagado AS paid_interest,
         castigado AS written_off,
         true AS es_semilla
    FROM foto
) TO STDOUT WITH (FORMAT csv);
