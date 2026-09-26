# Remediación de la auditoría integral — 2026-08-06

**Base:** `a1b898e` · **Rama:** `audit/backend-integral-20260806-1204`
**Método:** cada hallazgo se **explotó contra la API real** (Postgres 16 + Redis 7 en contenedores,
migraciones y seeders aplicados) antes de corregirlo, y se **volvió a ejecutar** el mismo ataque
después. Evidencia: [`evidence/live-exploit-2026-08-06.md`](./evidence/live-exploit-2026-08-06.md).

Lo que separa esta pasada de las cuatro auditorías anteriores no es leer más código: es que los tres
hallazgos de fondo —una escalada entre tenants, un segundo factor que se apagaba solo y una consola
de operación que reportaba acciones no ejecutadas— **no se detectan leyendo**. Se detectan
recorriendo los caminos de autorización de punta a punta con la aplicación levantada.

## 1. Estado

| | Antes | Después |
|---|---|---|
| Escaladas de privilegio entre tenants | 1 (explotada en vivo) | **0** |
| Fugas de datos entre tenants | 2 (lectura + escritura) | **0** |
| Endpoints que reportan acciones no ejecutadas | 5 | **0** |
| Gates que aprueban sin comprobar nada | 4 | **0** |
| Endpoints sin validación de entrada | 15 | **0** |
| Vulnerabilidades HIGH de dependencias | 11 (advisory publicado hoy) | **0** |
| Suite | 305 suites / 2.872 tests | **309 suites / 2.938 tests** |
| Cobertura (stmt/branch/func/line) | 85,83 / 68,35 / 78,94 / 86,40 | **86,11 / 68,66 / 79,50 / 86,71** |
| Warnings de lint sin trinquete | 151 | 153, **congelados** (`--max-warnings`) |

## 2. Correcciones

### `ATLAS-SEC-007` · ALTA — Toma de cuenta entre tenants

`provisionCredentials` recibía **solo el rol** del solicitante. `TenantGuard` no cubre este endpoint
porque el actor destino viaja en el cuerpo (`actorId`), no en `x-tenant-id`, así que nada acotaba el
alcance: un `admin` del tenant A fijaba la contraseña inicial de un `internal_user` del tenant B sin
credenciales y entraba como él con `x-tenant-id: B`. **Verificado en vivo**: se obtuvo un token con
claims `{"sub":"3","role":"admin","tenantId":"2"}` desde una sesión del tenant 1.

Ahora el controller propaga `tenantId` y el servicio exige contención: un `admin` es un rol *de
tenant* y solo provisiona dentro del suyo; provisionar un `platform_user` —que no pertenece a ningún
tenant— exige `platform_admin`. El mismo `403` para "otro tenant" y "sin tenant en el token" evita
que el código de respuesta sirva para sondear qué `actorId` existen en otros tenants.

La prueba que fijaba el comportamiento anterior como correcto
([`auth.controller.spec.ts`](../../test/unit/auth/auth.controller.spec.ts)) se corrigió, y
`smoke:user-types` incorpora el intento cruzado como **caso de regresión con 403 esperado**.

### `ATLAS-SEC-008` · MEDIA-ALTA — El segundo factor se apagaba solo

`isSecondFactorRequired` devuelve `false` cuando MailSender no está configurado: sin canal no hay PIN
que entregar. Correcto en local, **rebaja silenciosa de autenticación en producción** — `admin` y
`platform_admin` recibiendo el par de tokens con solo la contraseña, con 200 y sin rastro. No existía
ninguna validación cruzada que exigiera el canal de correo en producción.

Dos capas:

1. **Configuración** — producción no arranca sin `MAILSENDER_BASE_URL` ni con
   `AUTH_LOGIN_PIN_ENABLED=false`. Se falla al arrancar en lugar de advertir: una advertencia sobre
   un control de seguridad ausente es un control ausente.
