---
name: postgresql-advanced
description: PostgreSQL en profundidad — leer `EXPLAIN (ANALYZE, BUFFERS)`, elegir índice (B-tree, GIN, GiST, BRIN), búsqueda con `pg_trgm`, `unaccent` y full-text, exclusion constraints para agenda sin solapes, locks y `lock_timeout`, `CREATE INDEX CONCURRENTLY`, aislamiento y `40001`, Row Level Security, JSONB, particionado, vacuum y pool. Usar al diagnosticar una query lenta, diseñar un índice o búsqueda, aplicar DDL sobre tablas con tráfico, aislar tenants o garantizar una invariante en la base.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# PostgreSQL avanzado

Profundiza donde `database-design` solo roza (modelado, tipos y naming viven allá). Para
carreras a nivel de aplicación ver `concurrency-and-locking`; para el ORM,
el ORM que fije el `CLAUDE.md` del repo. Regla madre: **no se opina sobre performance, se mide**.

## 1. Leer un plan

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;   -- ANALYZE EJECUTA la query: en un DML, envolvé en BEGIN/ROLLBACK
```

| Mirá | Qué te dice |
|---|---|
| `rows=` estimado vs `actual rows=` | Si difieren por órdenes de magnitud, estadísticas viejas o predicado no estimable → `ANALYZE tabla`, estadísticas extendidas |
| `Seq Scan` en tabla grande con filtro selectivo | Falta índice, o el predicado no lo puede usar (función sobre la columna, cast, `LIKE '%x'`) |
| `Rows Removed by Filter` alto | El índice trae de más y se descarta después: falta columna en el índice o índice parcial |
| `Buffers: shared read` alto | Lectura de disco; `hit` es caché. Compará corridas en caliente |
| `Sort Method: external merge Disk` | El sort no entró en `work_mem` |
| `Nested Loop` con `loops=` enorme | Join por fila sobre conjunto grande: faltan índices en la FK o estimación mala |
| `Heap Fetches` alto en `Index Only Scan` | Visibility map desactualizado: falta vacuum |

- Medí con volumen realista: en una tabla de 50 filas el planner elige `Seq Scan` y está bien.
- Pegá el plan literal en el PR cuando justifiques un índice (ver `evidence-and-verification`).

## 2. Qué índice

| Tipo | Usalo para | No para |
|---|---|---|
| **B-tree** | igualdad, rangos, `ORDER BY`, unicidad, cursor `(created_at, id)` | contención de arrays, texto difuso |
| **GIN** | `jsonb` (`@>`), arrays, `tsvector`, trigramas | columnas con escrituras muy intensas (caro de mantener) |
| **GiST** | rangos (`&&`), geometría/PostGIS, exclusion constraints, KNN (`<->`) | igualdad simple |
| **BRIN** | tablas enormes append-only correlacionadas físicamente (eventos por fecha) | datos sin orden físico |

- Índice sobre expresión si consultás por expresión: `CREATE INDEX ... ON t (lower(email))`.
  La query debe usar **exactamente** esa expresión.
- `INCLUDE (col)` para cubrir sin engordar la clave. Parciales para subconjuntos calientes.
- Cada FK que se usa en joins o en `ON DELETE` necesita su índice: Postgres **no** lo crea solo.
- Índices sin uso cuestan escritura: revisá `pg_stat_user_indexes` (`idx_scan = 0`).

## 3. Búsqueda de texto

- **Difusa / "contiene" / tolerante a typos** (nombres de personas, instituciones):
  `pg_trgm` + GIN con `gin_trgm_ops`; acelera `ILIKE '%x%'` y `similarity()`/`%`.
- **Acentos**: `unaccent()` **no es `IMMUTABLE`**, así que no se puede indexar directo.
  Envolvela en una función propia `IMMUTABLE` que fije el diccionario, e indexá esa
  expresión; la query usa la misma función.

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE FUNCTION f_norm(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT lower(public.unaccent('public.unaccent', $1)) $$;
CREATE INDEX doctor_name_trgm ON doctor USING gin (f_norm(full_name) gin_trgm_ops);
-- query: WHERE f_norm(full_name) LIKE '%' || f_norm($1) || '%'
```

- **Full-text** (documentos, publicaciones): columna `tsvector` generada + GIN, consulta con
  `websearch_to_tsquery('spanish', $1)`, orden con `ts_rank`. Elegí la configuración de
  idioma a propósito.
- Siempre con `LIMIT` y orden determinista. Ver `search-and-filtering`.

## 4. Exclusion constraints: agenda sin solapamientos

La invariante "un profesional no tiene dos turnos superpuestos" **no se garantiza en la
aplicación** (dos requests concurrentes pasan ambos el chequeo). Va en la base:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;          -- necesaria para mezclar = con &&
ALTER TABLE appointment ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&     -- '[)' : turnos contiguos no chocan
  ) WHERE (status <> 'cancelled');
