---
name: backend-development
description: Principios de arquitectura backend agnósticos de framework — capas y fronteras, validación en el borde, modelo de errores, idempotencia, paginación, transacciones, configuración 12-factor, jobs en background, versionado de API, resiliencia (timeouts/retries/circuit breaker), health checks y graceful shutdown. Usar al diseñar un servicio nuevo, un endpoint, un job asíncrono, al encontrar un controller con reglas de negocio o consultas a la base adentro, o al revisar si una API está lista para producción.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Desarrollo backend — principios de arquitectura

Reglas operativas para diseñar servicios backend mantenibles y listos para producción,
sin atarse a un framework. Para TypeScript/Node con NestJS específicamente, ver
`nestjs-development`. Para SOLID y código limpio a nivel de función/clase, ver
`solid-principles` y `clean-code`.

## 1. Capas y fronteras

- Separá en al menos tres capas: **transporte** (controller/handler — parsea y serializa,
  no tiene lógica de negocio), **dominio/aplicación** (casos de uso, reglas de negocio,
  sin conocer HTTP/DB) y **infraestructura** (persistencia, clientes externos).
- La dependencia va de afuera hacia adentro: infraestructura implementa interfaces que
  el dominio define, nunca al revés (puerto/adapter — inversión de dependencias).
- Un controller no debe superar ~20 líneas por acción: parsear entrada, invocar un caso
  de uso, mapear la salida. Si tiene `if` de negocio, la lógica está en la capa equivocada.
- No filtrar tipos de infraestructura (entidades de ORM, `Request`/`Response` del framework)
  fuera de su capa: usá DTOs propios en las fronteras.

## 2. Validación de entrada

- Validá **en el borde**, antes de que el dato entre al dominio: tipo, formato, rango,
  longitud, campos requeridos. Rechazá lo desconocido (`whitelist`) en vez de ignorarlo.
- Nunca confíes en validación del cliente: es UX, no seguridad — repetila en el servidor
  (ver `security-guardrails`).
- Una vez validado en el borde, el dominio asume datos correctos: no repitas `if (!x) throw`
  en cada capa interna.

## 3. Modelo de errores

- Un formato de error consistente en toda la API. Usá **RFC 9457 (Problem Details)**:
  `type`, `title`, `status`, `detail`, `instance`, con `Content-Type: application/problem+json`.
- Distinguí errores de **cliente** (4xx — dato inválido, no autorizado, no encontrado,
  conflicto) de errores de **servidor** (5xx — no exponer stack trace ni detalle interno).
- Cada error de negocio es una excepción tipada propia (`OrderNotFoundError`,
  `InsufficientStockError`), mapeada a un código HTTP en un único punto (filtro/middleware
  de errores), no repetido en cada handler.

```json
{
  "type": "https://api.example.com/errors/insufficient-stock",
  "title": "Insufficient stock",
  "status": 409,
  "detail": "SKU 'ABC-123' has 2 units available, 5 requested",
  "instance": "/orders/8f14e"
}
```

## 4. Idempotencia

- Todo endpoint que muta estado y puede reintentarse (pagos, creación de recursos vía
  cliente con reintentos automáticos) debe soportar una **idempotency key** provista por
  el cliente: mismo key + mismo payload → mismo resultado, sin duplicar el efecto.
- `PUT`/`DELETE` son idempotentes por definición (mismo efecto si se repiten); `POST` no
  lo es — si necesita serlo, es la key la que lo garantiza, no el verbo.
- Guardá la key con el resultado de la primera ejecución (con expiración) para responder
  igual ante reintentos, no para reprocesar.

## 5. Paginación

| Tipo | Cuándo usar | Trade-off |
|---|---|---|
| Offset (`page`/`limit`) | listados chicos, UI con número de página | degrada con `OFFSET` alto; inconsistente si hay inserts concurrentes |
| Cursor (`after`/`before`) | listados grandes, scroll infinito, APIs públicas | estable ante inserts; no permite "ir a la página 40" |

- Siempre con límite máximo forzado del lado del servidor (nunca confiar en el `limit`
  que manda el cliente sin techo).
- Devolvé metadata de paginación explícita (`hasMore`, cursor siguiente, total si es barato
  de calcular) — no obligues al cliente a inferir el fin de la lista.

## 6. Transacciones

- Una transacción de negocio = una transacción de base de datos cuando sea posible: si
  una operación toca dos tablas y una falla, ninguna debe persistir (atomicidad).
