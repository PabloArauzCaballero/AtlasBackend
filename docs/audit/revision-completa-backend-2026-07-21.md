# Revisión completa del backend — Informe de fallas y puntos de mejora por área

> **Registro histórico.** Sus hallazgos se corrigieron o revaluaron después de esta fecha. Consultar
> [`cierre-correcciones-2026-07-21.md`](./cierre-correcciones-2026-07-21.md) y la revisión vigente
> [`documentacion-y-correcciones-2026-07-27.md`](./documentacion-y-correcciones-2026-07-27.md).

- **Fecha:** 2026-07-21
- **Rama auditada:** `plan-10-10-docs-kms-refactors` (working tree, incluye cambios sin commitear)
- **Método:** 6 auditorías paralelas de solo lectura (seguridad, arquitectura/clean code, base de datos, observabilidad, rendimiento, testing/CI) aplicando los checklists de las skills `security-audit`, `clean-code-review`, `backend-hardening`, `observability-audit`, `performance-audit` y `production-verification` del catálogo `claude_backend_skills_recomendadas.json`. Todo hallazgo cita `archivo:línea`. No se modificó código ni se ejecutó nada contra bases de datos.
- **Evidencia ejecutada (gates):**
  - `yarn type-check` → ✅ verde
  - `yarn lint` → ✅ verde
  - `yarn test:unit` → ✅ **234 suites, 1920 tests, 0 fallos** (365 s). ⚠️ Jest avisa de un worker que no cierra limpiamente ("tests leaking due to improper teardown"; `test/unit/observability/tracing.spec.ts` tarda 60 s — sospechoso principal).

## Veredicto general

Backend **notablemente maduro** para su etapa: sin hallazgos de severidad Crítica en ninguna área. La arquitectura por capas es disciplinada (8/10), la seguridad de autenticación es de nivel OAuth2-BCP, la capa de datos está bien gobernada (mínimo privilegio verificado en CI, seeds con guardas anti-producción) y el CI es excepcionalmente completo. Las fallas reales se concentran en: **configuración operativa ausente (pool de Postgres), un script de migración de PII que crashea, trabajo pesado dentro del request HTTP, logs sin estructura ni correlación, y huecos de verificación (ningún test toca DB real, smokes de contrato fuera de CI)**.

Varios hallazgos fueron encontrados **independientemente por 2-3 auditores distintos** (marcados ✕2/✕3): son los de mayor confianza.

---

## Resumen por área

| Área | Estado | Hallazgos Alta | Riesgo principal |
|---|---|---|---|
| Seguridad | Maduro, sin críticos | 1 | Rate limiting genérico en endpoints de auth |
| Arquitectura / Clean Code | 8/10 | 1 | 16 modelos duplicados muertos con deriva de esquema |
| Base de datos | Bien gobernada | 2 | Script re-cifrado PII roto; pool/timeouts sin configurar |
| Observabilidad | Intermedio–avanzado | 3 | Logs sin JSON/correlation-id; health siempre 200 |
| Rendimiento | Buena higiene | 2 | Pool default (5) vs concurrencia asumida (25); broadcast síncrono |
| Testing / CI | Muy por encima de la media | 3 | Ningún test Jest toca DB; contratos fuera de CI |

---

## 1. Seguridad

### Alta

- **S-A1. Rate limiting insuficiente en endpoints públicos de auth** — `src/app.module.ts:54-61`, `src/modules/auth/auth.controller.ts:64,113,141,169`. Solo aplica el throttler global (100 req/60s por IP). `password-reset/request` envía un correo real por request (`auth-password-reset.service.ts:61-67`) → mail bombing (~100 correos/min/IP); el lockout por cuenta (5 intentos) no impide credential stuffing distribuido (5 contraseñas × 20 cuentas/min/IP). **Fix:** `@Throttle` estricto (5-10/min) en login/reset/refresh + cooldown por correo destino (como ya hace `customer-contact-verification.service.ts:56-58`).

### Media

