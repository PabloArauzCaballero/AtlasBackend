# Auditoría integral y plan de mejora — 2026-07-30

Auditoría transversal del backend (no módulo por módulo: eso ya está en el resto de `docs/audit/`).
Ejes: **preparación para producción, seguridad, observabilidad, robustez, eficiencia y clean code**,
más una verificación explícita del requisito **"nada mockeado: todo desde base de datos, `env` o un
servicio"**.

Cada hallazgo cita `archivo:línea` verificable. El plan por fases está al final y se marca a medida
que se implementa.

## 0. Línea base medida antes de tocar nada

| Gate | Resultado |
|---|---|
| `yarn type-check` | ✅ exit 0 |
| `yarn lint` | ✅ 0 errores / 151 warnings (complejidad y `max-params`, todos en `systems-ops`) |
| `yarn format:check` | ✅ |
| `yarn check:file-size` | ✅ (34 archivos en deuda congelada) |
| `yarn check:seed-profiles` | ✅ production=11, development=2, demo=4, test=1 |
| `yarn check:env-example` | ✅ 120 variables tipadas cubiertas |
| `yarn check:domain-schemas` | ✅ 130 modelos con schema explícito |
| `yarn check:domain-schema-layout` | ✅ |
| `yarn check:overfetching` | ✅ |
| `yarn check:read-api-views` | ✅ 7 vistas |
| `yarn check:smoke-results-untracked` | ✅ |

Es decir: **todos los gates existentes estaban verdes y aun así el sistema no era desplegable desde
cero.** Eso, por sí solo, es el hallazgo más importante de esta auditoría: los gates no cubrían el
arranque real de un entorno nuevo.

---

## 1. Hallazgos

### A-01 · CRÍTICO · Provisionar un entorno nuevo es imposible: migración monolítica duplicada

`src/database/migrations/20260626154044-create-atlas-user-intelligence-fraud-schema-v5-2-1.ts`
(12 559 líneas) crea **las mismas 86 tablas** que las diez migraciones `schema-part-*`. Verificado
programáticamente: 86 tablas en el monolito, 86 en el split, **86 solapadas, 0 exclusivas**.

`src/database/migrate.ts:13` usa `glob: 'src/database/migrations/*.ts'` y Umzug ordena
alfabéticamente. El orden real es:

```
20260626154044-create-atlas-user-intelligence-fraud-schema-v5-2-1.ts   <-- corre PRIMERO ('c' < 's')
20260626154044-schema-part-0-platform-core.ts                          <-- falla: relation already exists
```

Consecuencias verificadas:

- `yarn db:migration:up` sobre una base vacía revienta en la segunda migración.
- El job `db-and-cache-integration` de `.github/workflows/ci.yml` (que corre `db:migration:up` contra
  un Postgres real) no puede pasar.
- El job `migration-check` del mismo workflow tampoco: su límite es 800 líneas para migraciones que
  no encajan en el patrón `schema-part-*`/`schema-relationships-part-*`, y este archivo tiene 12 559.

