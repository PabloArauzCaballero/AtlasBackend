# Esquemas de dominio del modelo de escritura

La migración `20260717120000-split-write-model-into-domain-schemas.ts` elimina la dependencia de las
tablas de negocio en `public`. Los modelos Sequelize usan `schema: atlasSchemaFor(tableName)` y el
mapa único vive en `src/database/domain-schemas.ts`.

| Schema            | Responsabilidad                                                      |
| ----------------- | -------------------------------------------------------------------- |
| `iam`             | tenants, usuarios internos/plataforma, RBAC y credenciales           |
| `customer`        | cliente, perfil, identidad, contactos y direcciones                  |
| `privacy`         | consentimientos, clasificación, retención, DSR y evidencia           |
| `telemetry`       | dispositivos, sesiones, onboarding y eventos de comportamiento       |
| `catalog`         | catálogos de contexto, definiciones y atributos enriquecidos         |
| `risk`            | features, modelos/rulesets, corridas y decisiones de riesgo          |
| `case_management` | revisión manual, fraude y watchlists                                 |
| `audit`           | auditoría operacional y calidad de datos                             |
| `integrations`    | proveedores externos, solicitudes, respuestas y health               |
| `messaging`       | templates, mensajes, deliveries, preferencias y tokens push          |
| `platform_ops`    | idempotencia, outbox, jobs, catálogo técnico, QA y schema management |
| `read_api`        | vistas versionadas de solo lectura; no contiene tablas operativas    |

`public` se conserva únicamente para metadata de infraestructura compatible con Umzug (por ejemplo
`SequelizeMeta` y tracking de seeders). No es el schema por defecto de ningún modelo de negocio.

## Compatibilidad de consultas heredadas

Los modelos siempre generan nombres schema-qualified. El SQL heredado que aún usa nombres simples
se resuelve mediante un `search_path` explícito con los once schemas de dominio y `public` al final.
Las migraciones usan `public` primero para poder reproducir el historial anterior a la separación.
El código nuevo debe usar modelos con schema o nombres SQL calificados.

## Verificación

```bash
yarn check:domain-schemas       # gate estático: decoradores + mapa sin duplicados
yarn db:migration:up            # aplica/mueve tablas preservando FK, índices y datos
yarn check:domain-schema-layout # gate contra PostgreSQL: ubicación real y public limpio
yarn check:read-api-views       # confirma que las vistas siguen resolviendo tras el move
```

La migración es reversible sin `CASCADE`: el `down` mueve objetos a `public` y solo elimina schemas
vacíos con `RESTRICT`.
