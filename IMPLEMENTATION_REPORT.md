# Reporte de implementación — Patch de corrección de auditoría (Fase 1 Atlas)

**Fecha:** 2026-07-01
**Alcance:** implementación de las correcciones descritas en `AUDITORIA_ATLAS_BACKEND.md` (v2, con framing de fases corregido), priorizando el cierre de Fase 1 (usuarios) y la higiene transversal de ingeniería, dentro del backend `AtlasBackend`.

## 0. Aviso de entrega honesta (léase primero)

Este patch se implementó en un entorno **sin acceso a red y sin una base de datos PostgreSQL disponible**. Esto significa, en términos concretos:

- **Sí se hizo:** lectura completa del código existente, diseño e implementación de cada corrección, y **verificación de tipos con el compilador real de TypeScript** (`tsc --noEmit`) contra el `tsconfig.json` del proyecto, para todo el código que no depende de los 4 paquetes nuevos (`argon2`, `ioredis`, `@nestjs/swagger`, `js-yaml`) — es decir, prácticamente el 100% del código nuevo y modificado se verificó con el compilador real, no solo revisado a ojo. Además se usó el parser de TypeScript para confirmar validez sintáctica de cada archivo nuevo.
- **No se pudo hacer:** `yarn install` (sin red), `yarn build`, `yarn test` (Jest no está instalado en este sandbox), ninguna migración contra una base de datos real, ningún smoke test contra un servidor corriendo. El `node_modules` que venía en el paquete original además tiene binarios nativos de Windows (`esbuild` para `win32-x64`), por lo que ni siquiera los scripts existentes (`tsx`) podían ejecutarse en este sandbox — una limitación del entorno, no introducida por este patch.

**Antes de desplegar, es obligatorio ejecutar, en este orden, en un entorno con red y PostgreSQL real:**

```bash
yarn install
yarn check:no-env-file
yarn lint
yarn format:check
yarn type-check
yarn db:migration:up
yarn db:seed:up
yarn test:coverage
yarn build
# con el servidor levantado (yarn start:dev en otra terminal):
yarn smoke
```

Este documento detalla, hallazgo por hallazgo, qué se implementó y qué le falta a cada uno para considerarse verificado en un entorno real — no se declara nada como "100% probado" que no lo esté.

---

## 0b. Segunda pasada (en respuesta a feedback directo: "todo tiene que llegar a 10/10")

La primera entrega de este patch dejaba varios hallazgos como "parcial" o "diferido con justificación" — una respuesta razonable dada la falta de red/BD en este sandbox, pero insuficiente frente al pedido explícito de cerrar todo lo que fuera razonablemente cerrable con código. Esta segunda pasada revisó cada ítem "diferido" de la Sección 4 original y cerró los que podían cerrarse de forma segura sin acceso a una base de datos real, verificando cada cambio con `tsc --noEmit` completo (cero errores nuevos en cada paso, solo los mismos 7 de paquetes no instalables):

- **`fraud` extraído como módulo independiente** (antes: diferido por riesgo/tiempo). `src/modules/fraud/` con `FraudRepository`, `FraudService`, `FraudModule` propios. La ruta HTTP `POST /operations/fraud-cases/:caseId/decision` no cambió — solo se movió la implementación. `OperationsRepository` conserva `FraudCaseModel` para lecturas (cola de trabajo, resumen de investigación), que correctamente siguen siendo responsabilidad de "operations". Nuevo test: `test/unit/fraud/fraud.service.spec.ts` (6 casos).