- **S-M1. PII sin redactar en audit logs HTTP** — `src/common/utils/privacy/redaction.util.ts:1-2` no cubre `identifier` (el campo del login con email/teléfono, `auth.schemas.ts:9`) ni `fullName`/`firstName`. Cada login deja el email/teléfono en claro en `http_action_logs`. **Fix:** ampliar el patrón o redactar el body completo en rutas `auth/*`.
- **S-M2. `GET /metrics` sin autenticación de aplicación** — `src/common/observability/metrics.controller.ts:21-31`. Además **no tiene `@SkipThrottle`** (a diferencia de health): el scrape de Prometheus consume el rate limit global. **Fix:** token de scrape o allowlist + `@SkipThrottle`.
- **S-M3. Producción puede arrancar sin KMS silenciosamente** — `src/common/utils/crypto/local-key-provider.ts:5-8`: sin `KMS_KEY_ID`+`AWS_REGION`, la master key deriva de una env var (SHA-256). **Fix:** exigir o advertir ruidosamente KMS en `NODE_ENV=production`; correr `crypto:reencrypt-pii` tras activarlo (ver DB-A1: hoy ese script está roto).
- **S-M4. Logs de texto libre sin redacción** (✕3: también observabilidad M3 y DB M5) — ver O-A1/DB-M5.

### Baja

- Webhooks salientes sin firma HMAC (`http-adapter.util.ts:100-137`); TOCTOU/DNS-rebinding teórico en el runner de system-tests (mitigado por allowlist); `x-forwarded-for` crudo en audit log en vez de `req.ip` (`http-action-log.interceptor.ts:53-55`); advisory transitiva `brace-expansion` 1.1.15 (CVE-2026-13149, solo tooling — fix: `resolutions`); clave de idempotencia sin `actorId` (`runtime-hardening.service.ts:51`); política de contraseñas mínima (10 chars, sin lista de comprometidas).

### Positivo

JWT HS256 fijado al firmar y verificar (inmune a confusión de algoritmo); refresh tokens opacos con rotación transaccional `FOR UPDATE` y **detección de reuso con revocación en cadena** (`auth.service.ts:334-435`); Argon2id parámetros OWASP; anti-BOLA centralizado (`ownership.util.ts`, 21 usos); SQL crudo 100% parametrizado con allowlist de columnas; defaults de dev bloqueados en producción por Zod (`env.ts:253-292`); OTP dev bloqueado en prod; idempotencia global con índice único.

---

## 2. Arquitectura y Clean Code

### Alta

- **AR-A1. 16 pares de modelos Sequelize duplicados, muertos y con deriva** (✕2: también DB M6) — `src/database/models/`: pares singular/plural (`consent-document` vs `consent-documents`, `customer` vs `customers`, `tenant`, `device`, `fraud-case`…). Solo las plurales viven (`index.ts:27,29`; las singulares tienen **0 imports** en todo el repo) pero **han derivado**: `consent-document.model.ts:21-25` usa `DATE`/`Date|null` donde el vivo usa `DATEONLY`/`string|null`; nulabilidad y longitudes distintas. Mismas clases con el mismo nombre sobre la misma tabla → un autoimport del IDE puede traer tipos incorrectos que compilan. Además `systems-catalog-seed.service.ts:141-146` escanea el directorio por regex y el "ganador" depende del orden del filesystem. `docs/audit/consents.md:20` referencia los muertos. **Fix:** borrar los 16 singulares (riesgo casi nulo, 0 imports verificados) y corregir la doc. **Resuelto (2026-07-21):** los 16 archivos singulares fueron eliminados y `docs/audit/consents.md` actualizada para apuntar a los modelos plurales vivos; `tsc --noEmit` en verde tras el borrado.

### Media

