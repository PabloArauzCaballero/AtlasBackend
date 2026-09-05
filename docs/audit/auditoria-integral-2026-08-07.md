# Auditoría integral del backend — 2026-08-07

Revisión estricta de todo el backend Atlas. Método: lectura de código con evidencia `archivo:línea`
más la ejecución real de los gates del repositorio. No se ejecutó nada contra una base de datos
real, contra Redis ni contra producción: todo lo relativo a latencia, volumen o comportamiento bajo
carga queda marcado como **no verificado**.

**Estado del árbol.** La revisión empezó sobre `chore/jest-30-migration` (`cdf75af`) y, a mitad de
pasada, el árbol de trabajo se movió a `dev` al integrarse
`audit/backend-integral-20260806-1204` (`3de1416`) y `7cc0182` — 38 archivos de `src/` cambiaron.
**Todas las citas `archivo:línea` de este informe fueron re-verificadas una a una contra `7cc0182`**,
que es el estado que describe. Esa re-verificación retiró un hallazgo: ver §2 bis.

Precedencia aplicada (CLAUDE.md): `docs/audit/` vigente > código y pruebas > docs de `docs/`.
Auditorías previas consultadas: `auditoria-integral-2026-08-06.md` (la más reciente),
`remediacion-integral-2026-08-06.md`, `hardening-resiliencia-2026-08-05.md` y
`auditoria-integral-2026-07-30.md`. No se encontró contradicción entre lo que documentan y lo que
hace el código hoy.

**Relación con la auditoría del 2026-08-06.** Los nueve hallazgos de esta pasada son **nuevos**: no
hay solapamiento con `DEP-001`, `SEC-006`, `ORP-001/2/3`, `FMT-001`, `DATA-003`, `DOC-001/2` ni con
los heredados de la bóveda (`SEC-002`, `U-006`, `U-008`, `U-009`), que siguen como los dejó ese
informe. La diferencia de enfoque lo explica: aquella pasada recorrió dependencias, huérfanos,
documentación y la ejecución de los gates; esta recorrió las rutas de ejecución (autorización
efectiva por endpoint, caminos destructivos, degradación de controles de seguridad, transaccionalidad
y disparadores de CI). El único punto de contacto es `TEST-001`, para el que esta auditoría aporta
evidencia nueva — ver **B-05**.

Inventario: 686 archivos TypeScript en `src/` (≈103.400 líneas), 28 módulos de negocio, 42
controladores, 250 rutas / 261 operaciones OpenAPI, 309 suites de prueba. Stack: NestJS 11,
Sequelize 6 sobre PostgreSQL, Redis (ioredis), Zod 4, OpenTelemetry, prom-client, argon2,
jsonwebtoken, AWS KMS.

---

## 1. Resumen por área

| Área | Estado | Hallazgos abiertos |
| --- | --- | --- |
| Autenticación / sesiones | Sólido (lockout, rotación, revocación por `tokenVersion`, cookies HttpOnly, 2FA interno fail-closed en producción) | M-01 |
| Autorización / multitenencia | Sólido (guards en los 42 controladores, ownership centralizado, `TenantGuard`) | — |
| Inyección (SQL / NoSQL / SSRF) | Sólido (parametrización, allowlist DNS, `escapeRegex`) | — |
| Validación de entrada | Sólido (Zod en todo endpoint, límites de payload) | B-03 |
| Correctitud / concurrencia | Sólido (sin promesas huérfanas alcanzables, guards de reentrada) | M-03 |
| Integridad de datos | Un camino destructivo ante entrada vacía | **A-01**, M-02, M-03 |
| Observabilidad | Muy sólido (JSON estructurado, redacción en ambos canales, correlación, RED, OTel) | — |
| Rendimiento (estático) | Sólido (pool acotado, timeouts de sentencia, cursor keyset) | M-03, B-03 |
| Resiliencia | Muy sólido (retry+jitter+breaker, dead-letter, drenado) | M-04 |
| Pruebas | 2.601 pruebas verdes; cobertura desigual en un módulo crítico | M-05, B-01, B-05 |
| CI / despliegue | Batería de gates excelente… que no corre en la rama donde se integra | **A-02**, B-02 |

**Gates ejecutados en esta auditoría** (todos con código de salida capturado):