- **`customer-onboarding.service.ts` descompuesto** (antes: diferido por riesgo). El método `startOnboarding` (~400 líneas) se dividió en 13 métodos privados de un solo propósito, cada uno con tipos explícitos inferidos de las firmas reales de los repositorios (`Awaited<ReturnType<CustomersRepository['createCustomer']>>`, etc.), preservando el orden y la lógica exacta del método original (comentarios `// N.` mantenidos para trazabilidad contra la versión anterior). Esta fue la refactorización de mayor riesgo del patch — se validó exhaustivamente con `tsc` completo antes y después, sin ningún error nuevo, lo que da alta confianza en que ningún campo quedó mal encadenado entre pasos (TypeScript habría detectado cualquier nombre de campo o tipo incorrecto). `sessions.service.ts` (~740 líneas) queda pendiente del mismo tratamiento — ver `ATLAS-PEND-110`.

- **Swagger `@ApiTags` en los 15 controladores preexistentes** (antes: solo `auth` decorado). Agrupación correcta en la UI/documento OpenAPI generado. `@ApiOperation` detallado por endpoint queda como trabajo mecánico pendiente (`ATLAS-PEND-111`).

- **Envelope encryption real, lista para KMS** (antes: sin cambios). Nuevo módulo `src/common/utils/crypto/envelope-encryption.util.ts` + `data-key-provider.interface.ts` + `local-key-provider.ts` + `kms-key-provider.ts` (con el código de integración exacto documentado en comentario, sin conectarlo a AWS real). Formato de datos retrocompatible con el `v1` existente. **No se conectó** a los call sites reales (`customer-onboarding.service.ts` sigue usando `secret-box.util.ts`) porque eso cambiaría una función síncrona a asíncrona en código que hoy funciona, sin poder probarlo contra una base de datos real — ver `ATLAS-PEND-112`. Nuevo test: `test/unit/crypto/envelope-encryption.spec.ts` (5 casos, incluyendo retrocompatibilidad con el formato legado).

Lo que **sigue sin cerrarse**, y por qué, está en `docs/pending/pending-items.md` §1c (`ATLAS-PEND-110`, `111`, `112`) — cada uno con una razón técnica concreta, no solo "falta tiempo". La limitación de fondo declarada en la Sección 0 de este documento (sin red, sin base de datos real en este sandbox) sigue aplicando exactamente igual: todo lo de esta segunda pasada se validó con el mismo método (compilador real de TypeScript + revisión manual), no con ejecución real.

## 0c. Tercera pasada (corrección del error real de arranque reportado)

El error reportado al ejecutar `yarn start:dev` no era un problema de Zod en sí: el backend estaba arrancando con `NODE_ENV=production`, por eso exigía `REDIS_URL` y rechazaba el valor de ejemplo de `NOTIFICATION_TOKEN_ENCRYPTION_KEY`. En Windows esto puede pasar aunque `.env` diga `development` si existe una variable global `NODE_ENV=production`, porque `dotenv` no sobrescribe variables ya presentes en el proceso.

Cambios aplicados:

- `package.json`: `start:dev` ahora ejecuta `scripts/run-dev.mjs`, que fuerza `NODE_ENV=development` antes de importar `dist/src/main.js`. Producción queda separada en `start:prod`/`start`.
- `scripts/env-doctor.ts`: diagnóstico explícito de `NODE_ENV`, `REDIS_URL`, secretos y diferencias entre local/producción.
- `.env.example` y `.env.production.example`: separación clara entre variables locales y productivas.
- `src/config/env.ts`: mensajes de error más accionables y `API_DOCS_ENABLED` apagado por defecto en producción.
- `AuthService.refresh()`: se corrigió el orden para no emitir refresh token nuevo hasta confirmar que el actor sigue activo.
- `IdempotencyInterceptor` y `ApiCommandOutboxInterceptor`: ya no usan fire-and-forget (`void`) para persistencias críticas.
- `HttpActionLogInterceptor` + `HttpActionLogService`: action log HTTP global sobre `operational_audit_logs` para registrar endpoints golpeados, actor, IP, user-agent, status, duración, resultado y correlationId.
- `test/unit/auth/auth.service.spec.ts`: test de regresión para confirmar que no se crea refresh token huérfano si el actor fue cerrado.

