---
name: database-design
description: Diseño de bases de datos relacionales — modelado y normalización, claves y constraints, tipos correctos para dinero y fechas, índices, migraciones zero-downtime, soft delete, auditoría, multi-tenancy, N+1 y aislamiento transaccional. PostgreSQL como referencia principal. Usar al diseñar un esquema nuevo, agregar una tabla o índice, escribir una migración, o revisar por qué una query es lenta o inconsistente.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Diseño de bases de datos

Principios de modelado relacional, con PostgreSQL como caso de referencia (la mayoría
aplica a cualquier motor SQL). Para transacciones y resiliencia a nivel de aplicación,
ver `backend-development`.

## 1. Modelado y normalización

- Normalizá a **3FN** por defecto: cada columna depende de la clave, toda la clave y
  nada más que la clave. Evita anomalías de actualización (el mismo dato repetido en
  varias filas que puede quedar inconsistente).
- Desnormalizá **a propósito y documentado**, no por costumbre: cuando el patrón de
  lectura lo exige (agregados costosos de recalcular, reportes) y podés tolerar el
  costo de mantener la copia sincronizada (trigger, job, o aceptar consistencia eventual).
- Una tabla = un concepto del dominio. Si una columna es NULL para la mayoría de las
  filas, probablemente ese atributo pertenece a otra tabla (herencia por tabla separada).

## 2. Claves y constraints

- Clave primaria en toda tabla. `bigint` autoincremental o UUID según necesites orden
  natural (autoincremental) o generación distribuida sin coordinación (UUID); un UUID
  v4 aleatorio fragmenta índices B-tree en tablas muy grandes — considerá UUID v7
  (ordenable por tiempo) si el motor/librería lo soporta.
- Las constraints son la fuente de verdad de la integridad, no la aplicación: `NOT NULL`,
  `UNIQUE`, `CHECK`, `FOREIGN KEY` con `ON DELETE`/`ON UPDATE` explícitos
  (`RESTRICT`, `CASCADE`, `SET NULL` — elegido, nunca el default sin pensar).
- Una app puede tener un bug o correr en múltiples instancias sin coordinarse; una
  constraint de DB no se salta nunca. Validar "solo en el código" es una carrera de
  condición esperando pasar.

## 3. Tipos

- **Dinero**: nunca `float`/`double` (error de redondeo binario). Usá `numeric(p,s)`
  con precisión fija, o enteros en la unidad mínima (centavos) si el dominio lo permite.
- **Fechas y horas**: guardá en UTC (`timestamptz` en Postgres, no `timestamp` sin zona)
  y convertí a zona local solo en la capa de presentación. Mezclar timestamps con y sin
  zona es la fuente número uno de bugs de horario.
- Usá el tipo más restrictivo que exprese el dominio (`enum`/`CHECK` en vez de texto
  libre para un conjunto cerrado de valores) — la DB rechaza lo inválido antes de que
  llegue a corromper un reporte.

## 4. Índices

- Sin índice en una columna usada en `WHERE`, `JOIN` o `ORDER BY` de una tabla grande,
  cada query es un full scan. Con demasiados índices, cada `INSERT`/`UPDATE` los mantiene
  todos — hay costo de escritura, no son gratis.
- **Orden en índices compuestos**: la columna de mayor selectividad (o la usada en
  igualdad) primero; un índice `(a, b)` sirve para filtrar por `a` o por `a AND b`, no
  eficientemente por `b` sola (regla del prefijo izquierdo).
- **Índices parciales** (`WHERE deleted_at IS NULL`, `WHERE status = 'pending'`) cuando
  las queries frecuentes solo tocan un subconjunto de filas — más chicos y rápidos que
  indexar la tabla entera.
- **Índices de cobertura** (incluir en el índice todas las columnas que la query lee)
  evitan el viaje extra a la tabla (index-only scan) en consultas de lectura caliente.
- Medí antes de agregar un índice "porque parece que ayuda": `EXPLAIN ANALYZE` sobre la
  query real, no intuición.

## 5. Migraciones zero-downtime (expand/contract)

Nunca hagas en un solo paso un cambio que rompa el código desplegado actualmente. Dividí
en fases, cada una desplegable de forma independiente:

1. **Expand**: agregar la columna/tabla nueva (nullable o con default), sin tocar lo
   existente. El código viejo sigue funcionando.
2. **Migrar datos**: backfill en background, en lotes (no un `UPDATE` masivo que
   bloquee la tabla entera).
