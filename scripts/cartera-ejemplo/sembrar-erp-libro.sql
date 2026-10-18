-- Proveedores y libro mayor de la cartera de ejemplo. Continúa `sembrar-erp.sql` en la misma
-- transacción (lo encadena `cargar-en-test.sh`); usa sus tablas temporales `resumen` y `fac`.

-- ── Proveedores: facturas, pagos y órdenes pendientes ───────────────────────────────────────────

/*
 * Cinco proveedores con gasto mensual. Se factura a fin de mes y se paga el día 10 del siguiente;
 * la factura de marketing de hace dos meses sigue impaga (vencida) y las del mes en curso esperan
 * con una orden de pago aprobada, para que «por pagar» tenga antigüedad y órdenes sin ejecutar.
 */
CREATE TEMP TABLE prov ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('NUBE',  '61010101', '21010103', 'TECH-PLAT',   NULL::text),
  ('PAGOS', '51010101', '21010103', 'OPS-PAY',     'BNPL-STD'),
  ('MKT',   '63010101', '21010108', 'MKT-GROWTH',  NULL),
  ('OFI',   '64010101', '21010101', 'FIN-ACCOUNT', NULL),
  ('COBR',  '53010103', '21010107', 'OPS-COLL',    'RECOVERY')) AS x(sup, cuenta_gasto, cuenta_cxp, cc, pc);

CREATE TEMP TABLE mes26 ON COMMIT DROP AS
SELECT mes, (extract(month FROM mes) - 1)::int AS k,
       LEAST((mes + interval '1 month - 1 day')::date, current_date) AS fecha,
       -- Planilla e intereses se pagan al cierre: el mes en curso todavía no los lleva.
       (mes + interval '1 month - 1 day')::date AS cierre,
       sum(desembolsado) AS des, sum(capital_cobrado) AS cap, sum(interes_cobrado) AS inte, sum(castigado) AS castigo
  FROM resumen WHERE mes >= DATE '2026-01-01' GROUP BY mes;

CREATE TEMP TABLE apf ON COMMIT DROP AS
SELECT p.*, m.mes, m.k,
       'DEMO-AP-' || p.sup || '-' || to_char(m.mes, 'YYYYMM') AS numero,
       CASE WHEN m.mes = date_trunc('month', current_date) THEN current_date - 1 ELSE m.fecha END AS fecha,
       round(CASE p.sup WHEN 'NUBE' THEN 4000 * (1 + 0.03 * m.k)
                        WHEN 'PAGOS' THEN 0.004 * (m.cap + m.inte)
                        WHEN 'MKT' THEN 6000
                        WHEN 'OFI' THEN 3500
                        ELSE 0.02 * m.cap END, 2) AS bruto
  FROM prov p CROSS JOIN mes26 m;

ALTER TABLE apf ADD COLUMN iva numeric, ADD COLUMN vence date, ADD COLUMN pagado_el date;
UPDATE apf SET iva = round(bruto * 0.13, 2), vence = fecha + 30,
  pagado_el = CASE WHEN sup = 'MKT' AND mes = date_trunc('month', current_date) - interval '2 months' THEN NULL
                   WHEN (mes + interval '1 month')::date + 9 < current_date THEN (mes + interval '1 month')::date + 9 END;
DELETE FROM apf WHERE bruto <= 0;

INSERT INTO atlas_accounting.ap_invoice
  (legal_entity_id, supplier_bp_id, invoice_no, invoice_date, due_date, currency_code, net_amount, tax_amount, gross_amount, status)
SELECT le.id, bp.id, a.numero, a.fecha, a.vence, 'BOB', a.bruto - a.iva, a.iva, a.bruto,
       CASE WHEN a.pagado_el IS NULL THEN 'POSTED' ELSE 'PAID' END
  FROM apf a
  JOIN atlas_accounting.business_partner bp ON bp.partner_no = 'DEMO-BP-' || a.sup
  CROSS JOIN (SELECT id FROM atlas_accounting.legal_entity WHERE code = 'ATLAS-BO') le;

INSERT INTO atlas_accounting.supplier_payment (ap_invoice_id, payment_date, amount, status)
SELECT i.id, a.pagado_el, a.bruto, 'EXECUTED'
  FROM apf a JOIN atlas_accounting.ap_invoice i ON i.invoice_no = a.numero
 WHERE a.pagado_el IS NOT NULL;