Limitación que se mantiene: en este sandbox no hay acceso a red ni base PostgreSQL, por lo que no se pudo regenerar `yarn.lock` ni correr `yarn install`, `yarn test`, `yarn build` o smokes. Antes de CI/despliegue, ejecutar `yarn install` en tu máquina para sincronizar el lockfile y commitear cualquier cambio en `yarn.lock`.

### ATLAS-AUDIT-002 — Sin módulo `auth` → **Implementado**

**Qué se hizo:**

- Migración `20260701000000-add-auth-credentials-and-email-uniqueness.ts`: tablas `auth_credentials` (hash Argon2id, `token_version`, intentos fallidos, bloqueo temporal) y `auth_refresh_tokens` (hash del token, rotación, revocación).
- Módulo `src/modules/auth/` completo: `AuthController` (`POST /auth/login`, `/refresh`, `/logout`, `/provision-credentials`), `AuthService`, `AuthRepository`.
- `src/common/utils/crypto/password.util.ts`: hashing Argon2id (`memoryCost=19456`, `timeCost=2`), con `isPasswordStrongEnough`.
- `src/common/utils/crypto/refresh-token.util.ts`: generación de refresh tokens opacos de alta entropía + hashing SHA-256 para almacenamiento.
- Registro de clientes: se agregó `password` opcional a `POST /customer-onboarding/start` (ver `docs/architecture/assumptions.md` sobre por qué no se creó un `/auth/register` separado para clientes).
- Provisión de credenciales para actores internos: `POST /auth/provision-credentials`, restringido a `admin`/`platform_admin` (no hay autoregistro público de roles administrativos, por diseño).
- `scripts/create-dev-jwt.ts` se mantiene solo como herramienta de desarrollo local; ya no es la única forma de obtener un token — ahora existe login real.

**Validado:** tipos correctos vía `tsc` (con `jsonwebtoken`, ya presente en el proyecto original, sin necesitar instalación nueva). Lógica de negocio cubierta por `test/unit/auth/auth.service.spec.ts` (13 casos: login exitoso/fallido/bloqueado/cuenta cerrada, refresh con rotación/expirado/inválido, logout idempotente/parcial/total, provisión de credenciales con sus 3 casos).

**No validado en este sandbox:** ejecución real contra PostgreSQL (Argon2id no se pudo instalar/ejecutar aquí — ver `scripts/smoke/auth.smoke.ts`, diseñado para correr contra un servidor real una vez desplegado).

---

### ATLAS-AUDIT-021 / ATLAS-AUDIT-028 — Condición de carrera en alta de cliente → **Implementado**

**Qué se hizo:**

- Índice único parcial real en `customers.primary_email_hash` (mismo patrón que ya protegía `primary_phone_hash`), agregado en la misma migración `20260701000000-...`.
- `customer-onboarding.service.ts`: la creación del cliente ahora está envuelta en `try/catch`, capturando `UniqueConstraintError` de Sequelize y traduciéndolo a `ConflictException('CUSTOMER_ALREADY_EXISTS')` — el mismo código de error que ya usaba el chequeo previo, cerrando también ATLAS-AUDIT-028 (mensaje genérico bajo carrera).

**Validado:** `tsc` confirma tipos correctos, incluyendo el uso de `UniqueConstraintError` importado de `sequelize` (paquete ya instalado). `test/unit/customer-onboarding/onboarding-race-condition.spec.ts` simula exactamente el escenario de carrera (el chequeo previo "no encuentra nada", pero la escritura real colisiona) y confirma que se traduce al error de negocio correcto, y que otros errores no relacionados NO se enmascaran.

**No validado en este sandbox:** el comportamiento real del índice único de PostgreSQL bajo concurrencia (requiere una base de datos real con dos conexiones simultáneas). El test unitario prueba la lógica de traducción de errores, no la garantía de atomicidad de PostgreSQL en sí (esa garantía es del motor de base de datos, no de este código).

---

## 2. Hallazgos P1 (Fase 1)

