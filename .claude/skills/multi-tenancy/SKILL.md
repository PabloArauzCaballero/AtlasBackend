---
name: multi-tenancy
description: Gate de aislamiento entre organizaciones (tenants) en la API NestJS + MikroORM + PostgreSQL — elección del modelo (columna tenant con RLS, esquema o base por tenant), contexto de tenant por request, filtro global en el ORM, rutas agnósticas de tenant como excepción declarada, fugas típicas en jobs, cachés, búsquedas, exportes y logs, usuarios que pertenecen a varias organizaciones y tests de aislamiento cruzado. Usar al crear una tabla, endpoint, job, caché o índice de búsqueda en un sistema multi-organización, y antes de cerrar cualquier cambio que toque datos con dueño organizacional.
allowed-tools: Read Grep Glob Bash
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Multi-tenancy — gate de aislamiento

Un tenant es la organización dueña de los datos (clínica, grupo médico, aseguradora). La falla
característica no es un crash: es **mostrarle a una organización los datos de otra**, en
silencio. En salud eso es una brecha de datos clínicos. `authz-access-control` decide qué
puede hacer un actor *dentro* de su tenant; esta skill garantiza que nunca salga de él.

## 1. Elegir el modelo de aislamiento

| Modelo | Aislamiento | Costo operativo | Cuándo |
|---|---|---|---|
| Columna `tenant_id` en tablas compartidas | lógico (depende del código + RLS) | bajo | muchos tenants chicos; default de la casa |
| Esquema por tenant | medio | medio (DDL × N, `search_path`) | decenas de tenants, necesidad de restore por tenant |
| Base por tenant | fuerte | alto (conexiones, despliegues × N) | pocos tenants grandes, exigencia contractual o regulatoria |

- Decidilo una vez, registralo en un ADR (`technical-docs-and-adr`) y no mezcles modelos sin razón.
- Con columna compartida, **dos capas** obligatorias: filtro en el ORM (comodidad y default
  seguro) **y** RLS en Postgres (red de contención cuando el código se equivoca).

## 2. Esquema con columna tenant

1. `tenant_id NOT NULL` con FK en **toda** tabla con dueño organizacional. Tabla sin `tenant_id`
   ⇒ o es global (catálogo, terminología) y se declara como tal, o es un bug.
2. Claves únicas **compuestas con el tenant**: `UNIQUE (tenant_id, code)`, no `UNIQUE (code)`.
3. FKs entre tablas del mismo tenant: incluí `tenant_id` en la FK compuesta para que sea
   imposible referenciar una fila de otro tenant a nivel de base.
4. Índices que empiezan por `tenant_id` para las consultas calientes (`database-design`).
5. El modelo es la fuente de verdad: el cambio entra por el diagrama y el generador
   (`model-driven-schema`), no por DDL a mano.

## 3. Row Level Security en PostgreSQL

