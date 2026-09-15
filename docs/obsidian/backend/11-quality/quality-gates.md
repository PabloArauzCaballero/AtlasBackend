---
title: "Gates de calidad"
type: "reference"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - quality
  - ci
source_files:
  - "package.json"
  - ".github/workflows/ci.yml"
aliases: []
related: []
---
# Gates de calidad

## Antes de cualquier PR

```bash
yarn type-check          # tsc --noEmit sobre src/
yarn type-check:tests    # idem sobre las pruebas
yarn lint                # ESLint sobre src/, test/, scripts/
yarn format:check        # Prettier
yarn test                # suite Jest
```

## Gates específicos del proyecto

| Gate | Qué protege |
|---|---|
| `check:file-size` | Que los archivos no crezcan — trinquete con `.file-size-baseline.json` |
| `check:tenant-header` | Uso de `x-tenant-id` — trinquete con `.tenant-header-baseline.json` |
| `check:domain-schemas` | Que cada tabla resuelva su esquema |
| `check:domain-schema-layout` | La disposición de los esquemas de dominio |
| `check:overfetching` | Que no se seleccionen columnas de más |
| `check:migrations` | Validez y reversibilidad de las migraciones |
| `check:read-api-views` | Integridad del modelo de lectura |
| `check:entity-narratives` | Que las entidades tengan narrativa de negocio |
| `check:openapi` | Que el contrato publicado coincida con el código |
| `check:seed-profiles` | Separación de perfiles de seed |
| `check:no-env-file` | Que no se versione un `.env` |
| `check:env-example` | Que el ejemplo siga al esquema Zod |
| `check:db-privileges` | Que el rol de runtime no tenga DDL |
| `check:smoke-results-untracked` | Que no se versionen resultados de smoke |

> [!info] Trinquetes con línea base
> `check:file-size` y `check:tenant-header` comparan contra un fichero de línea base versionado. No exigen arreglar la deuda existente; impiden añadir más. Es lo que hace que una regla sobreviva a un sprint con prisa — y también significa que **la línea base documenta la deuda actual**.

## Documentación

```bash
yarn docs:validate   # openapi + check:openapi + redocly lint + mkdocs build --strict
```

## Antes de desplegar

```bash
yarn build
yarn check:migrations
yarn check:openapi
yarn check:no-env-file
```

Y tras desplegar, los smokes correspondientes al área tocada.

## Verificación de migraciones

Probar `up → down → up` en un entorno desechable. La reversibilidad solo se comprueba ejecutándola.

## Qué NO cubren los gates

`PENDIENTE`:

- `yarn audit --level high` — no está en la lista de gates versionados.
- Análisis estático de seguridad (SAST).
- Pruebas de carga con umbral.
- Verificación del aislamiento de red de `/metrics`.

## Relaciones

- [[11-quality/testing-strategy]] · [[10-operations/deployment]] · [[13-change-impact/change-checklists]]
