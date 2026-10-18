-- La cara ERP de la cartera de ejemplo: comercios, comisión facturada y cobrada, proveedores y la
-- contabilidad de 2026, para que Finanzas y Contabilidad tengan algo que leer en TEST.
--
-- NO se corre suelto: `cargar-en-test.sh` abre la transacción, borra lo anterior con el cuerpo de
-- `quitar-erp.sql`, carga la tabla temporal `resumen` con la salida de `resumen-mensual.sql` (lo que
-- la cartera del núcleo movió cada mes y por comercio) y después ejecuta esto.
--
-- Cómo se contabiliza. El plan de cuentas del ERP es el de un BNPL de comercio, sin una cuenta de
-- «cartera de créditos»; se usa la más cercana y se dice aquí para que nadie lo tome por norma:
--   * crédito desembolsado  → 12020101 Principal cubierto - Vigente (contra 11010203 pagos a comercios)
--   * cuota cobrada          → 11010202 cobranzas, contra principal (12020101) e interés (45010105)
--   * comisión del comercio  → 12010101 MDR facturado, contra 4101030x por rubro e IVA débito 21030101
--   * provisión / castigo    → 52010201 gasto ECL contra 12040201; el castigo consume la provisión
--   * proveedores            → gasto + IVA crédito 13010101 contra 2101010x; se pagan el día 10
--   * fondeo                 → capital 31010101 y deuda 24010101 / 22010103; intereses en 67
-- Cada asiento cuadra por construcción: la línea de contrapartida es la suma de las demás.
-- Los períodos del ERP empiezan en enero de 2026: lo anterior entra como asiento de apertura.

-- Los disparadores del ERP nombran sus tablas sin esquema: la aplicación fija este search_path.
SET LOCAL search_path = atlas_accounting, atlas_sales, public;

-- ── Socios de negocio y comercios ───────────────────────────────────────────────────────────────

INSERT INTO atlas_accounting.business_partner (partner_no, partner_type, legal_name, trade_name, tax_id, country_code, status)
SELECT 'DEMO-BP-' || codigo, tipo, 'DEMO ' || nombre, nombre, 'DEMO-' || codigo, 'BO', 'ACTIVE'
  FROM (VALUES ('COM-1', 'COMPANY', 'Electro Hogar S.R.L.'), ('COM-2', 'COMPANY', 'Motos del Oriente S.R.L.'),
               ('COM-3', 'COMPANY', 'Muebles Chiquitano S.R.L.'), ('COM-4', 'COMPANY', 'Farmacia Vida S.R.L.'),
               ('COM-5', 'COMPANY', 'Óptica Central S.R.L.'), ('CONS', 'COMPANY', 'Clientes de la cartera de ejemplo'),
               ('BANCO', 'BANK', 'Banco de ejemplo S.A.'), ('ACC', 'COMPANY', 'Accionistas de ejemplo'),
               ('PLANILLA', 'COMPANY', 'Planilla de ejemplo'), ('NUBE', 'COMPANY', 'Nube de ejemplo S.R.L.'),
               ('PAGOS', 'COMPANY', 'Pasarela QR de ejemplo S.A.'), ('MKT', 'COMPANY', 'Agencia de marketing de ejemplo'),
               ('OFI', 'COMPANY', 'Inmobiliaria de ejemplo'), ('COBR', 'COMPANY', 'Cobranzas de ejemplo S.R.L.')) AS x(codigo, tipo, nombre);

CREATE TEMP TABLE comercio ON COMMIT DROP AS
SELECT x.n, x.nombre, x.rubro, x.cuenta_mdr, r.partner_id
  FROM (VALUES (1, 'Electro Hogar', 'Electrodomésticos', '41010301'), (2, 'Motos del Oriente', 'Motocicletas', '41010307'),
               (3, 'Muebles Chiquitano', 'Hogar', '41010302'), (4, 'Farmacia Vida', 'Salud', '41010303'),
               (5, 'Óptica Central', 'Salud visual', '41010303')) AS x(n, nombre, rubro, cuenta_mdr)
  JOIN (SELECT DISTINCT n, partner_id FROM resumen) r ON r.n = x.n;

