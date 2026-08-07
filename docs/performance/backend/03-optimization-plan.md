# Plan de optimización

## Regla de entrada

Ningún cambio de esta lista se implementa antes de que exista un baseline medido y un perfil que
demuestre el cuello. El orden de abajo es el orden **previsto**, derivado del ranking de
[02-bottleneck-map.md](02-bottleneck-map.md); la medición puede reordenarlo o descartar entradas
enteras, y eso sería un resultado correcto, no un fracaso del plan.

## Fase A · Producir el baseline — HECHA (2026-08-06)

Tres corridas con dispersión máxima del 3.6 %, muy por debajo del 15 % exigido. Resultados en
[01-baseline.md](01-baseline.md).

El presupuesto **sigue sin calibrar a propósito**: el dataset era un seed de desarrollo con tablas
casi vacías, y convertir esos percentiles en umbrales bloqueantes daría un gate que pasa siempre en
local y falla el día que alguien mida contra datos reales.

## Fase A' · El baseline que falta

La Fase A midió lo que se podía medir. Lo que queda es lo que decide el resto del plan:

1. **Dataset representativo.** Es la limitación dominante: R-01, R-03 y R-05 sólo se manifiestan con
   queries que tarden lo suficiente como para retener una conexión.
2. **Mezcla que recorra escritura y broadcast.** La actual es de lectura, así que nunca tocó los
   caminos donde viven R-01, R-02 y R-03. Correr `yarn stress:notifications` en paralelo a
   `--scenario=load` y vigilar `atlas_db_pool_connections{state="waiting"}` es la prueba concreta
   que R-01 necesita.
3. **KMS activo**, sin el cual R-02 no existe.

Sólo entonces tiene sentido calibrar y pasar a la Fase C.

## Fase B · Instrumentar antes de tocar

Dos de los cinco riesgos no se pueden confirmar con lo que hoy se publica.

| Instrumento | Para qué | Riesgo que confirma |
|---|---|---|
| Histograma y contador de llamadas a KMS en `decryptDataKey` | Distinguir «una data key por lote» de «una por fila» | R-02 |
| Duración de las transacciones de ingesta | Ver si los round trips secuenciales retienen locks | R-03 |
| `process_open_fds` bajo inferencia | Confirmar el techo de descriptores | R-04 |

Lo demás ya está publicado: `atlas_db_pool_connections` cubre R-01 y R-05 sin añadir nada.

## Fase C · Correcciones, en orden de prioridad

### C-0 · Desacoplar el logging de SQL de `NODE_ENV` (R-06) · el único con evidencia medida

Hoy `database.config.ts:75` vuelca cada sentencia a stdout en `development`: 8 MB por corrida de
150 s, con PII en claro, contra la regla explícita de `.claude/rules/30-security.md`.

Cambio previsto: variable propia (`DB_LOG_SQL`, desactivada por defecto) en lugar del acoplamiento a
`NODE_ENV`, y sin volcar valores de parámetros. Es un cambio de contrato de configuración y una
decisión de seguridad: **requiere ADR**, no un parche.

No mejora la latencia y no se venderá como tal (ver la nota honesta en
[02-bottleneck-map.md](02-bottleneck-map.md)). Está el primero porque es el único hallazgo que la
medición confirmó.

### C-1 · Alinear los techos de fan-out con el pool (R-01)

> Rebajado de prioridad: la medición lo **refutó en la ruta de lectura**. No se toca hasta que la
> Fase A' lo demuestre en la ruta de broadcast.


Derivar los límites de concurrencia de `DB_POOL_MAX` en vez de declararlos como constantes en cinco
archivos, dejando margen para el tráfico HTTP que comparte el mismo pool.

- **No** consiste en subir el pool: `(instancias × DB_POOL_MAX)` está acotado por el
  `CONNECTION LIMIT` del rol `atlas_app_rw`.
- **Verificación:** `atlas_db_pool_connections{state="waiting"}` en cero durante un broadcast bajo
  el escenario `load`, y p95 del flujo `catalogos-listado` sin degradarse mientras el broadcast corre.
- **Riesgo del cambio:** bajar la concurrencia de entrega alarga el broadcast. Es un intercambio
  explícito entre latencia de las peticiones interactivas y duración del trabajo de fondo, y hay que
  decidirlo con datos, no por defecto.

### C-2 · Caché acotada de data keys (R-02)

Caché con clave el ciphertext de la data key, TTL corto y tamaño máximo — la práctica estándar del
AWS Encryption SDK.

- **Decisión previa obligatoria:** TTL y tamaño. Una data key descifrada en memoria es material
  sensible; la caché es un intercambio entre latencia/coste y ventana de exposición. Requiere ADR.
- **Verificación:** llamadas a KMS por notificación deben dejar de crecer con el número de
  destinatarios.
- **Además:** acotar el `Promise.all` de `notifications.repository.ts:506` con `mapWithConcurrency`,
  que ya existe.

### C-3 · Agrupar la ingesta por lotes (R-03)

Sustituir los `await` en bucle por operaciones de lote (`bulkCreate`). **No paralelizar**: están
dentro de una transacción, y N conexiones concurrentes dentro de una transacción es peor que
secuencial.

- **Verificación:** número de sentencias por petición de 500 ítems, y duración de la transacción.

### C-4 · Acotar el escaneo de fuentes (R-04)

Sustituir el `Promise.all` de `systems-source-scan.util.ts:41` por `mapWithConcurrency`. Es el
cambio más barato de la lista y el de menor impacto: hacerlo sólo cuando los tres anteriores estén
cerrados o descartados.

## Fase D · Consolidar

1. Documentar cada cambio aceptado en [04-before-after-report.md](04-before-after-report.md) con la
   tabla antes/después completa, incluidas las métricas que empeoraron.
2. Activar el gate de carga en CI una vez que el presupuesto esté calibrado y el escenario `smoke`
   demuestre ser estable (ver [05-performance-budget.md](05-performance-budget.md)).
3. Actualizar el registro de progreso.

## Lo que este plan NO contempla

Descartado explícitamente, para que nadie lo reproponga sin argumento nuevo:

- **Cambiar de ORM, framework, runtime o gestor de paquetes.** Ninguna evidencia lo sugiere.
- **Introducir k6.** No está instalado, y el repositorio ya tiene una convención de pruebas de
  carga en TypeScript sobre `tsx` que funciona sin dependencias nuevas. Dos herramientas para la
  misma responsabilidad es exactamente lo que las reglas del proyecto prohíben.
- **Añadir un segundo stack de observabilidad.** OpenTelemetry + `prom-client` ya cubren trazas y
  métricas.
- **Caché de respuestas HTTP.** Sin baseline no se sabe si el coste está en la query, en el
  descifrado o en la serialización. Cachear antes de saberlo es adivinar, y añade invalidación y
  riesgo de fuga entre tenants a cambio de nada demostrado.
- **Subir `DB_POOL_MAX` como primera medida.** Trata el síntoma y traslada la contención al servidor
  de base de datos, donde es más cara de diagnosticar.
