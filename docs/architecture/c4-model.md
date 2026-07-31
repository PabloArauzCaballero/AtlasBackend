# Arquitectura C4

> Los cuatro niveles del modelo C4 aplicados al sistema **real**. Cada elemento tiene nombre,
> responsabilidad y un archivo del repositorio detrás; los límites de confianza y los protocolos son
> explícitos.
>
> Fuente de verdad de la estructura: [workspace.dsl](../../structurizr/workspace.dsl) (Structurizr).
> Los diagramas de esta página son Mermaid, que es lo que se renderiza dentro del portal.

---

## Nivel 1 · Contexto del sistema

Quién usa Atlas y con qué habla.

```mermaid
graph TB
    subgraph Personas
        CLI["Cliente<br/><i>solicita crédito</i>"]
        OPE["Operador interno<br/><i>revisa identidad, cumplimiento y fraude</i>"]
        ADM["Administrador<br/><i>configura catálogos y políticas</i>"]
    end

    subgraph Atlas["Sistema Atlas"]
        BE["Atlas Backend<br/><i>identidad, riesgo, crédito, operación</i>"]
    end

    subgraph Externos["Sistemas externos"]
        SEGIP["SEGIP<br/><i>registro civil</i>"]
        BURO["InfoCenter<br/><i>buró crediticio</i>"]
        TELCO["Telco / WhatsApp<br/><i>contactabilidad</i>"]
        BANCA["Banca / QR<br/><i>cobro</i>"]
        MAIL["MailSender<br/><i>correo transaccional</i>"]
    end

    CLI -->|"HTTPS · JWT propio"| BE
    OPE -->|"HTTPS · JWT + RBAC interno"| BE
    ADM -->|"HTTPS · JWT + RBAC interno"| BE

    BE -->|"HTTPS · idempotente, con breaker"| SEGIP
    BE -->|"HTTPS · costoso, requiere aprobación"| BURO
    BE -->|"HTTPS"| TELCO
    BE -->|"HTTPS"| BANCA
    BE -->|"HTTPS · API key"| MAIL
```

**Límite de confianza.** Todo lo que entra por HTTPS desde una persona es no confiable: se valida con
Zod, se autentica con JWT (`iss`/`aud` verificados) y se autoriza por rol **y** por tenant
(`TenantGuard` cruza `x-tenant-id` contra el token). Todo lo que sale hacia un proveedor externo pasa
por circuit breaker, idempotencia y auditoría, y en producción un proveedor en modo simulado queda
bloqueado en vez de devolver datos fabricados.

---

## Nivel 2 · Contenedores

Qué unidades desplegables componen el sistema y cómo se comunican.

```mermaid
graph TB
    subgraph Clientes
        APP["App móvil / web pública"]
        PORTAL["Portal administrativo<br/><i>AtlasAdminPortal</i>"]
    end

    subgraph AtlasSys["Sistema Atlas"]
        API["Contenedor <b>api</b><br/>APP_ROLE=api<br/><i>Node 22 · NestJS · sin trabajo de fondo</i>"]
        WRK["Contenedor <b>worker</b><br/>APP_ROLE=worker<br/><i>7 jobs · monitor de salud · entrega diferida</i>"]
        MIG["Job <b>migrate</b> (one-shot)<br/><i>migraciones + seeders, identidad DDL propia</i>"]
        PG[("PostgreSQL 16<br/><i>fuente de verdad · outbox · auditoría</i>")]
        RD[("Redis 7<br/><i>throttling · locks de líder · caché</i>")]
        MG[("MongoDB 7<br/><i>visor de logs (opcional)</i>")]
    end

    PROM["Prometheus"]

    APP -->|"HTTPS /api/v1"| API
    PORTAL -->|"HTTPS /api/v1"| API

    MIG -->|"DDL · atlas_migrator"| PG
    API -->|"SQL · atlas_app_rw"| PG
    WRK -->|"SQL · atlas_app_rw"| PG
    API -->|"RESP"| RD
    WRK -->|"RESP · SET NX PX"| RD
    API -->|"tail de su propio log"| MG
    WRK -->|"tail de su propio log"| MG

    PROM -->|"scrape /metrics"| API
    PROM -->|"scrape :3006/metrics"| WRK

    MIG -.->|"debe terminar con éxito antes"| API
    MIG -.->|"debe terminar con éxito antes"| WRK
```

| Contenedor | Responsabilidad | Entrypoint | Puerto |
|---|---|---|---|
| `api` | Atender HTTP de negocio. **No** ejecuta trabajo de fondo | `node dist/src/main.js` | `APP_PORT` (público) |
| `worker` | Ejecutar el trabajo de fondo. **No** monta rutas de negocio | `node dist/src/worker.js` | `WORKER_PROBE_PORT` (interno) |
| `migrate` | Aplicar migraciones y seeders. Corre y sale | `node dist/src/database/migrate.js up` | — |

Los tres salen de **la misma imagen**: comparten el árbol de dependencias completo, así que dos
imágenes serían dos builds, dos escaneos y dos oportunidades de divergir. Ver
[ADR-0006](../adr/0006-separacion-de-roles-api-worker.md).

**Nota sobre `log-sync`.** Corre en `api` **y** en `worker`, no sólo en el worker: sincroniza el
archivo que escribe **su propio** proceso. Moverlo al worker dejaría los logs de la API sin
sincronizar. Es la excepción deliberada al reparto de roles.

---

## Nivel 3 · Componentes del contenedor `api`

El recorrido de una petición dentro del proceso.