Además el propio `.github/workflows/ci.yml` documenta que el monolito **fue** dividido ("ya no hay
una migración histórica que excluir") y `docs/pending/pending-items.md` da ATLAS-TECH-001 por
resuelto con "Archivo eliminado". El archivo sigue presente en `main` y en `HEAD`: la corrección
nunca llegó al repositorio o se revirtió.

**Por qué ningún gate lo detectó:** no existe ninguna verificación estática de las migraciones. El
gate de CI que sí lo habría visto necesita una base de datos, y ese job estaba rojo por esta misma
causa.

### A-02 · CRÍTICO · En producción los proveedores externos sirven datos fabricados por defecto

Este es exactamente el punto de "nada mockeado".

1. `src/modules/external-data/application/external-data-policy.util.ts:45-49` — `toMode()` cae a
   `'mock_local'` ante **cualquier** valor ausente o desconocido.
2. `src/database/seeders/production/20260702032000-seed-external-data-providers.ts:32-116` — el
   seeder **de producción** siembra los 9 proveedores (SEGIP, INFOCENTER, banca, telco, WhatsApp,
   Facebook, confianza digital, QR) con `default_mode: 'mock_local'`.
3. `src/modules/external-data/infrastructure/adapters/segip/segip.adapter.ts:36-77` (y los otros 8
   adaptadores) — en `mock_local` devuelven un payload **inventado por escenario**
   (`matchScore: 0.98`, `documentExists: true`, …) con `isMocked: true`.
4. `external-data-policy.util.ts:182` — `statusFromRaw` traduce eso a estado `MOCKED`, y
   `featuresFromObservations` (líneas 186-197) lo convierte en features que se **persisten** como
   evidencia del cliente y alimentan el motor de riesgo.

Resultado: un despliegue productivo que no fije explícitamente `${CODE}_MODE=production` (o no
actualice la fila en base) aprueba identidades y calcula riesgo **sobre datos inventados**, sin
fallar, sin alertar y sin degradar readiness. `productionIntegrationBlockers()` (línea 92) solo actúa
si el modo ya es `production`, así que no cubre este caso.

Relacionado: `external-data-policy.util.ts:64` fija `http://localhost:4010/mock` como URL base por
defecto del servidor de mocks — un `localhost` cableado que en producción no debería existir; y
`external-provider-convenience.service.ts:147` repite el literal `'mock_local'` como default.

### A-03 · CRÍTICO · Ningún trabajo de fondo se ejecuta solo

`src/modules/runtime-jobs/runtime-jobs.controller.ts:52-125` expone cinco jobs **solo por HTTP**
(`process-outbox`, `process-events`, `expire-stale-sessions`, `apply-retention-policies`,
`recalculate-data-quality`). No hay `@nestjs/schedule`, ni `@Cron`, ni `setInterval` para ninguno de
ellos (`grep` sobre `src/`: los únicos `setInterval` son los de `log-sync` y del monitor de salud), y
no hay ningún manifiesto de despliegue en el repositorio que defina un CronJob externo.

Consecuencias en producción, si nadie llama esos endpoints a mano:

- El **outbox** nunca se despacha: los eventos de dominio quedan `pending` para siempre.
- Las **políticas de retención** nunca se aplican → incumplimiento de retención de datos personales
  en un backend KYC.
- Las **sesiones caducadas** nunca se expiran.
- La **calidad de datos** nunca se recalcula.

A esto se suma que no hay barrido de reintento para dos colas más:
`notification-broadcast.service.ts:155` entrega en *fire-and-forget* (si el proceso se reinicia, los
mensajes quedan `pending` sin que nada los recoja) y `runtime-hardening.service.ts` nunca purga
`idempotency_keys` (crecimiento sin límite).

### A-04 · ALTO · La PII se redacta en el archivo de log pero **no** en stdout

`src/common/logging/app-file-logger.service.ts:53-68` aplica `redactSensitiveText` a lo que escribe
en `Archivo.log`, pero antes llama a `super.log(...)` (líneas 71-101), que imprime el mensaje
**crudo** por stdout. En contenedores, stdout es el pipeline de logs real (Docker/K8s → agregador),
así que la redacción efectiva es la que **no** protege el canal que importa.

El mismo archivo tiene el problema espejo en observabilidad: la salida de stdout es texto humano de
`ConsoleLogger`, no JSON. `correlationId` y `traceId` solo existen en la línea del archivo, así que
en producción los logs recolectados **no son correlacionables ni parseables**.

Amplificador: `src/common/filters/http-exception.filter.ts:140,143` loguea `request.url`, que incluye
la query string completa; un `?identifier=...`/`?email=...` acaba en claro en stdout.

### A-05 · ALTO · La versión reportada por `/health` no es fiable en producción

`src/modules/health/health.controller.ts:55` lee `process.env['npm_package_version']`, que solo lo
define el propio `yarn`/`npm` al ejecutar un script. El arranque productivo documentado es
`node dist/src/main.js` (`package.json`, script `start`), donde esa variable **no existe** → siempre
responde el literal `'0.1.0'`. No hay forma de saber qué build está corriendo, ni commit ni fecha.

### A-06 · ALTO · No existe artefacto de despliegue

No hay `Dockerfile`, ni `.dockerignore`, ni `docker-compose.yml`, ni manifiesto de ningún tipo
(verificado en la raíz y en `ops/`, que solo contiene SQL de roles y config de observabilidad). La
memoria del plan 10/10 asume "la imagen de prod" (para `@aws-sdk/client-kms`) y
`docs/runbooks/despliegue-produccion.md` describe un despliegue cuyo artefacto no está definido en
ningún sitio del repositorio.

### A-07 · MEDIO · Apagado no ordenado de dependencias externas

- `src/common/redis/redis.module.ts:20-48` crea el cliente ioredis y **nunca** lo cierra: no hay
  `onModuleDestroy`/`quit`. `app.enableShutdownHooks()` (`main.ts:65`) no puede cerrar lo que nadie
  registró, así que el proceso depende de que el orquestador lo mate.
- No hay drenado en `SIGTERM`: readiness sigue devolviendo 200 mientras el proceso se apaga, así que
  el balanceador le sigue mandando tráfico durante la ventana de terminación.
- No hay timeout global de request: un handler colgado ocupa una conexión del pool indefinidamente.

### A-08 · MEDIO · Superficie de seguridad del JWT

`src/common/guards/jwt-auth.guard.ts:118` verifica con `algorithms: ['HS256']` (bien) pero **sin
`issuer` ni `audience`**, y `auth.service.ts:79-84` firma igual. El mismo secreto
`JWT_ACCESS_TOKEN_SECRET` lo usa además `systems-health.service.ts:151` para firmar un token de
sonda. Hoy no es explotable (el payload de sonda no pasa `parseAuthenticatedUser`), pero es un
acoplamiento que convierte cualquier futuro token firmado con ese secreto en un token de sesión
potencial.

### A-09 · MEDIO · Dependencia de producción sin usar

`joi` está en `dependencies` de `package.json` y **no se importa en ningún sitio** (`grep` sobre
`src/`, `scripts/`, `test/`: cero coincidencias). Es superficie de cadena de suministro gratuita y
contradice la regla de "una sola librería por responsabilidad" (`zod` ya cubre validación).

### A-10 · MEDIO · Métricas ciegas en los puntos que más duelen

`src/common/observability/metrics.service.ts` cubre HTTP (RED), llamadas a proveedor, estado del
breaker y profundidad del outbox. No cubre: saturación del **pool de conexiones** (la causa más común
de degradación en un backend Sequelize), resultado de **autenticación** (login fallido, lockout, token
revocado — señal de ataque), entrega de **notificaciones**, ejecución de **jobs**, ni cuántos
proveedores están sirviendo datos simulados (A-02).

### A-11 · BAJO · Deuda de clean code acotada y ya congelada

151 warnings de ESLint, **todos** en `systems-ops` (complejidad ciclomática y `max-params`), más 34
archivos sobre 300 líneas en `.file-size-baseline.json`. Es deuda conocida, congelada por trinquete y
sin impacto funcional: no se ataca en este plan salvo donde se toque el archivo por otra razón.
`check:file-size` reporta además que `customer-onboarding-start.service.ts` bajó de 623 a 598 líneas
y el baseline no se actualizó (el trinquete se puede apretar gratis).

### A-12 · BAJO · Higiene del árbol de trabajo

Archivos sueltos en la raíz que no pertenecen al proyecto: `fix-atlas-backend-quality.cjs`,
`tmp-internal-rbac-server.log`, `tmp-internal-rbac-server.err.log`. Los `.log` los cubre `.gitignore`;
el `.cjs` no.

### Verificación explícita: "nada mockeado"

| Área | Veredicto |
|---|---|
| Proveedores externos (KYC, buró, telco, banca) | ❌ **A-02** — fabricado por defecto en producción. Se corrige en Fase 1. |
| Códigos OTP / verificación de contacto | ✅ Real (`contact-verification-code.service.ts`: sin atajos ni código devuelto al cliente) |
| Notificaciones (email/SMS/push/WhatsApp) | ✅ Real, con proveedor por `env` y `disabled` explícito (`notification-provider-config.service.ts:10-14`) |
| Broadcast de notificaciones | ✅ Real de punta a punta (`notification-broadcast.service.ts:48-73`) |
| Motor de riesgo | ✅ Heurístico pero **declarado** como tal (`risk_heuristic_v0`, ATLAS-RISK-001) |
| Seeders de producción | ✅ Solo catálogos de referencia; datos ficticios aislados en `demo/` y verificados por `check:seed-profiles` |
| Configuración | ✅ Todo por `env.schema.ts` (120 variables tipadas) o por base de datos |

---

## 2. Plan de mejora por fases

Cada fase es independiente y se cierra con sus gates verdes.

| Fase | Objetivo | Hallazgos que cierra |
|---|---|---|
| **0** | Provisionar un entorno nuevo vuelve a funcionar, y un gate impide la regresión | A-01 |
| **1** | Fail-closed de proveedores externos: prohibido servir datos simulados en producción | A-02 |
| **2** | Los trabajos de fondo se ejecutan solos, con elección de líder | A-03 |
| **3** | Observabilidad de producción: stdout JSON redactado, versión real, métricas que faltan | A-04, A-05, A-10 |
| **4** | Ciclo de vida robusto: cierre ordenado, drenado en SIGTERM, timeout de request | A-07 |
| **5** | Endurecimiento de seguridad y limpieza de dependencias | A-08, A-09 |
| **6** | Artefacto de despliegue reproducible | A-06 |
| **7** | Pendientes abiertos del registro, higiene y documentación | A-11, A-12, ATLAS-SEC-002 |
| **8** | Durabilidad de las dos colas que quedaban sin recoger | A-03 (resto) |

### Estado de ejecución

Las ocho fases están implementadas y verificadas. Qué se hizo en cada una:

| Fase | Estado | Entregado |
|---|---|---|
| **0** | ✅ | Monolito eliminado tras verificar la equivalencia con el split (86/86 tablas, 244/244 FKs, 5/5 checks, 385/385 índices), documentada en [migration-split-verification.md](../architecture/migration-split-verification.md). Nuevo gate `yarn check:migrations` + paso de CI. Detectó además una segunda duplicación (`20260705113000`, idempotente) que queda como aviso permanente con su excepción documentada. |
| **1** | ✅ | `productionIntegrationBlockers` bloquea los modos simulados en producción; portón propio en `BankingQrService`; `mockBaseUrlFor` sin `localhost` en producción; auditoría de modos al arrancar expuesta en readiness; `EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION` + cross-check de `env`. 16 pruebas nuevas. |
| **2** | ✅ | `RuntimeJobsSchedulerService`: `setInterval` (sin dependencia nueva), opt-in, elección de líder por Redis `SET NX PX`, fail-closed en producción sin lock, un fallo por tenant no cancela al resto, nunca `dryRun`. 11 pruebas. |
| **3** | ✅ | stdout JSON redactado y correlacionado (`LOG_FORMAT`); `sanitizeUrlForLog`; `build-info.ts` y `/health` con `version`/`commit`/`builtAt`; métricas `atlas_db_pool_connections`, `atlas_auth_attempts_total`, `atlas_scheduled_job_runs_total`; 8 alertas Prometheus nuevas (16 en total). 15 pruebas. |
| **4** | ✅ | `GracefulShutdownService` (readiness a 503 + drenado antes de cerrar), `RedisLifecycleService`, `RequestTimeoutInterceptor`. 15 pruebas. |
| **5** | ✅ | `iss`/`aud` centralizados en `jwt-claims.util.ts` y aplicados en los 8 puntos que firman o verifican; `joi` eliminado de `dependencies`. 3 pruebas de rechazo (otro emisor, otra audiencia, token legado sin claims). |
| **6** | ✅ | `Dockerfile` multi-stage con `tini`, usuario sin privilegios, solo dependencias de producción y `HEALTHCHECK` contra readiness; `.dockerignore`; `docker-compose.yml` alineado con las versiones de CI; job `docker-image`; runbook de despliegue reescrito. |
| **7** | ✅ | ATLAS-SEC-002 congelado con el trinquete `check:tenant-header` (26 controllers / 129 usos); `joi` y `fix-atlas-backend-quality.cjs` eliminados; baseline de tamaño apretado en 6 archivos; registro de pendientes y documentación al día. |
| **8** | ✅ | Cerradas las dos colas que A-03 dejaba señaladas pero sin recoger: `retry_stuck_notifications` (mensajes en `pending`/`sending` tras un reinicio a mitad de broadcast, reintentados por el MISMO orquestador que la entrega normal) y `purge_idempotency_keys` (`idempotency_keys` solo crecía; nunca borra `processing`). Ambos con endpoint, entrada en el planificador, alerta propia y pruebas. |

### Decisiones tomadas y por qué

- **No se migraron los 26 controllers a `@CurrentTenant()`** (A-11 / ATLAS-SEC-002). Es duplicación
  sin riesgo funcional —`TenantGuard` ya cierra la brecha— y hacerlo obligaría a tocar 26 specs y a
  revalidar todos los endpoints con alcance de tenant a cambio de nada visible. En su lugar se
  congeló con un trinquete en CI, que es lo que evita el problema real: que la duplicación crezca.
- **No se añadió `@nestjs/schedule`** para la Fase 2. Los jobs son "cada N milisegundos", no
  expresiones cron, y el repositorio ya usa `setInterval` con `OnApplicationBootstrap` en dos
  servicios. Una dependencia nueva habría que justificarla; `setInterval` no.
- **`SHUTDOWN_DRAIN_MS` por defecto es 0**, no un valor "seguro". Un default distinto de cero haría
  que cada test y cada script tardaran de más en salir; el valor real es una decisión de despliegue
  y está en el runbook y en `.env.production.example`.
- **`auth.service.ts` creció de 512 a 527 líneas** (instrumentación de métricas + claims JWT) y su
  piso en `.file-size-baseline.json` se subió de forma quirúrgica. Sigue siendo candidato de la Fase
  2.2 de extracción; el resto del baseline se apretó en 6 archivos.
- **Los 151 warnings de ESLint no se tocaron** (A-11). Son complejidad ciclomática en `systems-ops`,
  deuda conocida y congelada, sin impacto funcional: reescribir esos métodos durante un endurecimiento
  de producción añade riesgo sin cerrar ningún hallazgo.

### Verificación

Ejecutada al cerrar (ver el resumen del propio commit): `type-check`, `type-check:tests`, `lint`,
`format:check`, `check:migrations`, `check:tenant-header`, `check:file-size`, `check:env-example`,
`check:seed-profiles`, `check:domain-schemas`, `check:domain-schema-layout`, `check:overfetching`,
`check:read-api-views`, `check:smoke-results-untracked`, `build` y la suite completa.

Lo que **no** se pudo verificar en esta máquina y queda para CI: el job de integración contra
Postgres/Redis reales (`db:migration:up` desde cero, seeders, smokes) y el build de la imagen Docker.
Ambos tienen su job en `.github/workflows/ci.yml`.