- **AR-M1. El filtro global descarta los `issues` de Zod** — `zod-validation.pipe.ts:24-27` construye el detalle campo-a-campo pero `http-exception.filter.ts:119-126` solo devuelve `code`+`message`: el cliente recibe "Entrada inválida en body." sin saber qué campo falló. **Fix:** propagar `issues` en los 400 de validación (no son PII) o eliminar `formatZodError` — decidirlo explícitamente.
- **AR-M2. Acoplamiento por repositorios cross-módulo en onboarding** — `customer-onboarding-start.service.ts:15-18` inyecta repositorios de 4 módulos ajenos. Atenuante legítimo: la transacción única es requisito real. **Fix:** puertos transaccionales estrechos en vez de exportar el repositorio completo.
- **AR-M3. Deuda de tamaño congelada: 35 archivos > 300 líneas** — top: `systems-catalog-seed.service.ts` (731), `multidomain-context-loader.ts` (714), `external-data.controller.ts` (628), `auth.service.ts` (512, el más riesgoso por dominio). El gate trinquete es correcto; presupuestar la división de los 5 mayores.
- **AR-M4. Introspección leyendo fuentes `.ts` en runtime** — `systems-catalog-seed.service.ts:136-149` lee `src/database/models/*.ts` del filesystem; en un despliegue solo-`dist/` retorna 0 **silenciosamente**. **Fix:** introspectar los modelos registrados en Sequelize.

### Baja

Providers exportados sin consumidores (`notifications.module.ts:61`, `internal-users.module.ts:45`); 107 handlers repiten el parsing de `x-tenant-id` (decorador `@TenantId()` lo eliminaría); estructura interna de módulos inconsistente (fijar convención objetivo); cursor de paginación duplicado en `audit.repository.ts:300-314`; `notifications.controller.ts` mezcla 3 audiencias en 21 endpoints.

### Positivo

Patrón uniforme `controller → service → repository → mapper → DTO`; **ningún modelo Sequelize llega al transporte HTTP**; cero `forwardRef` (grafo acíclico); casi cero `any`; no hay errores tragados (todos los `catch {}` inspeccionados son deliberados y correctos); comentarios que explican decisiones, no código.

---

## 3. Base de datos e integridad

### Alta

- **DB-A1. El script de re-cifrado de PII crashea: columna `id` inexistente** — `scripts/reencrypt-pii-to-envelope.ts:41-48` usa `idColumn: 'id'` pero la PK real de `customer_contact_methods` y `device_tokens` es `_id` (`migrations/20260626154045…:700`, `20260630183000…:237`). La migración PII v1→v2 está **bloqueada**: el primer SELECT falla. Riesgo secundario: `contact_value_encrypted` es bytea y el script usa semántica de texto (`LIKE 'v1:%'`). **Fix:** `idColumn: '_id'`, validar coerción bytea↔text, dry-run contra base descartable. (Conecta con S-M3: sin este script no se puede completar la adopción de KMS.)
- **DB-A2. Pool y timeouts sin configurar** (✕2: también rendimiento A1) — `src/config/database.config.ts:28-42,53-69` no pasa `pool`: defaults de Sequelize `max: 5, min: 0, acquire: 60000`. El propio código asume 25 entregas concurrentes contra ese pool (`notification-broadcast.service.ts:26`), y `atlas_app_rw` no tiene `statement_timeout` ni `idle_in_transaction_session_timeout` (solo el rol RO los tiene, `ops/postgres/bootstrap-roles.sql:75-78`): una transacción colgada retiene locks indefinidamente y la saturación se manifiesta como latencia en cola de hasta 60 s, no como error. **Fix:** `DB_POOL_MAX/MIN/ACQUIRE/IDLE` por env en ambos builders + timeouts a nivel rol para `atlas_app_rw`; alinear `DELIVERY_CONCURRENCY ≤ pool.max`.

### Media

