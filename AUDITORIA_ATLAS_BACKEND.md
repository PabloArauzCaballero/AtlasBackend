# Auditoría técnica ultra-detallada — `AtlasBackend__2_.zip` (v2, revisión de fondo)

**Fecha de auditoría:** 2026-07-01 (v1) — **actualizado** el mismo día con una segunda pasada enfocada en errores ocultos y riesgo de largo plazo.
**Alcance revisado:** código fuente (`src/`), migraciones y modelos (`src/database/`), pruebas (`test/`, `scripts/smoke`, `scripts/stress`), documentación (`docs/`, `README.md`, `config/roadmap/`), configuración (`package.json`, `.env`, `.env.example`, `tsconfig.json`), y comparación contra las **fuentes de verdad del proyecto** (`PROJECT_BRIEF_ATLAS.md`, `PROMPT_MASTER_ATLAS.md`, `BACKEND_DEVELOPMENT_CONTEXT.md`, `PENDIENTES_ATLAS.md`, `CHECKLIST_FINAL.md`, `CONTRIBUTING.md`, `CLAUDE.md`).

## Nota de corrección respecto a la v1 de esta auditoría

La primera versión de este documento calificaba la ausencia total del dominio BNPL (compras, cuotas, línea de crédito, comercios, MDR) como el hallazgo bloqueante #1. **Esa lectura era incorrecta dado el roadmap real del producto**, confirmado por el usuario:

> Fase 1: usuarios. Fase 2: motor de decisión y plataforma administrativa. Fase 3: deudas y otros.

Con ese contexto, el código auditado corresponde, casi en su totalidad, a **Fase 1 (usuarios) con piezas de Fase 2 ya adelantadas** (`risk`, `catalog-management`, `operations`, `data-quality`, `audit`). Que no exista `purchases`/`installment-plans`/`credit-lines`/`merchants`/`payments`/`collections` **no es un defecto**: es exactamente lo esperado en esta etapa, y ese hallazgo se retira de la lista de bloqueantes (queda documentado como nota de alineación de alcance en la Sección 2.1).

Lo que **sí sigue siendo válido, y de hecho se vuelve más importante** con este contexto, es todo lo que compromete la Fase 1 en sí misma (falta de autenticación real) y — el foco de esta segunda revisión — **los errores que hoy son invisibles porque el volumen de datos y de tráfico todavía es bajo, pero que se activan solos a medida que Atlas avanza a Fase 2 y Fase 3**: condiciones de carrera, límites que no escalan horizontalmente, trabajos en segundo plano sin bloqueo de fila, retención de datos que no purga nada, paginación que se degrada con el tiempo, y piezas de seguridad "a medio construir" que aparentan estar completas.

**Veredicto general actualizado:** la base de Fase 1 (identidad de cliente, sesiones, consentimientos, privacidad, telemetría, notificaciones) está **arquitectónicamente bien encaminada y con buenas prácticas puntuales reales** (Zod en todo el borde de entrada, mappers que no filtran modelos Sequelize, cifrado AES-256-GCM correcto, patrón de outbox con `FOR UPDATE SKIP LOCKED` bien hecho en el camino de eventos de negocio). Pero tiene **un bloqueante de alcance de fase** (no hay forma real de autenticarse) y **seis a ocho defectos latentes** que hoy no producen ningún síntoma visible y que, si no se corrigen antes de escalar tráfico o pasar a Fase 2/3, se van a manifestar como bugs de producción difíciles de diagnosticar (duplicados de clientes, límites de tasa que dejan de limitar, notificaciones duplicadas, tablas de telemetría que nunca se depuran).

Calificación por eje (escala 1–10), **recalculada con el alcance de Fase 1 como contexto correcto**:

| Eje | Nota v1 (alcance incorrecto) | Nota v2 (Fase 1 correctamente contextualizada) | Justificación del cambio |
|---|---|---|---|
| Arquitectura / alcance de producto | 2/10 | **6/10** | Correcto para Fase 1: capas bien separadas, dominio de identidad/telemetría/riesgo cubierto con profundidad razonable. Baja un poco por servicios "god object" y por mezclar prematuramente riesgo/fraude en un solo módulo. |
| Seguridad | 4/10 | **4/10 (sin cambio, mismo defecto raíz)** | El defecto de autenticación real sigue siendo bloqueante *dentro* de Fase 1 (usuarios), no es un problema de alcance futuro. |
| Concurrencia y correctitud a escala *(eje nuevo en v2)* | — | **3/10** | Ver Sección 3: condición de carrera en alta de clientes, procesamiento de outbox sin bloqueo en un camino, rate limiting no distribuido. |
| Base de datos / migraciones | 4/10 | **5/10** | El modelo de datos de Fase 1 es razonable; sigue penalizado por la migración monolítica de 13k líneas y por la falta de índices en algunas columnas de búsqueda frecuente. |
| Documentación | 3/10 | **3/10 (sin cambio)** | Sigue faltando `docs/pending/pending-items.md`, `docs/architecture/assumptions.md`, y el `README.md` raíz sigue siendo un changelog de parche. |
| Pruebas | 2/10 | **2/10 (sin cambio)** | 34 líneas de test en todo el proyecto sigue siendo crítico independientemente del alcance de producto. |
| Gobernanza de pendientes | 1/10 | **2/10** | Sube levemente porque ya no hay que declarar "falta todo el BNPL" como pendiente (no aplica en Fase 1), pero sigue sin declarar los riesgos reales de Fase 1 (Sección 3). |

**Nota global ponderada v2: ~3.9/10** (sube desde 2.8/10 al corregir el alcance, pero sigue por debajo del aprobado por los defectos de autenticación y por los riesgos ocultos de la Sección 3).

---

## 0. Cómo leer este documento

Cada hallazgo tiene:

- **ID** (`ATLAS-AUDIT-XXX`), consecutivo entre v1 y v2 para trazabilidad, compatible con el formato de `PENDIENTES_ATLAS.md`.
- **Severidad**: `P0 Bloqueante`, `P1 Alta`, `P2 Media`, `P3 Baja`.
- **Evidencia**: archivo(s) y fragmento concreto.
- **Por qué es una falla**: qué regla del propio paquete de contexto Atlas se incumple, o qué patrón de ingeniería estándar se rompe.
- **Por qué es "oculto"** *(solo hallazgos de la Sección 3)*: bajo qué condición se activa el bug, y por qué no aparece hoy en desarrollo/demo.
- **Impacto**.
- **Corrección**: acción concreta, con snippets o pasos, y **criterio de aceptación** verificable.