2. **Runtime** — `assertSecondFactorDeliverable` cubre la ventana que la configuración no alcanza (el
   proveedor configurado pero caído en el instante del login): responde 503 en vez de emitir tokens
   de un solo factor. Denegar el acceso a un operador es un incidente de disponibilidad; emitir esos
   tokens es uno de seguridad.

La política vive ahora en [`auth-second-factor.service.ts`](../../src/modules/auth/auth-second-factor.service.ts),
extraída de `AuthService` con el mismo criterio que `AuthActorResolverService` y
`AuthPasswordResetService`.

### `ATLAS-SEC-009` · MEDIA-ALTA — El portal interno ignoraba el tenant

`system_job_runs` y `data_quality_issues` llevan `_tenant_id`; el portal las consultaba sin
filtrarlo. **Verificado en vivo**: un `admin` del tenant 1 leyó una corrida de job del tenant 2
—incluidos `input_json`/`result_json`— y **modificó** el estado de una alerta del tenant 2 con
`POST /internal/alerts/dq:103/acknowledge`.

[`portal-scope.util.ts`](../../src/modules/internal-portal/application/portal-scope.util.ts) deriva
el alcance del token y cada caso de uso lo recibe explícitamente. Decisiones que importan:

- **`admin` NO es un rol de plataforma.** Por el colapso de roles documentado en
  `systems-ops.constants.ts`, `admin` es el rol legacy de SUPER_ADMIN, SYSTEMS_ADMIN e
  INTERNAL_IDENTITY_ADMIN —todos administradores *de un tenant*—. Darle alcance global habría
  reabierto la fuga por la puerta de al lado. Solo `platform_admin` y `system_admin` cruzan tenants.
- **La escritura lleva el tenant en su propio `WHERE`**, no en una comprobación previa: no hay
  ventana entre "verifico que es mío" y "escribo". Cero filas afectadas → 404, indistinguible de un
  id inexistente.
- **`countInScope` es un método aparte de `count`**, para obligar a decidir en cada llamada si la
  tabla es catálogo compartido o dato de un tenant. Un helper "que a veces filtra" es exactamente
  cómo se coló la fuga original.

### `ATLAS-OPS-011` · MEDIA — Cinco endpoints reportaban acciones que no ejecutaban

| Endpoint | Qué devolvía | Qué hacía |
|---|---|---|
| `POST /internal/jobs/:id/retry` | `200 QUEUED_FOR_RETRY` | nada — el job seguía en `completed` |
| `POST /internal/jobs/:id/cancel` | `200 CANCEL_REQUESTED` | nada |
| `POST /internal/data-quality/rules/:id/run` | `200 completed`, `finishedAt = inicio + 220 ms` | nada |
| `PATCH /internal/governance/policies/:id` | `200` con la política "actualizada" | nada (`persisted: false` enterrado) |
| `GET /internal/reports/:id/snapshots` | dos snapshots con fecha `2026-01-01` | filas escritas a mano en código |

Los cinco se retiraron. Las capacidades **reales** ya existían en `runtime-jobs`
(`recalculate_data_quality`, `process_outbox`…), que sí ejecutan, registran su corrida en
`system_job_runs` y están cubiertas por pruebas. Las políticas de gobierno pasan a ser solo lectura:
en un backend financiero son artefactos versionados —migración o seeder revisable—, no filas que se
editan desde un panel.

En la misma línea se eliminó la constante `NOW_SEED` (2026-01-01), que rellenaba 15 fechas nulas de
glosario, gobierno, calidad y operaciones. Un hueco visible es mejor que una marca temporal
inventada. También desaparecieron `attempts: 1` y `priority: 'normal'` de las corridas de job, y el
disfraz de "export ya ejecutado" (`status: READY`, `requestedBy: seed_admin`) de `/internal/exports`,
que en realidad son descriptores de catálogos descargables.

Un trinquete en
[`internal-portal-service-contract.spec.ts`](../../test/unit/internal-portal/internal-portal-service-contract.spec.ts)
impide que reaparezcan sin hacer de verdad lo que prometen.