```mermaid
graph LR
    REQ(["Petición HTTP"]) --> MW["CorrelationIdMiddleware<br/><i>asigna o propaga x-correlation-id</i>"]
    MW --> THR["ThrottlerGuard<br/><i>límite por IP/actor · fail-open si Redis cae</i>"]
    THR --> JWT["JwtAuthGuard<br/><i>verifica firma, iss, aud, tokenVersion</i>"]
    JWT --> TEN["TenantGuard<br/><i>x-tenant-id == token.tenantId</i>"]
    TEN --> ROL["RolesGuard<br/><i>@Roles(...)</i>"]
    ROL --> PIPE["ZodValidationPipe<br/><i>valida cuerpo, query y params</i>"]
    PIPE --> IDEM["IdempotencyInterceptor<br/><i>claim por X-Idempotency-Key</i>"]
    IDEM --> CTRL["Controller<br/><i>delgado: delega</i>"]
    CTRL --> SVC["Service<br/><i>reglas de negocio</i>"]
    SVC --> REPO["Repository<br/><i>sólo persistencia</i>"]
    REPO --> PG[("PostgreSQL")]
    SVC --> OUT["OutboxInterceptor<br/><i>evento en la MISMA transacción</i>"]
    CTRL --> RESP["ResponseInterceptor<br/><i>sobre requestId/data/timestamp</i>"]
    RESP --> OK(["200 · ApiSuccess"])
    CTRL -.->|"excepción"| FILT["HttpExceptionFilter<br/><i>sobre ApiError, PII redactada</i>"]
    FILT -.-> ERR(["4xx/5xx · ApiError"])
```

El orden importa y es el que impone `app.module.ts`: primero se decide **si la petición entra**
(throttling, autenticación, tenant, rol), después **si los datos son válidos** (Zod), después **si ya
se ejecutó** (idempotencia), y sólo entonces se toca el dominio. Un fallo en cualquier punto sale por
el mismo filtro global con el mismo sobre.

---

## Nivel 3-bis · Componentes del contenedor `worker`

```mermaid
graph TB
    BOOT["worker.ts<br/><i>createApplicationContext()<br/>SIN rutas de negocio</i>"]
    BOOT --> PROBE["Sonda node:http<br/><i>/health/liveness · /health/readiness · /metrics</i>"]
    BOOT --> SCHED["RuntimeJobsSchedulerService"]
    BOOT --> MON["SystemsHealthMonitorService"]
    BOOT --> SEED["StartupSeedService<br/><i>opt-in</i>"]
    BOOT --> LOGS["ArchivoLogMongoSyncService<br/><i>su propio archivo</i>"]

    SCHED -->|"SET NX PX por job"| RD[("Redis")]
    SCHED --> J1["process_outbox · 30s"]
    SCHED --> J2["process_events · 30s"]
    SCHED --> J3["expire_stale_sessions · 5min"]
    SCHED --> J4["apply_retention_policies · 24h"]
    SCHED --> J5["retry_stuck_notifications · 5min"]
    SCHED --> J6["purge_idempotency_keys · 24h"]
    SCHED --> J7["recalculate_data_quality · 1h"]
    SCHED --> J8["deliver_pending_notifications · 10s<br/><i>sólo en modo deferred</i>"]
```

Cada tanda toma un lock de líder en Redis antes de ejecutarse: con N réplicas, sólo una corre. El
lock **no se libera al terminar** — expira solo, así que su TTL define además la cadencia mínima real
aunque la instancia líder muera a mitad de job.

---

## Nivel 4 · Despliegue

```mermaid
graph TB
    subgraph Internet
        LB["Balanceador / WAF<br/><i>termina TLS</i>"]
    end

    subgraph Red["Red privada"]
        subgraph Apps["Plano de aplicación"]
            A1["api #1"]
            A2["api #2"]
            AN["api #N"]
            W1["worker #1"]
        end
        subgraph Datos["Plano de datos (servicios gestionados)"]
            PG[("PostgreSQL<br/><i>con copias de seguridad</i>")]
            RD[("Redis")]
        end
        OBS["Prometheus + Grafana"]
    end

    LB -->|"HTTPS · readiness cada 10s"| A1
    LB --> A2
    LB --> AN
    A1 --> PG
    A2 --> PG
    AN --> PG
    W1 --> PG
    A1 --> RD
    W1 --> RD
    OBS -.->|"scrape"| A1
    OBS -.->|"scrape"| W1
```

Reglas de despliegue que el diagrama hace visibles:

- El worker **no** cuelga del balanceador. Su puerto vive sólo en la red privada porque expone
  `/metrics` sin autenticación.
- `SHUTDOWN_DRAIN_MS` debe superar el intervalo del readiness probe del balanceador: durante el
  drenado, readiness responde 503 y el balanceador retira la instancia **antes** de que se cierre.
- PostgreSQL y Redis son servicios gestionados, no contenedores efímeros. `docker-compose.prod.yml`
  no los declara a propósito.

---

## Consistencia con Graphify

Los diagramas de esta página y el grafo describen el mismo sistema. Las dos diferencias conocidas,
declaradas en vez de tapadas:

1. **El trabajo de fondo no aparece en el grafo** con la conectividad que muestra el nivel 3-bis: el
   planificador llama a sus jobs a través de un array de closures, que el análisis AST no resuelve.
2. **Los contenedores no existen en el grafo**, que es un grafo de código. La correspondencia
   rol ↔ proceso está en [background-processing.md](background-processing.md).

Detalle completo del contraste en [graphify-audit.md](../reports/graphify-audit.md) §6.
