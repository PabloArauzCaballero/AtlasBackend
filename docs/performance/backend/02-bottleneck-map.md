# Mapa de latencia y riesgos de rendimiento

> **Aviso metodológico.** El mapa nació de leer el código, así que su ranking original era de
> **riesgos**, no de cuellos confirmados. El 2026-08-06 se produjo un baseline real
> ([01-baseline.md](01-baseline.md)) y la medición **refutó la prioridad 1**. Los veredictos de
> abajo distinguen lo que la medición dice de lo que sigue sin comprobarse.
>
> Sigue sin aplicarse ninguna optimización, y ahora por una razón más fuerte que al principio: en la
> ruta medida no hay ningún cuello que optimizar.

Fecha del análisis: 2026-08-06 · Commit: `2451bd5` · Medición: commit `a1b898e` · Alcance: `src/`

## Qué dijo la medición

A 10 req/s el p95 global es de 15 ms; a **150 req/s baja a 7.4 ms**, con 0 % de error y el pool en
`using=0 waiting=0 size=4` — nunca se acercó a `DB_POOL_MAX=20`. En la mezcla de lectura no hay
saturación de pool, ni de event loop, ni de memoria.

Con la salvedad decisiva de que **el dataset es un seed de desarrollo con tablas casi vacías**: la
medición demuestra que el pool no es un cuello *para queries que tardan fracciones de milisegundo*.
No demuestra nada sobre el mismo pool con volumen real.

## Descomposición de la latencia por petición

```
entrada Express (helmet, compression, body parser)
+ JwtAuthGuard  → verificación HS256
+ TenantGuard   → cruce x-tenant-id contra el token
+ ZodValidationPipe
+ servicio de dominio
+ espera del pool de conexiones      ← candidato dominante bajo carga
+ query(s) a Postgres
+ descifrado de PII (KMS, si activo) ← candidato dominante en flujos de notificación
+ mapeo a DTO + serialización JSON
+ compresión gzip
```

## Ranking

| # | Hallazgo | Evidencia | Veredicto tras medir | Prioridad |
|---|---|---|---|---:|
| R-06 | En `development` se registra CADA sentencia SQL en stdout | `database.config.ts:75` | **Confirmado**: 8 MB de log en una corrida de 150 s | **1** |
| R-02 | Descifrado de PII sin caché de data keys, en fan-out ilimitado | `notifications.repository.ts:506` · `kms-key-provider.ts:80` | Sin medir: exige KMS activo | 2 |
| R-01 | El fan-out de entregas excede por sí solo el pool de conexiones | `notification-broadcast.service.ts:35` vs `env.schema.ts:56` | **Refutado en la ruta de lectura**; sigue abierto para el broadcast | 3 |
| R-03 | Ingesta por lotes con round trips secuenciales, hasta 500 ítems | `catalog-ingestion.service.ts:56` · `catalog-management.schemas.ts:75` | Sin medir: la mezcla es de lectura | 4 |
| R-04 | Lectura de código fuente en paralelo sin techo desde un handler HTTP | `systems-source-scan.util.ts:41` | Sin medir | 5 |
| R-05 | `statement_timeout` (60 s) mayor que `REQUEST_TIMEOUT_MS` (30 s) | `env.schema.ts:75` y `env.schema.ts:235` | Sin reproducir: no hubo queries lentas | 6 |

---

### R-06 · En `development` se registra cada sentencia SQL en stdout · CONFIRMADO

**Evidencia.** [`database.config.ts:75`](../../../src/config/database.config.ts):
`logging: env.NODE_ENV === 'development' ? console.log : false`.

Apareció midiendo, no leyendo: la primera corrida del baseline generó **8 MB de log** en unos 150
segundos, con el `INSERT` completo de `system_action_logs` y el `SELECT` de
`system_endpoint_catalog` repetidos por cada petición.

Dos consecuencias, y la segunda es la grave:

1. **Invalida cualquier medición local.** Toda corrida hecha con `yarn start:dev` mide, además del
   backend, la serialización y escritura de un log gigante. El baseline hubo de rehacerse con
   `NODE_ENV=test`.
2. **Contradice una regla de seguridad explícita del proyecto.** `.claude/rules/30-security.md`
   dice: «*Nunca loguear SQL (Sequelize inlinea valores → fuga de PII)*». En un backend KYC, un
   `INSERT` de `customers` o de `notification_messages` lleva nombre, correo y teléfono en claro al
   stdout de la máquina de quien desarrolla, y de ahí a `Archivo.log`.