- No abras una transacción y llames a un servicio externo (HTTP, cola) dentro: si el
  externo tarda, mantenés locks innecesarios. Confirmá la transacción local primero,
  publicá el efecto externo después (outbox pattern si necesitás garantía de entrega).
- Definí explícitamente el nivel de aislamiento cuando el default no alcance (ver
  `database-design` para condiciones de carrera y locking).

## 7. Configuración (12-factor)

- Configuración por variables de entorno, nunca hardcodeada ni en el repo (secretos
  menos aún — ver `security-guardrails`).
- Validá la configuración al arrancar (schema de env vars): fallar rápido en el boot es
  mejor que fallar en producción a mitad de un request por una env var faltante.
- Un mismo build/artefacto se despliega a todos los entornos; lo que cambia entre
  dev/staging/prod es config externa, no código ni rama.

## 8. Jobs en background

- Todo trabajo que no necesita responder sincrónicamente (envío de email, generación de
  reporte, reintentos de integración externa) va a una cola, no al request-response.
- Los jobs deben ser **idempotentes** (mismo job procesado dos veces por un reintento no
  debe duplicar el efecto) y tener una política de reintentos con backoff.
- Un job fallido repetidamente va a una dead-letter queue con alerta — no se pierde
  silenciosamente ni reintenta infinito.

## 9. Versionado de API

- Versioná desde el primer breaking change previsible: por URL (`/v1/...`), header o
  media type — elegí uno y sé consistente en toda la API.
- Un cambio es breaking si puede romper un cliente existente: quitar/renombrar un campo,
  cambiar un tipo, agregar una validación más estricta, cambiar el código de error.
  Agregar un campo opcional nuevo, no lo es.
- Deprecá con aviso (header `Deprecation`/`Sunset`, changelog) antes de eliminar — nunca
  rompas `v1` para arreglar `v2`.

## 10. Resiliencia ante dependencias externas

- **Timeouts** explícitos en toda llamada de red (HTTP, DB, cola): sin timeout, un
  dependiente lento cuelga tu servicio entero.
- **Retries** solo para errores transitorios (timeout, 5xx, conexión), nunca para errores
  de negocio (4xx) ni para operaciones no idempotentes sin idempotency key. Con
  **backoff exponencial + jitter** para no sincronizar reintentos entre instancias y
  agravar un pico.
- **Circuit breaker**: si una dependencia falla repetidamente, dejá de llamarla por un
  tiempo (fail fast) en vez de agotar timeouts en cada request y arrastrar la falla
  aguas arriba.

## 11. Health checks y graceful shutdown

- `/health` (liveness: el proceso está vivo) separado de `/ready` (readiness: puede
  atender tráfico — DB conectada, dependencias críticas arriba). El orquestador usa
  liveness para reiniciar y readiness para enrutar tráfico.
- Al recibir señal de apagado (`SIGTERM`): dejar de aceptar conexiones nuevas, esperar a
  que terminen los requests en vuelo (con un timeout máximo), cerrar conexiones a DB/cola
  limpiamente, recién ahí salir. Un shutdown abrupto corta transacciones y pierde mensajes.

## Anti-patrones

- Lógica de negocio en el controller o en el modelo de ORM.
- `catch` genérico que traga la excepción y devuelve `200` con un body de error.
- Reintentar una llamada `POST` sin idempotencia "porque total el timeout fue raro".
- Paginar con `OFFSET` sin límite en tablas de millones de filas.
- Configuración distinta por entorno lograda con `if (env === 'prod')` desperdigados en
  el código en vez de un valor externo.

## Checklist

- [ ] Controllers finos; lógica de negocio en la capa de dominio.
- [ ] Toda entrada externa se valida y rechaza lo inesperado.
- [ ] Errores en un formato único (problem details), sin fugar detalle interno en 5xx.
- [ ] Mutaciones no idempotentes por naturaleza tienen idempotency key si el cliente reintenta.
- [ ] Paginación con límite máximo forzado por el servidor.
- [ ] Ninguna llamada externa dentro de una transacción abierta.
- [ ] Config vía env vars, validada al boot; sin secretos en el repo.
- [ ] Trabajo no sincrónico va a una cola, con reintentos idempotentes y dead-letter.
- [ ] Todo endpoint versionado; breaking changes solo en versión nueva, con deprecación avisada.
- [ ] Llamadas externas con timeout, retry con backoff+jitter, y circuit breaker donde aplica.
- [ ] `/health` y `/ready` separados; shutdown drena conexiones antes de salir.