INSERT INTO atlas_accounting.payment_order
  (legal_entity_id, payee_bp_id, payment_type, requested_amount, currency_code, requested_date, approved_at, status)
SELECT i.legal_entity_id, i.supplier_bp_id, 'SUPPLIER_PAYMENT', a.bruto, 'BOB', a.vence, now(), 'APPROVED'
  FROM apf a JOIN atlas_accounting.ap_invoice i ON i.invoice_no = a.numero
 WHERE a.mes = date_trunc('month', current_date);

-- ── Libro mayor ─────────────────────────────────────────────────────────────────────────────────

/* Cada fila es una línea; `doc` agrupa las de un asiento. `bp`, `cc`, `pc` y `tax` son códigos. */
CREATE TEMP TABLE mov (
  doc text, fecha date, cuenta text, debe numeric DEFAULT 0, haber numeric DEFAULT 0,
  bp text, cc text, pc text, tax text, ref text, descr text
) ON COMMIT DROP;

-- Apertura: capital, préstamo bancario, la cartera colocada antes de 2026 y la comisión de
-- diciembre que todavía se debía al cerrar el año.
WITH previo AS (
  SELECT COALESCE(sum(desembolsado - capital_cobrado - castigado), 0) AS cartera
    FROM resumen WHERE mes < DATE '2026-01-01'
), mdr_previo AS (
  SELECT n, sum(total) AS total FROM fac
   WHERE fecha < DATE '2026-01-01' AND pagado_en >= DATE '2026-01-01' GROUP BY n
)
INSERT INTO mov (doc, fecha, cuenta, debe, haber, bp, pc, ref, descr)
SELECT 'DEMO-APE-2026', DATE '2026-01-01', '11010201', 2000000 - cartera, 0, NULL, NULL, 'RECEIPT', 'Apertura: caja' FROM previo
UNION ALL SELECT 'DEMO-APE-2026', DATE '2026-01-01', '12020101', cartera, 0, 'CONS', 'BNPL-STD', 'LOAN', 'Apertura: cartera colocada en 2025' FROM previo
UNION ALL SELECT 'DEMO-APE-2026', DATE '2026-01-01', '12010101', total, 0, 'COM-' || n, 'MDR-MERCH', 'AR_INVOICE', 'Apertura: comisión de diciembre por cobrar' FROM mdr_previo
UNION ALL SELECT 'DEMO-APE-2026', DATE '2026-01-01', '34010101', 0, (SELECT COALESCE(sum(total), 0) FROM mdr_previo), NULL, NULL, NULL, 'Apertura: resultado de 2025'
UNION ALL SELECT 'DEMO-APE-2026', DATE '2026-01-01', '31010101', 0, 800000, 'ACC', NULL, NULL, 'Apertura: capital pagado'
UNION ALL SELECT 'DEMO-APE-2026', DATE '2026-01-01', '24010101', 0, 1200000, 'BANCO', NULL, 'LOAN', 'Apertura: préstamo bancario a largo plazo';

-- Desembolsos y cobros de la cartera, por mes.
INSERT INTO mov (doc, fecha, cuenta, debe, haber, bp, pc, ref, descr)
SELECT 'DEMO-DES-' || to_char(mes, 'YYYYMM'), fecha, '12020101', des, 0, 'CONS', 'BNPL-STD', 'LOAN', 'Créditos desembolsados' FROM mes26
UNION ALL SELECT 'DEMO-DES-' || to_char(mes, 'YYYYMM'), fecha, '11010203', 0, des, NULL, NULL, 'LOAN', 'Pago a comercios por compras financiadas' FROM mes26
UNION ALL SELECT 'DEMO-COB-' || to_char(mes, 'YYYYMM'), fecha, '11010202', cap + inte, 0, NULL, NULL, 'RECEIPT', 'Cuotas cobradas' FROM mes26
UNION ALL SELECT 'DEMO-COB-' || to_char(mes, 'YYYYMM'), fecha, '12020101', 0, cap, 'CONS', 'BNPL-STD', 'RECEIPT', 'Capital cobrado' FROM mes26
UNION ALL SELECT 'DEMO-COB-' || to_char(mes, 'YYYYMM'), fecha, '45010105', 0, inte, 'CONS', NULL, NULL, 'Interés cobrado' FROM mes26;