| Gate | Resultado |
| --- | --- |
| `yarn type-check` | ✅ exit 0 |
| `yarn type-check:tests` | ✅ exit 0 (con el `tsc` local 5.9.3 — ver B-02) |
| `yarn lint` | ✅ exit 0 |
| `yarn format:check` | ✅ exit 0 |
| `yarn build` | ✅ exit 0 |
| `yarn test:unit` | ✅ exit 0 — 298 suites / 2.601 pruebas, 346 s (ver B-01) |
| `jest --coverage` (sin umbrales, para medir) | ✅ exit 0 — total 85,54 % sentencias / 69,74 % ramas / 78,57 % funciones / 86,12 % líneas |
| `check:overfetching`, `check:domain-schemas`, `check:file-size`, `check:migrations`, `check:tenant-header`, `check:read-api-views`, `check:env-example`, `check:no-env-file`, `check:seed-profiles`, `check:domain-schema-layout`, `check:entity-narratives`, `check:smoke-results-untracked` | ✅ 12/12 exit 0 |
| `check:retention-coverage` | ✅ exit 0 (8 políticas: 3 ejecutables, 8 con decisión declarada, 0 en silencio) |
| `check:openapi` | ✅ exit 0 (250 rutas / 261 operaciones; 133 sin descripción larga — ver B-04) |

No ejecutados (requieren infraestructura real, fuera del alcance permitido de esta skill):
`db:migration:up/down`, seeders, `check:db-privileges`, los `smoke:*`, `yarn audit`, CodeQL,
gitleaks.

---

## 2. Hallazgos

### A-01 · Alta · El descubrimiento de endpoints marca TODO el catálogo como obsoleto cuando corre en producción

**Evidencia.**
- `src/modules/systems-ops/endpoint-discovery.service.ts:186-188` — `scanControllers()` resuelve
  `join(process.cwd(), 'src', 'modules')` y, si el directorio no existe, `return []` **en silencio**
  (sin log, sin error, sin métrica).
- `Dockerfile:79` y `Dockerfile:83` — la etapa `runtime` copia únicamente `dist/` y `src/database`.
  `src/modules` **no viaja en la imagen de producción**, por diseño (el comentario del Dockerfile
  explica que solo el árbol de base de datos se necesita para correr migraciones con `tsx`).
- `src/modules/systems-ops/endpoint-discovery.service.ts:181-182` — con `items = []`, `activeKeys`
  queda vacío y aun así se invoca `markDeprecatedCandidates(activeKeys)`.
- `src/modules/systems-ops/systems-catalog.repository.ts:163-174` — selecciona todos los endpoints
  con `status='ACTIVE'` y `reviewStatus != 'APPROVED'`, los cruza contra un set vacío (ninguno
  sobrevive) y ejecuta **un solo** `UPDATE ... SET status='DEPRECATED_CANDIDATE' WHERE id IN (...)`.
- `src/modules/systems-ops/systems-ops.schemas.ts:266` — `persist: z.coerce.boolean().default(true)`:
  el modo destructivo es el **valor por defecto**.
- Segundo camino de entrada: `src/modules/systems-ops/systems-catalog-seed.service.ts:113` llama
  `discoverAndMaybePersist(true)` desde `POST /systems/endpoints/catalog-seed/refresh`.

**Fallo.** Un `system_admin`/`platform_admin` que invoque `POST /systems/endpoints/discover` (o el
refresco del seed) contra producción no descubre nada — porque el fuente no está ahí — y con ese
resultado vacío degrada todo el catálogo de endpoints no aprobados a `DEPRECATED_CANDIDATE` en una
sola sentencia. La respuesta (`{discovered: 0, persisted: 0, deprecatedCandidates: N}`) lo reporta,
pero nada lo impide ni lo advierte antes de escribir. Es el patrón clásico de "entrada vacía →
escritura destructiva": falta la guarda de que un escaneo que no encontró **ningún** controlador es
un escaneo fallido, no un catálogo vacío legítimo.

**Por qué no lo detectan las pruebas.** `test/unit/systems-ops-endpoint-discovery-security.spec.ts:10`
y `:22` invocan `scanControllers()` de verdad desde la raíz del repo, donde `src/modules` sí existe.
La condición de producción (fuente ausente) no está cubierta por ninguna prueba.

**Impacto.** Corrupción del catálogo de gobernanza sobre el que operan la cola de revisión, la
matriz de impacto de datos y las suites de prueba de systems-ops. Es reversible (cambio de estado,
no borrado), pero es silencioso y requiere reconstrucción manual o un reseed.

**Recomendación.** En `discoverAndMaybePersist`, abortar antes de persistir si el escaneo devolvió
cero elementos: lanzar un error explícito (`SYSTEMS_SOURCE_TREE_NOT_AVAILABLE`) en vez de continuar.
Complementariamente, que `scanControllers` logue en `warn` cuando el directorio no existe, en vez de
devolver `[]` mudo. La alternativa de fondo —descubrir desde el `DiscoveryService` de Nest en vez de
leer el fuente— resolvería la causa raíz, pero es un cambio mayor: la guarda de "cero resultados no
persiste" cierra el riesgo hoy.

