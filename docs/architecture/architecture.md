# Arquitectura API Atlas — Fase 1

## Decisión principal

Se implementó un monolito modular NestJS con módulos por dominio inicial:

- `customers`
- `consents`
- `sessions`
- `risk`
- `operations`

La base de datos sigue siendo la misma generada por migraciones. No se crearon entidades nuevas.

## Capas

Cada módulo sigue esta separación:

- Controller: expone rutas HTTP, guards, headers, params, body y query.
- Service: aplica casos de uso y transacciones.
- Repository: encapsula Sequelize.
- Schemas: validación Zod.
- DTOs: contratos públicos de respuesta.
- Mapper: evita exponer modelos internos.

## Seguridad

Los endpoints protegidos usan JWT Bearer. No se implementó login porque el schema actual no define persistencia para credenciales.

Esta decisión evita inventar tablas o guardar contraseñas en lugares no diseñados para eso.

## Persistencia

Se usan modelos Sequelize sobre tablas existentes:

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

## Privacidad

La API inicial evita exponer:

- Hashes.
- Valores cifrados.
- Teléfono completo.
- Email completo.
- Payloads sensibles.
- Tokens.

Los endpoints de registro calculan hashes SHA-256 de teléfono/email y solo devuelven últimos 4 dígitos o dominio.

## Por qué no se implementó scoring automático

El brief y los pendientes dejan abiertas políticas de negocio críticas. Además, la bibliografía de scorecards recomienda que el scoring sea una herramienta de decisión entendible, validada y alineada con objetivos de negocio, no una caja negra improvisada.

Por eso esta fase solo permite leer resultados existentes de riesgo, sin crear decisiones automáticas nuevas.