-- Provisión (2,5 % de lo colocado más lo que se castiga) y castigos contra la provisión.
INSERT INTO mov (doc, fecha, cuenta, debe, haber, bp, cc, pc, ref, descr)
SELECT 'DEMO-PRV-' || to_char(mes, 'YYYYMM'), fecha, '52010201', round(0.025 * des + castigo, 2), 0, NULL, 'RISK-PORT', 'BNPL-STD', NULL, 'Provisión por pérdida esperada' FROM mes26
UNION ALL SELECT 'DEMO-PRV-' || to_char(mes, 'YYYYMM'), fecha, '12040201', 0, round(0.025 * des + castigo, 2), NULL, NULL, NULL, 'PROVISION', 'Provisión por pérdida esperada' FROM mes26
UNION ALL SELECT 'DEMO-CAS-' || to_char(mes, 'YYYYMM'), fecha, '12040201', castigo, 0, NULL, NULL, NULL, 'PROVISION', 'Castigo contra provisión' FROM mes26
UNION ALL SELECT 'DEMO-CAS-' || to_char(mes, 'YYYYMM'), fecha, '12020101', 0, castigo, 'CONS', NULL, 'BNPL-STD', 'LOAN', 'Créditos castigados' FROM mes26;

-- Comisión: factura de los meses cerrados (con IVA), devengo del mes en curso y cobros.
INSERT INTO mov (doc, fecha, cuenta, debe, haber, bp, pc, tax, ref, descr)
SELECT 'DEMO-MDR-' || to_char(f.mes, 'YYYYMM'), f.fecha, '12010101', f.total, 0, 'COM-' || f.n, 'MDR-MERCH', NULL, 'AR_INVOICE', 'Comisión facturada ' || f.numero
  FROM fac f WHERE f.fecha >= DATE '2026-01-01'
UNION ALL
SELECT 'DEMO-MDR-' || to_char(f.mes, 'YYYYMM'), f.fecha, c.cuenta_mdr, 0, f.total - f.iva, 'COM-' || f.n, 'MDR-MERCH', 'IVA13_VENTA', NULL, 'Comisión MDR ' || c.nombre
  FROM fac f JOIN comercio c ON c.n = f.n WHERE f.fecha >= DATE '2026-01-01'
UNION ALL
SELECT 'DEMO-MDR-' || to_char(f.mes, 'YYYYMM'), f.fecha, '21030101', 0, f.iva, NULL, NULL, 'IVA13_VENTA', 'AR_INVOICE', 'IVA débito de la comisión'
  FROM fac f WHERE f.fecha >= DATE '2026-01-01'
UNION ALL
SELECT 'DEMO-MDR-' || to_char(r.mes, 'YYYYMM'), current_date, '12010102', round(r.desembolsado * r.mdr / 100 * 0.87, 2), 0,
       'COM-' || r.n, 'MDR-MERCH', NULL, 'AR_INVOICE', 'Comisión devengada sin facturar'
  FROM resumen r WHERE r.mes = date_trunc('month', current_date) AND r.desembolsado > 0
UNION ALL
SELECT 'DEMO-MDR-' || to_char(r.mes, 'YYYYMM'), current_date, c.cuenta_mdr, 0, round(r.desembolsado * r.mdr / 100 * 0.87, 2),
       'COM-' || r.n, 'MDR-MERCH', 'IVA13_VENTA', NULL, 'Comisión devengada ' || c.nombre
  FROM resumen r JOIN comercio c ON c.n = r.n WHERE r.mes = date_trunc('month', current_date) AND r.desembolsado > 0
UNION ALL
SELECT 'DEMO-MDC-' || to_char(f.pagado_en, 'YYYYMM'), f.pagado_en::date, '11010202', f.pagado, 0, NULL, NULL, NULL, 'RECEIPT', 'Comisión cobrada ' || f.numero
  FROM fac f WHERE f.pagado > 0 AND f.pagado_en >= DATE '2026-01-01'
UNION ALL
SELECT 'DEMO-MDC-' || to_char(f.pagado_en, 'YYYYMM'), f.pagado_en::date, '12010101', 0, f.pagado, 'COM-' || f.n, 'MDR-MERCH', NULL, 'RECEIPT', 'Comisión cobrada ' || f.numero
  FROM fac f WHERE f.pagado > 0 AND f.pagado_en >= DATE '2026-01-01';