---

### A-02 · Alta · La batería completa de CI no corre en `dev`, que es la rama donde se integra

**Evidencia.**
- `.github/workflows/ci.yml:7-11` — `on: push: branches: [main]` y `pull_request: branches: [main]`.
- `git log --merges`: `38455c1`, `6b2e434`, `46b13f7`, `12bacfc` — las cuatro fusiones más recientes
  son `... into dev`. La rama activa del repositorio es `dev`; `main` recibe promociones posteriores.

**Fallo.** Los ocho jobs del workflow (gates estáticos, type-check, lint, format, pruebas unitarias
aleatorizadas, cobertura, build, integración con Postgres/Redis reales, imagen Docker,
`yarn audit`, CodeQL, gitleaks, SBOM) solo se disparan contra `main`. Todo el trabajo que se fusiona
a `dev` —que es todo el trabajo— entra sin que ninguno de esos gates lo haya visto. La calidad del
pipeline es excelente y por eso mismo el hueco duele: lo que protege no cubre el punto donde entran
los cambios.

**Impacto.** Un CVE `high`, un secreto filtrado, una regresión de tipos en tests o una migración
irreversible pueden vivir en `dev` durante días y solo detectarse al promover a `main`, cuando ya
están mezclados con otros cambios. Anula, en la práctica, el propósito de `dependency-audit`,
`secret-scan`, `codeql` y `db-and-cache-integration`.

**Recomendación.** Añadir `dev` a ambos disparadores (`push` y `pull_request`). Si el costo de correr
la batería completa en cada push a `dev` preocupa, dividir: gates rápidos (lint, type-check,
unit, secret-scan) en `push`/`pull_request` sobre `dev`, y los jobs caros (integración, Docker,
CodeQL, SBOM) solo en `pull_request`.

---

### M-01 · Media · El login de usuarios internos no lleva `@Throttle` estricto; el de clientes sí

**Evidencia.**
- `src/modules/internal-users/internal-auth.controller.ts:86-91` (`POST login`), `:113-123`
  (`POST login/pin`), `:139-144` (`POST refresh`), `:160-164` (`POST logout`): los cuatro son
  `@Public()` y **ninguno** declara `@Throttle`. Caen en el límite global
  (`API_RATE_LIMIT_MAX=100` / 60 s, `src/config/env.schema.ts:95-96`).
- Contraste: `src/modules/auth/auth.controller.ts:52` (login, 10/min), `:89` (PIN, 10/min), `:113`
  (reset, 5/min), `:143` (confirmación, 5/min), `:175` (refresh, 30/min).
- La regla del propio proyecto, `.claude/rules/30-security.md`: «`@Throttle` estricto en endpoints
  públicos de auth (login, password-reset, refresh)».

**Fallo.** El endpoint de autenticación de los actores **más privilegiados** admite 10× más intentos
por IP que el de los clientes. Mitigan parcialmente el bloqueo de cuenta en base de datos
(`auth.service.ts:160-173`, `AUTH_MAX_FAILED_LOGIN_ATTEMPTS` + `AUTH_LOCKOUT_MINUTES`, compartido
porque `InternalAuthService.login` delega en `AuthService.login`,
`internal-auth.service.ts:37-42`) y el tope de intentos del PIN. Pero el bloqueo es **por cuenta** y
el throttle es **por IP**: no cubre el credential stuffing repartido entre muchas cuentas, ni el
coste de CPU de 100 verificaciones argon2 por minuto y por IP, que es un vector de agotamiento de
recursos por diseño del algoritmo.

**Impacto.** Superficie de fuerza bruta distribuida y de agotamiento de CPU sobre el panel interno.

**Recomendación.** Replicar los valores de `auth.controller.ts` en los cuatro endpoints públicos de
`internal-auth.controller.ts` (10/min en login y PIN, 30/min en refresh).

---

### M-02 · Media · La clave de idempotencia no incluye al actor: replay y bloqueo cruzados dentro del mismo tenant

**Evidencia.**
- `src/modules/runtime-hardening/runtime-hardening.service.ts:53` — la búsqueda es
  `{ tenantScope, scope, idempotencyKey }`. El `actorId`/`actorType` se **guardan** (`:63-64`) pero
  no participan de la identidad del registro.
- `src/database/migrations/20260629170000-add-runtime-hardening-tables.ts:29` — el índice único es
  `['tenant_scope', 'scope', 'idempotency_key']`.
- `src/modules/runtime-hardening/runtime-hardening.service.ts:27-32` — `claimExisting` compara solo
  `requestHash`: si coincide y el estado es `completed`, devuelve `mode: 'replay'` con el
  `responseBodyJson` **del primer actor**.