Que sea sólo en desarrollo lo hace menos urgente, no conforme: los datos de un entorno de
desarrollo con seed realista siguen siendo datos.

**Cómo medirlo.** Ya está medido: comparar el tamaño de la salida del proceso entre
`NODE_ENV=development` y `NODE_ENV=test` con la misma corrida.

**Dirección de la corrección** (no aplicada, requiere decisión): el logging de SQL es útil al
depurar. La forma habitual de conservar la utilidad sin la fuga es una variable propia
(`DB_LOG_SQL`) desactivada por defecto, en vez de acoplarlo a `NODE_ENV`, y un `logQueryParameters`
que no vuelque valores. Es un cambio de contrato de configuración: pertenece a un ADR, no a este
documento.

**Nota honesta sobre su efecto en latencia:** la corrida con logging activo dio p50 6.6 ms / p95
12.9 ms, y las corridas con logging desactivado p50 ≈ 9.1 ms / p95 ≈ 15.0 ms. Es decir, salió
*aparentemente más rápida*. No es creíble que escribir 8 MB acelere nada; lo más probable es que esa
corrida difiriera en otras condiciones. **No se afirma ninguna mejora de latencia por desactivar el
logging**: la evidencia sostiene el hallazgo de seguridad y de contaminación del log, no un número
de latencia.

---

### R-01 · El fan-out de entregas excede por sí solo el pool de conexiones · REFUTADO EN LECTURA

> **Lo que la medición dijo.** A 150 req/s de tráfico de lectura el pool se quedó en
> `using=0 waiting=0 size=4`: ni una sola petición esperó una conexión, y el pool ni siquiera creció
> hasta su mínimo útil, no digamos hasta los 20 de `DB_POOL_MAX`. Como cuello de la ruta de lectura,
> **este riesgo queda descartado con las queries actuales**.
>
> Lo que la medición **no** toca, y por eso el hallazgo sigue abierto: la ruta de broadcast, que es
> donde vive `DELIVERY_CONCURRENCY = 25`. La mezcla de carga es de lectura a propósito, así que
> nunca disparó una entrega. Comprobarlo exige correr `yarn stress:notifications` en paralelo a un
> escenario de carga y vigilar `waiting`, que es justo lo que dice el método de medición de abajo.
>
> Esto es lo que vale un baseline: la prioridad 1 del análisis estático resultó no serlo en la ruta
> que se pudo medir. Sin medir, se habría «optimizado» algo que no era el problema.


**Evidencia.** `DELIVERY_CONCURRENCY = 25` en
[`notification-broadcast.service.ts:35`](../../../src/modules/notifications/notification-broadcast.service.ts),
usado en la línea 178 con `mapWithConcurrency`. El pool por defecto es
`DB_POOL_MAX = 20` en [`env.schema.ts:56`](../../../src/config/env.schema.ts).

Lo llamativo es que el comentario que justifica el tamaño del pool, en `env.schema.ts:52-55`, dice
literalmente que se dimensiona porque «el fan-out de notificaciones asume ~25 entregas
simultáneas» — y luego fija el defecto en 20. La razón documentada y el valor real se contradicen,
y eso es antes de sumar el tráfico HTTP normal, que comparte el mismo pool.

Hay además otros tres fan-out con techos propios e independientes: `UPSERT_CONCURRENCY = 20`
(`systems-data-impact-inference.service.ts:16`, `systems-tool-inference.service.ts:13`),
`SEED_CONCURRENCY = 20` (`systems-catalog-seed.service.ts:27`) y `SCAN_CONCURRENCY = 10`
(`endpoint-discovery.service.ts:272`). Nada obliga a que la suma de los techos concurrentes quepa en
el pool: son constantes en cinco archivos distintos frente a una variable de entorno.

**Síntoma esperable.** Latencia alta en peticiones que no ejecutan ninguna query lenta: el tiempo se
va esperando una conexión. Con `DB_POOL_ACQUIRE_MS = 30000`, la espera puede llegar a 30 s antes de
fallar.

**Cómo medirlo.** Correr `yarn perf:load --scenario=load` mientras se dispara un broadcast, y mirar
`atlas_db_pool_connections{state="waiting"}` en `/metrics` (ya publicada por
`db-pool-metrics.service.ts:49`). `waiting > 0` sostenido confirma el cuello. Comparar el p95 del
flujo `catalogos-listado` con y sin broadcast en curso aísla el efecto.