-- La ficha del comercio en el CRM, enlazada con el comercio del núcleo y con su socio contable.
INSERT INTO atlas_sales.b2b_accounts
  (legal_name, trade_name, tax_id, account_type, industry, lifecycle_status, category, business_line,
   country_code, city, partner_profile_id, business_partner_id, created_at, updated_at)
SELECT 'DEMO ' || c.nombre || ' S.R.L.', c.nombre, 'DEMO-NIT-' || c.n, 'MERCHANT', c.rubro, 'CUSTOMER',
       c.rubro, 'BNPL', 'BO', 'Santa Cruz', c.partner_id::text, bp.id,
       now() - interval '15 months', now()
  FROM comercio c JOIN atlas_accounting.business_partner bp ON bp.partner_no = 'DEMO-BP-COM-' || c.n;

-- ── Embudo comercial: prospectos, oportunidades y altas ─────────────────────────────────────────

/*
 * Diez prospectos en distintas etapas, los cinco comercios como oportunidades ganadas y dos
 * perdidas con su motivo; las altas de los cinco completadas y dos prospectos en revisión. Así el
 * pipeline por etapa y el alta por estado enseñan dónde se atasca la red, no dos filas sueltas.
 * El dueño es el primer usuario interno del ERP: la oportunidad lo exige y no se inventa uno.
 */
INSERT INTO atlas_sales.b2b_accounts
  (legal_name, trade_name, tax_id, account_type, industry, lifecycle_status, category, business_line,
   country_code, city, created_at, updated_at)
SELECT 'DEMO ' || p.nombre || ' S.R.L.', p.nombre, 'DEMO-PROS-' || p.n, 'MERCHANT', p.rubro,
       (CASE WHEN p.n <= 4 THEN 'LEAD' ELSE 'QUALIFIED' END)::atlas_sales.account_status, p.rubro, 'BNPL',
       'BO', 'Santa Cruz', now() - make_interval(days => 5 + p.n * 9), now()
  FROM (VALUES (1, 'Celulares Norte', 'Tecnología'), (2, 'Bicicletas Andinas', 'Movilidad'),
               (3, 'Colchones Descanso', 'Hogar'), (4, 'Dental Sonrisa', 'Salud'),
               (5, 'Línea Blanca Express', 'Electrodomésticos'), (6, 'Computación Total', 'Tecnología'),
               (7, 'Repuestos El Cruce', 'Movilidad'), (8, 'Óptica Visión Clara', 'Salud visual'),
               (9, 'Muebles Roble', 'Hogar'), (10, 'Instituto Futuro', 'Educación')) AS p(n, nombre, rubro);

INSERT INTO atlas_sales.sales_opportunities
  (account_id, owner_user_id, name, opportunity_type, stage, expected_monthly_volume, expected_mdr_rate,
   expected_monthly_revenue, probability, expected_close_date, loss_reason, created_at, updated_at)
