# Baseline de consultas (Fase 0)

> **Estado:** plantilla. Debe llenarse con `pg_stat_statements` de un entorno representativo antes de
> optimizar. Los objetivos de rendimiento (§39) son presupuestos de partida, no dogmas: se recalibran
> con esta evidencia.

## Cómo capturarlo

1. Habilita `pg_stat_statements` en el Postgres de staging (`shared_preload_libraries`), luego:
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
   ```
2. Genera carga representativa (o deja correr staging un tiempo).
3. Captura el top de consultas:
   ```bash
   yarn db:capture-query-baseline   # top por total_time / mean_time / rows (si pg_stat_statements existe)
   ```
4. Pega el resultado abajo y registra p50/p95/p99 de los endpoints principales (desde métricas de app).

## Top de consultas (por tiempo total)

| # | Query (normalizada) | Llamadas | total_time (ms) | mean_time (ms) | rows | shared_hit/read |
| - | ------------------- | -------- | --------------- | -------------- | ---- | --------------- |
|   | _(pegar salida de `yarn db:capture-query-baseline`)_ |          |                 |                |      |                 |

## Latencia por endpoint (desde métricas de aplicación)

| Endpoint                                   | p50 (ms) | p95 (ms) | p99 (ms) | payload prom. | payload máx. |
| ------------------------------------------ | -------- | -------- | -------- | ------------- | ------------ |
| `GET /operations/work-queue`               |          |          |          |               |              |
| `GET /customers/:id`                       |          |          |          |               |              |
| `GET /operations/audit/customer/:id/feed`  |          |          |          |               |              |

## Objetivos iniciales (§39, recalibrables)

- Lista operativa p95 DB: ≤ 200 ms en staging representativo.
- Detalle principal p95 DB: ≤ 150 ms.
- Máximo 100 filas por página; sin leer > 1.000 filas para responder 20 (salvo exportaciones).
- Sin sort de miles de objetos en Node.js para endpoints interactivos.