```sql
ALTER TABLE appointment ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment FORCE ROW LEVEL SECURITY;   -- también aplica al dueño de la tabla

CREATE POLICY tenant_isolation ON appointment
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

- Con RLS habilitada y **sin** política, Postgres aplica *default-deny*: no se ve ni modifica nada.
- `USING` filtra lo que se lee/afecta; `WITH CHECK` valida lo que se escribe. Si omitís
  `WITH CHECK`, hereda la expresión de `USING`.
- **Bypass**: superusuarios y roles con `BYPASSRLS` siempre saltean RLS; el dueño de la tabla
  también, salvo `FORCE ROW LEVEL SECURITY`. ⇒ El rol de conexión de la aplicación **no** es
  superusuario, **no** es dueño de las tablas y **no** tiene `BYPASSRLS`. Las tareas de
  mantenimiento usan otro rol.
- Con pool de conexiones, el valor se fija **por transacción**: `SELECT set_config('app.tenant_id', $1, true)`
  (tercer argumento `true` = local a la transacción). Un `SET` de sesión queda pegado a la
  conexión y lo hereda el próximo request: fuga garantizada.
- Si la variable no está seteada, `current_setting('app.tenant_id')` falla ⇒ la query falla
  cerrada. No uses la variante tolerante a ausencia para "que no rompa".

## 4. Contexto de tenant por request

1. El tenant se resuelve **en el servidor** a partir de la sesión y de la membresía del actor.
   Un header o parámetro del cliente solo *selecciona* entre los tenants a los que el actor
   ya pertenece; nunca se confía en él sin validar la membresía.
2. Un interceptor/guard lo resuelve una vez y lo deja en un contexto por request
   (`AsyncLocalStorage`). Providers request-scoped de NestJS funcionan, pero propagan el scope
   a toda la cadena de inyección: medí antes de adoptarlos (`nestjs-development`).
3. **Sin tenant resuelto, la request falla** (salvo ruta declarada agnóstica). Nada de tenant
   por defecto ni de "el primero de la lista".
4. El `tenant_id` de una fila nueva lo pone el servidor desde el contexto; jamás viene del body.

## 5. Filtro global en el ORM (MikroORM)

```ts
// registro: filtro global, activo por defecto, limitado a las entidades con tenant
em.addFilter('tenant', (args) => ({ tenant: args.tenantId }), [Appointment, Invoice]);

