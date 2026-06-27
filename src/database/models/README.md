# Modelos Sequelize usados por la API inicial

Esta carpeta contiene únicamente modelos TypeScript que mapean tablas ya existentes en el schema Atlas.

No se creó ninguna tabla nueva para estos endpoints. Los modelos sirven para que los repositories usen Sequelize de forma tipada y no accedan mediante SQL crudo.

## Alcance actual

Modelos habilitados para la primera fase de endpoints:

- `tenants`
- `customers`
- `customer_profile_versions`
- `customer_status_events`
- `customer_contact_methods`
- `consent_documents`
- `customer_consents`
- `consent_events`
- `global_device_fingerprints`
- `devices`
- `customer_device_links`
- `customer_sessions`
- `device_snapshots`
- `risk_assessment_results`
- `manual_review_cases`
- `fraud_cases`

## Qué no debe colocarse aquí

- Reglas de negocio.
- DTOs públicos.
- Validaciones Zod.
- Endpoints.
- Seeders.
- Migraciones.