SELECT a.id, u.id, 'Afiliación ' || a.trade_name, 'NEW_MERCHANT', o.etapa::atlas_sales.opportunity_stage,
       o.volumen, 3.2, round(o.volumen * 0.032, 2), o.prob, current_date + o.cierre, o.perdida,
       now() - make_interval(days => 10 + o.cierre), now()
  FROM (VALUES ('DEMO-PROS-1', 'DISCOVERY', 40000, 0.10, 60, NULL), ('DEMO-PROS-2', 'DISCOVERY', 25000, 0.10, 75, NULL),
               ('DEMO-PROS-3', 'QUALIFICATION', 60000, 0.25, 45, NULL), ('DEMO-PROS-4', 'QUALIFICATION', 30000, 0.25, 50, NULL),
               ('DEMO-PROS-5', 'PROPOSAL', 90000, 0.45, 30, NULL), ('DEMO-PROS-6', 'PROPOSAL', 120000, 0.45, 25, NULL),
               ('DEMO-PROS-7', 'NEGOTIATION', 50000, 0.65, 15, NULL), ('DEMO-PROS-8', 'CONTRACTING', 35000, 0.85, 7, NULL),
               ('DEMO-PROS-9', 'CLOSED_LOST', 70000, 0, -20, 'Prefirió financiar con su banco'),
               ('DEMO-PROS-10', 'CLOSED_LOST', 20000, 0, -35, 'Volumen por debajo del mínimo'),
               ('DEMO-NIT-1', 'CLOSED_WON', 150000, 1, -400, NULL), ('DEMO-NIT-2', 'CLOSED_WON', 140000, 1, -400, NULL),
               ('DEMO-NIT-3', 'CLOSED_WON', 110000, 1, -390, NULL), ('DEMO-NIT-4', 'CLOSED_WON', 30000, 1, -380, NULL),
               ('DEMO-NIT-5', 'CLOSED_WON', 30000, 1, -370, NULL)) AS o(tax, etapa, volumen, prob, cierre, perdida)
  JOIN atlas_sales.b2b_accounts a ON a.tax_id = o.tax
  CROSS JOIN (SELECT id FROM atlas_sales.internal_users ORDER BY created_at LIMIT 1) u;

INSERT INTO atlas_sales.merchant_onboarding_cases (account_id, owner_user_id, status, started_at, completed_at)
SELECT a.id, u.id, x.estado, now() - make_interval(days => x.hace), CASE WHEN x.estado = 'COMPLETED' THEN now() - make_interval(days => x.hace - 6) END
  FROM (VALUES ('DEMO-NIT-1', 'COMPLETED', 420), ('DEMO-NIT-2', 'COMPLETED', 410), ('DEMO-NIT-3', 'COMPLETED', 400),
               ('DEMO-NIT-4', 'COMPLETED', 395), ('DEMO-NIT-5', 'COMPLETED', 390), ('DEMO-PROS-8', 'UNDER_REVIEW', 6),
               ('DEMO-PROS-7', 'SUBMITTED', 3)) AS x(tax, estado, hace)
  JOIN atlas_sales.b2b_accounts a ON a.tax_id = x.tax
  CROSS JOIN (SELECT id FROM atlas_sales.internal_users ORDER BY created_at LIMIT 1) u;

-- ── Comisión: facturas, cobros y saldo abierto ──────────────────────────────────────────────────

/*
 * Una factura de comisión por comercio y mes cerrado, vence a los 15 días. Casi todo se cobra a
 * tiempo; agosto deja a Óptica Central debiendo y septiembre tiene un pago parcial y dos vencidas,
 * para que la antigüedad de cuentas por cobrar tenga tramos de verdad.
 */
CREATE TEMP TABLE fac ON COMMIT DROP AS
SELECT r.n, r.mes,
       'DEMO-MDR-' || to_char(r.mes, 'YYYYMM') || '-' || r.n AS numero,
       (r.mes + interval '1 month - 1 day')::date AS fecha,
       (r.mes + interval '1 month - 1 day')::date + 15 AS vence,
       round(r.desembolsado * r.mdr / 100, 2) AS total
  FROM resumen r
 WHERE r.mes < date_trunc('month', current_date) AND r.desembolsado > 0;

ALTER TABLE fac ADD COLUMN iva numeric, ADD COLUMN pagado numeric, ADD COLUMN pagado_en timestamptz, ADD COLUMN estado text;
UPDATE fac SET iva = round(total * 0.13, 2),
  pagado = CASE WHEN mes = date_trunc('month', current_date) - interval '1 month' AND n IN (4, 5) THEN 0
                WHEN mes = date_trunc('month', current_date) - interval '1 month' AND n = 2 THEN round(total / 2, 2)
                WHEN mes = date_trunc('month', current_date) - interval '2 months' AND n = 5 THEN 0
                ELSE total END;