// por request (middleware/interceptor), sobre el EntityManager de ESE request
em.setFilterParams('tenant', { tenantId: ctx.tenantId });
```

- Alternativa declarativa: `@Filter({ name: 'tenant', cond: args => ({ tenant: args.tenantId }), default: true })`.
- Se desactiva por consulta con `filters: { tenant: false }` o `filters: false`. **Cada
  desactivación es una excepción auditable**: va envuelta en un helper con nombre explícito,
  con comentario del porqué, y es lo primero que se busca con `grep` en una revisión.
- Los filtros **no** cubren SQL crudo, el query builder usado sin pasar por el filtro, ni
  `em.nativeUpdate/Delete` — verificá en la doc de tu versión qué caminos los aplican. Por eso
  RLS es obligatoria y no opcional.
- Seteá los parámetros sobre el EM con contexto del request, nunca sobre el EM global compartido.

## 6. Rutas agnósticas de tenant — excepción declarada

Login, selección de organización, catálogos globales, directorios públicos y health checks no
tienen tenant. Se marcan con un decorador explícito (p. ej. `@TenantAgnostic()`), y:
- la lista completa de rutas agnósticas es corta, está en un solo lugar y se revisa en cada PR;
- una ruta agnóstica que toca tablas con tenant exige justificación escrita;
- los datos **públicos** de una organización (perfil en un directorio) se exponen por una
  proyección dedicada, no desactivando el filtro sobre la entidad completa.

## 7. Dónde se fuga — revisá cada una

| Superficie | Fuga típica | Control |
|---|---|---|
| Jobs / cron / consumidores | no hay request ⇒ no hay contexto; corre "sin tenant" y barre todo | el payload lleva `tenantId`; el worker abre contexto y transacción por tenant (`background-jobs-scheduling`) |
| Caché | clave sin tenant ⇒ respuesta de A servida a B | tenant (y usuario) en la clave (`caching-strategy`) |
| Búsqueda / índices | índice global sin filtro de tenant; autocompletar que revela nombres ajenos | tenant como filtro obligatorio del índice (`search-and-filtering`) |
| Exportes / reportes | SQL crudo de reporting sin `WHERE tenant_id` | pasar por la misma capa filtrada; RLS activa también para reporting |
| Archivos | ruta de storage adivinable sin tenant | prefijo por tenant + URL firmada (`file-uploads-media`) |
| Logs y trazas | mezcla que impide auditar; datos sensibles de un tenant en logs de soporte de otro | `tenant_id` como atributo estructurado; sin datos sensibles (`backend-observability`) |
| Eventos | consumidor procesa evento de otro tenant | `tenantId` en el sobre del evento (`async-messaging-events`) |
| Secuencias / numeración | correlativo global revela volumen ajeno | numeración por tenant |
| Websockets | canal compartido | canal/room con tenant, autorizado al suscribir |
| Errores | mensaje de unicidad que revela que "ese código ya existe" en otro tenant | unicidad compuesta con tenant |

## 8. Usuarios en varias organizaciones

- **Identidad global, membresía por tenant**: `user` ↔ `membership(user, tenant, role, estado)`.
  El rol es de la membresía, no del usuario.
- La sesión tiene **un tenant activo**; cambiarlo es una acción explícita que re-evalúa permisos
  e **invalida cachés y estado del cliente** del tenant anterior.
- Nunca unas datos de dos tenants en una misma respuesta "porque el usuario pertenece a ambos",
  salvo vista diseñada para eso (p. ej. "mis organizaciones") con proyección mínima.
- Membresía suspendida o revocada corta el acceso **en el próximo request**, no al expirar el token.
- El paciente suele ser transversal a organizaciones: decidí explícitamente qué datos suyos son
  del tenant (la historia en esa clínica) y cuáles de la persona (su perfil), según
  `data-privacy-sensitive`.

## 9. Operación

- Alta de tenant idempotente y scripteada; baja con política de retención y borrado definida
  (`data-privacy-sensitive`). Restore por tenant: planteá cómo se hace **antes** de necesitarlo
  (`backup-restore-dr`).
- Acceso de soporte entre tenants: rol separado, con motivo, tiempo acotado y auditoría
  (`audit-trail-history`). Nunca desactivando RLS con el rol de la aplicación.
- Vecino ruidoso: cuotas y rate limit por tenant, no solo por usuario.

## Tests de aislamiento cruzado

Fixture mínima: **dos tenants (A y B) con datos equivalentes** y un usuario en cada uno. Para
cada recurso con tenant:
1. Usuario de A lista → cero filas de B; `total` y contadores sin B.
2. Usuario de A pide por ID un recurso de B → 404.
3. Usuario de A crea/edita mandando `tenantId` de B en el body → ignorado o 400; la fila queda en A.
4. Usuario de A referencia un ID hijo de B (FK cruzada) → rechazado.
5. Job/consumidor ejecutado para A no toca filas de B (contar antes y después).
6. Con el rol de la aplicación y **sin** `app.tenant_id` seteado, un `SELECT` directo falla o
   devuelve cero filas — prueba que RLS está viva.
7. Caché: request de A y luego de B a la misma URL → respuestas distintas.

Corren contra Postgres real (`integrity-testing`); el ORM mockeado no prueba aislamiento.

## Evidencia / Definition of Done

Pegá salida literal de:
- `\d+ <tabla>` (o consulta a `pg_policies`) mostrando RLS habilitada, forzada y la política.
- Atributos del rol de la aplicación (`rolsuper`, `rolbypassrls` en `pg_roles`) en falso.
- Ejecución de los tests 1–7 aplicables al cambio, con resultado.
- `grep` de `filters: false`, `tenant: false` y SQL crudo en el diff, cada uno justificado.
- Lista de rutas agnósticas de tenant antes y después del cambio.
Sin esto el cambio está "escrito", no "aislado" (`evidence-and-verification`).

## Checklist

- [ ] Modelo de aislamiento decidido y documentado.
- [ ] `tenant_id NOT NULL` + unicidad y FKs compuestas con tenant.
- [ ] RLS habilitada y forzada; rol de la app sin superusuario, sin ownership, sin `BYPASSRLS`.
- [ ] Tenant fijado por transacción (`set_config(..., true)`), nunca por sesión de conexión.
- [ ] Tenant resuelto en servidor y validado contra la membresía; sin tenant ⇒ falla.
- [ ] Filtro global del ORM activo; cada desactivación envuelta, nombrada y justificada.
- [ ] Rutas agnósticas declaradas en un solo lugar.
- [ ] Jobs, caché, búsqueda, exportes, archivos, logs, eventos y websockets revisados.
- [ ] Membresía por tenant; cambio de tenant activo limpia estado y cachés.
- [ ] Tests de aislamiento cruzado con dos tenants contra base real, en verde.