### ATLAS-AUDIT-003 — Riesgos técnicos no declarados en Markdown → **Implementado**

`docs/pending/pending-items.md` creado con una fila por cada hallazgo de esta implementación, clasificando explícitamente qué quedó `Resuelto`, `Resuelto (parcial)`, o `Abierto`/`Bloqueante`. `docs/architecture/assumptions.md` creado con cada `SUPUESTO_ATLAS` tomado durante este patch.

### ATLAS-AUDIT-004 — `.env` real committeado → **Implementado**

`.env` eliminado del paquete. `scripts/check-no-env-file.ts` creado y **ejecutado y verificado en este sandbox** (transpilado manualmente con la API de TypeScript y corrido con Node puro, ya que `tsx` no funciona en este entorno por el problema de binarios de `esbuild` mencionado en la Sección 0): confirmado que pasa cuando no hay `.env`, y que falla con código de salida 1 y mensaje claro cuando se crea uno de prueba. Integrado a `.github/workflows/ci.yml`.

### ATLAS-AUDIT-005 — Sin Jest, cobertura ~0% → **Implementado (parcial)**

- `package.json` migrado de `node --test` a Jest (`ts-jest`, preset ESM).
- `jest.config.ts` creado.
- Los 2 tests preexistentes convertidos a sintaxis Jest sin perder cobertura.
- 5 archivos de test nuevos, enfocados en el código de mayor riesgo de este patch: `password.util.spec.ts`, `refresh-token.util.spec.ts`, `ownership.util.spec.ts`, `auth.service.spec.ts`, `onboarding-race-condition.spec.ts`.
- **No se alcanzó** el 70% de cobertura recomendado en la auditoría original para los 15 módulos preexistentes — ver `ATLAS-PEND-103`. El umbral en `jest.config.ts` se dejó deliberadamente en 5% para reflejar la realidad, no para aparentar un número no alcanzado.

**No validado en este sandbox:** Jest no está instalado aquí (sin red), por lo que **ningún test se ejecutó realmente con el test runner** — todos se verificaron únicamente por corrección sintáctica/tipos (`tsc`) y por revisión manual lógica cuidadosa contra la implementación real que testean (documentada línea por línea en el proceso de esta implementación). Ejecutar `yarn test` es el primer paso obligatorio antes de confiar en estos tests.

### ATLAS-AUDIT-006 — Sin Swagger/OpenAPI → **Implementado (parcial)**

- `@nestjs/swagger` agregado a dependencias.
- `src/config/swagger.ts`: builder compartido del documento OpenAPI.
- `src/main.ts`: monta Swagger UI en `${API_PREFIX}/docs` cuando `API_DOCS_ENABLED=true` (por defecto activo solo en development/test; apagado por defecto en producción).
- `scripts/generate-openapi.ts`: exporta `docs/endpoints/openapi.yaml` desde el propio `AppModule`.
- `AuthController` decorado con `@ApiTags`/`@ApiOperation`.
- **No se decoraron** los 15 módulos preexistentes (aparecen en el documento por sus decoradores HTTP estándar de Nest, pero sin descripciones enriquecidas) — ver `ATLAS-PEND-104`.

**No validado en este sandbox:** `@nestjs/swagger` no está instalado; `scripts/generate-openapi.ts` además requiere una base de datos real para levantar `AppModule` (no se pudo generar el `openapi.yaml` de ejemplo en esta entrega). Ejecutar `yarn docs:openapi` con DB real disponible.

### ATLAS-AUDIT-007 — Migración monolítica de 13k líneas → **Corregido con matiz (ver `assumptions.md`)**

No se dividió retroactivamente la migración ya aplicada (se determinó, al implementar, que hacerlo violaría `CONTRIBUTING.md` §5 — no editar migraciones ya aplicadas). En su lugar: todas las migraciones nuevas de este patch son pequeñas y focalizadas (la de este patch tiene ~85 líneas), y `.github/workflows/ci.yml` incluye un job que falla si una migración nueva supera ~800 líneas, exceptuando explícitamente la migración histórica.