### `ATLAS-SEC-010` · MEDIA — 15 endpoints sin contrato de entrada

El portal era el único módulo con `@Query()`/`@Param()`/`@Body()` crudos, contra la regla del propio
proyecto. No había inyección —el SQL parametriza y `parsePage` acotaba— pero tampoco contrato: el
`@ApiQuery` documentaba `minimum: 1, maximum: 100` y **nada lo aplicaba**. Todos pasan ahora por
`ZodValidationPipe` ([`internal-portal.schemas.ts`](../../src/modules/internal-portal/internal-portal.schemas.ts)).

### `ATLAS-DATA-003` · MEDIA — `outbox_events` crecía sin techo

`process_outbox` marcaba `processed` y nadie borraba. El coste no es solo disco: el índice por el que
se reclaman los pendientes se degrada con cada fila muerta, así que el drenado se vuelve más lento
justo cuando más carga hay. Nuevo job `purge_processed_outbox` (HTTP + planificador,
`RUNTIME_JOBS_OUTBOX_RETENTION_DAYS`). Solo borra `processed` con `processed_at` anterior al corte:
`pending` y `processing` no se tocan jamás —borrar uno perdería un efecto de negocio en silencio— y
una fila `processed` sin marca de procesado sobrevive para poder investigarse.

### `ATLAS-DATA-004` · MEDIA — Retención declarada y nunca aplicada

Ocho políticas sembradas (varias en el perfil de **producción**, con base legal explícita:
`kyc_aml_record_keeping`, 1825 días, acción `anonymize`) contra tres tablas mapeadas. Las cinco
restantes se reportaban en un campo `unmappedPolicies` del JSON del job que nadie leía.

No se inventó un mapeo: acotar el alcance de `risk-data-365d` o decidir qué campos anonimizar en la
evidencia de proveedor son decisiones de Riesgo, Legal y Cumplimiento, no del backend. Lo que sí se
eliminó es el **silencio**: [`retention-targets.ts`](../../src/modules/runtime-jobs/retention-targets.ts)
exige que cada política esté mapeada **o** tenga escrito qué falta decidir y quién decide, y
`yarn check:retention-coverage` lo bloquea en CI. El gate encontró una octava política
(`risk-model-inputs-730d`) que ninguna auditoría previa había visto.

### `ATLAS-CI-002` · MEDIA — Cuatro gates aprobaban sin comprobar nada

`check:read-api-views`, `check:domain-schema-layout`, `check:db-privileges` y
`db:seed:verify-prod-idempotency` imprimían `[skip]` y salían con código **0** si Postgres no
respondía. El caso que importa no es el portátil sin base: es el job de CI que sí tiene Postgres,
donde una credencial mal puesta convertía la verificación de la matriz de privilegios en un aprobado
automático — justo el gate que existe para cazar eso. Ahora fallan cerrado; el salto exige
`--allow-skip` / `ATLAS_GATES_ALLOW_SKIP=true`, que CI no pasa.

### `ATLAS-PERF-004` / `ATLAS-SEC-012` · ALTA — Volcado de SQL con PII en el log

Estaba **OPEN** en el registro de remediación desde la sesión de rendimiento, con la corrección
pospuesta por requerir un ADR. `buildSequelizeOptions()` traía:

```ts
logging: env.NODE_ENV === 'development' ? console.log : false,
```

"Estoy en desarrollo" implicaba "publica cada sentencia **con sus valores inlineados**". En un
backend KYC eso es nombre, correo, teléfono y número de documento en claro — y no en un sitio
efímero: `AppFileLogger` manda stdout y `Archivo.log` por el mismo camino, y el sincronizador replica
ese archivo en MongoDB, que se consulta por `GET /systems/logs/mongo`. Un dato que entró como "log de
desarrollo" acababa disponible por API. Contradecía además la regla escrita del propio proyecto
(«Nunca loguear SQL»).

