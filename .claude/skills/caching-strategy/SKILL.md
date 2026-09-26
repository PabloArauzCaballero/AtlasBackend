---
name: caching-strategy
description: Estrategia de caché para la API NestJS y sus clientes — qué cachear y qué NUNCA (datos clínicos compartidos, respuestas autorizadas por usuario), capas (HTTP con Cache-Control/ETag, aplicación, Redis), claves con tenant y usuario, invalidación por evento vs TTL, estampida, caché negativo, consistencia con el ORM y medición de hit ratio. Usar antes de agregar cualquier cache, al revisar un endpoint lento que "se arregla cacheando", al diseñar catálogos o directorios públicos de alto tráfico, y al diagnosticar datos viejos, respuestas de otro usuario o memoria que crece.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Estrategia de caché

Un caché es una **copia que puede estar vieja o en manos equivocadas**. Antes de agregarlo,
`code-efficiency` exige medir: la mayoría de los endpoints lentos se arreglan con un índice o
sin el N+1, y eso no introduce ni staleness ni fugas. Cacheá cuando el costo de recalcular es
alto, la lectura domina y **podés definir cuándo deja de ser válido**.

## 1. Qué NUNCA se cachea (o solo con reglas estrictas)

| Dato | Regla |
|---|---|
| Respuestas de datos clínicos o PII | no en caché compartido; si hace falta, solo por usuario, TTL corto, cifrado en reposo, y `Cache-Control: no-store` hacia el cliente (`data-privacy-sensitive`) |
| Cualquier respuesta **autorizada** (depende de quién pregunta) | clave incluye actor y tenant, o no se cachea; nunca en caché HTTP compartido (`private`) |
| Decisiones de autorización, consentimiento, membresía | no se cachean, o con invalidación inmediata al revocar (`authz-access-control`, `data-privacy-sensitive`) |
| Saldos, cupos de agenda, contadores que deciden una escritura | nunca: se leen en la transacción que decide (`concurrency-and-locking`) |
| Tokens, secretos, sesiones | no son caché; son estado con su propio almacén |

Lo que sí rinde: catálogos y terminología, directorios públicos, configuración por tenant,
agregados costosos con staleness aceptable, respuestas de terceros con cuota.

## 2. Capas y en qué orden considerarlas

1. **Base de datos**: índices, query plan, materialized views refrescadas (`postgresql-advanced`).
   Es "caché" sin invalidación manual. Primera opción.
2. **HTTP** (navegador, CDN, proxy): la única que ahorra la request entera. Solo para lo
   público o lo `private` por usuario.
3. **Aplicación / proceso** (memoria): rapidísima, **no compartida** entre instancias, se pierde
   al reiniciar. Solo datos chicos, inmutables o con TTL corto.
4. **Distribuida** (Redis): compartida, sobrevive reinicios, un salto de red. Para lo que las
   instancias deben ver igual.
5. **Cliente** (store o caché de datos del front y de la app): `mobile-offline-sync`.
   Misma regla: el dato sensible se cachea con cuidado y se limpia al cerrar sesión o cambiar tenant.

## 3. Caché HTTP correcto

- Público y cacheable por intermediarios: `Cache-Control: public, max-age=<s>` (y `s-maxage`
  para el CDN). Directorios públicos, catálogos, assets con hash en el nombre (`immutable`).
- Por usuario: `Cache-Control: private, max-age=<s>` — el navegador sí, la CDN no.
- Sensible: `Cache-Control: no-store` (no guardar) — `no-cache` significa *revalidar antes de
  usar*, no "no guardar".
- **Validación**: `ETag` en la respuesta; el cliente manda `If-None-Match`; si coincide, `304`
  sin body. Ahorra transferencia, no cómputo, salvo que el ETag salga de una versión barata
  (`updated_at`, `row_version`) sin recalcular la respuesta.
- `Vary: Authorization, Accept-Language` cuando la respuesta depende de esos headers; sin
  `Vary`, un intermediario sirve la respuesta de un usuario a otro.
- `stale-while-revalidate` para servir lo viejo mientras se refresca en background, donde la
  staleness es aceptable.
- Toda respuesta que pase por un guard de autenticación **nace** `private` o `no-store`; el
  default seguro se pone en un interceptor global y lo público se relaja explícitamente.

## 4. Claves

Formato: `<app>:<versión-esquema>:<tenant>:<recurso>:<identificador>[:<actor>][:<variantes>]`.
- **Tenant siempre**; **actor** cuando la respuesta depende de él; **variantes** que cambian
  la salida (idioma, rol, paginación, filtros normalizados y ordenados).
- Prefijo de versión: al cambiar la forma cacheada, subís la versión y el caché viejo muere
  solo; no necesitás vaciar Redis en el deploy.
- Nunca una clave construida con input crudo del usuario sin normalizar ni acotar (colisiones,
  claves infinitas). Hasheá filtros largos.
- Un endpoint cacheado por interceptor **sin actor en la clave** es el bug más común: el
  `CacheInterceptor` de NestJS cachea por URL por defecto; si la respuesta depende del usuario o
  del tenant, sobreescribí `trackBy` o no lo uses en esa ruta.