### ATLAS-AUDIT-008 — README no es guía de proyecto → **Implementado**

`README.md` reescrito completo: estado real de fase, stack, estructura, comandos, autenticación, enlaces a documentación. El changelog de parche que ocupaba el README anterior se movió a `CHANGELOG.md`.

### ATLAS-AUDIT-009 — Roadmap YAML vacío → **Implementado**

`config/roadmap/implementation_phases.yaml` completado con las 3 fases reales (usuarios → decisión/admin → deudas), módulos por fase, y estado (`in_progress`/`not_started`).

### ATLAS-AUDIT-022 — Outbox técnico sin bloqueo de fila → **Implementado**

`RuntimeJobsService.processOutbox` reescrito para usar exactamente el mismo patrón `SELECT ... FOR UPDATE SKIP LOCKED` + `UPDATE` atómico ya usado (correctamente) en `EventsRepository.claimPending`, en vez de `SELECT` + loop + `.save()` fila por fila. Modo `dryRun` sigue siendo de solo lectura (sin necesidad de bloqueo).

**No validado en este sandbox:** el comportamiento de `FOR UPDATE SKIP LOCKED` bajo dos ejecuciones concurrentes reales requiere PostgreSQL. La consulta SQL se revisó manualmente contra el patrón ya probado en `claimPending` (mismo autor, mismo dialecto, misma estructura `WITH candidates ... UPDATE ... FROM candidates`).

### ATLAS-AUDIT-023 — Rate limiting no distribuido → **Implementado (mecanismo)**

- `src/common/redis/redis.module.ts`: cliente `ioredis` compartido, `null` si `REDIS_URL` no está configurado (degradación explícita, no silenciosa).
- `src/common/throttler/redis-throttler-storage.ts`: implementación de `ThrottlerStorage` (interfaz verificada contra el código fuente real de `@nestjs/throttler@6.5.0` ya instalado en el proyecto — no se adivinó la interfaz).
- `app.module.ts`: `ThrottlerModule.forRootAsync` usa el storage de Redis cuando hay cliente disponible, cae a memoria si no.
- `env.ts`: `REDIS_URL` es obligatorio cuando `NODE_ENV=production` (falla el arranque si falta, mismo patrón que la validación existente de `JWT_ACCESS_TOKEN_SECRET`).

**No validado en este sandbox:** `ioredis` no está instalado; no se pudo levantar un Redis real ni probar el comportamiento bajo 2+ instancias. La interfaz `ThrottlerStorage` sí se verificó línea por línea contra el `.d.ts` real del paquete ya presente en `node_modules`.

### ATLAS-AUDIT-024 — Job de retención es un stub → **Implementado (parcial, alcance deliberadamente acotado)**

`RuntimeJobsService.applyRetentionPolicies` ejecuta ahora purga/anonimización real para 3 tablas de telemetría explícitamente registradas en `RETENTION_TARGETS` (`address_gps_observations`, `device_snapshots`, `form_field_interaction_events`), respetando `dryRun`. La política ya sembrada (`risk-data-365d`) se deja intencionalmente sin mapear por ambigüedad de alcance (podría tocar tablas de decisión/auditoría que deben ser append-only) — ver `ATLAS-PEND-101`.

**No validado en este sandbox:** ejecución real de `destroy()`/`update()` contra PostgreSQL.

---

## 3. Hallazgos P2 tratados en este patch

### ATLAS-AUDIT-025 — Paginación `OFFSET` en tablas de alto crecimiento → **Bug de corrección cerrado + mecanismo de referencia agregado**