Ahora es `DB_LOG_SQL`: decisión propia, apagada por defecto, **prohibida en producción** por
validación cruzada, y redactada a través del logger de la aplicación cuando se activa.
[ADR-0008](../adr/0008-logging-de-sql.md) documenta la decisión **y su límite**: la redacción por
clave no alcanza a un valor posicional sin nombre, así que reduce la exposición pero no la elimina —
por eso la prohibición en producción no depende de ella.

**Verificado en vivo:** arranque por defecto en `development` → **0** líneas `Executing (default)`;
con `DB_LOG_SQL=true` → el SQL aparece y los correos salen como `[REDACTED_EMAIL]`.

### `ATLAS-DEP-002` · ALTA — 11 advisories HIGH en `js-yaml`

Advisory **publicado durante esta sesión** (GHSA-5p4m-2wfm-xmqj): consumo cuadrático de CPU
resolviendo `!!omap`, presente en toda la línea 4.x hasta 4.3.0. Pin directo y `resolutions` subidos a
`^4.3.1` — la corrección va en `resolutions`, no promoviendo transitivos a dependencias, siguiendo el
criterio que ya fijó `DEP-001`. `yarn audit --level high`: **11 HIGH → 0**.

### Menores

- **`ATLAS-OPS-012`** — `Archivo.log` solo se truncaba tras sincronizar a Mongo; sin Mongo crecía
  hasta llenar el disco del contenedor. Rotación por tamaño (`LOG_FILE_MAX_BYTES`, 64 MB) con un
  solo relevo: es un búfer hacia el pipeline de logs, no el archivo histórico.
- **`ATLAS-SEC-011`** — producción sin KMS (master key de toda la PII derivada de una env var) era un
  `console.warn` perdido entre las líneas de arranque. Ahora exige declararlo:
  `PII_ENCRYPTION_ALLOW_ENV_MASTER_KEY=true`. El riesgo queda firmado en el manifiesto, revisable en
  un PR, en vez de asumido por omisión.
- **`ATLAS-TEST-002`** — `ts-jest` corría con `diagnostics.warnOnly: true`: un error de tipos en un
  spec era un aviso y la suite seguía verde. Desactivado; la suite pasa en 306/306.
- **Trinquete de lint** — `complexity`, `max-params` y `max-lines-per-function` estaban declarados
  como `warn` y CI no los miraba: el "gate de complejidad" no bloqueaba nada. `--max-warnings=153`
  congela la deuda; un warning nuevo rompe el build.
- **`listJobs`/`listAlerts`** contaban la tabla entera ignorando el filtro de texto: `totalPages`
  prometía páginas vacías al buscar.

### Defectos encontrados al verificar (no estaban en el informe original)

- **`smoke:frontend-contract` llevaba tiempo muerto.** Fallaba en el primer paso leyendo
  `data.accessToken` cuando `/internal/auth/login` entrega el token en una cookie `HttpOnly` — el
  mismo fallo corregido en `user-types.smoke.ts` (`670e9b2`) que aquí quedó pendiente. Al arreglarlo
  aparecieron tres desincronizaciones más que llevaban ocultas detrás: un campo `reason` que
  `updateDataEntityMetadataSchema` (`.strict()`) rechaza, y `/systems/review-queue`, que devuelve seis
  grupos y no una lista plana. **Es el primer verde real de este smoke.**

## 3. Divisiones exigidas por el gate de tamaño

El gate no se relajó en ningún momento; los archivos se dividieron:

- `auth.service.ts` 584 → **445** líneas (`AuthSecondFactorService`).
- `env-cross-checks.ts` 354 → **238** líneas (`env.notification-providers.checks.ts`).
- `internal-portal.controller.ts` 324 → **281** líneas (decorador compuesto `ApiPortalListQuery`).

El baseline se **bajó**, no se subió.

## 4. Evidencia ejecutada

