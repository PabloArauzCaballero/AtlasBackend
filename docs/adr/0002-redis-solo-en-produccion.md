# ADR-0002: Redis obligatorio solo en producción para rate limiting distribuido

- **Estado:** Aceptado
- **Fecha:** 2026-07-16
- **Decisores:** equipo backend
- **Relacionado:** [`src/config/env.ts`](../../src/config/env.ts) (`REDIS_URL`, validación de producción), plan 10/10 Infra/Costo

## Contexto

El rate limiting protege endpoints sensibles (login, refresh, onboarding público) de
abuso. Con **una sola instancia** del backend, un contador en memoria basta. Con
**varias instancias detrás de un balanceador**, un contador por proceso deja pasar N
veces el límite (una vez por instancia), así que el estado del rate limit debe
compartirse — típicamente en Redis.

Forzar Redis en **todos** los entornos encarece y complica el desarrollo local y los
tests, donde casi siempre corre una sola instancia.

## Decisión

`REDIS_URL` es **opcional en desarrollo/test** (el rate limit cae a memoria por
instancia, suficiente para una sola instancia) y **obligatorio en producción**: la
validación de entorno **falla el arranque** si `NODE_ENV=production` y `REDIS_URL` no
está definido.

```
if (NODE_ENV === 'production' && !REDIS_URL) → error de configuración
"REDIS_URL es requerido en producción: sin Redis, el rate limiting solo protege por instancia."
```

## Alternativas consideradas

- **Redis obligatorio siempre** — fricción innecesaria en local y CI para un beneficio
  nulo cuando hay una sola instancia. Descartada por costo de DX.
- **Redis nunca (solo memoria)** — inseguro en producción multi-instancia: el límite
  efectivo se multiplica por el número de réplicas. Descartada por seguridad.
- **Rate limit en base de datos** — añade carga de escritura de alta frecuencia a
  PostgreSQL en el hot path de autenticación. Descartada por rendimiento.

## Consecuencias

- **Positivas:** DX local sin dependencias extra; producción segura por defecto (el
  arranque se niega a correr en un estado inseguro conocido); una sola pieza de infra
  (Redis) con propósito acotado y justificado.
- **Negativas / costos asumidos:** el comportamiento del rate limit **difiere** entre
  local (memoria) y producción (Redis distribuido); los tests de rate limit distribuido
  deben ejercitar explícitamente el camino Redis (cubierto en la suite, plan Fase 1.3).
- **Condición de revisión (trigger):** si en el futuro se necesitara Redis como almacén
  durable (colas, sesiones), reevaluar su criticidad y requisitos de persistencia/HA en
  un ADR nuevo — hoy es caché efímera, no fuente de verdad.