**Dirección de la corrección** (no aplicada): derivar los techos de fan-out de `DB_POOL_MAX` en vez
de declararlos como constantes sueltas, y dejar margen para el tráfico HTTP. Subir el pool sin más
no sirve: `(instancias × DB_POOL_MAX)` está acotado por el `CONNECTION LIMIT` del rol
`atlas_app_rw`.

---

### R-02 · Descifrado de PII sin caché de data keys, en fan-out ilimitado

**Evidencia.** [`notifications.repository.ts:506`](../../../src/modules/notifications/notifications.repository.ts):

```ts
const rows = await this.deviceTokenModel.findAll({ where: { tenantId, customerId, isActive: true } });
const decrypted = await Promise.all(rows.map((row) => decryptSecretEnvelope(row.tokenEncrypted)));
```

El mismo patrón en las líneas 493-499 para los destinos de contacto.

`decryptSecretEnvelope` llama a `provider.decryptDataKey(...)` en
[`envelope-encryption.util.ts:76`](../../../src/common/utils/crypto/envelope-encryption.util.ts), y
`KmsKeyProvider.decryptDataKey` en
[`kms-key-provider.ts:80`](../../../src/common/utils/crypto/kms-key-provider.ts) hace un
`DecryptCommand` contra AWS KMS **en cada llamada, sin caché**.

Con KMS activo (`KMS_KEY_ID` + `AWS_REGION`, ver `main.ts:42`), esto son N llamadas de red a AWS en
paralelo por destinatario, donde N no tiene techo: es el número de filas que devuelva el `findAll`.
Cada una suma RTT, cuota de la API de KMS y coste facturable.

**Cómo medirlo.** Instrumentar `decryptDataKey` con un histograma (`atlas_kms_decrypt_duration_seconds`)
y un contador de llamadas. En un flujo de notificación, comparar el número de llamadas a KMS con el
número de destinatarios: si crecen juntos, no hay reutilización de data keys. El perfil de CPU no
mostrará nada — el tiempo es espera de red, y hay que buscarlo en las trazas de OpenTelemetry.

**Dirección de la corrección** (no aplicada): caché acotada de data keys descifradas, con clave el
propio ciphertext de la key y TTL corto — es la práctica estándar del AWS Encryption SDK. Requiere
decidir explícitamente el TTL y el tamaño, porque una data key en memoria es material sensible.

---

### R-03 · Ingesta por lotes con round trips secuenciales

**Evidencia.** [`catalog-ingestion.service.ts:56`](../../../src/modules/catalog-management/application/catalog-ingestion.service.ts)
hace `await this.repository.createStagingItem(...)` dentro de un bucle. El contrato admite hasta 500
ítems por petición (`catalog-management.schemas.ts:75`). El mismo patrón aparece en
`catalog-data-governance.service.ts` (líneas 44, 60, 77, 94, 114, 133),
`catalog-definitions.service.ts` (38, 60, 86, 115) y `catalog-risk-policy.service.ts` (73, 91).

500 ítems son 500 round trips secuenciales dentro de una transacción. A 1 ms de RTT local eso es
medio segundo de puro ir y venir; contra una base remota a 10 ms, cinco segundos — por encima de
cualquier presupuesto razonable, y con la transacción abierta todo ese tiempo, reteniendo locks.

**Matiz importante:** aquí lo secuencial es probablemente *correcto*. Está dentro de una transacción
y el orden puede importar. La corrección no es paralelizar —eso multiplicaría el uso del pool dentro
de una transacción, que es peor— sino agrupar en `bulkCreate`/`bulkInsert`.

**Cómo medirlo.** `POST` de un lote de 500 ítems con `EXPLAIN`/`pg_stat_statements` activo, o contar
sentencias con el logging de Sequelize en un entorno de prueba. Medir también la duración de la
transacción: es el dato que dice si hay riesgo de contención.

---

### R-04 · Lectura de código fuente en paralelo sin techo desde un handler HTTP

**Evidencia.** [`systems-source-scan.util.ts:41`](../../../src/modules/systems-ops/systems-source-scan.util.ts):
`await Promise.all(files.map((file) => readFile(file, 'utf8')))`, sin límite de concurrencia, sobre
todos los `.ts` de un módulo. Se invoca desde handlers HTTP (`POST /systems/.../infer-*`), según el
propio comentario del archivo (líneas 20-26).

