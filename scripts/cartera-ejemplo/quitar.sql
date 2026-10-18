-- Retira la cartera de ejemplo de los tableros. Sólo toca filas con prefijo `DEMO-`.
--
-- Va en el orden inverso de las claves foráneas: imputaciones, pagos, calificaciones, cuotas,
-- créditos, solicitudes, productos, comercios, telemetría y clientes. Es idempotente: sin cartera sembrada,
-- no borra nada.
--
--   psql ... -v ON_ERROR_STOP=1 -f scripts/cartera-ejemplo/quitar.sql

BEGIN;

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
-- La telemetría apunta a los clientes con ON DELETE SET NULL: fuera antes, o quedan sesiones huérfanas.
DELETE FROM telemetry.auth_events
 WHERE session_id IN (SELECT _id FROM telemetry.customer_sessions WHERE session_token_hash LIKE 'DEMO-%');
DELETE FROM telemetry.customer_sessions WHERE session_token_hash LIKE 'DEMO-%';
DELETE FROM customer.customers WHERE customer_code LIKE 'DEMO-C-%';

COMMIT;