-- Proveedores: la factura (gasto + IVA crédito contra la cuenta por pagar) y su pago.
INSERT INTO mov (doc, fecha, cuenta, debe, haber, bp, cc, pc, tax, ref, descr)
SELECT 'DEMO-GAS-' || to_char(mes, 'YYYYMM'), fecha, cuenta_gasto, bruto - iva, 0, sup, cc, pc, 'IVA13_COMPRA', NULL, 'Factura ' || numero FROM apf
UNION ALL SELECT 'DEMO-GAS-' || to_char(mes, 'YYYYMM'), fecha, '13010101', iva, 0, NULL, NULL, NULL, 'IVA13_COMPRA', 'AP_INVOICE', 'IVA crédito ' || numero FROM apf
UNION ALL SELECT 'DEMO-GAS-' || to_char(mes, 'YYYYMM'), fecha, cuenta_cxp, 0, bruto, sup, NULL, NULL, NULL, 'AP_INVOICE', 'Por pagar ' || numero FROM apf
UNION ALL SELECT 'DEMO-PAG-' || to_char(pagado_el, 'YYYYMM'), pagado_el, cuenta_cxp, bruto, 0, sup, NULL, NULL, NULL, 'SUPPLIER_PAYMENT', 'Pago ' || numero FROM apf WHERE pagado_el IS NOT NULL
UNION ALL SELECT 'DEMO-PAG-' || to_char(pagado_el, 'YYYYMM'), pagado_el, '11010204', 0, bruto, NULL, NULL, NULL, NULL, 'SUPPLIER_PAYMENT', 'Pago ' || numero FROM apf WHERE pagado_el IS NOT NULL;

-- Planilla (crece 2 % al mes con el equipo), intereses del fondeo y la línea de junio.
INSERT INTO mov (doc, fecha, cuenta, debe, haber, bp, cc, ref, descr)
SELECT 'DEMO-NOM-' || to_char(m.mes, 'YYYYMM'), m.cierre, s.cuenta, round(s.monto * (1 + 0.02 * m.k), 2), 0, 'PLANILLA', s.cc, NULL, 'Sueldos ' || s.area
  FROM mes26 m CROSS JOIN (VALUES ('62010101', 'CORP-CEO', 5000, 'dirección'), ('62010102', 'FIN-ACCOUNT', 3500, 'finanzas'),
                                  ('62010103', 'RISK-CREDIT', 5000, 'riesgo'), ('62010105', 'OPS-ORIG', 4500, 'originación')) AS s(cuenta, cc, monto, area)
UNION ALL
SELECT 'DEMO-NOM-' || to_char(m.mes, 'YYYYMM'), m.cierre, '11010205', 0, round(5000 * (1 + 0.02 * m.k), 2) + round(3500 * (1 + 0.02 * m.k), 2)
       + round(5000 * (1 + 0.02 * m.k), 2) + round(4500 * (1 + 0.02 * m.k), 2), NULL, NULL, 'SUPPLIER_PAYMENT', 'Pago de planilla'
  FROM mes26 m
UNION ALL SELECT 'DEMO-INT-' || to_char(mes, 'YYYYMM'), cierre, '67010101', 9000, 0, 'BANCO', 'FIN-TREAS', NULL, 'Intereses préstamo bancario' FROM mes26
UNION ALL SELECT 'DEMO-INT-' || to_char(mes, 'YYYYMM'), cierre, '67010102', 7333.33, 0, 'BANCO', 'FIN-TREAS', NULL, 'Intereses línea de crédito' FROM mes26 WHERE mes >= DATE '2026-07-01'
UNION ALL SELECT 'DEMO-INT-' || to_char(mes, 'YYYYMM'), cierre, '11010201', 0, 9000 + CASE WHEN mes >= DATE '2026-07-01' THEN 7333.33 ELSE 0 END, NULL, NULL, 'SUPPLIER_PAYMENT', 'Pago de intereses' FROM mes26
UNION ALL SELECT 'DEMO-FON-202606', DATE '2026-06-05', '11010201', 800000, 0, NULL, NULL, 'LOAN', 'Desembolso línea de crédito'
UNION ALL SELECT 'DEMO-FON-202606', DATE '2026-06-05', '22010103', 0, 800000, 'BANCO', NULL, 'LOAN', 'Línea de crédito utilizada';

DELETE FROM mov WHERE debe = 0 AND haber = 0;
DELETE FROM mov WHERE fecha > current_date;

