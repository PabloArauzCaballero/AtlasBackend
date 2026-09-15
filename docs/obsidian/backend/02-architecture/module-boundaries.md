---
title: "Límites de módulo"
type: "architecture"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - architecture
aliases: []
related: []
---
# Límites de módulo

## Dos grafos, dos veredictos

| Grafo | Estado |
|---|---|
| **Módulos** (código) | Limpio: acíclico, cero `forwardRef`, dirección de dependencias respetada |
| **Tablas** (datos) | Acoplado: 153 de 244 FK cruzan el límite de un esquema |

Los dominios están desacoplados en código y acoplados en la base de datos. Cualquier plan de extracción tropieza con lo segundo, no con lo primero.

## Reglas que se cumplen

`VERIFICADO`:

1. **Sin ciclos.** Ni un `forwardRef` en `src/`.
2. **`common/` no conoce dominios.** No importa de `modules/`.
3. **Un esquema por tabla, declarado una vez.** `atlasSchemaFor()` lanza si falta.
4. **Ningún modelo Sequelize sale al transporte.** Siempre por mapper.

## Gates que los vigilan

| Gate | Qué protege |
|---|---|
| `yarn check:domain-schemas` | Que cada tabla resuelva su esquema |
| `yarn check:domain-schema-layout` | La disposición de los esquemas de dominio |
| `yarn check:file-size` | Que los archivos no crezcan (trinquete con línea base) |
| `yarn check:tenant-header` | El uso de la cabecera de tenant (trinquete) |
| `yarn check:overfetching` | Que no se seleccionen columnas de más |
| `yarn check:read-api-views` | La integridad del modelo de lectura |

> [!info] Trinquetes, no perfección
> `.file-size-baseline.json` y `.tenant-header-baseline.json` congelan el estado actual. Los gates no exigen arreglarlo todo hoy; exigen **no empeorar**. Es lo que hace que una regla sobreviva a un sprint con prisa.

## Dónde está bajo presión

### `CustomersModule` como núcleo compartido

12 de 27 módulos dependen de él, y exporta **`CustomersRepository`** además de sus servicios. Un repositorio exportado permite llegar a la persistencia sin pasar por las reglas del servicio.

La regla del proyecto lo admite solo *"con necesidad transaccional real y documentada"*. Es el punto a revisar en cada PR que amplíe sus exports.

### `platform_ops` con 25 tablas

Cuatro subdominios sin ciclo de vida común en un solo esquema. Ver [[14-audits/risks-register|ARCH-002]].

### FK cruzadas

| Consecuencia | Detalle |
|---|---|
| No se puede separar la base | Habría que sustituir 153 FK por validación en aplicación |
| Transacciones cruzan dominios | Una operación puede tocar varios esquemas atómicamente — cómodo, pero ata |
| El borrado propaga restricciones | `RESTRICT` entre dominios: no se puede limpiar uno sin mirar los demás |

## Candidatos a extracción

Módulos hoja, sin dependencias hacia otros módulos de negocio: `Audit`, `CatalogManagement`, `DataQuality`, `LogSync`, `SchemaManagement`, `Health`, `RuntimeHardening`.

El obstáculo sigue siendo el mismo: sus tablas tienen FK hacia `tenants` y, en varios casos, hacia `customers`.

## Relaciones

- [[02-architecture/dependency-map]] · [[02-architecture/architectural-style]] · [[05-data/relationship-catalog]]
