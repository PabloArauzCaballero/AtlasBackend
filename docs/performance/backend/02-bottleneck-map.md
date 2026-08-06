# Mapa de latencia y riesgos de rendimiento

> **Aviso metodológico.** Este mapa es **estático**: sale de leer el código, no de medir el sistema
> en ejecución. Por tanto lo que contiene son **riesgos con evidencia**, no cuellos de botella
> confirmados. Un riesgo se convierte en cuello cuando un perfil o una prueba de carga lo demuestra.
> Cada hallazgo trae su método de medición precisamente para poder hacer esa conversión.
>
> No se aplicó ninguna optimización a partir de este mapa. Optimizar sin baseline es exactamente lo
> que el procedimiento prohíbe.

Fecha: 2026-08-06 · Commit analizado: `2451bd5` · Alcance: `src/`

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

| # | Hallazgo | Evidencia | Impacto | Frecuencia | Riesgo | Esfuerzo | Prioridad |
|---|---|---|---:|---:|---:|---:|---:|
| R-01 | El fan-out de entregas excede por sí solo el pool de conexiones | `notification-broadcast.service.ts:35` vs `env.schema.ts:56` | Alto | Alta | Alto | Bajo | **1** |
| R-02 | Descifrado de PII sin caché de data keys, en fan-out ilimitado | `notifications.repository.ts:506` · `kms-key-provider.ts:80` | Alto | Media | Alto | Medio | **2** |
| R-03 | Ingesta por lotes con round trips secuenciales, hasta 500 ítems | `catalog-ingestion.service.ts:56` · `catalog-management.schemas.ts:75` | Medio | Media | Bajo | Medio | 3 |
| R-04 | Lectura de código fuente en paralelo sin techo desde un handler HTTP | `systems-source-scan.util.ts:41` | Medio | Baja | Medio | Bajo | 4 |
| R-05 | `statement_timeout` (60 s) mayor que `REQUEST_TIMEOUT_MS` (30 s) por defecto | `env.schema.ts:75` y `env.schema.ts:235` | Medio | Media | Medio | Bajo | 5 |

---

### R-01 · El fan-out de entregas excede por sí solo el pool de conexiones

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

- **Ningún percentil de latencia.** No hay baseline: no había Postgres ni backend en ejecución.
- **Planes de ejecución.** Requieren una base con datos representativos.
- **Índices faltantes más allá del outbox.** Sólo 5 migraciones declaran `addIndex`; determinar si
  faltan exige el patrón de consulta real, que se obtiene de `pg_stat_statements`, no leyendo código.
- **Comportamiento del GC y crecimiento de memoria.** Exige el escenario `soak`.
- **Latencia de proveedores externos.** Exige el entorno con los proveedores configurados.
