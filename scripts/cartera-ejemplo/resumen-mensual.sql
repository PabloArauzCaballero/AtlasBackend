-- Lo que la cartera de ejemplo movió cada mes, por comercio, para contabilizarlo en el ERP.
--
-- Es el puente entre las dos bases: el ERP no lee el núcleo, así que `cargar-en-test.sh` copia
-- esta salida a una tabla temporal de la sesión del ERP y `sembrar-erp.sql` la usa para facturar
-- la comisión y escribir los asientos. Una fila por mes y comercio (1 a 5, del `DEMO-NIT-n`).

COPY (
  WITH meses AS (
    SELECT generate_series(date_trunc('month', current_date) - interval '12 months',
                           date_trunc('month', current_date), interval '1 month')::date AS mes
  ), comercios AS (
    SELECT _id, substring(tax_id FROM 10)::int AS n, mdr_rate_percent
      FROM partner.partner_profiles WHERE tax_id LIKE 'DEMO-NIT-%'
  ), creditos AS (
    SELECT l._id, c.n, l.principal_amount, l.disbursed_at, l.written_off_at, l.written_off_amount
      FROM credit.loans l JOIN comercios c ON c._id = l.partner_profile_id
     WHERE l.loan_code LIKE 'DEMO-L-%'
  ), cobros AS (
    SELECT cr.n, date_trunc('month', p.received_at)::date AS mes,
           sum(a.principal_applied) AS capital, sum(a.interest_applied) AS interes
      FROM credit.loan_payments p
      JOIN credit.loan_payment_allocations a ON a.loan_payment_id = p._id AND NOT a.reversed
      JOIN creditos cr ON cr._id = p.loan_id
     WHERE p.status = 'applied'
     GROUP BY 1, 2
  )
  SELECT m.mes, c.n, c._id AS partner_id, c.mdr_rate_percent,
         COALESCE((SELECT sum(principal_amount) FROM creditos x
                    WHERE x.n = c.n AND date_trunc('month', x.disbursed_at) = m.mes), 0) AS desembolsado,
         COALESCE(cb.capital, 0) AS capital_cobrado,
         COALESCE(cb.interes, 0) AS interes_cobrado,
         COALESCE((SELECT sum(written_off_amount) FROM creditos x
                    WHERE x.n = c.n AND date_trunc('month', x.written_off_at) = m.mes), 0) AS castigado
    FROM meses m CROSS JOIN comercios c
    LEFT JOIN cobros cb ON cb.n = c.n AND cb.mes = m.mes
   ORDER BY m.mes, c.n
) TO STDOUT WITH (FORMAT csv);
