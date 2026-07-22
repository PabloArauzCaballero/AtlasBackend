---
name: performance-audit
description: Auditoría estática de riesgos de rendimiento del backend Atlas (pool de conexiones, N+1, índices, caché Redis, paginación, event loop, fan-out/backpressure, resilience, arranque). Exige medición antes de optimizar; marca los hallazgos sin baseline como riesgos, no cuellos confirmados.
---

# performance-audit

**Propósito.** Identificar riesgos de rendimiento y cómo medirlos, sin optimizar a ciegas.

**Cuándo usarla.** Antes de escalar carga, tras reportes de latencia, o al revisar un flujo caliente.
**Cuándo NO.** Para aceptar una optimización: eso exige baseline medido (p50/p95/p99) antes/después.

**Fuentes obligatorias.** `src/config/database.config.ts`, repositories/services calientes, `src/common/resilience/`, `src/common/utils/concurrency.util.ts`, `scripts/stress/`, migraciones (índices).

**Entradas.** Alcance opcional.

**Condiciones de parada.** No afirmes que algo es un cuello sin medición; sin baseline, todo hallazgo es "riesgo potencial".

**Flujo por fases.**
1. Pool Postgres: `max/min/acquire/idle` vs concurrencia asumida (p.ej. broadcast).
2. N+1 / queries en bucles: `for`/`map` con `await` de query dentro; includes sin `attributes`.
3. Índices: columnas de búsqueda frecuente (hashes, status, FKs de tablas grandes) con índice declarado.
4. Caché Redis: TTL, invalidación, estampida; RTT en el camino caliente.
5. Payloads: listas sin paginación (`findAll` sin limit); JSON grandes.
6. Event loop: crypto síncrono, JSON.parse enorme; argon2 async.
7. Fan-out: `Promise.all` sin límite vs worker pool acotado; backpressure; trabajo pesado dentro del request.
8. Resilience: timeouts por intento, retries con jitter, circuit breaker.
9. Arranque: carga ansiosa de contextos/modelos.

**Comandos permitidos.** Lectura, grep, `graphify`, y para MEDIR: `scripts/stress/*`, autocannon/k6 (fuera de producción).
**Comandos prohibidos.** Optimizar sin medición; benchmarks contra producción.

**Evidencia requerida.** `archivo:línea`, y **cómo medirlo** por hallazgo. Toda optimización aceptada trae comparación antes/después.

**Entregables.** Informe: resumen, riesgos por severidad con archivo:línea + recomendación + método de medición, positivos, no verificado.

**Formato.** Español; aviso metodológico al inicio (estático = riesgos, no cuellos).

**Checklist final.** ¿Pool, N+1, índices, caché, payloads, event loop, fan-out, resilience, arranque cubiertos? ¿Cada hallazgo con "cómo medirlo"?

**Limitaciones.** Sin runtime no hay confirmación; los hallazgos son hipótesis a validar con baseline.

**Trazabilidad.** `CLAUDE_ORGANIZAR_SKILLS_BACKEND.md` §11 + auditoría 2026-07-21 (Rendimiento).
