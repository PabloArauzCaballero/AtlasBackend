---
title: "Secuencias críticas"
type: "architecture"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - architecture
  - sequences
aliases: []
related: []
---

# Secuencias críticas

Los cuatro caminos cuyo comportamiento hay que entender antes de tocar nada.

## 1. Comando autenticado con idempotencia

El caso general de cualquier `POST`/`PUT`/`PATCH`/`DELETE`.

```mermaid
sequenceDiagram
    participant C as Cliente
    participant MW as CorrelationId
    participant TH as Throttler (Redis)
    participant IN as Interceptores
    participant G as Guards
    participant CT as Controller
    participant SV as Service
    participant DB as PostgreSQL

    C->>MW: POST /api/v1/... (Bearer | cookie, x-tenant-id, x-idempotency-key)
    MW->>MW: asigna correlationId
    MW->>TH: ¿dentro del límite?
    TH-->>C: 429 si excede
    TH->>IN: métricas → timeout → action log
    IN->>IN: IdempotencyInterceptor.claim(clave, hash(body,query,params))
    alt clave ya vista con el mismo hash
        IN-->>C: replay de la respuesta almacenada
    else clave nueva
        IN->>G: JwtAuthGuard → TenantGuard → RolesGuard
        G-->>C: 401 / 403 si falla
        G->>CT: ZodValidationPipe valida body/params/query
        CT-->>C: 400 si el esquema no valida
        CT->>SV: caso de uso
        SV->>DB: BEGIN … cambio de negocio … INSERT outbox_events … COMMIT
        SV-->>IN: resultado
        IN->>IN: ApiCommandOutboxInterceptor emite evento de comando
        IN-->>C: { requestId, data, timestamp }
    end
```

> [!info] La clave de idempotencia incluye el hash del request
> `IdempotencyInterceptor` calcula `requestHash(body, query, params)` y lo guarda junto a la clave, con ámbito `tenantScope` (el `tenantId` del token, o el header, o `'global'`) y `scope` = `MÉTODO + URL`.
>
> Repetir la **misma** clave con un cuerpo **distinto** no es un reintento: es un error del cliente. Guardar el hash permite distinguirlos en vez de devolver silenciosamente una respuesta que no corresponde al cuerpo enviado.
>
> Solo se aplica a `POST`/`PUT`/`PATCH`/`DELETE`, y **solo si el header viene**: sin `x-idempotency-key`, el interceptor no hace nada. Varios controllers lo exigen explícitamente (`throw new BadRequestException('X-Idempotency-Key header is required.')`).

## 2. Publicación de un evento de dominio (outbox)

```mermaid
sequenceDiagram
    participant SV as Service (API)
    participant DB as PostgreSQL
    participant SCH as Scheduler (worker)
    participant JOB as process_outbox
    participant CONS as Consumidores

    SV->>DB: BEGIN
    SV->>DB: UPDATE/INSERT del cambio de negocio
    SV->>DB: INSERT outbox_events (status='pending')
    SV->>DB: COMMIT
    Note over DB: el cambio y el evento se confirman juntos o no se confirman

    loop cada RUNTIME_JOBS_OUTBOX_INTERVAL_MS
        SCH->>JOB: tick (solo el líder)
        JOB->>DB: reclama lote (pending → processing)
        JOB->>CONS: entrega
        alt éxito
            JOB->>DB: status = processed
        else fallo
            JOB->>DB: status = failed
        end
    end
```

> [!info] Por qué existe `reclaim_stuck_events`
> Si el proceso muere entre `pending → processing` y la resolución, el evento queda en `processing` **para siempre**: ninguna consulta de reclamo mira ese estado. Sería una pérdida silenciosa.
>
> El job `reclaim_stuck_events` rescata los que llevan más de `RUNTIME_JOBS_STUCK_EVENT_MINUTES` en `processing`. El propio código lo dice: *"sin este job esos eventos quedan en `processing` para siempre… se pierden en silencio"*.

## 3. Autenticación

```mermaid
sequenceDiagram
    participant C as Cliente
    participant G as JwtAuthGuard
    participant REV as TokenRevocationService

    C->>G: request con cookie de sesión o Authorization: Bearer
    G->>G: ¿@Public()? → deja pasar
    G->>G: extraer token: cookie primero, luego cabecera
    alt sin ninguno de los dos
        G-->>C: 401 "Sesión requerida"
    end
    G->>G: verify(HS256, issuer, audience)
    G->>G: ¿payload.role ∈ ATLAS_USER_ROLES?
    G-->>C: 401 si el rol es desconocido
    G->>REV: ¿token revocado? (tokenVersion / actor)
    REV-->>G: sí → 401
    G->>G: request.user = AuthenticatedUser
```

Puntos que importan:

- **La cookie tiene prioridad sobre la cabecera.** Un cliente que envíe ambas usará la cookie.
- Un `Authorization` con formato distinto de `Bearer <token>` produce **401 inmediato**, no se ignora.
- El rol se valida contra `ATLAS_USER_ROLES`, la misma constante que usa el resolver de actor: no pueden desincronizarse.

Detalle en [[08-security/authentication]].

## 4. Readiness durante el apagado

```mermaid
sequenceDiagram
    participant K as Orquestador
    participant H as HealthController
    participant GS as GracefulShutdown
    participant PG as PostgreSQL
    participant RD as Redis

    K->>H: GET /health/readiness
    H->>GS: isShuttingDown()
    alt drenando
        H-->>K: 503 inmediato, sin tocar dependencias
    else operativo
        par en paralelo, cada uno con timeout
            H->>PG: authenticate()
            H->>RD: ping()
        end
        Note over H: el pool de LECTURA se reporta pero NO decide
        alt postgres ok y redis ≠ unreachable
            H-->>K: 200 ready
        else
            H-->>K: 503 not_ready
        end
    end
```

> [!info] Dos decisiones deliberadas
> 1. **El drenado se comprueba primero y sin tocar dependencias.** Durante el apagado la respuesta debe ser inmediata y negativa, no depender de que PostgreSQL conteste.
> 2. **El pool de lectura se reporta pero no decide el readiness.** Es una dependencia *compartida* por todas las instancias: si la réplica cae, marcar `not_ready` sacaría del balanceador a **todo** el despliegue —incluidos los caminos de escritura, auth y onboarding, que siguen sanos— convirtiendo una degradación parcial en una caída total. El operador lo ve; el orquestador no actúa sobre ello.

## Relaciones

- [[02-architecture/views/c4-component]] · [[07-async-processing/events]] · [[08-security/authentication]] · [[09-observability/observability-overview]]