- `src/modules/runtime-hardening/idempotency.interceptor.ts:26-28` — en endpoints `@Public()`,
  `tenantScope` cae al header `x-tenant-id` o a `'global'`, y `actorId` es `null`: el espacio de
  claves queda completamente bajo control del cliente.

**Fallo.** Dos consecuencias, ambas dentro del mismo tenant y la misma ruta:
1. **Replay cruzado.** Si el `requestHash` coincide (cuerpo, query y params idénticos), el segundo
   actor recibe la respuesta almacenada del primero. Los tokens quedan cubiertos porque
   `completeIdempotency` (`:93`) pasa el cuerpo por `redactSensitiveObject` y `token` está en
   `SENSITIVE_KEY_PATTERN` (`src/common/utils/privacy/redaction.util.ts`), pero el resto del cuerpo
   —identificadores de recurso, estados, montos— se devuelve tal cual.
2. **Bloqueo cruzado.** Un actor puede reclamar por adelantado una clave de otro y provocarle un
   `IDEMPOTENCY_CONFLICT` (409) o un `IDEMPOTENCY_REQUEST_IN_PROGRESS` durante los 5 minutos del
   `lockedUntil` (`:71`).

La explotabilidad real depende de que la clave sea adivinable: con UUIDv4 el riesgo es bajo, pero el
contrato no obliga a nada y un cliente que use claves determinísticas (`pedido-123`) lo vuelve
trivial. Las rutas con `:customerId` en la URL están protegidas de hecho, porque el `scope` incluye
`originalUrl`; las rutas que derivan el actor del token, no.

**Impacto.** Divulgación acotada entre actores y denegación de servicio dirigida sobre mutaciones
idempotentes.

**Recomendación.** Incluir `actor_type` y `actor_id` en el índice único y en el `where` de
`claimIdempotency`. Es una migración de índice más un cambio de dos líneas; conserva la semántica de
idempotencia (el mismo actor reintentando) y elimina ambas rutas de abuso.

---

### M-03 · Media · `upsertPreferences`: hasta 200 consultas secuenciales y escritura parcial sin transacción

**Evidencia.**
- `src/modules/notifications/notification-preferences.repository.ts:34-58` — bucle
  `for (const preference of body.preferences)` con un `findOne` por elemento (`:36-38`) más un
  `save()` o un `create()` por elemento, **sin `transaction`**.
- `src/modules/notifications/notifications.schemas.ts:95-96` — el arreglo admite hasta **100**
  elementos.
- `src/modules/notifications/notification-preferences.repository.ts:40` — en medio del bucle se lanza
  `BadRequestException('REQUIRED_NOTIFICATION_CANNOT_BE_DISABLED')`.

**Fallo.** Dos problemas en el mismo bloque:
1. **N+1.** Hasta 200 viajes secuenciales a PostgreSQL en una sola petición HTTP, cuando el conjunto
   completo se puede leer con un `findAll` y resolver con un `bulkCreate` con `updateOnDuplicate`.
2. **Escritura parcial.** La excepción de validación de la línea 40 es un camino **normal y
   alcanzable**, no un fallo excepcional: si la preferencia número 5 es una obligatoria que el
   cliente intenta desactivar, las cuatro anteriores **ya están comprometidas** en base de datos. El
   cliente recibe un 400 y asume que nada cambió; el estado dice otra cosa. Contradice la regla del
   proyecto sobre persistencia transaccional en flujos multi-escritura.

**Impacto.** Estado de preferencias inconsistente tras un 400, y latencia proporcional al tamaño del
lote. Riesgo de rendimiento **no medido** (sin baseline contra base real).

**Recomendación.** Envolver el bucle en una transacción y validar **todas** las preferencias contra
el estado actual (leído con un solo `findAll`) **antes** de escribir cualquiera. El N+1 se resuelve
en el mismo cambio.

---

### M-04 · Media · La caída de Redis desactiva por completo el rate limiting, sin repliegue ni métrica

**Evidencia.**
- `src/common/throttler/redis-throttler-storage.ts:90-99` — el `catch` devuelve
  `{ totalHits: 1, isBlocked: false }`, es decir, permite el request.
- `:54-64` — la rama sin cliente Redis hace lo mismo.
- La degradación se registra con `logger.error` pero **no** emite ninguna métrica Prometheus, pese a
  que el proyecto tiene `MetricsService` y series propias para otros eventos operativos.