El comentario ya razona correctamente por qué usa `fs/promises` y no las variantes `Sync`, y cachea
la Promise en curso — el archivo está bien pensado. Lo que queda sin techo es el número de descriptores
de archivo abiertos a la vez.

**Cómo medirlo.** Contar los `.ts` del módulo más grande y compararlo con `ulimit -n`. Vigilar
`process_open_fds` en `/metrics` durante una inferencia. Un `EMFILE` bajo carga confirmaría el riesgo.

**Dirección de la corrección** (no aplicada): `mapWithConcurrency` ya existe en
`src/common/utils/concurrency.util.ts` y resuelve exactamente esto; es sustituir el `Promise.all`.

---

### R-05 · `statement_timeout` mayor que el timeout de petición

**Evidencia.** `DB_STATEMENT_TIMEOUT_MS` por defecto 60 000 (`env.schema.ts:75`) y
`REQUEST_TIMEOUT_MS` por defecto 30 000 (`env.schema.ts:235`).

Esto es **deliberado y está documentado** en `env.schema.ts:73` («el de statement debe ser mayor que
REQUEST_TIMEOUT_MS»), y el razonamiento de `database.config.ts:14-26` es correcto: el interceptor
corta el Observable y devuelve 503, pero la consulta subyacente sigue viva reteniendo su conexión.

El riesgo residual es de dimensionamiento, no de diseño: durante 30 s el cliente ya recibió su error
y la conexión sigue ocupada. Con suficientes peticiones lentas, el pool se agota con todos los
clientes ya respondidos. Es la interacción entre R-05 y R-01 lo que importa, no R-05 aislado.

**Cómo medirlo.** En el escenario `stress`, correlacionar 503 del interceptor con
`atlas_db_pool_connections{state="using"}`: si el «using» se mantiene alto después de que la tasa de
503 baja, se está viendo exactamente este efecto.

---

## Lo que está bien y no hay que tocar

Registrarlo importa: evita que una pasada futura «optimice» algo que ya se resolvió con criterio.

- **Fan-out acotado como utilidad compartida.** `mapWithConcurrency`
  (`src/common/utils/concurrency.util.ts`) es un worker pool deslizante, no chunks con `Promise.all`;
  evita el head-of-line blocking. Se usa en 16 sitios.
- **Redis con fail-fast.** `enableOfflineQueue: false`, `connectTimeout: 3000`, `commandTimeout: 1000`
  (`redis.module.ts:33-40`). Un Redis caído no cuelga las peticiones.
- **Techos de sesión en Postgres.** `statement_timeout` e `idle_in_transaction_session_timeout` se
  aplican al runtime pero no a migraciones (`database.config.ts:28-33`), que es la distinción correcta.
- **Métricas de pool ya publicadas.** `atlas_db_pool_connections` con `size/available/using/waiting`
  (`db-pool-metrics.service.ts:49`), leídas en el momento del scrape.
- **Drenado ordenado.** Readiness pasa a 503 antes de cerrar (`graceful-shutdown.service.ts:35`).
- **Índices sobre el outbox.** `ix_outbox_status_available_at` e `ix_outbox_aggregate`
  (`20260629170000-add-runtime-hardening-tables.ts:51-52`) cubren el patrón de consulta del job.

## No verificado

Lo que este análisis **no** puede afirmar, y por qué:

- **Nada sobre volumen real.** El baseline se tomó con tablas casi vacías. Es la limitación que más
  condiciona: R-01, R-03 y R-05 dependen de queries que tarden lo suficiente como para retener una
  conexión, y aquí ninguna lo hace.
- **La ruta de escritura y el broadcast.** La mezcla es de lectura. R-01, R-02 y R-03 viven en
  caminos que la carga nunca recorrió.
- **Planes de ejecución.** Requieren una base con datos representativos.
- **Índices faltantes más allá del outbox.** Sólo 5 migraciones declaran `addIndex`; determinar si
  faltan exige el patrón de consulta real, que se obtiene de `pg_stat_statements`, no leyendo código.
- **Comportamiento del GC y crecimiento de memoria.** Exige el escenario `soak`.
- **Latencia de proveedores externos.** Exige el entorno con los proveedores configurados.