3. **Cambiar la aplicación** para leer/escribir la columna nueva. Desplegar.
4. **Contract**: una vez que todo el tráfico usa la columna nueva, eliminar la vieja
   en una migración separada.

- Agregar una columna `NOT NULL` sin default en una tabla con filas existentes bloquea
  el ALTER; agregala nullable o con default, backfilleá, después restringí.
- Todo `ALTER TABLE` grande revisá si el motor lo hace con lock exclusivo o online —
  en tablas de tráfico alto, corré índices con la variante concurrente que ofrezca el
  motor y programá migraciones pesadas fuera de pico.
- Toda migración necesita su rollback probado, no solo el forward.

## 6. Soft delete y auditoría

- Soft delete (`deleted_at timestamptz NULL`) cuando el dominio necesita recuperar o
  auditar lo borrado; hard delete cuando no hay razón de negocio ni legal para retenerlo
  (dato sensible con plazo de retención vencido).
- Con soft delete, **todo índice único debe excluir lo borrado** (índice parcial
  `WHERE deleted_at IS NULL`) o vas a bloquear la reutilización de un valor "borrado".
- Auditoría (quién cambió qué y cuándo) va en una tabla/log append-only separada, no
  mezclada con la tabla operativa — evita que un `UPDATE` de negocio pise el rastro.

## 7. Multi-tenancy

- Estrategias, de más aislada a más eficiente: DB separada por tenant → schema separado
  por tenant → columna `tenant_id` compartiendo tablas. Elegí según requisitos de
  aislamiento/compliance vs costo operativo, no por defecto.
- Con `tenant_id` compartido: **toda** tabla de tenant lo lleva, todo índice y toda
  constraint única lo incluye como parte de la clave (`UNIQUE(tenant_id, email)`, no
  `UNIQUE(email)`), y ninguna query puede ejecutarse sin filtrar por tenant — hacé
  imposible el olvido (row-level security o un wrapper que lo inyecte siempre).

## 8. N+1 y aislamiento transaccional

- N+1: 1 query para la lista + N queries para relacionados de cada fila. Se arregla con
  `JOIN`/carga anticipada (`include`/`with` del ORM) o batching (una query con
  `WHERE id IN (...)`) — nunca con un loop que consulta por fila.
- Nivel de aislamiento por defecto (`READ COMMITTED` en Postgres) permite *non-repeatable
  reads* y *phantom reads*; si dos transacciones concurrentes leen-modifican el mismo
  dato (ej. descontar stock), usá locking optimista (columna `version`, `UPDATE ... WHERE
  version = ?`) o `SELECT ... FOR UPDATE` explícito — no asumas que "no va a pasar".

## 9. Naming

- `snake_case`, tablas en plural (`orders`), columnas en singular (`status`), claves
  foráneas como `<tabla_singular>_id` (`user_id`). Un nombre por concepto en todo el
  esquema — no `client_id` en una tabla y `customer_id` en otra para lo mismo.
- Sin abreviaturas ambiguas ni prefijos de tipo (`tbl_`, `str_`). El nombre de la tabla/
  columna es la fuente de verdad del dominio — si el negocio usa un término, el esquema
  usa ese término, no una traducción libre.

## Anti-patrones

- `float`/`double` para dinero.
- `timestamp` sin zona horaria en un sistema con usuarios en más de una zona.
- Índice único sin excluir soft-deleted.
- `ALTER TABLE ... ADD COLUMN ... NOT NULL` sin default en una tabla con datos, en producción.
- Confiar solo en la aplicación para una invariante que la DB podría garantizar con una constraint.
- `tenant_id` opcional "por las dudas" en vez de obligatorio en cada tabla y cada índice único.

## Checklist

- [ ] Esquema en 3FN salvo desnormalización documentada y justificada.
- [ ] Toda invariante de integridad tiene su constraint en DB, no solo validación en código.
- [ ] Dinero en `numeric`/enteros; fechas en UTC con zona horaria explícita.
- [ ] Índices verificados con `EXPLAIN ANALYZE` sobre las queries reales, no por intuición.
- [ ] Migraciones grandes en fases expand/contract, con rollback probado.
- [ ] Soft delete con índices únicos que excluyen lo borrado.
- [ ] Auditoría en tabla append-only separada.
- [ ] `tenant_id` presente y obligatorio en toda tabla/índice único si es multi-tenant compartido.
- [ ] Sin N+1: cargas relacionadas con `JOIN`/batching.
- [ ] Escrituras concurrentes sobre el mismo registro usan locking optimista o pesimista explícito.