```

- La violación llega como SQLSTATE **`23P01`** (`exclusion_violation`): mapeala a 409
  con código estable (ver `error-handling-contract`).

## 5. Locks y DDL sobre tablas vivas

- Casi todo `ALTER TABLE` pide `ACCESS EXCLUSIVE`. Si espera detrás de una transacción
  larga, **encola detrás suyo a todas las lecturas**: la tabla queda caída sin que el DDL
  haya empezado. Antídoto obligatorio:

```sql
SET lock_timeout = '3s';        -- falla rápido (SQLSTATE 55P03) y reintentás
SET statement_timeout = '60s';
```

- `CREATE INDEX CONCURRENTLY`: no bloquea escrituras, **no puede ir dentro de una
  transacción**, y si falla deja un índice `INVALID` que hay que `DROP`ear y recrear.
  Igual para `REINDEX ... CONCURRENTLY` y `DROP INDEX CONCURRENTLY`.
- Constraints en dos pasos: `ADD CONSTRAINT ... NOT VALID` (instantáneo) y luego
  `VALIDATE CONSTRAINT` (lock liviano). Aplica a FK y `CHECK`.
- `idle_in_transaction_session_timeout`: mata sesiones que abrieron transacción y se
  colgaron (la causa número uno de locks eternos y bloat).
- Diagnóstico: `pg_stat_activity` (`wait_event_type = 'Lock'`), `pg_locks`,
  `pg_blocking_pids(pid)`.

## 6. Aislamiento y errores reintentables

| Nivel | Garantiza | Costo |
|---|---|---|
| `READ COMMITTED` (default) | cada sentencia ve lo confirmado | lost update y write skew posibles |
| `REPEATABLE READ` | snapshot estable en la transacción | puede fallar con `40001` |
| `SERIALIZABLE` | equivalente a ejecución en serie | falla con `40001`; **el reintento es parte del contrato** |

- Reintentables: **`40001`** (`serialization_failure`) y **`40P01`** (`deadlock_detected`).
  Se reintenta **la transacción entera**, con backoff y tope. Todo lo demás (`23505`
  unique, `23503` FK, `23514` check, `23P01` exclusion) es error de negocio: no se reintenta.
- Deadlocks: tomá locks siempre en el mismo orden (por id ascendente).

## 7. Row Level Security

```sql
ALTER TABLE clinical_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_note FORCE ROW LEVEL SECURITY;   -- sin esto, el dueño de la tabla la saltea
CREATE POLICY tenant_isolation ON clinical_note
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

- La app fija el contexto **por transacción**: `SET LOCAL app.tenant_id = ...` (o
  `set_config(..., true)`). Con pool en modo transacción, un `SET` de sesión se filtra al
  siguiente cliente.
- Superusuarios y roles con `BYPASSRLS` saltean todo: la app **no** corre con ese rol.
- `USING` filtra lo visible; `WITH CHECK` valida lo que se escribe. RLS es la red de
  abajo, no reemplaza el filtro de la aplicación. Ver `multi-tenancy`.

## 8. JSONB con criterio

- Sí: payloads de terceros, atributos realmente variables, snapshots de auditoría.
- No: campos por los que filtrás, ordenás, joineás o que tienen FK/constraints → columnas.
- Índice GIN (`jsonb_path_ops` si solo usás `@>`); B-tree sobre expresión para una clave
  puntual (`(data->>'code')`). Un `UPDATE` de una clave reescribe el documento entero.

## 9. Particionado, vacuum y pool

- Particioná (declarativo, por rango de fecha casi siempre) cuando necesitás **borrar por
  bloques** (retención) o podar particiones en las queries. No es una optimización por
  defecto: la clave de partición debe estar en toda PK/unique y en los `WHERE`.
- Bloat: `UPDATE`/`DELETE` dejan tuplas muertas. Autovacuum tiene que poder correr:
  transacciones largas y slots de replicación abandonados lo frenan. Mirá `n_dead_tup` y
  `last_autovacuum` en `pg_stat_user_tables`.
- Cada conexión es un proceso: `max_connections` no se sube alegremente. Pool acotado por
  instancia (`instancias × pool ≤ presupuesto`), y un pooler externo si hay muchas
  instancias. En modo transacción del pooler no hay estado de sesión (prepared
  statements de sesión, `SET`, advisory locks de sesión).

## Anti-patrones

- "Agregué un índice y anda más rápido" sin plan antes/después.
- Chequear solapamientos o unicidad con un `SELECT` previo desde la app.
- `ALTER TABLE` en producción sin `lock_timeout`.
- `CREATE INDEX` (sin `CONCURRENTLY`) sobre tabla con escrituras.
- Reintentar cualquier error de base; no reintentar `40001`.
- RLS sin `FORCE`, o app conectada como dueño/superusuario.
- Todo en un `jsonb` "para no migrar".

## Checklist

- [ ] Query lenta diagnosticada con `EXPLAIN (ANALYZE, BUFFERS)` y volumen realista; plan pegado.
- [ ] Tipo de índice elegido por operador, no por costumbre; FKs indexadas.
- [ ] Búsqueda con `pg_trgm`/full-text e índice sobre la misma expresión que usa la query.
- [ ] Invariantes de no-solapamiento/unicidad como constraint (`EXCLUDE`/`UNIQUE`), no en la app.
- [ ] DDL con `lock_timeout`; índices `CONCURRENTLY`; constraints `NOT VALID` + `VALIDATE`.
- [ ] Solo `40001`/`40P01` se reintentan, transacción completa, con tope.
- [ ] RLS con `ENABLE` + `FORCE`, contexto por `SET LOCAL`, rol sin `BYPASSRLS`.
- [ ] JSONB solo para lo variable; lo consultable en columnas.
- [ ] Pool dimensionado contra `max_connections`; sin transacciones ociosas.