- **DB-M1. Tri-estado de `_deleted`** — columna nullable sin DEFAULT (`schema-part-1:129-133`) y filtros `[Op.ne]: true`: una fila con `_deleted = NULL` es **invisible para la app** (SQL: `NULL != true` → NULL) y además escapa del índice único parcial de emails (`WHERE _deleted = false`, `20260701000000:63`): dos emails iguales con NULL no violarían unicidad. Hoy funciona porque cada `create` lo setea a mano. **Fix:** expand: `SET DEFAULT false` → backfill → `SET NOT NULL`.
- **DB-M2. Gate anti-overfetching cubre solo `read_api`** — `check-overfetching.ts:8-9` lo declara honestamente; los `findAll` de tablas anchas traen `payload_json`/blobs cifrados (`notifications.repository.ts:299,324`), y hay bucles de upsert secuencial dentro de transacción (`catalog-definitions.service.ts:31-110`). **Fix:** `attributes` explícitos en listados calientes; `bulkCreate(..., {updateOnDuplicate})` en ingestas.
- **DB-M3. `decryptSecretEnvelope` degrada en silencio** — `envelope-encryption.util.ts:62-64` (`catch { return null }`): una caída de KMS o clave mal rotada se manifiesta como "el cliente no tiene email/token", sin log ni métrica (`notifications.repository.ts:84-86,530` filtran el null sin señal). **Fix:** resultado tipado `{ok, reason}` + contador de fallos de descifrado por proveedor.
- **DB-M4. `refreshCatalog` no atómico** — el advisory lock abre transacción pero los seeds corren en autocommit (`systems-catalog-seed.service.ts:64-113`). Mitigado por idempotencia; documentar o pasar la transacción.
- **DB-M5. Mongo de logs sin TTL ni redacción** (✕3: obs M3, sec M4) — `log-sync.service.ts:237-240` sin índice TTL; el archivo local se trunca tras sincronizar → Mongo es la única copia, crecimiento ilimitado, contenido crudo expuesto vía `GET /systems/logs/mongo`. **Fix:** TTL sobre `capturedAt` + scrubber antes de insertar.
- **DB-M6.** = AR-A1 (modelos duplicados).
- **DB-M7. Los `down` de las 57 migraciones jamás se ejercitan** — CI solo corre `db:migration:up` (`ci.yml:183`). **Fix:** job `up → down → up` contra la base efímera (viable: los `down` complejos son transaccionales).

### Baja

Carrera check-then-insert en idempotencia de notificaciones (mitigada por índice único; capturar `UniqueConstraintError` y releer, `notifications.repository.ts:157-162`); `_created_at NOT NULL` sin `DEFAULT now()` en tablas del schema base; `verify-prod-seed-idempotency` vigila solo 8 tablas; `check-db-privileges` no-bloqueante si el usuario conectado no es el esperado (añadir `--strict` en CI); renombrar la confirmación de `DATABASE_CLEAN_CONFIRM` para reflejar que trunca TODO, no solo seeds.

### Positivo

57 migraciones con `up`/`down`, cero `sync({force|alter})`, split a schemas de dominio expand/contract de libro; política central de FKs (`atlas-schema-builder.util.ts:188-189`); mínimo privilegio real verificado en CI (app user sin DDL, identidad separada `atlas_migrator`→`atlas_owner`, escritura de prueba que debe fallar); outbox con `FOR UPDATE SKIP LOCKED`; seeds con guardas anti-producción en 3 capas; PII con patrón hash-para-buscar + blob-para-guardar y vistas `read_api` sin columnas sensibles.

---

## 4. Observabilidad

### Alta

- **O-A1. Logs en texto plano, sin correlation-id ni trace-id** — `AppFileLogger` (`app-file-logger.service.ts:40`) escribe texto, no JSON, sin `correlationId` ni `trace_id` OTel. El `x-correlation-id` existe (middleware + filter) pero cualquier `logger.log()` de servicio sale sin él; no hay `AsyncLocalStorage`. El log-sync sube **chunks de texto crudo** a Mongo. Correlación logs↔request↔traza rota. **Fix:** `ConsoleLogger` JSON de Nest 11 (o pino) + ALS inyectando `correlationId`/`trace_id` en cada línea.
- **O-A2. Health check único que nunca devuelve 503** — `health.controller.ts:26-43`: solo `sequelize.authenticate()`, responde `degraded` con **200**; Redis y Mongo no se verifican; sin liveness/readiness separados. K8s/LB no pueden sacar una instancia enferma del pool. Existe un monitor interno rico (`systems-health-monitor.service.ts:42-80`) no expuesto como readiness. **Fix:** `/health/liveness` + `/health/readiness` con 503 real.
- **O-A3. Sin `unhandledRejection`/`uncaughtException` handlers** — 0 coincidencias en el repo; solo `bootstrap().catch` y SIGTERM. Un unhandled rejection mata el proceso escribiendo a stderr, **fuera** del pipeline de logs propio: crash sin evidencia. **Fix:** ambos handlers en `main.ts` con log de stack + flush + exit ≠ 0; añadir SIGINT al shutdown de trazas.