```ts
// ❌ la primera respuesta (de A) queda para todos
@UseInterceptors(CacheInterceptor)
@Get('me/appointments') list() { /* ... */ }

// ✅ respuesta por actor y tenant, TTL corto, sin exponerla a intermediarios
const key = `api:v3:${ctx.tenantId}:appointments:list:${ctx.actorId}:${hash(query)}`;
const cached = await this.cache.get<AppointmentListDto>(key);
if (cached) return cached;
const dto = await this.useCase.list(ctx, query);
await this.cache.set(key, dto, 30_000); // ms
return dto;
```

## 5. Invalidación

| Estrategia | Cuándo | Costo |
|---|---|---|
| **TTL** | staleness acotada aceptable; sin evento claro de cambio | la ventana de datos viejos = TTL |
| **Por evento** (escritura invalida) | el cambio es tuyo y sabés qué claves afecta | mantener el mapa cambio → claves; olvidar una = bug silencioso |
| **Por versión** (clave incluye `updated_at`/versión del agregado) | el lector ya conoce la versión | claves viejas quedan hasta expirar; TTL de respaldo |
| Write-through | necesitás que el caché esté caliente y consistente tras escribir | doble escritura; complejidad |

- Siempre TTL de respaldo, incluso con invalidación por evento: cubre el evento que no llegó.
- Invalidación de **familias** (todas las listas de un tenant): prefijo versionado por tenant
  (`tenant:<id>:lists:v<n>`) e incrementá `n` — no escanees claves con `KEYS`/`SCAN` en caliente.
- Invalidá **después del commit**, no dentro de la transacción (si se revierte, ya vaciaste; si
  la transacción es larga, otro lector rellena el caché con el valor viejo antes del commit).
  Con outbox/eventos (`async-messaging-events`) la invalidación llega con retraso: TTL corto para
  ese lapso.
- Invalidación inmediata obligatoria: revocación de acceso, cambio de rol, retiro de
  consentimiento, cambio de tenant activo, cierre de sesión (`multi-tenancy`, `authn-identity`).

## 6. Estampida, negativos y consistencia con el ORM

- **Estampida** (miss simultáneo de miles de requests que recalculan): lock de un solo
  recalculador (`SET NX` con TTL corto) y el resto espera o sirve stale; o jitter en los TTL
  para que no expiren todos a la vez; o refresco anticipado antes de expirar.
- **Caché negativo**: cachear "no existe" con TTL corto evita martillar la base con IDs
  inválidos; ojo con cachear un 404 que en segundos se vuelve 200 (recién creado).
- **Identity map de MikroORM no es caché**: vive en el EntityManager del request y muere con
  él. Datos "viejos" dentro de un request son otro problema (la unidad de trabajo del ORM), no se
  arreglan con Redis.
- Cacheá **DTOs serializables**, nunca entidades del ORM (referencias, colecciones perezosas,
  ciclos): guardá el resultado mapeado, plano.

## 7. Implementación en NestJS

- `@nestjs/cache-manager`: `CacheModule.register({ ttl, isGlobal })` — `ttl` en **milisegundos**;
  `@Inject(CACHE_MANAGER) cache: Cache` con `get/set/del`; `set(key, value, ttlMs)`.
- Stores vía Keyv: memoria para desarrollo, `@keyv/redis` en producción; `stores: [memoria, redis]`
  funciona como L1/L2 (el primero es primario, el resto respaldo).
- `CacheInterceptor` + `@CacheKey`/`@CacheTTL` solo en rutas **públicas** o con `trackBy`
  que incluya tenant y actor. Verificá en la doc de tu versión el comportamiento exacto de
  `trackBy` y de los headers `Cache-Control` que el interceptor respeta.
- Fallo del caché **no** es fallo del request: timeout corto hacia Redis y *fallback* a la
  fuente, con métrica de error. Un Redis caído no puede tumbar la API.
- Tamaño: TTL y límite de entradas en memoria (`lruSize`); en Redis, política de expulsión
  configurada y memoria monitoreada.

## 8. Medir

Sin números no hay caché justificado. Por caché: **hit ratio**, latencia p95 con y sin hit,
tamaño/entradas, expulsiones, errores del store, edad media de lo servido. Un hit ratio bajo
con invalidación frecuente indica que ese dato no era cacheable. Dashboard y alerta de errores
del store en `backend-observability`.

## Anti-patrones

- "Lo cacheo y listo" sin medir la query. Cachear la entidad del ORM.
- `CacheInterceptor` por URL en una ruta autenticada. Clave sin tenant.
- `no-cache` creyendo que es `no-store`. Respuesta autorizada con `public`.
- Invalidar con `KEYS *patrón*` en producción. Invalidar dentro de la transacción.
- Caché sin TTL de respaldo. Redis caído que devuelve 500.
- Cachear cupos, saldos o permisos.

## Checklist

- [ ] Medido antes: índice/query descartados como solución.
- [ ] Nada clínico ni autorizado en caché compartido; `no-store`/`private` por defecto en rutas autenticadas.
- [ ] Clave con versión de esquema, tenant, recurso, actor si aplica y variantes normalizadas.
- [ ] Invalidación elegida (TTL / evento / versión) con TTL de respaldo; post-commit.
- [ ] Invalidación inmediata en revocaciones, cambio de rol/tenant, logout.
- [ ] Protección contra estampida y política de caché negativo.
- [ ] Se cachean DTOs planos, nunca entidades.
- [ ] `ttl` en ms; store de Redis en producción con timeout y fallback; Redis caído ≠ 500.
- [ ] `ETag`/`Vary` correctos en lo que se sirve por HTTP.
- [ ] Hit ratio, latencia, tamaño y errores del store medidos y en dashboard.