-- Un asiento que no cuadre aborta todo: mejor ninguna contabilidad que una que no suma.
DO $$
DECLARE descuadre text;
BEGIN
  SELECT string_agg(doc || ' ' || (sum_d - sum_h)::text, ', ') INTO descuadre
    FROM (SELECT doc, sum(debe) AS sum_d, sum(haber) AS sum_h FROM mov GROUP BY doc HAVING sum(debe) <> sum(haber)) x;
  IF descuadre IS NOT NULL THEN RAISE EXCEPTION 'Asientos de ejemplo descuadrados: %', descuadre; END IF;
END $$;

INSERT INTO atlas_accounting.accounting_document
  (legal_entity_id, source_system, source_type, source_id, document_type, document_no, document_date,
   posting_date, accounting_period_id, ledger_id, currency_code, status, approval_status, created_at)
SELECT le.id, 'DEMO', 'cartera_ejemplo', d.doc, 'JOURNAL', d.doc, d.fecha, d.fecha, p.id, lg.id, 'BOB', 'POSTED',
       'NOT_REQUIRED', d.fecha
  FROM (SELECT doc, max(fecha) AS fecha FROM mov GROUP BY doc) d
  JOIN atlas_accounting.legal_entity le ON le.code = 'ATLAS-BO'
  JOIN atlas_accounting.ledger lg ON lg.code = 'LOCAL-BO' AND lg.legal_entity_id = le.id
  JOIN atlas_accounting.fiscal_year fy ON fy.legal_entity_id = le.id
  JOIN atlas_accounting.accounting_period p
    ON p.fiscal_year_id = fy.id AND p.is_open AND d.fecha BETWEEN p.start_date AND p.end_date;

INSERT INTO atlas_accounting.journal_entry (accounting_document_id, journal_no, posting_status, created_at)
SELECT id, document_no, 'DRAFT', posting_date FROM atlas_accounting.accounting_document WHERE document_no LIKE 'DEMO-%';

-- Todas las líneas en UNA sentencia: el disparador de cuadre corre al final de la sentencia.
INSERT INTO atlas_accounting.journal_entry_line
  (journal_entry_id, line_no, gl_account_id, debit, credit, currency_code, amount_lc, partner_id,
   cost_center_id, profit_center_id, tax_code_id, reference_type, description, created_at)
SELECT je.id, row_number() OVER (PARTITION BY m.doc ORDER BY m.debe DESC, m.cuenta)::smallint, ga.id,
       m.debe, m.haber, 'BOB', m.debe + m.haber, bp.id, cc.id, pc.id, tc.id, m.ref, left(m.descr, 250), m.fecha
  FROM mov m
  JOIN atlas_accounting.journal_entry je ON je.journal_no = m.doc
  JOIN atlas_accounting.gl_account ga ON ga.account_no = m.cuenta
  LEFT JOIN atlas_accounting.business_partner bp ON bp.partner_no = 'DEMO-BP-' || m.bp
  LEFT JOIN atlas_accounting.cost_center cc ON cc.code = m.cc
  LEFT JOIN atlas_accounting.profit_center pc ON pc.code = m.pc
  LEFT JOIN atlas_accounting.tax_code tc ON tc.code = m.tax;

UPDATE atlas_accounting.journal_entry je SET posting_status = 'POSTED', posted_at = d.posting_date
  FROM atlas_accounting.accounting_document d
 WHERE d.id = je.accounting_document_id AND d.document_no LIKE 'DEMO-%';

-- Lo que quedó, para leerlo en la salida y no suponerlo.
SELECT 'asientos' AS que, count(*)::text AS cuantos FROM atlas_accounting.journal_entry WHERE journal_no LIKE 'DEMO-%'
UNION ALL SELECT 'líneas', count(*)::text FROM mov
UNION ALL SELECT 'caja Bs (grupo 11)', round(sum(debe - haber))::text FROM mov WHERE cuenta LIKE '11%'
UNION ALL SELECT 'resultado 2026 Bs', round(sum(haber - debe))::text FROM mov WHERE left(cuenta, 1) IN ('4', '5', '6')
UNION ALL SELECT 'resultado ' || to_char(fecha, 'YYYY-MM'), round(sum(haber - debe))::text FROM mov WHERE left(cuenta, 1) IN ('4', '5', '6') GROUP BY to_char(fecha, 'YYYY-MM')
UNION ALL SELECT 'facturas de comisión', count(*)::text FROM fac
UNION ALL SELECT 'facturas de proveedor', count(*)::text FROM apf;