La Sección 8 consolida todo en un **plan de corrección secuenciado por fases, alineado al roadmap real (usuarios → motor de decisión/admin → deudas)**.

---

## 1. Hallazgos P0 — Bloqueantes dentro del alcance de Fase 1

### ATLAS-AUDIT-002 — No existe módulo de autenticación (`auth`); los JWT solo se emiten con un script de desarrollador

**Este es ahora el único hallazgo P0 del documento.** No es un problema de alcance futuro: "usuarios" (Fase 1) sin autenticación real es, por definición, una fase incompleta.

**Evidencia:**
- `scripts/create-dev-jwt.ts` firma tokens manualmente por CLI; es el **único** emisor de JWT en todo el repositorio.
- `grep -rn "login\|register" src/modules` no devuelve ningún endpoint de autenticación real.
- No existe dependencia `bcrypt` ni `argon2` en `package.json`; no hay ninguna tabla ni modelo de contraseña.
- `docs/database/dev-credentials.md` lo confirma explícitamente: *"En esta fase todavía no existe módulo Auth/JWT ni tabla de contraseña."*
- `src/common/guards/jwt-auth.guard.ts` valida tokens pero ningún controlador los emite.

**Por qué es una falla:** `BACKEND_DEVELOPMENT_CONTEXT.md` §1 exige JWT para auth con guards; §10 exige "Contraseñas con Argon2id o bcrypt" y "Refresh token con rotación y revocación". El módulo `auth` es el primero en la lista de módulos obligatorios (§3), justamente porque todo lo demás (usuarios, sesiones, consentimientos) depende de él. Sin él, **ningún cliente real puede autenticarse**; los 15 controladores con `@UseGuards(JwtAuthGuard, RolesGuard)` son inaccesibles fuera de una terminal con acceso al backend.

**Impacto:** bloqueante para cerrar Fase 1. La app móvil y el panel administrativo no tienen forma de obtener una sesión válida sin que un ingeniero les entregue un token a mano.

**Corrección:** crear módulo `auth` completo: `POST /auth/register` (por tipo de actor), `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, hashing Argon2id, tabla de refresh tokens con rotación/revocación, rate limiting reforzado y bloqueo tras intentos fallidos.

**Criterio de aceptación:** un cliente sin acceso al servidor obtiene un access+refresh token válido llamando solo a la API pública; `create-dev-jwt.ts` se elimina o se restringe explícitamente a `NODE_ENV=test`.

---

### 2.1 — Nota de alineación de alcance (ya no es un hallazgo, solo contexto)

El dominio BNPL (`purchases`, `installment-plans`, `credit-lines`, `merchants`, `payments`, `merchant-settlements`, `collections`) **no existe en el código**, y eso es correcto para el momento actual del roadmap (Fase 3). Se retira de la lista de defectos. Queda registrado únicamente como recordatorio de secuencia: no debe empezar a construirse hasta que Fase 1 (en particular `auth`, ATLAS-AUDIT-002) y Fase 2 (motor de decisión + plataforma administrativa) estén cerradas, porque el módulo financiero depende de ambas (necesita usuarios autenticados reales y necesita el motor de riesgo/scoring para el snapshot de originación exigido por `PROJECT_BRIEF_ATLAS.md` §4.4).

---

## 2. Gobernanza de pendientes — sigue siendo un hallazgo real, con alcance corregido

### ATLAS-AUDIT-003 — Los riesgos reales de Fase 1 no están declarados en el framework de gobernanza propio del proyecto

**Evidencia:** `find docs -iname "*pending*"` y `find docs -iname "*assumption*"` → vacío. No existen `docs/pending/pending-items.md` ni `docs/architecture/assumptions.md`. `PENDIENTES_ATLAS.md` solo tiene las 8 filas genéricas de decisiones de negocio originales (`ATLAS-PEND-001..008`, todas de Fase 3: concurrencia de compras, plazo del 60%, mora, MDR, etc.) y ninguna fila sobre los riesgos técnicos de Fase 1 que sí aplican hoy (Sección 3 de este documento).

**Por qué es una falla:** el propio paquete de prompts (`PROMPT_MASTER_ATLAS.md`, `PENDIENTES_ATLAS.md`, `CHECKLIST_FINAL.md`, `prompt/prompt/index.md`) exige declarar en Markdown cualquier riesgo técnico, no solo decisiones de negocio abiertas. La categoría `ATLAS-TECH-PEND` (definida en `PENDIENTES_ATLAS.md` §3, "cuando falten diagramas, contratos... o riesgo técnico") existe exactamente para hallazgos como los de la Sección 3, y no se usó ni una vez.

**Corrección:** crear `docs/pending/pending-items.md` con una fila por cada hallazgo de la Sección 3 (marcados según su severidad: `Bloqueante` para ATLAS-AUDIT-021 y 023, `Abierto` para el resto), y `docs/architecture/assumptions.md` documentando explícitamente que hoy no hay purga de datos, no hay revocación de tokens, y el rate limiting no es distribuido.

**Criterio de aceptación:** ambos archivos existen y contienen las filas correspondientes a la Sección 3 completa.

---

## 3. Segunda revisión — Errores ocultos y riesgos de largo plazo

Estos son los hallazgos centrales de esta segunda pasada. Ninguno produce un error visible hoy (pocos usuarios, poco tráfico, una sola instancia corriendo, tablas pequeñas). **Todos se activan solos cuando cambia una condición de escala** (más tráfico concurrente, más de una instancia del backend, tablas que crecen con el tiempo, o el paso a Fase 2/3 donde estas mismas piezas se reutilizan). Por eso son los más peligrosos: nadie los va a encontrar en un smoke test ni en una demo.

### ATLAS-AUDIT-021 — Condición de carrera (TOCTOU) al registrar un cliente nuevo, con respaldo de base de datos incompleto

**Severidad: P0 dentro de Fase 1** (afecta directamente la integridad del dato más importante de esta fase: el cliente).

**Evidencia:**

`src/modules/customer-onboarding/customer-onboarding.service.ts`, método `startOnboarding`:

```ts
const existing = await this.customersRepository.findByContactHash(tenantId, {
  phoneHash: phoneHash ?? undefined,
  emailHash: emailHash ?? undefined,
});

if (existing) {
  throw new ConflictException('CUSTOMER_ALREADY_EXISTS');
}

// ... validaciones de consentimiento ...

// BLOCKED: Full idempotency key deduplication requires an idempotency_keys table
// that does not exist in the current schema. Duplicate registrations are prevented
// by phone/email uniqueness above.