**Fallo.** Es una decisión deliberada y documentada (una caída de Redis no debe tumbar la API), y la
elección de disponibilidad es defendible. Lo que no está resuelto es que la degradación sea
**total**: durante la incidencia desaparece también el throttle de `POST /auth/login` y del resto de
endpoints públicos, justo cuando el sistema está en su momento más frágil. `@nestjs/throttler` trae
un almacenamiento en memoria que seguiría protegiendo por instancia; hoy no se usa como repliegue.

**Impacto.** Ventana sin ningún límite de tasa durante cada incidencia de Redis. Mitiga —solo en
fuerza bruta por cuenta— el bloqueo en base de datos de `auth.service.ts:160-173`.

**Recomendación.** Repliegue a la implementación en memoria de `@nestjs/throttler` cuando Redis
falle (protección por instancia en vez de ninguna), y una métrica
(`atlas_rate_limit_degraded_total`) para que la ventana sea alertable y no solo visible en el log.

---

### M-05 · Media · `customer-onboarding` (KYC) es el módulo crítico con menor cobertura y no tiene trinquete reforzado

**Evidencia.** Cobertura por módulo, agregada desde el `coverage/coverage-summary.json` generado por
la corrida propia de esta auditoría (298 suites / 2.601 pruebas, umbrales desactivados para poder
medir sin que el gate abortara):

| Módulo | Sentencias | Ramas | Funciones |
| --- | --- | --- | --- |
| `modules/risk` | 98,3 % | 86,2 % | 100 % |
| `modules/fraud` | 97,3 % | 82,5 % | 100 % |
| `modules/credit` | 96,6 % | 73,3 % | 89,4 % |
| `modules/auth` | 96,5 % | 77,7 % | 94,0 % |
| `modules/customer-privacy` | 100 % | 79,6 % | 100 % |
| `modules/systems-ops` | 80,5 % | 69,6 % | 83,0 % |
| `common/guards` | 80,2 % | 66,7 % | 88,9 % |
| **`modules/customer-onboarding`** | **68,5 %** | **51,2 %** | **54,1 %** |
| *(total)* | 85,5 % | 69,7 % | 78,6 % |

- `jest.config.cjs:70-79` — los umbrales reforzados cubren `auth`, `risk`, `fraud` y
  `common/utils/crypto`. `customer-onboarding` **no** figura, así que solo le aplica el umbral
  `global` (83/67/77/83), que ya supera con holgura gracias al resto del backend.

**Fallo.** El módulo con casi la mitad de sus ramas sin ejercitar es el de onboarding KYC: el camino
de verificación de identidad, perfil declarado y estado del cliente. Es el más sensible desde el
punto de vista de cumplimiento y el único crítico sin trinquete propio, de modo que su cobertura
puede seguir bajando sin romper ningún gate.

**Impacto.** Regresiones no detectadas en el flujo de admisión de clientes.

**Recomendación.** Añadir `./src/modules/customer-onboarding/` al `coverageThreshold` calibrado al
valor medido de hoy (como marca `.claude/rules/60-testing.md`: al valor real, no aspiracional) para
congelar la deuda, y subirlo a medida que se cubran las ramas de verificación de identidad.

---

### B-01 · Baja · La suite unitaria deja procesos sin cerrar

**Evidencia.** `A worker process has failed to exit gracefully and has been force exited. This is
likely caused by tests leaking due to improper teardown.` — reproducido en **las dos** corridas de
esta auditoría (`yarn test:unit` y la corrida con cobertura), ambas con la suite completa en verde
(298 suites / 2.601 pruebas). No es intermitente.

**Fallo.** `.claude/rules/60-testing.md` lo declara explícitamente: «Un "worker failed to exit
gracefully" es un bug de teardown a corregir». Es además un riesgo de flakiness y de consumo de
memoria en CI, especialmente en el job de cobertura, que ya corre con `maxWorkers: 1` por un flake
de fusión de mapas de cobertura (`jest.config.cjs:7-13`).

**Recomendación.** `yarn test:unit -- --detectOpenHandles` para localizar el recurso y cerrarlo en
`afterAll`/`onModuleDestroy`. Los candidatos por los rastros de la corrida son el cliente de Redis
del throttler, el monitor de salud de systems-ops y el temporizador de log-sync.

---

### B-02 · Baja · `tsconfig.spec.json` usa una resolución de módulos ya removida en TypeScript ≥ 6

**Evidencia.**
- `tsconfig.spec.json:5` — `"moduleResolution": "Node"` (alias de `node10`).
- `tsconfig.json:3-4` — el proyecto principal usa `NodeNext`.
- Reproducido: con el `tsc` local (5.9.3) el gate pasa (exit 0); con un `tsc` 7.0.2 la misma
  configuración falla con `error TS5108: Option 'moduleResolution=node10' has been removed`.

