# Arquitectura actual de AtlasBackend

Este documento describe el sistema ejecutable actual. Los informes de `docs/audit/` conservan el
estado de la fecha indicada y no sustituyen esta vista.

## Por qué existe el backend

### Negocio

AtlasBackend sostiene el recorrido BNPL desde el alta de una persona hasta su habilitación y
solicitud de crédito. Centraliza identidad, consentimiento, evidencia KYC, elegibilidad, riesgo,
fraude y revisión humana para que cada decisión pueda explicarse y auditarse.

### Sistema

Es una API NestJS modular sobre PostgreSQL/Sequelize. Aplica aislamiento por tenant, contratos Zod,
transacciones, idempotencia, outbox, cifrado de PII, RBAC y observabilidad. Redis distribuye rate
limiting/cachés; MongoDB conserva logs redactados con TTL; los proveedores externos se aíslan detrás
de adaptadores resilientes.

## Flujo de capas

```text
HTTP → guard/decorator/pipe → controller → application service → repository → Sequelize/PostgreSQL
                                      ↘ mapper → DTO HTTP
                                      ↘ outbox/adapters externos
```

- Los controladores resuelven transporte, autenticación y autorización; no deciden reglas.
- Los servicios coordinan reglas, transacciones y efectos.
- Los repositorios encapsulan SQL/Sequelize, locks y filtros multitenant.
- Los modelos representan tablas; nunca son respuestas HTTP.
- Schemas Zod validan entradas y mappers/DTO estabilizan salidas.
- Adaptadores externos traducen protocolos y fallos a errores tipados con timeout, retry y breaker.

## Dominios activos

| Dominio                                             | Razón de negocio                                                        | Responsabilidad del sistema                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `auth`                                              | Proteger cuentas y recuperación de acceso.                              | Credenciales, login/PIN, JWT, MFA, reset y rotación de refresh tokens.                         |
| `customer-onboarding`                               | Convertir registro en cliente verificable y conforme.                   | Perfil, contacto, OTP real, identidad, documentos, dirección, referencias, screening y estado. |
| `customers`                                         | Mantener la fuente de verdad del cliente y su habilitación.             | Lecturas agregadas, ciclo de vida y evaluaciones de elegibilidad versionadas.                  |
| `credit`                                            | Ofrecer y decidir crédito con evidencia congelada.                      | Productos, solicitudes, snapshots de elegibilidad, decisiones y eventos.                       |
| `consents` / `customer-privacy`                     | Demostrar autorización y atender derechos del titular.                  | Documentos, decisiones, eventos y solicitudes de privacidad.                                   |
| `sessions` / `customer-telemetry`                   | Mantener continuidad y señales anti-fraude.                             | Dispositivos, sesiones, heartbeat, GPS y lotes de telemetría.                                  |
| `risk` / `fraud`                                    | Reducir pérdidas con decisiones explicables.                            | Evaluaciones, contribuciones, reglas disparadas, casos y revisión.                             |
| `external-data`                                     | Incorporar evidencia KYC/financiera controlando costo y consentimiento. | Registro de proveedores, políticas, adaptadores, evidencia y resiliencia.                      |
| `catalog-management` / `data-quality`               | Gobernar definiciones y confiabilidad de datos.                         | Ingesta, versionado, aprobación, reglas y hallazgos de calidad.                                |
| `operations` / `internal-portal` / `internal-users` | Permitir operación humana segura.                                       | Colas, reportes, RBAC granular, glosario, linaje y decisiones manuales.                        |
| `notifications` / `mail-sender`                     | Entregar mensajes transaccionales y operativos.                         | Preferencias, reglas, plantillas, audiencias y adaptadores multicanal.                         |
| `events` / `runtime-hardening` / `runtime-jobs`     | Resistir reintentos y fallos parciales.                                 | Idempotencia, outbox, jobs, locks, reintentos y retención.                                     |
| `audit` / `systems-ops` / `log-sync` / `health`     | Hacer el backend gobernable y diagnosticable.                           | Auditoría, catálogo técnico, pruebas controladas, logs, métricas y probes.                     |
| `schema-management`                                 | Gobernar propuestas estructurales sin DDL remoto.                       | Valida y audita propuestas; el DDL físico se aplica solo mediante migraciones revisadas.       |
| `workflow-catalog`                                  | Publicar el árbol de endpoints del proceso estándar.                    | Flujos, etapas, subetapas, pasos, dependencias, transiciones, avance del cliente y drift.      |

El inventario de archivos y subcarpetas de cada dominio vive en su `README.md`, generado con
`yarn docs:project`.

## Estado y habilitación de crédito

Onboarding, ciclo de vida, elegibilidad y crédito son conceptos separados:

1. onboarding captura y verifica evidencia;
2. el ciclo de vida registra transiciones autorizadas del cliente;
3. elegibilidad produce una evaluación inmutable con bloqueadores y snapshot;
4. crédito exige una evaluación vigente y congela su referencia en la solicitud;
5. una decisión de crédito agrega eventos; no reescribe la historia.

El detalle de reglas y transiciones está en
[`onboarding-flujo-corregido.md`](./onboarding-flujo-corregido.md) y
[`onboarding-habilitacion-credito.md`](./onboarding-habilitacion-credito.md).

Ese recorrido también está publicado como **dato**: `workflow-catalog` lo modela como un árbol
versionado de etapas y endpoints, verificable contra las rutas que el proceso tiene montadas. Ver
[`docs/endpoints/workflow-catalog.md`](../endpoints/workflow-catalog.md). El catálogo describe el
recorrido; no lo reimplementa: el avance de un cliente sale de la misma evaluación de habilitación
que decide su acceso al crédito.

## Persistencia y evolución

- Las tablas viven en schemas PostgreSQL por dominio; `public` queda para infraestructura de Umzug.
- `synchronize` y `autoLoadModels` permanecen desactivados.
- Todo cambio estructural usa migración `up`/`down`; cambios destructivos siguen expand/contract.
- Seeders se separan por perfiles `production`, `development`, `demo` y `test`.
- PII usa hash para búsqueda y envelope encryption para almacenamiento.
- Vistas `read_api` ofrecen lecturas operativas sin exponer hashes ni blobs cifrados.
- La migración `20260728140000-create-workflow-catalog.ts` incorpora en `platform_ops` definiciones,
  etapas, pasos, dependencias y transiciones versionadas. Ese catálogo describe el proceso del
  software; no reemplaza el avance por tenant ni la evidencia transaccional de cada cliente.

## Seguridad y operación

- `JwtAuthGuard`, `TenantGuard`, roles y permisos internos cierran autenticación, anti-BOLA y RBAC.
- Endpoints públicos sensibles tienen throttle específico y códigos de un solo uso con hash, TTL e intentos.
- Los logs de archivo son JSON, heredan `correlationId`/`traceId` y pasan por redacción.
- `/health/liveness` indica proceso vivo; `/health/readiness` responde 503 si dependencias críticas fallan.
- `/metrics` está fuera del throttle y debe exponerse solo en la red de observabilidad.
- Los comandos y requisitos operativos están en `docs/runbooks/` y `docs/config/environment.md`.

## Fuentes de contrato

1. Código, migraciones y pruebas: comportamiento ejecutable.
2. `docs/endpoints/openapi.yaml`: contrato HTTP generado.
3. Este documento y los ADR: arquitectura y decisiones vigentes.
4. Informes de auditoría fechados: evidencia histórica, no necesariamente estado actual.
