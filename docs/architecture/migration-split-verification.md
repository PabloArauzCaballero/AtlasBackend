# Verificación del split de la migración de esquema base

El esquema base de Atlas (86 tablas) se creó originalmente en una sola migración de 12 559 líneas,
`20260626154044-create-atlas-user-intelligence-fraud-schema-v5-2-1.ts`. Esa migración se dividió en
veinte archivos acotados por dominio:

- `20260626154044..154053-schema-part-0..9-*` — **solo tablas**.
- `20260626154054..154103-schema-relationships-part-0..9-*` — foreign keys, índices y checks, después
  de que todas las tablas existen (evita dependencias circulares entre dominios).

## Por qué existe este documento

El archivo monolítico **siguió presente en el repositorio** después del split, en `main` y en la rama
de trabajo. Como `src/database/migrate.ts` usa `glob: 'src/database/migrations/*.ts'` y Umzug ordena
alfabéticamente, ambos compartían el prefijo `20260626154044` y el desempate lo decidía la letra
siguiente:

```
20260626154044-create-atlas-user-intelligence-fraud-schema-v5-2-1.ts   ('c')  → corría PRIMERO
20260626154044-schema-part-0-platform-core.ts                          ('s')  → relation already exists
```

Resultado: `yarn db:migration:up` sobre una base vacía era imposible. Está registrado como
ATLAS-TECH-001 y como hallazgo A-01 en
[la auditoría integral del 2026-07-30](../audit/auditoria-integral-2026-07-30.md).

## Equivalencia verificada antes de eliminar el monolito

Comparación programática entre el contenido del monolito y la unión de los veinte archivos del split,
sobre el árbol en el momento de la eliminación:

| Elemento | Monolito | Split | Diferencia |
|---|---|---|---|
| Tablas (`tableName`) | 86 | 86 | 0 — conjuntos idénticos, sin tablas exclusivas de ninguno de los dos lados |
| Foreign keys (`table.column → targetTable.targetColumn`) | 244 | 244 | 0 — conjuntos idénticos |
| Check constraints (por nombre) | 5 | 5 | 0 — `ck_watchlist_entries_scope_consistency` está en `schema-relationships-part-8-fraud-review.ts:217` y `ck_data_provider_response_payload_strategy` en `schema-relationships-part-0-platform-core.ts:105` |
| Índices | 385 | 385 | 0 |

Con la equivalencia confirmada, el monolito se eliminó. El split es desde entonces la única
definición del esquema base.

## Gate que impide la regresión

`yarn check:migrations` (`scripts/check-migrations.ts`) corre en CI antes que cualquier job que
necesite base de datos y falla si:

1. una tabla se crea en dos migraciones y al menos una creación no es idempotente,
2. dos migraciones comparten prefijo de timestamp sin excepción documentada,
3. un archivo no exporta `up` **y** `down`,
4. un nombre de archivo se sale del patrón `<14 dígitos>-<kebab-case>.ts`.

El gate es estático: no necesita Postgres y corre en milisegundos, así que el fallo aparece en el PR
y no varios minutos después en el job de integración.

### Excepción vigente

`20260705113000` está repetido entre `add-systems-business-metadata-governance.ts` y
`add-systems-ops-rich-metadata-tables.ts`: el mismo cambio de metadatos de `systems-ops` escrito dos
veces. Ambas son íntegramente idempotentes (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`),
así que el orden entre ellas no cambia el esquema resultante y aplicarlas ambas es un no-op para la
segunda. No se renombran ni se fusionan porque ya están registradas en la `SequelizeMeta` de entornos
existentes y renombrarlas las volvería a ejecutar. El gate las reporta como aviso permanente para que
la duplicación no se pierda de vista.
