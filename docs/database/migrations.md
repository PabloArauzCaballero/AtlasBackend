# Migraciones de base de datos — Proyecto Atlas

## Alcance de esta entrega

Esta fase implementa el ORM de migraciones, la migración inicial del schema `Atlas_User_Intelligence_Fraud_Schema_v5_2_1` y seeders mínimos de desarrollo.

Se crearon 86 tablas persistentes a partir del PUML.

## Convención de nombres

- Clases PascalCase del PUML → tablas `snake_case` en plural.
- Ejemplo: `CustomerProfileVersion` → `customer_profile_versions`.
- Excepción documentada: `RiskRuleFired` → `risk_rules_fired`, para mantener el nombre plural legible.

## Comandos de migraciones

```bash
npm run db:migration:create -- create-atlas-user-intelligence-fraud-schema-v5-2-1
npm run db:migration:up
npm run db:migration:down
npm run db:migration:status
```

## Comandos de seeders

```bash
npm run db:seed:create -- seed-minimal-dev-credentials
npm run db:seed:up
npm run db:seed:down
npm run db:seed:status
```

## Decisiones aplicadas

- Se usa Umzug como runner de migraciones TypeScript.
- Se usa Umzug también para seeders, con una tabla de tracking separada: `SequelizeDataSeeders`.
- La migración inicial crea primero tablas, luego foreign keys, luego checks e índices.
- No se usa `sequelize.sync`.
- La nulabilidad es conservadora para evitar bloquear flujos pre-registro y datos capturados progresivamente.
- Se implementan índices críticos por tenant, hashes, sesiones, dispositivos, features, riesgo, fraude y auditoría.
- Las tablas `event` quedan documentadas como candidatas a particionamiento mensual, pero no se particionan aún para no sobrecomplicar la primera migración.

## Seed mínimo incluido

El seeder mínimo crea registros para probar una cadena base de uso:

- Tenant.
- Usuarios internos y plataforma.
- Cliente demo.
- Identidad, contacto, dispositivo, sesión y consentimiento.
- Onboarding.
- Evaluación de riesgo, resultado y resumen de actividad.
- Revisión manual, fraude, watchlist, auditoría y calidad.

Las credenciales reservadas están documentadas en `docs/database/dev-credentials.md`.

## Exclusiones obligatorias

No se crearon tablas para:

- `ImplementationPhase`
- `EntityBuildScope`

Estas entidades son configuración YAML externa. Se dejaron archivos placeholder en `config/roadmap/`.

## Fuera de alcance

No se implementó:

- API REST.
- Auth/JWT.
- Controllers.
- Services.
- Repositories.
- Scoring ejecutable.
- Crédito, préstamos, cuotas, pagos, MDR, cobranza ni límites de crédito.