### Media

- **O-M1. Las métricas RED no ven 401/403/429** — los guards ejecutan antes que `HttpMetricsInterceptor`: un ataque de fuerza bruta es invisible en `http_requests_total` y la alerta de client-errors nunca dispara por esa vía. **Fix:** medir en middleware Express (`res.on('finish')`).
- **O-M2. Workers con fallos silenciosos (solo estado en DB)** — `events.service.ts:172-186` (0 llamadas a logger), `catalog-ingestion.service.ts` (cero logging), `notification-orchestrator.service.ts:150-157` (delivery failed sin log ni counter). No hay señal alertable de notificaciones/ingesta fallando. **Fix:** counters `_total{outcome}` + histograma de duración + `logger.error` con stack por worker.
- **O-M3.** = DB-M5/S-M4 (redacción solo en persistencia estructurada, no en el camino general de log; en dev Sequelize loguea SQL con valores inlined, `database.config.ts:39`).
- **O-M4. `x-correlation-id` entrante sin validar** — se refleja y persiste tal cual (log injection, longitud arbitraria). **Fix:** validar patrón o regenerar.
- **O-M5. Trazas al 100% de sampling sin documentar** — `tracing.ts:33-40` sin `sampler`; documentar `OTEL_TRACES_SAMPLER` para producción.

### Baja

`/metrics` sin `@SkipThrottle` (= S-M2); gauge de outbox por tenant se estanca si el job muere (ya documentado en `ops/observability/README.md:55-58`); `action_code` del audit usa el path resuelto (alta cardinalidad en tabla).

### Positivo

Métricas RED completas con cardinalidad cuidada (ruta patrón, buckets 5ms–5s); métricas de negocio en el punto único de salida (`ResilientAdapterExecutorService`); 9 alertas Prometheus + dashboard Grafana + runbooks **versionados**; OTel arrancado correctamente antes de imports instrumentables; contrato de error consistente con `requestId`; redacción disciplinada en persistencia (26 call sites).

---

## 5. Rendimiento

*(Revisión estática: riesgos potenciales, no cuellos confirmados; cada uno incluye cómo medirlo.)*

### Alta

- **P-A1.** = DB-A2 (pool default `max: 5` vs `DELIVERY_CONCURRENCY = 25`; medir con `pool.pending` durante `scripts/stress/notifications.stress.ts`).
- **P-A2. Broadcast completo dentro del request HTTP** — `notifications.controller.ts:254-263` → `notification-broadcast.service.ts:46-137`: resuelve destinatarios **sin límite** (`customers.repository.ts:46-58`, `findAll` sin limit), un solo `bulkCreate` gigante, y espera la entrega completa antes de responder. Con decenas de miles de clientes: minutos de request, timeout del proxy, y sin reanudación si el proceso muere (retry del cliente duplicaría). `notifyAllInternalUsers` itera todos los tenants en el hilo de la alerta de salud. **Fix:** responder 202 + mover la entrega al patrón outbox que el repo ya tiene (`runtime-jobs.service.ts:174-199`); trocear `bulkCreate` (~1000 filas); keyset pagination en destinatarios. **Medir:** broadcast con tenant de 10k/50k/100k clientes.

### Media

- **P-M1. N+1 por mensaje en el orquestador** — por regla×canal: query de canal + template **sin caché** + create + re-lectura del mensaje recién creado (`notification-orchestrator.service.ts:63-109`, `notifications.repository.ts:256-260`); eventos procesados uno a uno (`events.service.ts:161-192`). **Fix:** caché de templates (TTL corto), pasar el modelo en memoria a `deliverMessage`, batch con concurrencia acotada. **Medir:** el stress script ya reporta `throughputPerSecond`/`p95RoundMs`.
- **P-M2. El ejecutor resiliente no impone timeout por intento** — `resilient-adapter-executor.service.ts:30-49`: ni retry ni breaker abortan una llamada colgada; la garantía depende de que cada adaptador tenga su propio timeout (no verificado uno a uno). **Fix:** `timeoutMs` con `AbortSignal.timeout` en el ejecutor.
- **P-M3. Revocación de tokens: +1 RTT a Redis por request autenticado** — diseño razonable; si p95 lo justifica, micro-caché en memoria de 1-5 s.
- **P-M4. Sin compresión HTTP** — no hay `compression` en `main.ts:33-67`; confirmar si el proxy comprime.

