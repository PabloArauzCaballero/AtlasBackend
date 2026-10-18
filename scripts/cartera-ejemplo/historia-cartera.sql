-- La foto agregada por producto y tramo (`dashboards.portfolio_snapshot_daily`) de la cartera de
-- ejemplo, rehecha desde la foto por préstamo que acaba de cargarse.
--
-- Imita a `read_api.v_accounting_portfolio_v1`, que es de donde la saca el job de tableros: saldo
-- con lo castigado dentro de su tramo, castigo aparte y la provisión de referencia con las mismas
-- tasas por tramo (1 / 5 / 20 / 50 / 80 / 100 %). Vencido y por vencer quedan en blanco porque el
-- job tampoco los escribe. Corre dentro de la transacción que abre `cargar-en-test.sh`.

INSERT INTO dashboards.portfolio_snapshot_daily
  (tenant_id, at, product_code, bucket, creditos, saldo_capital, castigado, provision_referencia,
   es_semilla)
SELECT tenant_id, at, product_code, bucket, count(*), sum(saldo_capital),
       COALESCE(sum(saldo_capital) FILTER (WHERE written_off), 0),
       round(sum(saldo_capital * CASE bucket
                   WHEN 'current' THEN 0.01 WHEN 'dpd_1_29' THEN 0.05 WHEN 'dpd_30_59' THEN 0.20
                   WHEN 'dpd_60_89' THEN 0.50 WHEN 'dpd_90_plus' THEN 0.80 WHEN 'written_off' THEN 1.00
                   ELSE 0.01 END), 2),
       true
  FROM dashboards.loan_daily_snapshot
 WHERE es_semilla AND product_code LIKE 'DEMO-%'
 GROUP BY tenant_id, at, product_code, bucket;
