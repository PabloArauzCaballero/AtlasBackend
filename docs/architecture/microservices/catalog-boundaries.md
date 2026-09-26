# Fronteras del catálogo, la calidad y los metadatos de negocio (AT-030)

Prueba: `test/contracts/governance/catalog-consumer-contract.spec.ts`.

## Definiciones vs. valores

| Cosa | Tabla | Dueño | Qué es |
|---|---|---|---|
| Definición de atributo | `catalog.attribute_definitions` | `catalog-management` | Qué significa `monthly_income_declared`, si es sensible, si puede usarse para decidir crédito, su versión |
| Valor del atributo para un cliente | `catalog.customer_attribute_values` (físicamente en `catalog`) | **`customers`** (propietario lógico declarado) | El ingreso declarado de ESTE cliente |
| Observación sobre un cliente | `catalog.customer_observations` | **`customers`** | Un hecho observado (registrada hoy por 6 módulos) |
| Catálogos de contexto versionados | `catalog.context_catalogs`, `context_catalog_versions`, `context_items` | `catalog-management` | Listas de referencia (ocupaciones, bancos…) |
| Hallazgos de calidad | `audit.data_quality_issues` | `data-quality` | «Este valor no cuadra» — referencia, no corrección |

El esquema físico no manda: `customer_attribute_values` y `customer_observations` viven en `catalog` pero los escribe
Clientes. AT-004 lo inventarió y `context-map.json` lo declara.

## Reglas de contrato

1. **Versionado.** Un consumidor cita la versión de definición/catálogo con la que decidió. La regla de elegibilidad
   ya cita `ELIGIBILITY_RULE_VERSION`; una decisión histórica no se recalcula cuando el catálogo cambia.
2. **Definición inexistente → error tipado** (`ATTRIBUTE_DEFINITION_NOT_FOUND`), no una escritura en una tabla
   arbitraria ni un valor por defecto.
3. **Calidad no corrige.** `data-quality` registra hallazgos con referencia a la entidad; el dueño decide si corrige.
   Nunca escribe en `credit`.
4. **Lecturas operativas transversales** (portal, `systems-ops`) van por vistas `read_api` o por lector gobernado con
   rol de sólo lectura (V44), no por CRUD sobre modelos ajenos.

## Residual

`customer_attribute_values` y `customer_observations` siguen registradas por varios módulos; su migración a puerto de
lectura es parte de la línea base de fronteras (111) que baja con F4/F5.