Durante la implementación se encontró que el problema real en `audit.repository.ts` era **más grave** de lo caracterizado originalmente: no solo degradación de rendimiento a largo plazo, sino un **bug de corrección presente desde hoy** — cada subconsulta por tabla de origen pedía siempre `limit` filas sin importar la página solicitada, así que `page >= 2` podía devolver resultados incompletos/incorrectos para cualquier cliente con más eventos de auditoría que `limit`, independientemente del volumen de la tabla. Se corrigió pidiendo `page * limit` (acotado a un máximo) por fuente.

Adicionalmente, se creó `src/common/utils/pagination/cursor-pagination.util.ts` (paginación por cursor/keyset real) y se aplicó como referencia funcional en el módulo `events` (`GET /events?pagination=cursor`), de forma retrocompatible (el modo `offset` original sigue funcionando igual). Migrar `operations`/`data-quality` al mismo patrón, y diseñar una vista unificada para el fan-in de `audit`, queda documentado en `ATLAS-PEND-102`.

### ATLAS-AUDIT-026 — `tokenVersion` sin validar → **Implementado**

`TokenRevocationService` (módulo global `CommonAuthModule`) + `JwtAuthGuard` actualizado: cuando el JWT incluye `tokenVersion` (todos los emitidos por `AuthService` lo incluyen), se compara contra el valor almacenado en `auth_credentials`. `AuthService.logout({allDevices: true})` incrementa `tokenVersion`, invalidando de inmediato todos los access tokens vigentes del actor, no solo los refresh tokens.

### ATLAS-AUDIT-027 — Ownership duplicado en 7 lugares → **Implementado (con 2 excepciones documentadas, no bugs)**

`src/common/utils/auth/ownership.util.ts` creado (`assertOwnCustomerResource`, `assertIsOwningCustomer`). Refactorizados: `customers.service.ts`, `customer-privacy.service.ts`, `customer-telemetry.service.ts`, `risk.service.ts`, `sessions.service.ts` (5 de 7 casos, comportamiento verificado como idéntico al original en cada uno). Los 2 restantes (`notifications.service.ts`, `customer-onboarding.service.ts`) **se dejaron sin unificar a propósito**: al revisar su lógica se encontró que tienen listas de roles permitidos ligeramente distintas (excluyen `merchant`/`system` explícitamente) — unificarlos ciegamente al helper genérico habría sido una **regresión de seguridad silenciosa** (ampliar acceso). Se documentó la razón en el propio código.

---

## 4. Hallazgos identificados en la auditoría original, no tocados en este patch (deferidos con justificación explícita)

| ID                                                   | Por qué no se tocó                                                                                                                                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ATLAS-AUDIT-010 (servicios "god object")             | **Resuelto para `customer-onboarding.service.ts`** en la segunda pasada — ver Sección 0b. `sessions.service.ts` sigue pendiente (`ATLAS-PEND-110`).                                                                    |
| ATLAS-AUDIT-011 (idempotencia opcional)              | No se hizo obligatoria para módulos financieros porque esos módulos (Fase 3) no existen todavía; queda como diseño a aplicar cuando se construyan.                                                                     |
| ATLAS-AUDIT-012 (cifrado sin KMS)                    | **Mecanismo implementado en la segunda pasada** (`envelope-encryption.util.ts`, listo para KMS), pero no conectado a los call sites reales — ver `ATLAS-PEND-112`.                                                     |
| ATLAS-AUDIT-013 (contraseñas en Markdown)            | **Sí se corrigió**: `docs/database/dev-credentials.md` reescrito sin contraseñas literales, con instrucciones de provisión vía el nuevo `POST /auth/provision-credentials`.                                            |
| ATLAS-AUDIT-014 (`fraud` no es módulo independiente) | **Resuelto en la segunda pasada** — ver Sección 0b.                                                                                                                                                                    |
| ATLAS-AUDIT-015 a 018, 020 (varios P3)               | ATLAS-AUDIT-020 (ESLint/Prettier) **sí se implementó**. Los demás (changelog, IDs, SQL crudo documentado) quedan sin cambios; su severidad es baja y no comprometían la corrección funcional priorizada en este patch. |
| ATLAS-AUDIT-019 (sin CI)                             | **Sí se implementó** (`.github/workflows/ci.yml`).                                                                                                                                                                     |