return this.sequelize.transaction(async (transaction) => {
  // recién aquí se crea el customer
```

La verificación de duplicado (`findByContactHash`) se ejecuta **fuera** de la transacción, como un `SELECT` independiente, antes de abrir la transacción que crea el registro. Es un patrón clásico *check-then-act* no atómico.

Además, revisando el índice real en la migración (`src/database/migrations/20260626154044-....ts`, arreglo `INDEXES`):

```json
{ "table": "customers", "fields": ["_tenant_id", "primary_phone_hash"], "where": "_deleted = false", "unique": true },
{ "table": "customers", "fields": ["primary_email_hash"], "where": "_deleted = false", "unique": false }
```

**El teléfono sí tiene un índice único parcial a nivel de base de datos (buena práctica), pero el email no.**

**Por qué es un error oculto:** con tráfico bajo y pruebas manuales secuenciales, el `SELECT` de verificación siempre "gana la carrera" y nunca se nota el problema. El bug se activa cuando:
1. Dos peticiones llegan casi simultáneamente con el mismo email (reintento de red en la app móvil por mala conectividad en Bolivia — un escenario explícitamente anticipado en `MOBILE_DEVELOPMENT_CONTEXT.md` §6, "Reintento controlado" y §10 "No enviar múltiples veces... por doble click", pero aquí la protección de doble-click vive del lado del cliente, no del servidor); o
2. Dos personas comparten el mismo email pero teléfonos distintos (o uno de los dos no da teléfono, un campo opcional según el schema).

En ambos casos, como el email no tiene restricción única en la base de datos, **nada impide que se creen dos registros de cliente distintos con el mismo email**.

**Impacto a largo plazo:** clientes duplicados contaminan todo lo que se construye encima: doble score de riesgo para la misma persona, doble historial de consentimiento, notificaciones duplicadas, y — el más grave, mirando hacia Fase 3 — riesgo de que una misma persona obtenga dos líneas de crédito independientes si el motor de decisión (Fase 2) evalúa por `customerId` sin deduplicación previa por identidad real.

**Corrección:**
1. Agregar índice único parcial en `primary_email_hash` (mismo patrón que `primary_phone_hash`): `UNIQUE (_tenant_id, primary_email_hash) WHERE _deleted = false`.
2. Envolver la creación del cliente en un `try/catch` que capture `UniqueConstraintError` y la traduzca al `ConflictException('CUSTOMER_ALREADY_EXISTS')` específico (hoy cae al mensaje genérico del filtro global, ver ATLAS-AUDIT-028).
3. Mantener la verificación previa (`findByContactHash`) como optimización de UX (falla rápido con buen mensaje), pero **no como única defensa** — la integridad real la debe garantizar el índice único.
4. Documentar el caso de "misma persona, datos de contacto distintos" como decisión de negocio pendiente (identidad determinística vs. probabilística) en `docs/pending/pending-items.md`, ya que ninguna combinación de índices de email/teléfono resuelve el caso de fraude de identidad múltiple con datos distintos — eso requiere el motor de riesgo de Fase 2.

**Criterio de aceptación:** un test de integración que dispara 2 registros concurrentes con el mismo email (teléfonos distintos) recibe exactamente una respuesta 201 y una 409, nunca dos 201.

---

### ATLAS-AUDIT-022 — El job de procesamiento de outbox "técnico" no usa bloqueo de fila; es inconsistente con el patrón correcto que ya existe en el propio proyecto

**Severidad: P1 (se activa al escalar a más de una instancia/worker).**

**Evidencia:**

Camino **correcto** (eventos de negocio / notificaciones), `src/modules/events/events.repository.ts`, método `claimPending`:

```sql
WITH candidates AS (
  SELECT _id FROM outbox_events
  WHERE status = 'pending' ... 
  ORDER BY priority DESC NULLS LAST, available_at ASC NULLS FIRST, _id ASC
  LIMIT :limit
  FOR UPDATE SKIP LOCKED
)
UPDATE outbox_events ... FROM candidates WHERE event._id = candidates._id
```

Esto es exactamente el patrón correcto para colas basadas en tabla: bloquea las filas seleccionadas, salta las que otro worker ya bloqueó (`SKIP LOCKED`), y las marca en una sola sentencia atómica.

Camino **inconsistente** (outbox "técnico" legado), `src/modules/runtime-jobs/runtime-jobs.service.ts`, método `processOutbox`:

```ts
const events = await this.outboxModel.findAll({
  where: { tenantId: input.tenantId, status: 'pending', availableAt: { [Op.lte]: new Date() } },
  order: [['availableAt', 'ASC'], ['id', 'ASC']],
  limit: input.body.limit * 3,
});
const technicalEvents = events.filter(...).slice(0, input.body.limit);
if (!input.body.dryRun) {
  for (const event of technicalEvents) {
    event.status = 'processed';
    ...
    await event.save();   // sin FOR UPDATE, sin SKIP LOCKED
  }
}
```

Aquí es un `SELECT` normal seguido de un `for` con `.save()` fila por fila, **sin ningún bloqueo**.

**Por qué es un error oculto:** hoy este job se dispara manualmente o desde un único disparador programado, así que nunca hay dos ejecuciones simultáneas. El bug aparece quien lo dispare dos veces casi al mismo tiempo — un reintento de un scheduler externo (p. ej. EventBridge) que no recibió confirmación a tiempo, un operador que lo ejecuta a mano mientras el cron también corre, o (más adelante) más de una tarea de ECS Fargate con el mismo cron configurado. En ese momento, **dos ejecuciones leen el mismo lote de eventos "pendientes" antes de que ninguna de las dos los marque como procesados**, y ambas los procesan.

**Impacto a largo plazo:** duplicación de efectos secundarios del outbox técnico (auditoría duplicada, contadores duplicados, y si en el futuro este mismo camino técnico se reutiliza para algo con efecto visible al usuario — ej. un evento que dispara una notificación — notificaciones duplicadas). Es exactamente el tipo de bug que "nunca pasó en desarrollo" y aparece la primera semana que se despliega con autoscaling real, tal como exige `INFRASTRUCTURE_DEVELOPMENT_CONTEXT.md` §2 (ECS Fargate, con más de una tarea como objetivo explícito).

**Corrección:** unificar `processOutbox` para usar el mismo patrón `FOR UPDATE SKIP LOCKED` que ya existe y funciona en `events.repository.ts::claimPending` (idealmente, reutilizar el mismo método en lugar de mantener dos implementaciones de "reclamar trabajo pendiente"). Si se decide mantener dos caminos por alguna razón de compatibilidad, documentarlo explícitamente y, como mínimo, envolver el lote completo en una única transacción con `SELECT ... FOR UPDATE SKIP LOCKED` antes del `for`.

**Criterio de aceptación:** un test que dispara `processOutbox` dos veces en paralelo sobre el mismo conjunto de eventos pendientes deja cada evento procesado exactamente una vez.

---

### ATLAS-AUDIT-023 — El rate limiting (y cualquier futura caché/sesión compartida) vive en memoria de proceso; no hay Redis pese a que la infraestructura objetivo lo exige

**Severidad: P1 (bloqueante en el momento exacto de escalar horizontalmente).**

**Evidencia:** `src/app.module.ts`:
```ts
ThrottlerModule.forRoot([{ ttl: env.API_RATE_LIMIT_TTL_MS, limit: env.API_RATE_LIMIT_MAX }]),
```
Sin `storage` personalizado, `@nestjs/throttler` usa un almacén en memoria del propio proceso Node por defecto. `grep -rn "redis\|ioredis" package.json src/` → **cero resultados**. `INFRASTRUCTURE_DEVELOPMENT_CONTEXT.md` §2 incluye `ElastiCache Redis` como parte fija del stack AWS objetivo, y §2 también fija `ECS Fargate` (múltiples tareas) como plataforma de cómputo.

**Por qué es un error oculto:** con una sola instancia corriendo (como en desarrollo y probablemente en el piloto inicial), el límite configurado (`API_RATE_LIMIT_MAX`) se respeta correctamente porque solo hay un contador. El día que se despliegue con 2 o más tareas Fargate detrás del Load Balancer (el escenario normal de alta disponibilidad que la propia infraestructura de Atlas exige), **cada instancia lleva su propio contador independiente**, así que el límite real efectivo se multiplica silenciosamente por el número de instancias, sin ningún error, alarma ni log que lo indique. Es un bug de los que "funcionan perfecto en staging con una sola tarea" y fallan en producción con autoscaling.

**Impacto a largo plazo:** protección real contra abuso/fuerza bruta (crítica una vez exista `auth`, ATLAS-AUDIT-002) mucho más débil de lo que la configuración sugiere; también bloquea, sin decirlo, cualquier necesidad futura de caché compartida (por ejemplo, cachear resultados de scoring en Fase 2) sin que nadie note que "no hay dónde poner eso" hasta que ya es urgente.

**Corrección:** agregar Redis (ElastiCache) al backend y configurar `@nestjs/throttler` con `ThrottlerStorageRedisService` (o equivalente) antes de desplegar con más de una tarea; usar el mismo Redis para cualquier necesidad futura de sesión/caché de Fase 2.

**Criterio de aceptación:** con 2 instancias del backend corriendo en paralelo apuntando al mismo Redis, una prueba de carga que dispara `N+1` peticiones (donde `N` es el límite configurado) recibe el `429` en la petición `N+1` sin importar a qué instancia haya llegado cada petición.

---

### ATLAS-AUDIT-024 — El job de retención de datos no elimina ni anonimiza nada; la telemetría sensible crece sin límite

**Severidad: P1 (riesgo de cumplimiento y de costo que se compone mes a mes).**

**Evidencia:** `src/modules/runtime-jobs/runtime-jobs.service.ts`, método `applyRetentionPolicies`:
```ts
async applyRetentionPolicies(...) {
  return this.runJob(..., async () => {
    const policies = await this.retentionPolicyModel.findAll({ where } as never);
    return {
      policiesScanned: policies.length,
      destructiveActionsExecuted: 0,   // siempre 0
      dryRun: input.body.dryRun,
      note: 'Este job registra ejecución y análisis. No elimina ni anonimiza datos sin política operativa aprobada.',
    };
  });
}
```

El job existe, tiene un endpoint (`POST /operations/jobs/apply-retention-policies`), aparenta estar implementado, pero **es un stub que solo cuenta políticas activas y nunca borra ni anonimiza nada** (`destructiveActionsExecuted` está codificado a `0`).

Mientras tanto, `MOBILE_DEVELOPMENT_CONTEXT.md` §2 y `PROJECT_BRIEF_ATLAS.md` describen recolección activa de señales de dispositivo, comportamiento y — vía `address_gps_observations` (ver `docs/architecture/flows.md`) — geolocalización, con tablas dedicadas para cada tipo de observación (`device_snapshots`, `sim_observations`, `ip_reputation_observations`, `form_field_interaction_events`, `customer_action_logs`, etc.).

**Por qué es un error oculto:** con pocos usuarios y pocos días de operación, el volumen de estas tablas es pequeño y nadie nota que "nunca se borra nada". El problema aparece meses después, de dos formas simultáneas: (a) costo de almacenamiento de RDS creciendo de forma lineal e indefinida con cada sesión/observación, sin ningún mecanismo automático de contención; y (b) exposición regulatoria — Atlas recolecta datos de comportamiento y ubicación de personas en Bolivia (`PROJECT_BRIEF_ATLAS.md` §5 ya marca que "ASFI, contratos, consentimientos, privacidad... deben tratarse con cuidado"), y una política de retención que existe solo como configuración pero nunca se ejecuta es, en la práctica, retención indefinida no declarada.

**Impacto a largo plazo:** este hallazgo se vuelve crítico exactamente cuando Fase 2 (motor de decisión) empiece a depender de estas mismas tablas de telemetría para scoring — en ese punto, cambiar la política de retención retroactivamente es mucho más difícil porque el motor de riesgo puede llegar a depender de historiales largos que en realidad nunca debieron conservarse sin anonimizar.

**Corrección:** implementar al menos un mecanismo real de purga/anonimización para las tablas de mayor volumen (empezar por `address_gps_observations`, `device_snapshots`, `customer_action_logs`, `form_field_interaction_events`), parametrizado por `retention_policies.retention_days`; ejecutar primero en modo `dryRun` con reporte de cuántas filas *serían* afectadas, y solo después habilitar el borrado/anonimización real con aprobación explícita documentada (tal como el propio código ya insinúa con la frase "sin política operativa aprobada" — falta cerrar esa aprobación y luego implementar la acción).

**Criterio de aceptación:** `applyRetentionPolicies` con `dryRun=false` reduce efectivamente el conteo de filas vencidas según la política, y queda un registro auditable (`operational_audit_logs`) de cada ejecución con el número real de filas afectadas.

---

### ATLAS-AUDIT-025 — Paginación por `OFFSET` en todos los listados administrativos; se degrada exactamente en las tablas que más van a crecer

**Severidad: P2 (dolor progresivo, no un corte súbito).**

**Evidencia:** `src/common/utils/pagination/pagination.util.ts`:
```ts
export function toOffset(input: PaginationInput): number {
  return (input.page - 1) * input.limit;
}
```
Usado de forma uniforme en los listados de `operations` (cola de trabajo, auditoría, calidad de datos) y previsiblemente en cualquier listado futuro que siga el mismo patrón.

**Por qué es un error oculto:** con cientos o pocos miles de filas, `OFFSET`/`LIMIT` es indistinguible en performance de una alternativa por cursor. El costo de un `OFFSET` en PostgreSQL crece linealmente con la profundidad de la página (la base de datos igual tiene que recorrer y descartar todas las filas anteriores al offset), así que el síntoma no aparece hasta que las tablas de alto crecimiento — exactamente las de telemetría/auditoría que ATLAS-AUDIT-024 ya identifica como no depuradas — acumulan suficiente volumen. En ese momento, las páginas "profundas" del panel de operaciones (que Fase 2 va a usar todos los días) se vuelven progresivamente más lentas sin que ningún despliegue nuevo lo haya causado — el código no cambió, los datos sí.

**Impacto a largo plazo:** justo cuando el "motor de decisión y plataforma administrativa" (Fase 2) empiece a depender de estos listados para el trabajo diario de analistas de riesgo, la paginación empezará a degradarse — el peor momento posible para descubrirlo.

**Corrección:** para las tablas de alto crecimiento (auditoría, telemetría, cola de trabajo de operaciones), migrar a paginación por cursor/keyset (`WHERE (created_at, id) < (:lastCreatedAt, :lastId) ORDER BY created_at DESC, id DESC LIMIT :limit`) y asegurar que existan índices compuestos que cubran ese orden. Mantener `OFFSET` solo para listados pequeños y acotados (catálogos, definiciones).

**Criterio de aceptación:** el tiempo de respuesta de `GET /operations/audit/customer/:id` no crece de forma perceptible al pasar de una tabla con 10k filas a una con 5M filas en un benchmark controlado.

---

### ATLAS-AUDIT-026 — El campo de revocación de token (`tokenVersion`) existe en el tipo pero nunca se valida; riesgo de falsa sensación de seguridad al construir `auth`

**Severidad: P2 (landmine para el próximo desarrollador, no un bug activo hoy).**

**Evidencia:** `grep -rn "tokenVersion" src/` devuelve exactamente 2 líneas:
```ts
// src/common/types/auth.types.ts
tokenVersion?: number;

// src/common/guards/jwt-auth.guard.ts
tokenVersion: typeof payload.tokenVersion === 'number' ? payload.tokenVersion : undefined,
```
El campo se **define** en el tipo `AuthenticatedUser` y se **extrae** del payload del JWT decodificado, pero **en ningún lugar del código se compara contra un valor almacenado** (por ejemplo, un `tokenVersion` guardado en la tabla de usuario que se incrementa al cambiar contraseña o al forzar cierre de sesión).

**Por qué es un error oculto:** el campo *parece* una funcionalidad de seguridad terminada — está tipado, está en el guard, se ve "conectado". Cualquier desarrollador que construya el módulo `auth` (ATLAS-AUDIT-002) y vea este campo ya presente puede asumir razonablemente que la revocación de tokens ya funciona, cuando en realidad hoy **un token JWT firmado sigue siendo válido durante toda su vigencia (`JWT_ACCESS_TOKEN_EXPIRES_IN`, por defecto 1h) sin ninguna forma de invalidarlo antes de tiempo**, ni siquiera si se detecta que la cuenta fue comprometida o si un `internal_operator` es despedido.

**Impacto a largo plazo:** en Fase 1 (usuarios) el radio de impacto es acotado (tokens de 1h). En Fase 2, cuando existan roles internos con permisos sensibles sobre datos de riesgo/fraude, y sobre todo en Fase 3 (acceso a datos financieros), la ausencia de revocación real de tokens es un hueco de seguridad mucho más caro, y para entonces habrá más código asumiendo (incorrectamente) que `tokenVersion` "ya está resuelto".

**Corrección:** o se implementa la validación real (guardar `tokenVersion` en la tabla de usuario/actor, incrementarlo en cambio de contraseña/cierre forzado de sesión, y que `JwtAuthGuard` la compare contra la base de datos o contra una lista de revocación en Redis — ver ATLAS-AUDIT-023, mismo Redis serviría para esto), o se elimina el campo del tipo hasta implementarlo, dejando explícito en `docs/architecture/assumptions.md` que hoy no hay revocación de tokens antes de expiración natural.

**Criterio de aceptación:** un token emitido antes de un cambio de contraseña deja de ser válido inmediatamente después del cambio (probado con un test de integración), o el campo `tokenVersion` no existe en el código hasta que esto sea cierto.

---

### ATLAS-AUDIT-027 — La verificación de "el cliente solo puede ver sus propios datos" está copiada a mano en 6+ archivos de servicio distintos, con firmas inconsistentes

**Severidad: P2 (no es una vulnerabilidad activa hoy — los 6+ casos actuales sí verifican correctamente — pero es una bomba de tiempo de mantenimiento y de seguridad).**

**Evidencia:** `grep -rn "assertCustomerAccess" src/modules --include=*.service.ts` encuentra la misma función reimplementada de forma independiente en:

| Archivo | Firma |
|---|---|
| `customers.service.ts` | `assertCustomerAccess(customerId, currentUser)` |
| `customer-privacy.service.ts` | `assertCustomerAccess(customerId, user)` |
| `customer-telemetry.service.ts` | `assertCustomerAccess(customerId, user)` |
| `risk.service.ts` | `assertCustomerAccess(customerId, currentUser)` |
| `sessions.service.ts` | `assertCustomerAccess(customerId, user)` (lógica ligeramente distinta: exige rol `customer` explícitamente, no solo lo permite) |
| `notifications.service.ts` | `assertCustomerAccess(currentUser, customerId)` — **orden de argumentos invertido respecto a los demás** |
| `customer-onboarding.service.ts` | verificación inline sin función extraída, línea 410 |

Cada archivo define su propia copia de una función que debería ser una sola pieza de infraestructura compartida (por ejemplo, un `@OwnCustomerResource()` decorator + guard, o un helper único importado por todos).

**Por qué es un error oculto:** hoy, los 7 lugares donde debería existir esta verificación **sí la tienen**, así que no hay ningún IDOR explotable actualmente (verificado explícitamente: `audit.controller.ts` y `operations.controller.ts` exponen rutas con `:customerId` pero están restringidas a roles internos vía `@Roles(...)` que excluyen `customer`, así que tampoco aplica ahí). El riesgo no está en el código de hoy, está en **el próximo módulo**: cada vez que se agregue un nuevo endpoint `GET /customers/:customerId/algo-nuevo` (y habrá muchos, en Fase 2 y Fase 3), alguien tiene que acordarse de copiar esta función a mano por octava vez, con la firma correcta. Un solo olvido —y con 7 variantes de firma circulando, es fácil invertir el orden de los argumentos como ya pasó en `notifications.service.ts`— convierte ese endpoint nuevo en un IDOR real: un cliente autenticado accediendo a los datos de otro cliente con solo cambiar el ID en la URL.

**Impacto a largo plazo:** el costo de este defecto no es el código actual, es la probabilidad acumulada de que el próximo desarrollador (humano o IA) que agregue el endpoint número 30, 40 o 50 con `:customerId` lo haga sin esta verificación, o la haga mal, especialmente bajo presión de tiempo en Fase 2/3 cuando el catálogo de endpoints ya sea grande.

**Corrección:** extraer una única función/decorator compartido en `src/common/` (p. ej. `assertOwnCustomerResource(currentUser, customerId)`, firma única y documentada) y hacer que los 7 casos actuales la importen en vez de redefinirla; idealmente, promoverlo a un guard reusable (`@UseGuards(CustomerOwnershipGuard)`) que lea el parámetro `:customerId` de la ruta automáticamente, para que sea imposible de omitir por accidente en un controlador nuevo.

**Criterio de aceptación:** existe una sola implementación de esta verificación en todo el repositorio; un test de "contrato" en CI falla si aparece una segunda función con un nombre o propósito equivalente definida localmente en un módulo.

---

### ATLAS-AUDIT-028 — Bajo condición de carrera, el cliente recibe un mensaje de error genérico en vez del específico

**Severidad: P3 (UX/observabilidad menor, consecuencia directa de ATLAS-AUDIT-021).**

**Evidencia:** como no hay `try/catch` de `UniqueConstraintError` alrededor de la creación del cliente dentro de la transacción (ver ATLAS-AUDIT-021), si dos peticiones llegan a competir por el mismo índice único, la que pierde la carrera no recibe el mensaje de negocio `CUSTOMER_ALREADY_EXISTS` (el que sí se lanza en el chequeo previo), sino el mensaje genérico del filtro global: *"El recurso ya existe o viola una restricción única."*

**Impacto:** menor, pero dificulta el diagnóstico en soporte/observabilidad, y es inconsistente para el cliente de la app móvil, que tendría que manejar dos mensajes distintos para el mismo caso de negocio.

**Corrección:** se resuelve como parte de la corrección de ATLAS-AUDIT-021 (capturar `UniqueConstraintError` dentro de la transacción y relanzar como `ConflictException('CUSTOMER_ALREADY_EXISTS')`).

**Criterio de aceptación:** ambos caminos (chequeo previo y colisión bajo carrera) devuelven el mismo código de error de negocio.

---

## 4. Hallazgos P1 de la v1 que siguen vigentes sin cambios de severidad

### ATLAS-AUDIT-004 — `.env` real committeado en el paquete entregado

**Evidencia:** `./.env` existe en el zip entregado, con `DB_PASSWORD=root`, `API_RATE_LIMIT_MAX=200000`. `.gitignore` sí excluye `.env`, lo que confirma que el archivo fue incluido manualmente en el empaquetado, no vía `git`.

**Corrección:** eliminar `.env` del paquete/repositorio; agregar chequeo de CI que falle si reaparece.

**Criterio de aceptación:** el zip/repo entregado no contiene `.env`; CI falla si aparece.

---

### ATLAS-AUDIT-005 — Stack de pruebas no cumple lo pactado (Jest) y cobertura de pruebas es casi nula

**Evidencia:** `package.json` usa Node test runner nativo, no Jest. `find src -name "*.spec.ts" -o -name "*.test.ts"` → 0 resultados. `test/unit/` tiene 2 archivos, 34 líneas totales.

**Corrección:** migrar a Jest, escribir specs de servicio para los 15 módulos existentes, priorizando `customer-onboarding` (973 líneas, ahora además con el defecto de concurrencia de ATLAS-AUDIT-021) y `sessions` (732 líneas).

**Criterio de aceptación:** `yarn test` corre con Jest; cobertura ≥70% en `src/modules/**/*.service.ts`.

---

### ATLAS-AUDIT-006 — Ausencia total de Swagger/OpenAPI

**Evidencia:** no hay `@nestjs/swagger`; no hay `docs/endpoints/openapi.yaml`.

**Corrección:** instalar `@nestjs/swagger`, exponer `SwaggerModule`, generar `docs/endpoints/openapi.yaml` en build.

**Criterio de aceptación:** `docs/endpoints/openapi.yaml` existe, se regenera automáticamente y valida en CI.

---

### ATLAS-AUDIT-007 — Migración monolítica de 13.037 líneas

**Evidencia:** `src/database/migrations/20260626154044-....ts` crea decenas de tablas en un único archivo.

**Corrección:** dividir en migraciones por dominio relacionado, cada una con `up`/`down` probado individualmente.

**Criterio de aceptación:** ninguna migración supera ~500–800 líneas; `db:migration:down` funciona paso a paso.

---

### ATLAS-AUDIT-008 — `README.md` raíz no es una guía de proyecto, es un changelog de parche puntual

**Corrección:** reescribir `README.md` con alcance real (Fase 1 en curso), stack, estructura, comandos, enlaces a `docs/`.

**Criterio de aceptación:** un desarrollador nuevo levanta el proyecto siguiendo solo el `README.md`.

---

### ATLAS-AUDIT-009 — `config/roadmap/implementation_phases.yaml` es un stub vacío

**Corrección:** completar con las fases reales alineadas al roadmap de negocio (usuarios → decisión/admin → deudas) o eliminar hasta tener contenido.

**Criterio de aceptación:** el archivo refleja fases reales o no existe.

---

## 5. Hallazgos P2 de la v1 que siguen vigentes

### ATLAS-AUDIT-010 — Servicios "god object" sin descomponer en casos de uso

`customer-onboarding.service.ts` (973 líneas) y `sessions.service.ts` (732 líneas) siguen siendo los archivos más grandes y más riesgosos del proyecto — y ahora sabemos que uno de ellos (`customer-onboarding`) también concentra el defecto de concurrencia más serio (ATLAS-AUDIT-021). Esto refuerza la corrección: dividir en pasos (`*.steps/*.ts`) no es solo higiene de código, es lo que permite testear el paso de "creación de cliente" de forma aislada y con un test de concurrencia dedicado.

### ATLAS-AUDIT-011 — Idempotencia es opcional, no obligatoria, en endpoints de escritura

Sigue vigente; se vuelve más relevante ahora que se confirmó formalmente que el patrón de outbox tiene un camino sin bloqueo (ATLAS-AUDIT-022) — la combinación de "idempotencia opcional" + "outbox sin lock en un camino" es la receta típica para efectos duplicados en producción.

### ATLAS-AUDIT-012, 013, 014 — Sin cambios

Cifrado sin KMS/rotación, contraseñas en Markdown versionado, y `fraud` no siendo módulo independiente de `risk` siguen vigentes tal como en la v1. Este último (`fraud` como módulo propio) es ahora explícitamente relevante para Fase 2 — conviene resolverlo **antes** de que `risk.service.ts` (313 líneas) crezca más mezclando ambas responsabilidades.

---

## 6. Hallazgos P3 (sin cambios respecto a v1)

| ID | Hallazgo | Corrección |
|---|---|---|
| ATLAS-AUDIT-015 | `progress-report.md` mezcla historial de parches sin versión clara. | Adoptar `CHANGELOG.md` con formato [Keep a Changelog]. |
| ATLAS-AUDIT-016 | IDs secuenciales enteros en entidades sensibles (clientes, tenants). | Evaluar UUID v7 para entidades expuestas en URLs públicas. |
| ATLAS-AUDIT-017 | Uso de `sequelize.query` sin justificación documentada en `events.repository.ts`. | Documentar el motivo en el README del módulo. |
| ATLAS-AUDIT-018 | `API_RATE_LIMIT_MAX=200000` en `.env` committeado. | Se resuelve junto con ATLAS-AUDIT-004; agregar techo máximo validado en `env.ts` para producción. |
| ATLAS-AUDIT-019 | Sin CI (`.github/workflows/`). | Implementar GitHub Actions (install, lint, type-check, test, build). |
| ATLAS-AUDIT-020 | Sin ESLint/Prettier configurado. | Añadir ESLint + Prettier con reglas mínimas. |

---

## 7. Lo que sí está bien hecho (confirmado y reforzado en esta segunda pasada)

- El patrón de reclamo de trabajo con `FOR UPDATE SKIP LOCKED` en `events.repository.ts::claimPending` es **correcto y de buen nivel** — es la referencia que se debe copiar hacia `runtime-jobs.service.ts` (ATLAS-AUDIT-022), no al revés.
- El índice único parcial en `primary_phone_hash` demuestra que el equipo ya conoce el patrón correcto de integridad a nivel de base de datos; solo falta aplicarlo de forma consistente (falta en `primary_email_hash`, ATLAS-AUDIT-021).
- `env.ts` sigue siendo un ejemplo sólido de validación de configuración con bloqueos explícitos de valores por defecto en producción.
- El filtro global de excepciones (`HttpExceptionFilter`) maneja bien `SequelizeUniqueConstraintError`/`ValidationError` como `409`, sin filtrar detalles internos — esto es lo que evita que ATLAS-AUDIT-021 sea también una fuga de información, aunque el mensaje que produce hoy sea genérico (ATLAS-AUDIT-028).
- La verificación de propiedad de recurso (`assertCustomerAccess`) está, de hecho, implementada correctamente en los 7 lugares donde existe hoy — el problema (ATLAS-AUDIT-027) es de duplicación/mantenibilidad, no de una omisión activa.

---

## 8. Matriz resumen de hallazgos (v2)

| ID | Severidad | Área | Título |
|---|---|---|---|
| ATLAS-AUDIT-002 | **P0** | Seguridad | Sin módulo `auth`, sin emisión real de JWT |
| ATLAS-AUDIT-021 | **P0 (dentro de Fase 1)** | Concurrencia / integridad de datos | Condición de carrera en alta de cliente; sin índice único en email |
| ATLAS-AUDIT-003 | P1 | Gobernanza | Riesgos técnicos de Fase 1 no declarados en Markdown |
| ATLAS-AUDIT-004 | P1 | Seguridad | `.env` real committeado |
| ATLAS-AUDIT-005 | P1 | Pruebas | Sin Jest, cobertura ~0% |
| ATLAS-AUDIT-006 | P1 | Documentación/API | Sin Swagger/OpenAPI |
| ATLAS-AUDIT-007 | P1 | Base de datos | Migración monolítica de 13k líneas |
| ATLAS-AUDIT-008 | P1 | Documentación | README raíz no es guía de proyecto |
| ATLAS-AUDIT-009 | P1 | Documentación | Roadmap YAML vacío entregado como final |
| ATLAS-AUDIT-022 | P1 | Concurrencia | Outbox técnico sin bloqueo de fila (inconsistente con el patrón correcto ya existente) |
| ATLAS-AUDIT-023 | P1 | Escalabilidad | Rate limiting no distribuido (sin Redis) |
| ATLAS-AUDIT-024 | P1 | Cumplimiento / costo | Job de retención es un stub; telemetría sensible sin purga |
| ATLAS-AUDIT-010 | P2 | Código | Servicios "god object" (700–970 líneas) |
| ATLAS-AUDIT-011 | P2 | Arquitectura | Idempotencia opcional, no obligatoria |
| ATLAS-AUDIT-012 | P2 | Seguridad | Cifrado sin KMS/rotación |
| ATLAS-AUDIT-013 | P2 | Seguridad/Docs | Contraseñas en Markdown versionado |
| ATLAS-AUDIT-014 | P2 | Arquitectura | `fraud` no es módulo independiente (relevante ahora para Fase 2) |
| ATLAS-AUDIT-025 | P2 | Rendimiento a largo plazo | Paginación por `OFFSET` en tablas de alto crecimiento |
| ATLAS-AUDIT-026 | P2 | Seguridad | `tokenVersion` sin validar (falsa sensación de revocación) |
| ATLAS-AUDIT-027 | P2 | Mantenibilidad / seguridad | Verificación de ownership duplicada en 7 lugares, firmas inconsistentes |
| ATLAS-AUDIT-015..020, 028 | P3 | Varias | Changelog, IDs, SQL crudo, CI, lint, límites, mensaje genérico bajo carrera |

---

## 9. Plan de corrección — reordenado según el roadmap real (usuarios → motor de decisión/admin → deudas)

### Fase A — Cerrar Fase 1 de negocio de verdad (1–2 semanas)

Objetivo: que "usuarios" deje de tener huecos que se notarán en Fase 2/3.

1. **Auth real** (ATLAS-AUDIT-002): módulo completo con login/register/refresh/logout, Argon2id, rotación de refresh tokens.
2. **Cerrar la condición de carrera de alta de cliente** (ATLAS-AUDIT-021 y 028): índice único en `primary_email_hash`, manejo de `UniqueConstraintError` dentro de la transacción, test de concurrencia.
3. **Unificar el patrón de outbox** (ATLAS-AUDIT-022): `processOutbox` debe usar `FOR UPDATE SKIP LOCKED` como `claimPending`.
4. **Redis para rate limiting** (ATLAS-AUDIT-023): antes de cualquier despliegue con más de una instancia.
5. **Implementar retención real** (ATLAS-AUDIT-024): al menos para las tablas de mayor volumen, empezando en modo `dryRun`.
6. **Unificar verificación de ownership** (ATLAS-AUDIT-027): una sola función/guard compartido.
7. **Decidir y documentar (o implementar) revocación real de tokens** (ATLAS-AUDIT-026).

**Salida de Fase A:** un cliente real puede registrarse, autenticarse y usar la app sin que ninguno de los 7 hallazgos anteriores pueda producir un dato corrupto o un hueco de seguridad, incluso bajo tráfico concurrente y con más de una instancia del backend corriendo.

### Fase B — Higiene de ingeniería transversal (2–3 semanas, puede correr en paralelo a Fase A)

1. Eliminar `.env` real del paquete (ATLAS-AUDIT-004) + CI que lo impida.
2. Migrar a Jest y construir cobertura real, priorizando `customer-onboarding` y `sessions` (ATLAS-AUDIT-005 y 010).
3. Swagger/OpenAPI real (ATLAS-AUDIT-006).
4. Dividir la migración monolítica (ATLAS-AUDIT-007).
5. README real + `docs/pending/pending-items.md` + `docs/architecture/assumptions.md` (ATLAS-AUDIT-003, 008, 009).
6. Paginación por cursor en tablas de alto crecimiento (ATLAS-AUDIT-025).
7. CI con lint/type-check/test/build (ATLAS-AUDIT-019, 020).

**Salida de Fase B:** el proyecto es mantenible y auditable por cualquier ingeniero nuevo sin arqueología de código.

### Fase C — Motor de decisión y plataforma administrativa (Fase 2 de negocio)

Antes de empezar, extraer `fraud` como módulo independiente de `risk` (ATLAS-AUDIT-014), para no seguir mezclando responsabilidades a medida que esta fase crece. El resto del diseño de esta fase (scoring, reglas, catálogos, panel administrativo) puede construirse sobre la base ya existente de `risk`, `catalog-management`, `operations`, `data-quality`, que en esta auditoría se confirma como razonablemente sólida.

### Fase D — Deudas y otros (Fase 3 de negocio: BNPL)

Cuando llegue el momento (después de A, B y C), retomar el diseño completo de `merchants`, `credit-lines`, `purchases`, `installment-plans`, `payments`, `merchant-settlements`, `collections` descrito en la Sección 2.1, respetando las 8 decisiones de negocio todavía abiertas en `PENDIENTES_ATLAS.md` (`ATLAS-PEND-001..008`) como interfaces/supuestos documentados, no como reglas cerradas por la IA.

---

## 10. Checklist de salida actualizado

**Fase 1 (usuarios) — bloqueantes para considerarla cerrada**
- [ ] Módulo `auth` real (login/register/refresh/logout, Argon2id, rotación de refresh tokens).
- [ ] Índice único en `primary_email_hash`; manejo correcto de colisión bajo carrera.
- [ ] `processOutbox` usa `FOR UPDATE SKIP LOCKED`.
- [ ] Rate limiting respaldado por Redis, verificado con más de una instancia corriendo.
- [ ] Job de retención ejecuta acciones reales (no solo cuenta políticas).
- [ ] Verificación de ownership unificada en una sola implementación.
- [ ] Decisión explícita y documentada sobre revocación de tokens.

**Higiene transversal**
- [ ] No hay `.env` real en el repo/paquete (verificado por CI).
- [ ] Jest como framework de test; cobertura ≥70% en services.
- [ ] Swagger/OpenAPI generado y validado en CI.
- [ ] Ninguna migración individual excede ~800 líneas.
- [ ] `README.md` raíz es una guía real; `docs/pending/pending-items.md` y `docs/architecture/assumptions.md` existen y están al día.
- [ ] Paginación por cursor en tablas de alto crecimiento (auditoría, telemetría).
- [ ] CI con lint/type-check/test/build.

**Fase 2 (motor de decisión y plataforma administrativa)**
- [ ] `fraud` extraído como módulo independiente de `risk`.
- [ ] Diseño de scoring/reglas reutiliza la base de `catalog-management`/`operations` ya validada en esta auditoría.

**Fase 3 (deudas y otros) — no iniciar antes de cerrar las anteriores**
- [ ] Las 8 decisiones de negocio de `PENDIENTES_ATLAS.md` (`ATLAS-PEND-001..008`) siguen modeladas como interfaces/supuestos hasta tener aprobación explícita, nunca como reglas cerradas por la IA.

**Honestidad de entrega**
- [ ] La respuesta/PR final indica explícitamente qué se validó, qué se asumió y qué sigue bloqueante — sin excepciones, tal como exige `CHECKLIST_FINAL.md`.

## Patch 5 — Jest globals y entorno de test explícito

- Corregido `yarn test:coverage` cuando `ts-jest` no reconocía `describe`, `it`, `expect` y `jest`.
- Los tests unitarios ahora importan explícitamente los helpers desde `@jest/globals`, evitando depender de globals implícitos o de un `tsconfig` productivo.
- Agregado `tsconfig.spec.json` para aislar la compilación de tests.
- Agregado `test/setup-jest-env.cjs` para forzar `NODE_ENV=test` aunque Windows tenga `NODE_ENV=production` configurado globalmente.
- `jest.config.cjs` ahora usa `tsconfig.spec.json`, `isolatedModules` y `setupFiles` para evitar el warning de módulo híbrido y errores falsos de configuración.