### Baja

N+1 acotados por payload de entrada (preferences, permisos de sesión); `mapWithConcurrency` con head-of-line blocking por chunk (`concurrency.util.ts:14-21` — curiosamente `runPool` del stress script ya implementa el worker-pool correcto); argon2 periódico en health monitor (async, con lock — solo vigilar); cliente Redis con offline queue ilimitada sin `connectTimeout` (`redis.module.ts:22-26`).

### Positivo

176 índices en 40 migraciones cubriendo las tablas calientes (incluidos únicos parciales e índice covering); backoff exponencial con jitter + circuit breaker por proveedor con half-open; sin crypto síncrono en caminos calientes; `bulkCreate` en broadcast; prácticamente cero `include` de Sequelize (el N+1 clásico por eager loading no existe); el loader multidominio NO corre en boot; el stress script es un buen embrión de baseline.

**Siguiente paso sugerido:** establecer baseline con el stress script + perfil de lectura (autocannon/k6), exponer métricas del pool, y solo entonces priorizar P-A1/P-A2 con datos.

---

## 6. Testing y CI/CD

### Alta

- **T-A1. Ningún test de Jest ejercita la base de datos** — los "e2e" levantan Nest + guards reales pero **mockean el service layer** (`test/e2e/systems-ops/support/systems-ops-test-app.ts:18-32`, `context-ingestion.spec.ts:17-19`); la capa repository↔Sequelize↔SQL solo se verifica con mocks. Mitigado por el job de integración de CI (migraciones+seeds+smokes contra Postgres real), pero los smokes son happy-path. Un bug de mapeo (tipos, transacciones, FK) solo se caza si casualmente rompe un 200. **Fix:** 2-3 suites e2e con DB real para onboarding completo, decisión de fraude y ciclo de consents.
- **T-A2. Los smokes de contrato NO corren en CI** — `ci.yml:242-252` omite `smoke:frontend-contract` y `smoke:internal-rbac` porque exigen `INTERNAL_SMOKE_PASSWORD` sin fallback y el workflow no lo provee. El frontend-contract es justo el que garantiza que el Admin Portal no reciba tablas vacías. **Fix:** sembrar usuario interno de CI + secret del job.
- **T-A3. El contrato con AtlasExternalProvidersMock no se verifica en este repo** — CI corre en modo `mock_local` (stubs in-process); `callMockServer` nunca se ejecuta contra el server real. Un cambio que rompa el contrato HTTP pasa CI verde aquí. **Fix:** job opcional que haga checkout del mock, lo levante y corra `smoke:external-providers:all` con `*_MODE=mock_server`.

### Media

- **T-M1. Umbrales de cobertura calibrados con specs sin trackear** — `jest.config.cjs:83-90` lo admite; el "colchón" de 3-4 pts permite regresionar sin que el gate lo note. **Fix:** commitear esos specs (varios están modificados en este branch) y recalibrar con colchón ~1 pt.
- **T-M2. `type-check` no cubre `test/`** — `tsconfig.json:18` + `diagnostics: {warnOnly: true}` (`jest.config.cjs:31-34`): un spec con errores de tipos pasa en verde. **Fix:** `tsc --noEmit -p tsconfig.spec.json` en CI.
- **T-M3. Specs de repository acoplados a implementación** — asserts sobre `mock.calls[0][0].where` (patrón dominante en ~25 specs). Aceptable como contrato de query documentado, pero cubrir auth/fraud/notifications además con e2e sobre DB real (= T-A1).
- **T-M4. Evidencia JSON de smokes vacía en CI** — solo el agregado `yarn smoke` escribe resultados; CI los invoca individualmente → artifact sube vacío (gap reconocido en `ci.yml:265-268`).
- **T-M5. Worker de Jest que no cierra limpiamente** — observado en la corrida de esta auditoría (verde, pero con warning de teardown; `tracing.spec.ts` 60 s). **Fix:** `--detectOpenHandles` para localizar el timer/handle y `.unref()` o teardown explícito.
- **T-M6. `smoke:external-providers:governance` tampoco corre en CI** — solo en los audits manuales v6/quality-10.