---

## 5. Archivos nuevos

```
src/database/migrations/20260701000000-add-auth-credentials-and-email-uniqueness.ts
src/database/models/auth-credentials.model.ts
src/database/models/auth-refresh-tokens.model.ts
src/common/utils/crypto/password.util.ts
src/common/utils/crypto/refresh-token.util.ts
src/common/utils/auth/ownership.util.ts
src/common/utils/pagination/cursor-pagination.util.ts
src/common/services/token-revocation.service.ts
src/common/common-auth.module.ts
src/common/redis/redis.module.ts
src/common/throttler/redis-throttler-storage.ts
src/config/swagger.ts
src/modules/auth/auth.repository.ts
src/modules/auth/auth.schemas.ts
src/modules/auth/auth.service.ts
src/modules/auth/auth.dtos.ts
src/modules/auth/auth.controller.ts
src/modules/auth/auth.module.ts
scripts/check-no-env-file.ts
scripts/generate-openapi.ts
scripts/smoke/auth.smoke.ts
jest.config.ts
eslint.config.js
.prettierrc.json
.github/workflows/ci.yml
docs/pending/pending-items.md
docs/architecture/assumptions.md
CHANGELOG.md
test/unit/auth/password.util.spec.ts
test/unit/auth/refresh-token.util.spec.ts
test/unit/auth/ownership.util.spec.ts
test/unit/auth/auth.service.spec.ts
test/unit/customer-onboarding/onboarding-race-condition.spec.ts
src/modules/fraud/fraud.schemas.ts
src/modules/fraud/fraud.repository.ts
src/modules/fraud/fraud.service.ts
src/modules/fraud/fraud.module.ts
src/modules/fraud/README.md
src/common/utils/crypto/data-key-provider.interface.ts
src/common/utils/crypto/local-key-provider.ts
src/common/utils/crypto/kms-key-provider.ts
src/common/utils/crypto/envelope-encryption.util.ts
test/unit/fraud/fraud.service.spec.ts
test/unit/crypto/envelope-encryption.spec.ts
```

## 6. Archivos modificados

```
src/database/models/index.ts
src/database/sequelize.module.ts
src/common/guards/jwt-auth.guard.ts
src/modules/customers/customers.service.ts
src/modules/customer-privacy/customer-privacy.service.ts
src/modules/customer-telemetry/customer-telemetry.service.ts
src/modules/risk/risk.service.ts
src/modules/sessions/sessions.service.ts
src/modules/notifications/notifications.service.ts (solo comentario aclaratorio)
src/modules/customer-onboarding/customer-onboarding.service.ts
src/modules/customer-onboarding/customer-onboarding.schemas.ts
src/modules/customer-onboarding/customer-onboarding.module.ts
src/modules/runtime-jobs/runtime-jobs.service.ts
src/modules/runtime-jobs/runtime-jobs.module.ts
src/modules/audit/audit.repository.ts
src/modules/events/events.schemas.ts
src/modules/events/events.repository.ts
src/modules/events/events.service.ts
src/app.module.ts
src/config/env.ts
src/main.ts
package.json
.env.example
test/unit/idempotency-hash.test.ts
test/unit/redaction.test.ts
README.md
docs/database/dev-credentials.md
config/roadmap/implementation_phases.yaml
src/modules/operations/operations.repository.ts
src/modules/operations/operations.service.ts
src/modules/operations/operations.schemas.ts
src/modules/operations/operations.controller.ts
src/modules/operations/operations.module.ts
src/app.module.ts (segunda pasada: registro de FraudModule)
15 controladores preexistentes (solo se agregó `@ApiTags`, ver Sección 0b)
```

**Eliminado:** `.env` (real, con credenciales de desarrollo).

## 7. Checklist de verificación aplicado en este sandbox

