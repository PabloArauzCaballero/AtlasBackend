# Seeders completos de desarrollo — Proyecto Atlas

## Objetivo

Estos seeders dejan la base lista para probar el portal administrativo, operaciones, catálogos, gobierno de datos, proveedores externos mock, notificaciones, suites QA y perfiles de stress. La regla es simple: después de migrar y sembrar, el frontend no debería abrir vistas vacías por falta de datos base.

## Flujo recomendado para una DB local limpia

```bash
yarn db:migration:up
DATABASE_CLEAN_BEFORE_SEED=true yarn db:seed:up
```

`DATABASE_CLEAN_BEFORE_SEED=true` limpia los datos de aplicación antes de correr los seeders. Preserva `SequelizeMeta`, limpia `SequelizeDataSeeders`, reinicia identidades y vuelve a cargar todo desde cero. Esto evita datos basura acumulados por pruebas anteriores.

## Variables ENV de limpieza

| Variable                          | Default | Uso                                                                                                                 |
| --------------------------------- | ------: | ------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_CLEAN_BEFORE_SEED`      | `false` | Si está en `true`, ejecuta `TRUNCATE ... RESTART IDENTITY CASCADE` sobre las tablas de aplicación antes de sembrar. |
| `DATABASE_CLEAN_ALLOW_PRODUCTION` | `false` | Doble seguro para producción. Debe seguir en `false` en uso normal.                                                 |
| `DATABASE_CLEAN_CONFIRM`          |   vacío | En producción debe ser exactamente `ATLAS_DESTROY_SEED_DATA` además del flag anterior.                              |

No uses limpieza sobre una base real. Para desarrollo/staging desechable sí es la forma correcta de garantizar una carga reproducible.

## Seeders incluidos

| Seeder                                              | Qué carga                                                                                                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260626160720-seed-minimal-dev-credentials`       | Tenant, usuarios base, cliente demo, dispositivo, sesión, consentimientos, onboarding, riesgo, revisión manual, fraude, watchlist, auditoría y una regla mínima de calidad.                                 |
| `20260702032000-seed-external-data-providers`       | Proveedores externos Bolivia/mock: SEGIP, InfoCenter, QR genérico, banca genérica, telco, Meta, WhatsApp y digital trust, más políticas de costo.                                                           |
| `20260703002000-seed-systems-ops-catalog`           | Escanea todos los controllers y modelos. Carga catálogo de endpoints, tablas, herramientas, impactos endpoint-tabla, impactos por campo, suites de prueba y perfiles de stress.                             |
| `20260704121000-seed-internal-rbac-and-pablo`       | RBAC interno, roles, permisos y usuario administrador Pablo para el panel interno.                                                                                                                          |
| `20260705090000-seed-portal-runtime-demo-data`      | Catálogos funcionales, definiciones, risk policy, signal seeds, gobierno de datos, reglas/issues de calidad, templates/mensajes de notificación, outbox, feature values, health de proveedores y jobs demo. |
| `20260711090000-seed-bnpl-production-risk-baseline` | Baseline idempotente de señales y reglas BNPL: capacidad de pago, deuda concurrente, dificultad financiera, disputas y riesgo de comercio. No contiene clientes ni operaciones ficticias.                   |

## Alcance productivo BNPL

El baseline BNPL carga metadatos y políticas de referencia, no una calibración aprobada. Antes de
activar decisiones reales se deben validar localmente fuentes, calidad, umbrales y tratamiento de
datos con Riesgo y Cumplimiento. En particular, el umbral de servicio total de deuda `0.40` y los
umbrales de acumulación son parámetros conservadores de arranque para revisión manual; no son
límites regulatorios bolivianos.

El esquema actual cubre onboarding, KYC, señales, scoring, fraude y operación interna. Todavía no
modela el ciclo financiero BNPL (comercio/tienda, orden, contrato, desembolso, cronograma, cuota,
pago, reverso, devolución, disputa, mora, cobranza, refinanciamiento y liquidación al comercio).
Por tanto, los seeds no deben usarse como evidencia de cobertura contable o de servicing hasta
incorporar esas entidades mediante migraciones, servicios y pruebas de invariantes monetarias.

## Datos funcionales principales

Después de `yarn db:seed:up` quedan disponibles, como mínimo:

- Cliente demo `customer_id=1` para vistas de cliente, sesiones, investigación, riesgo y notificaciones.
- Casos demo `MR-DEMO-001` y `FR-DEMO-001` para cola operativa.
- Catálogos publicados para zonas de Santa Cruz, ocupaciones, bandas de ingreso, documentos, reason codes, canales de pago, categorías de comercio y pasos de onboarding.
- Definiciones de observaciones, atributos, features y eventos para ML/scoring posterior.
- Políticas de riesgo MVP con reglas de bloqueo, revisión manual, aprobación y límite de línea.
- Políticas de retención, clasificación de datos y campos sensibles para gobierno.
- Proveedores externos en modo mock/local con health logs.
- Templates, mensajes, entregas y preferencias de notificación.
- Catálogo de sistemas con endpoints, herramientas, impactos, suites QA y perfiles de stress.

## Credencial local para el panel interno

El seeder de RBAC crea/actualiza el usuario:

```text
Email: pablo@atlas.internal
Password: Atlas_Pablo#2026!
```

Es una credencial de desarrollo local. Cámbiala antes de cualquier demo conectada a una base compartida.

## Comandos útiles

```bash
# Ver seeders ejecutados y pendientes
yarn db:seed:status

# Cargar seeds sin limpiar datos previos
yarn db:seed:up

# Cargar seeds reiniciando datos de aplicación
DATABASE_CLEAN_BEFORE_SEED=true yarn db:seed:up

# Revertir el último seeder ejecutado
yarn db:seed:down
```

## Validación rápida esperada

Con el backend levantado, estos endpoints deberían devolver `200` usando el token interno donde corresponda:

```bash
GET /api/v1/health
GET /api/v1/customers/1/me
GET /api/v1/operations/work-queue?queue=all&page=1&limit=20
GET /api/v1/operations/catalogs
GET /api/v1/operations/definitions?type=all&status=all
GET /api/v1/operations/data-governance/policies
GET /api/v1/external-data/providers/health
GET /api/v1/operations/notifications/templates
GET /api/v1/systems/dashboard
GET /api/v1/systems/endpoints?page=1&limit=20
GET /api/v1/systems/data-entities?page=1&limit=20
GET /api/v1/systems/test-suites
GET /api/v1/systems/stress-profiles
```

## Nota de calidad

El catálogo de endpoints no depende solo de una lista manual: el seeder escanea los controllers y luego sobreescribe con metadatos curados para las rutas críticas. Así se evita que falten vistas del portal cuando aparece un endpoint nuevo.
