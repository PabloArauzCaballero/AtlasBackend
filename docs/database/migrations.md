# Migraciones de base de datos — Proyecto Atlas

## Alcance de esta entrega

Esta fase implementa el ORM de migraciones, la migración inicial del schema `Atlas_User_Intelligence_Fraud_Schema_v5_2_1` y seeders mínimos de desarrollo.

En esta entrega se crearon las primeras tablas persistentes a partir del PUML (el inventario vigente
está en [Cifras reales](../architecture/index.md)).

## Convención de nombres

- Clases PascalCase del PUML → tablas `snake_case` en plural.
- Ejemplo: `CustomerProfileVersion` → `customer_profile_versions`.
- Excepción documentada: `RiskRuleFired` → `risk_rules_fired`, para mantener el nombre plural legible.

## Comandos de migraciones

```bash
yarn db:migration:create -- create-atlas-user-intelligence-fraud-schema-v5-2-1
yarn db:migration:up
yarn db:migration:down
yarn db:migration:status
```

## Semillas

Los seeders versionados de esta entrega (`db:seed:create|up|down`, tabla `SequelizeDataSeeders`) ya no
existen: el dato de semilla vive en una base aparte y se trae con `yarn db:seed:pull`; la siembra
demostrativa del repositorio es `yarn db:seed:demo`. Ver [Semillas](seeds.md).

```bash
yarn db:seed:pull     # trae el conjunto publicado (destructivo sobre sus tablas; --if-empty para no pisar)
yarn db:seed:status   # compara lo publicado con esta base, sin escribir
```

## Decisiones aplicadas

- Se usa Umzug como runner de migraciones TypeScript.
- (Histórico) Umzug también corría los seeders, con la tabla de tracking `SequelizeDataSeeders`; hoy las semillas se traen de otra base.
- La migración inicial crea primero tablas, luego foreign keys, luego checks e índices.
- No se usa `sequelize.sync`.
- La nulabilidad es conservadora para evitar bloquear flujos pre-registro y datos capturados progresivamente.
- Se implementan índices críticos por tenant, hashes, sesiones, dispositivos, features, riesgo, fraude y auditoría.
- Las tablas `event` quedan documentadas como candidatas a particionamiento mensual, pero no se particionan aún para no sobrecomplicar la primera migración.

## Seed mínimo incluido (histórico)

El seeder mínimo de esta entrega creaba registros para probar una cadena base de uso (hoy los publica
la base de semillas de desarrollo):

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