UPDATE fac SET
  pagado_en = CASE WHEN pagado > 0 THEN LEAST(vence - 2, current_date - 1)::timestamptz + interval '11 hours' END,
  estado = CASE WHEN pagado = total THEN 'PAID' WHEN pagado > 0 THEN 'PARTIALLY_PAID'
                WHEN vence < current_date THEN 'OVERDUE' ELSE 'ISSUED' END;

INSERT INTO atlas_sales.merchant_invoices
  (account_id, invoice_number, invoice_date, due_date, subtotal_amount, tax_amount, total_amount, status, currency_code, created_at)
SELECT a.id, f.numero, f.fecha, f.vence, f.total - f.iva, f.iva, f.total, f.estado::atlas_sales.invoice_status, 'BOB', f.fecha
  FROM fac f JOIN atlas_sales.b2b_accounts a ON a.tax_id = 'DEMO-NIT-' || f.n;

INSERT INTO atlas_sales.merchant_payments (account_id, amount, currency, paid_at, payment_method, external_ref, status, created_at)
SELECT a.id, f.pagado, 'BOB', f.pagado_en, CASE WHEN f.n % 2 = 0 THEN 'qr' ELSE 'transferencia' END,
       'DEMO-PAGO-' || f.numero, 'CONFIRMED', f.pagado_en
  FROM fac f JOIN atlas_sales.b2b_accounts a ON a.tax_id = 'DEMO-NIT-' || f.n
 WHERE f.pagado > 0;

INSERT INTO atlas_sales.merchant_receivables
  (account_id, invoice_id, source_type, amount_original, amount_open, currency, issued_at, due_date, status, created_at)
SELECT a.id, i.id, 'MDR', f.total, f.total - f.pagado, 'BOB', f.fecha, f.vence,
       (CASE WHEN f.estado = 'ISSUED' THEN 'PENDING' ELSE f.estado END)::atlas_sales.receivable_status, f.fecha
  FROM fac f
  JOIN atlas_sales.b2b_accounts a ON a.tax_id = 'DEMO-NIT-' || f.n
  JOIN atlas_sales.merchant_invoices i ON i.invoice_number = f.numero;

-- La misma comisión en el auxiliar contable de cuentas por cobrar (factura, recibo e imputación).
INSERT INTO atlas_accounting.ar_invoice
  (legal_entity_id, customer_bp_id, invoice_no, invoice_date, due_date, currency_code, net_amount, tax_amount, gross_amount, status, created_at)
SELECT le.id, bp.id, f.numero, f.fecha, f.vence, 'BOB', f.total - f.iva, f.iva, f.total,
       CASE WHEN f.pagado = f.total THEN 'PAID' WHEN f.pagado > 0 THEN 'PARTIALLY_PAID' ELSE 'ISSUED' END, f.fecha
  FROM fac f
  JOIN atlas_accounting.business_partner bp ON bp.partner_no = 'DEMO-BP-COM-' || f.n
  CROSS JOIN (SELECT id FROM atlas_accounting.legal_entity WHERE code = 'ATLAS-BO') le;

INSERT INTO atlas_accounting.receipt (legal_entity_id, payer_bp_id, receipt_no, receipt_date, amount, currency_code, status)
SELECT ar.legal_entity_id, ar.customer_bp_id, 'DEMO-REC-' || substring(f.numero FROM 10), f.pagado_en::date, f.pagado, 'BOB', 'POSTED'
  FROM fac f JOIN atlas_accounting.ar_invoice ar ON ar.invoice_no = f.numero
 WHERE f.pagado > 0;

INSERT INTO atlas_accounting.receipt_allocation (receipt_id, ar_invoice_id, allocated_amount)
SELECT rc.id, ar.id, f.pagado
  FROM fac f
  JOIN atlas_accounting.ar_invoice ar ON ar.invoice_no = f.numero
  JOIN atlas_accounting.receipt rc ON rc.receipt_no = 'DEMO-REC-' || substring(f.numero FROM 10)
 WHERE f.pagado > 0;

-- Sigue en `sembrar-erp-libro.sql` (proveedores y asientos), que `cargar-en-test.sh` encadena detrás.