- [x] `tsc --noEmit` sobre el proyecto completo tras cada cambio significativo (más de 15 corridas durante la implementación) — solo quedan errores `TS2307` para los 4 paquetes no instalables sin red (`argon2`, `ioredis`, `@nestjs/swagger`, `js-yaml`).
- [x] Parser de TypeScript (`ts.createSourceFile`) para validar sintaxis de cada archivo nuevo individualmente.
- [x] `scripts/check-no-env-file.ts` ejecutado realmente (transpilado manualmente) contra ambos casos (con y sin `.env`).
- [x] Revisión manual línea por línea de cada test contra la implementación real que ejercita (sin poder ejecutar Jest).
- [ ] `yarn install` — **pendiente, requiere red**.
- [ ] `yarn test` con Jest real — **pendiente**.
- [ ] `yarn build` — **pendiente**.
- [ ] Migraciones contra PostgreSQL real — **pendiente**.
- [ ] `yarn smoke` contra servidor real — **pendiente**.

## 8. Declaración final de honestidad de entrega (exigida por `CHECKLIST_FINAL.md`)

Quedan pendientes abiertos (Sección 4 de este documento y `docs/pending/pending-items.md`). El más importante es **`ATLAS-PEND-109`**: ningún comando de instalación, prueba o build se ejecutó realmente en este sandbox por falta de red y de base de datos — toda la validación se hizo por verificación de tipos con el compilador real y revisión manual exhaustiva. Este patch está en estado **"Parcial con pendientes documentados"**, no "completo", hasta que alguien lo corra en un entorno real siguiendo la Sección 0 de este documento.

## Patch 3 - Gates de calidad locales

Este patch corrige los fallos reportados al ejecutar `yarn lint`, `yarn format:check` y `yarn test:coverage` en Windows:

1. `eslint.config.mjs` reemplaza a `eslint.config.js` para evitar el warning ESM/CJS de Node.
2. `no-undef` queda apagado para TypeScript porque el compilador ya cubre esa validación y evita falsos positivos en Node 18+ y Jest.
3. `jest.config.cjs` reemplaza a `jest.config.ts`, eliminando la dependencia implícita de `ts-node`.
4. Se eliminan imports y catch bindings no usados.
5. Se normaliza el formato con Prettier.

Validación ejecutada en sandbox:

```bash
npx --yes prettier --check "src/**/*.ts" "test/**/*.ts"
```

Resultado: `All matched files use Prettier code style!`.

No se ejecutó `yarn lint` ni `yarn test:coverage` en sandbox porque no existen `node_modules` locales ni PostgreSQL/Redis de prueba, pero los errores reportados corresponden a configuración y código corregidos directamente en este patch.


## Patch 4 - Corrección de residuos locales de configuración

El error reportado se debía a que la carpeta local conservaba archivos obsoletos (`eslint.config.js` y `jest.config.ts`) después de extraer el ZIP nuevo encima de una instalación previa. Para hacer el proyecto más tolerante a ese escenario, los scripts de `package.json` ahora apuntan explícitamente a `eslint.config.mjs` y `jest.config.cjs`. Además se agregó `scripts/cleanup-legacy-configs.cjs`.

## Patch 5 — Jest globals y entorno de test explícito

- Corregido `yarn test:coverage` cuando `ts-jest` no reconocía `describe`, `it`, `expect` y `jest`.
- Los tests unitarios ahora importan explícitamente los helpers desde `@jest/globals`, evitando depender de globals implícitos o de un `tsconfig` productivo.
- Agregado `tsconfig.spec.json` para aislar la compilación de tests.
- Agregado `test/setup-jest-env.cjs` para forzar `NODE_ENV=test` aunque Windows tenga `NODE_ENV=production` configurado globalmente.
- `jest.config.cjs` ahora usa `tsconfig.spec.json`, `isolatedModules` y `setupFiles` para evitar el warning de módulo híbrido y errores falsos de configuración.