### Baja

Specs de delegación pura de bajo valor; 12 specs de systems-ops sueltos en la raíz de `test/unit/`; smokes (salvo auth) firman JWTs directamente con el secret en vez de login real.

### Cobertura por módulo (25/25 con specs)

Con huecos relativos ("Parcial"): **internal-portal (17 src / 4 specs — el mayor hueco)**, internal-users, consents, customer-privacy, customer-telemetry, data-quality, events, log-sync, runtime-jobs. El resto: cobertura razonable; auth/risk/fraud/crypto con umbrales reforzados propios.

### Positivo

CI de 8 jobs: gates estáticos + unit randomizado con semilla + build + cobertura con trinquete documentado + integración con Postgres/Redis reales (roles, matriz de privilegios, seeds, smokes) + `yarn audit --level high` bloqueante + CodeQL security-extended + gitleaks + SBOM CycloneDX + gate de tamaño de migraciones. Asserts de calidad (regresiones nombradas, verificación de "service NO llamado" en rechazos). OpenAPI verificado por spec sin DB. Higiene de secretos en smokes.

---

## Top 12 acciones priorizadas

**Quick wins (bajo riesgo, alto valor — ~1 día cada uno):**
1. Corregir `idColumn: '_id'` en `scripts/reencrypt-pii-to-envelope.ts` + dry-run (DB-A1 — desbloquea la migración de PII a KMS).
2. Configurar `pool` por env en `database.config.ts` + `statement_timeout` para `atlas_app_rw` (DB-A2/P-A1 ✕2).
3. Borrar los 16 modelos singulares muertos + corregir `docs/audit/consents.md` (AR-A1/DB-M6 ✕2, 0 imports verificados).
4. `@Throttle` estricto en login/password-reset/refresh + cooldown por correo (S-A1).
5. Añadir `identifier|fullName|name` al patrón de redacción (S-M1).
6. Handlers de `unhandledRejection`/`uncaughtException` + SIGINT en `main.ts` (O-A3).
7. Añadir `INTERNAL_SMOKE_PASSWORD` al job de CI y activar los 2 smokes de contrato (T-A2).
8. `resolutions: { "brace-expansion": "^1.1.16" }` (S-Baja).

**Estructurales (planificar):**
9. Broadcast → 202 + entrega vía outbox existente (P-A2).
10. Logs JSON + `AsyncLocalStorage` con `correlationId`/`trace_id`; scrubber antes de Mongo + TTL (O-A1 + DB-M5 ✕3).
11. `/health/liveness` + `/health/readiness` con 503 real (O-A2).
12. Migración expand para `_deleted` (default → backfill → NOT NULL) (DB-M1) y job CI `up→down→up` (DB-M7); 2-3 e2e con DB real (T-A1).

---

## Limitaciones de esta revisión

- **100% estática** salvo los gates (`type-check`, `lint`, `test:unit` ejecutados en verde). No se levantó la app, no se ejecutó nada contra bases de datos, no se midió latencia real.
- Refleja el **working tree** del branch `plan-10-10-docs-kms-refactors` (con decenas de archivos modificados sin commitear), que puede diferir de `main`.
- Cada auditor muestreó en profundidad; los módulos no muestreados se verificaron solo estructuralmente. Cada informe de área lista sus propios "no verificado".
- Las skills del catálogo (`backend-hardening`, `security-audit`, etc.) **no existen aún como skills instaladas** en `.claude/skills/` — esta revisión aplicó sus checklists manualmente. La orden `CLAUDE_ORGANIZAR_SKILLS_BACKEND.md` (crear esas skills, reglas y matriz de plugins) es una tarea separada pendiente.
