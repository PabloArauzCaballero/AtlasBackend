-- Retira del ERP (atlas_erp) todo lo que sembró `sembrar-erp.sql`. Sólo filas con prefijo `DEMO-`.
--
-- Los asientos PUBLICADOS son inmutables por diseño (disparadores `trg_posted_*`). Para borrar los
-- de ejemplo se apagan esos disparadores DENTRO de la transacción y se vuelven a encender antes del
-- COMMIT: `ALTER TABLE` es transaccional, así que un fallo a mitad deja datos y disparadores como
-- estaban. Nunca se borra un asiento que no empiece por `DEMO-`.

BEGIN;

-- Los disparadores del ERP nombran sus tablas sin esquema: la aplicación fija este search_path.
SET LOCAL search_path = atlas_accounting, atlas_sales, public;

ALTER TABLE atlas_accounting.journal_entry_line DISABLE TRIGGER trg_posted_journal_line_immutable_update;
ALTER TABLE atlas_accounting.journal_entry_line DISABLE TRIGGER trg_journal_balanced;
ALTER TABLE atlas_accounting.journal_entry DISABLE TRIGGER trg_posted_journal_entry_immutable;
ALTER TABLE atlas_accounting.accounting_document DISABLE TRIGGER trg_posted_accounting_document_immutable;

CREATE TEMP TABLE docs_demo ON COMMIT DROP AS
  SELECT id FROM atlas_accounting.accounting_document WHERE document_no LIKE 'DEMO-%';

DELETE FROM atlas_accounting.journal_entry_line
 WHERE journal_entry_id IN (SELECT id FROM atlas_accounting.journal_entry
                             WHERE accounting_document_id IN (SELECT id FROM docs_demo));
DELETE FROM atlas_accounting.journal_entry WHERE accounting_document_id IN (SELECT id FROM docs_demo);
DELETE FROM atlas_accounting.receipt_allocation
 WHERE ar_invoice_id IN (SELECT id FROM atlas_accounting.ar_invoice WHERE invoice_no LIKE 'DEMO-%');
DELETE FROM atlas_accounting.receipt WHERE receipt_no LIKE 'DEMO-%';
DELETE FROM atlas_accounting.ar_invoice WHERE invoice_no LIKE 'DEMO-%';
DELETE FROM atlas_accounting.supplier_payment
 WHERE ap_invoice_id IN (SELECT id FROM atlas_accounting.ap_invoice WHERE invoice_no LIKE 'DEMO-%');
DELETE FROM atlas_accounting.ap_invoice WHERE invoice_no LIKE 'DEMO-%';
DELETE FROM atlas_accounting.payment_order
 WHERE payee_bp_id IN (SELECT id FROM atlas_accounting.business_partner WHERE partner_no LIKE 'DEMO-%');
DELETE FROM atlas_accounting.accounting_document WHERE id IN (SELECT id FROM docs_demo);

ALTER TABLE atlas_accounting.journal_entry_line ENABLE TRIGGER trg_posted_journal_line_immutable_update;
ALTER TABLE atlas_accounting.journal_entry_line ENABLE TRIGGER trg_journal_balanced;
ALTER TABLE atlas_accounting.journal_entry ENABLE TRIGGER trg_posted_journal_entry_immutable;
ALTER TABLE atlas_accounting.accounting_document ENABLE TRIGGER trg_posted_accounting_document_immutable;

DELETE FROM atlas_sales.merchant_receivables
 WHERE account_id IN (SELECT id FROM atlas_sales.b2b_accounts WHERE tax_id LIKE 'DEMO-%');
DELETE FROM atlas_sales.merchant_payments
 WHERE account_id IN (SELECT id FROM atlas_sales.b2b_accounts WHERE tax_id LIKE 'DEMO-%');
DELETE FROM atlas_sales.merchant_invoices
 WHERE account_id IN (SELECT id FROM atlas_sales.b2b_accounts WHERE tax_id LIKE 'DEMO-%');
DELETE FROM atlas_sales.sales_opportunities
 WHERE account_id IN (SELECT id FROM atlas_sales.b2b_accounts WHERE tax_id LIKE 'DEMO-%');
DELETE FROM atlas_sales.merchant_onboarding_cases
 WHERE account_id IN (SELECT id FROM atlas_sales.b2b_accounts WHERE tax_id LIKE 'DEMO-%');
DELETE FROM atlas_sales.b2b_accounts WHERE tax_id LIKE 'DEMO-%';
DELETE FROM atlas_accounting.business_partner WHERE partner_no LIKE 'DEMO-%';

COMMIT;