**Fallo.** No es un defecto hoy —el gate está verde con la versión fijada—, pero deja
`type-check:tests` como el único punto del repositorio que se rompe con el próximo salto mayor de
TypeScript. En una rama cuyo propósito es precisamente migrar herramientas de desarrollo, conviene
cerrarlo ahora.

**Recomendación.** Alinear `tsconfig.spec.json` con `bundler` o `node16`, verificando que ts-jest
sigue emitiendo CommonJS como espera `jest.config.cjs:1-6`.

---

### B-03 · Baja · Un esquema de paginación admite 10.000 filas frente al patrón de 100 del resto

**Evidencia.** `src/modules/external-data/external-data.schemas.ts:239` —
`limit: z.coerce.number().int().positive().max(10000).default(5000)` en
`idempotencyAuditQuerySchema`, consumido por `GET /external-data/idempotency-audit`
(`external-data.controller.ts:396-406`). El resto del backend usa `max(100).default(20)` de forma
consistente, y el máximo siguiente más alto es `max(500)`.

**Fallo.** Una sola petición puede materializar 10.000 filas de auditoría en memoria y en la
respuesta JSON. Riesgo **no medido**: no hay baseline del tamaño real de la tabla ni de la latencia.
Es un endpoint de rol interno, lo que acota el alcance.

**Recomendación.** Bajar a `max(500)` y, si el caso de uso es la exportación completa, resolverlo con
el cursor keyset que el proyecto ya tiene (`src/common/utils/pagination/cursor-pagination.util.ts`).

---

### B-04 · Baja · 133 operaciones OpenAPI sin descripción larga

**Evidencia.** Salida de `yarn check:openapi`: «⚠️ 133 operación(es) con summary pero sin description
larga», sobre 261 operaciones. El gate pasa (es advertencia, no error).

**Recomendación.** Es deuda de documentación, no de código. Vale la pena fijarla como trinquete
(igual que `check:tenant-header` y `check:file-size`) para que el número no crezca.

---

### B-05 · Baja · `TEST-001`: la primera corrida de la sesión ejecuta menos suites de las que descubre

**Evidencia.** Tres corridas de la suite unitaria sobre el **mismo** árbol de trabajo y el mismo
commit, en esta auditoría:

| # | Invocación | Suites | Pruebas | Tiempo |
| --- | --- | --- | --- | --- |
| 1 (primera de la sesión) | `yarn test:unit` | **293** | **2.531** | 437 s |
| 2 | `jest … --coverage` | 298 | 2.601 | 346 s |
| 3 | `jest …` | 298 | 2.601 | 194 s |

Descubrimiento declarado por el propio Jest:
`jest --config jest.config.cjs --testPathPatterns=test/unit --listTests` → **298** archivos
(296 `*.spec.ts` + 2 `*.test.ts`). Es decir, la corrida 1 **ejecutó 5 suites menos de las que Jest
sabe que existen**, y las reportó como `293 passed, 293 total`: no aparecen como omitidas ni como
fallidas, simplemente no están en el recuento.

**Relación con `TEST-001`.** `auditoria-integral-2026-08-06.md:139-151` registra la misma anomalía
sin causa: «El baseline reportó **2531** pruebas en 293 suites; todas las corridas posteriores
reportan **2535** en los mismos 293 suites». La corrida 1 de hoy reprodujo **exactamente los mismos
números del baseline** (293 suites / 2.531 pruebas), y las posteriores se estabilizaron en un valor
mayor. El patrón es el mismo —primera corrida baja, posteriores estables y más altas— y esta pasada
añade el dato que faltaba: **la discrepancia está en el descubrimiento de archivos, no en el conteo
de casos dentro de ellos**, porque varía el número de *suites*, no solo el de pruebas.

La hipótesis más consistente con ese patrón es la caché de Jest (`haste map`): la primera corrida
tras cambiar de rama o de árbol reutiliza un crawl de ficheros desactualizado. **No la doy por
confirmada** —no la aislé con un experimento controlado— y por eso este hallazgo describe la
evidencia, no una causa probada.

**Impacto.** El gate de pruebas puede pasar sin haber ejecutado parte de la suite, y nada en su
salida lo delata. Es un gate que reporta verde sobre un subconjunto desconocido.

**Recomendación.** Dos medidas, ambas baratas y ambas útiles aunque la hipótesis de la caché sea
falsa:
1. Correr Jest con `--ci` en CI (desactiva escrituras oportunistas de caché y hace la corrida más
   determinista).
2. Añadir al pipeline una aserción explícita: comparar la salida de `--listTests` con el número de
   suites ejecutadas y fallar si difieren. Convierte un silencio en una señal, que es lo que el
   propio proyecto ya hace con el watchdog de trabajos de fondo.