Gates (todos en verde): `type-check`, `type-check:tests`, `lint`, `format:check`, `build`,
`check:no-env-file`, `check:env-example`, `check:smoke-results-untracked`, `check:seed-profiles`,
`check:overfetching`, `check:domain-schemas`, `check:entity-narratives`, `check:migrations`,
`check:tenant-header`, `check:file-size`, `check:retention-coverage`, `check:openapi`,
`check:read-api-views`, `check:domain-schema-layout`, `docs:openapi:lint`, `yarn audit --level high`.
**22/22.**

Base de datos real: migraciones `up`, reversibilidad `down → up`, seeders `demo` + `production`,
`db:seed:verify-prod-idempotency`, `db:seed:verify-graph`.

Suite: **309 suites / 2.938 tests**, cobertura por encima de todos los umbrales del trinquete.

Smokes contra la API levantada (**15/15**): `core`, `auth`, `sessions`, `catalog`, `workflow`,
`runtime`, `risk-telemetry`, `events`, `notifications`, `external-providers` (+`errors`,
+`governance`), `internal-rbac`, `user-types`, `frontend-contract`.

### `ATLAS-QUALITY-001` · MEDIA — Reglas importantes enterradas donde no se leen ni se prueban

No es un refactor por estética. Tres reglas que **deciden cosas** estaban dentro de funciones de
130-150 líneas, invisibles y sin prueba propia:

1. **Los defaults de seguridad del catálogo de definiciones** — ninguna observación, atributo o
   feature nace habilitada para decidir un crédito o marcar fraude, ni aprobada legalmente — vivían
   dentro de un callback de transacción de 147 líneas con **complejidad ciclomática 57**, la peor del
   repositorio. Comprobarlas exigía montar un doble de Sequelize.
2. **La precedencia de la traza de auditoría** — el catálogo de endpoints manda sobre lo que declare
   el request para `containsPii` y `riskLevel`, y la clave de idempotencia nunca se guarda en claro —
   estaba mezclada con la llamada al ORM.
3. **El clasificador que decide qué columnas son PII**, financieras o señal de fraude en
   `system_data_field_catalog` —el catálogo que alimenta el portal de gobierno, el mapeo de políticas
   de retención y la respuesta a "qué datos toca este endpoint"— era un método privado de un servicio
   de 731 líneas **sin una sola prueba**.

Extraídas a funciones puras con **35 pruebas nuevas** que fijan la regla y, en el caso del
clasificador, también **su límite conocido**: mira NOMBRES, no contenido, así que una columna con
nombre neutro que guarde un correo no se detecta. Dejarlo escrito evita que el catálogo se lea como
una garantía que no da.

Sin cambio de comportamiento: las pruebas previas siguen pasando. Los dos trinquetes BAJAN — tamaño
de archivo (731 → 690) y `--max-warnings` (153 → 152).

**Nota de método:** no se persiguió el número de ESLint. Extraer un objeto plano con 35 `??` a su
propia función no baja la métrica —la mueve—, porque cada default cuenta como rama aunque no haya
flujo de control. Se hicieron las extracciones que mejoran el diseño y se dejó constancia de esto en
vez de partir objetos en trozos artificiales para que el contador bajase.

## 5. Riesgo residual

1. **Producción sin KMS sigue siendo posible** si alguien declara
   `PII_ENCRYPTION_ALLOW_ENV_MASTER_KEY=true`. Es deliberado —bloquearlo por completo sería una
   decisión de producto, no de auditoría— pero es el mayor riesgo aceptado del sistema.
2. **Siete políticas de retención siguen sin aplicarse**, ahora con el motivo escrito y bloqueadas por
   gate. Cerrarlas exige decisiones de Riesgo, Legal y Cumplimiento; el backend ya no las oculta.
3. **Sin snapshots persistidos de reportes.** `runReport` computa en vivo y lo declara
   (`persisted: false`). Si el Admin Portal necesita histórico, hace falta una tabla — no una
   constante en código.
4. **32 archivos runtime sobre 300 líneas**, deuda congelada por el trinquete.
