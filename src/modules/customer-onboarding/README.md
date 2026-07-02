# Módulo Customer Onboarding

Responsabilidad: inicio compuesto de onboarding de cliente.

Endpoint activo:

- `POST /api/v1/customer-onboarding/start`

Este endpoint detona registros en múltiples tablas dentro de una transacción:

- `customers`
- `customer_profile_versions`
- `customer_contact_methods`
- `customer_status_events`
- `global_device_fingerprints`
- `devices`
- `customer_device_links`
- `customer_sessions`
- `device_snapshots`
- `onboarding_flows`
- `onboarding_step_events`
- `permission_events`
- `customer_action_logs`
- `operational_audit_logs`
- `customer_consents`
- `consent_events`

No ejecuta scoring, no aprueba crédito y no crea datos de pagos/cuotas/MDR/cobranza.