---

## 2 bis. Hallazgo retirado tras re-verificar contra `7cc0182`

**`A-03` — «el 2FA obligatorio de los actores internos falla ABIERTO si no hay correo
configurado». RETIRADO: ya está corregido.**

Se detectó leyendo `src/modules/auth/auth.service.ts` en el estado anterior del árbol, donde
`isSecondFactorRequired` devolvía `false` sin más si MailSender no estaba habilitado, sin ninguna
restricción por entorno. En `7cc0182` ese código ya no existe con esa forma y el control está
cerrado por dos lados:

- `src/config/env-cross-checks.ts:129-151` (`checkInternalSecondFactor`, ATLAS-SEC-008) — en
  `NODE_ENV=production` el arranque **falla** si falta `MAILSENDER_BASE_URL` o si
  `AUTH_LOGIN_PIN_ENABLED=false`. El comentario que lo acompaña (`:124-125`) razona exactamente el
  punto: «una advertencia sobre un control de seguridad ausente es un control ausente».
- `src/modules/auth/auth-second-factor.service.ts:76-83` (`assertDeliverable`) — defensa en
  profundidad en el propio flujo de login: en producción, si el canal del segundo factor no está
  disponible para un actor interno, se lanza `ServiceUnavailableException` en vez de emitir tokens
  de un solo factor.

Es decir: la corrección es más completa que la recomendación que este informe iba a emitir (falla al
arrancar **y** falla en el login, en vez de solo lo primero). Se documenta el hallazgo retirado en
lugar de borrarlo en silencio, porque la trazabilidad de qué se miró importa tanto como el
resultado. La evidencia en vivo de la explotabilidad previa está en
`docs/audit/evidence/live-exploit-2026-08-06.md`, referenciada desde el propio `env-cross-checks.ts:122`.

---

## 3. Aspectos positivos verificados

No son cortesías: son controles que se buscaron activamente y se encontraron correctos.

- **Guards en los 42 controladores.** Los 8 que no declaran `@UseGuards` directamente lo hacen vía
  `@SystemsOpsControllerSecurity()` (`src/modules/systems-ops/systems-controller.decorators.ts:13-20`),
  que compone `UseGuards(JwtAuthGuard, RolesGuard)` **más** `@Roles(...SYSTEMS_OPS_ROLES)` a nivel de
  clase. Las dos excepciones reales son `/metrics` (con `@SkipThrottle` y nota de aislamiento de red)
  y `/health` (`@Public()` por diseño).
- **Ausencia de `TenantGuard` donde falta es deliberada y correcta.** Se verificó uno a uno: los
  controladores sin él (systems-ops, internal-users, schema-management, workflow-catalog,
  internal-portal, mongo-logs) **no leen `x-tenant-id`**. El razonamiento está escrito en
  `workflow-catalog.controller.ts:30-32`.
- **Inyección cerrada en los tres frentes.** SQL crudo solo por `ReadQueryService` con
  `replacements` y una guarda que rechaza todo lo que no sea `SELECT`/`WITH`
  (`src/common/database/read-query.service.ts:46-51`); Mongo con `escapeRegex`
  (`mongo-logs-query.service.ts:29`); SSRF con allowlist de host por entorno, rechazo de
  credenciales en la URL, verificación de que el DNS no resuelva a rangos privados o de metadatos y
  `redirect: 'manual'` (`systems-test-url-policy.util.ts:38-64`,
  `systems-test-http-client.service.ts:31-42`).
- **No hay promesas huérfanas alcanzables.** Se auditaron los cinco `void x()` sin `.catch()`:
  `JobTickGuard.run` nunca lanza por contrato explícito (`job-tick-guard.ts:94-102`) y
  `acquireLeadership` captura su propio fallo de Redis
  (`runtime-jobs-scheduler.service.ts:209-215`); los de log-sync y el monitor de salud capturan
  dentro. Los handlers globales de `unhandledRejection`/`uncaughtException` existen en ambos
  entrypoints (`main.ts:94-104`, `worker.ts:100-104`).
- **Redacción de PII en los dos canales.** `AppFileLogger` aplica `redactSensitiveText` tanto al
  archivo como a stdout, y el filtro global recorta los valores de la query string conservando los
  nombres (`http-exception.filter.ts:106-119`) y nunca registra el SQL (`:50-54`).
- **Idempotencia HTTP con persistencia previa a la respuesta.** El interceptor espera a
  `completeIdempotency` antes de emitir el cuerpo, con la carrera del índice único cubierta
  (`runtime-hardening.service.ts:77-86`).
- **Pool de PostgreSQL con techo real:** `statement_timeout` e
  `idle_in_transaction_session_timeout` a nivel de sesión (`src/config/database.config.ts:16-31`).
- **Readiness que no se autoflagela:** el pool de lectura se reporta pero no decide el readiness,
  con el razonamiento escrito (`health.controller.ts:145-151`), y el drenado se comprueba primero,
  sin tocar dependencias.
- **Batería de gates de una madurez poco común:** 14 gates estáticos propios, migración up→down→up
  contra Postgres real, matriz de privilegios como `app_rw`/`app_ro`, smokes de contrato con
  autenticación real, CodeQL, gitleaks y SBOM. El problema es dónde se dispara (A-02), no qué
  contiene.

---

## 4. No verificado

- Latencia, throughput y comportamiento bajo carga: no se ejecutó nada contra Postgres, Redis ni
  Mongo reales. Los hallazgos de rendimiento (M-03, B-03) son **riesgos sin baseline**, no cuellos
  de botella confirmados.
- `yarn audit`, CodeQL y gitleaks: no ejecutados en esta pasada (corren en CI, con la salvedad de
  A-02). El estado de CVEs de dependencias queda **sin verificar** en esta auditoría.
- Migraciones y seeders: no se ejecutaron (prohibido por la skill sin base de datos real). El gate
  estático `check:migrations` sí pasó.
- Los `smoke:*` y `test:e2e`: requieren la API levantada contra infraestructura real.
- Configuración efectiva de producción (variables reales, KMS, red de `/metrics`): no accesible
  desde el repositorio.
- El gate `yarn test:coverage` **con** sus umbrales no se ejecutó tal cual: la medición de §M-05 se
  obtuvo corriendo Jest con `--coverageThreshold '{}'` para poder leer las cifras reales por módulo.
  Los umbrales configurados en `jest.config.cjs:66-79` quedan, por tanto, **sin verificar** en esta
  pasada (las cifras medidas los superan, pero el gate en sí no se corrió).

---

## 5. Top priorizado

| # | Hallazgo | Severidad | Esfuerzo | Por qué primero |
| --- | --- | --- | --- | --- |
| 1 | A-02 · CI no corre en `dev` | Alta | Muy bajo (2 líneas) | Es el multiplicador: sin esto, cualquier corrección posterior entra sin verificación. Corregirlo primero hace que el resto se valide solo. |
| 2 | A-01 · Descubrimiento destructivo con escaneo vacío | Alta | Bajo (una guarda) | Un solo clic de un admin en producción corrompe el catálogo de gobernanza, en silencio. |
| 3 | M-01 · Throttle del login interno | Media | Muy bajo (4 decoradores) | Incumple una regla propia del repositorio y el arreglo es copiar valores ya decididos. |
| 4 | M-03 · `upsertPreferences` sin transacción | Media | Bajo | Escritura parcial por un camino de validación normal; resuelve N+1 en el mismo cambio. |
| 5 | M-02 · Idempotencia sin actor en la clave | Media | Medio (migración de índice) | Cierra replay y bloqueo cruzados; requiere migración, por eso va después de los de bajo esfuerzo. |
| 6 | M-05 · Trinquete de cobertura para onboarding | Media | Bajo (config) | Congela la deuda del módulo KYC antes de que siga bajando. |
| 7 | M-04 · Repliegue del rate limiting | Media | Medio | Reduce la ventana sin protección durante incidencias de Redis. |
| 8 | B-05 · Suites descubiertas ≠ ejecutadas | Baja | Bajo | Aporta a `TEST-001`, abierto desde el 06-08: un gate de pruebas debe saber qué ejecutó. |
| 9 | B-01, B-02, B-03, B-04 | Baja | Bajo | Higiene: teardown, compatibilidad futura de TS, límite de paginación y documentación. |

---

## 6. Limitaciones

Auditoría estática salvo por los gates efectivamente ejecutados y citados en §1. No mide latencia
real, no ejecuta contra base de datos, no valida la configuración desplegada y no sustituye a un
pentest. Las severidades se justifican por impacto y alcanzabilidad reales, no por categoría
teórica: los dos hallazgos Altos son alcanzables por un actor legítimo (A-01) o eliminan una red de
seguridad completa (A-02); ninguno requiere un atacante externo con privilegios previos.

Una limitación de método vale la pena registrarla: el árbol de trabajo cambió bajo la auditoría
(§ cabecera), lo que produjo un falso positivo sobre código ya corregido (§2 bis). Se detectó al
re-verificar cada cita contra el commit final, que es el paso que convierte una lectura en
evidencia. Para próximas pasadas conviene fijar el commit al inicio (`git rev-parse HEAD`) y
re-verificar contra él antes de publicar.
