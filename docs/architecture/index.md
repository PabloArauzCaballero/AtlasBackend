# Arquitectura

Backend por capas sobre NestJS 11, con <!-- fig:code.modules -->44<!-- /fig --> módulos de dominio, fronteras entre
módulos vigiladas por `yarn check:architecture` y separación explícita entre el proceso que atiende
clientes y el que ejecuta trabajo de fondo.

## Por dónde empezar

| Si buscas | Ve a |
|---|---|
| Ver el sistema de un vistazo | [Modelo C4](c4-model.md) |
| Saber qué módulo depende de cuál | [Dependencias entre módulos](module-dependencies.md) |
| Entender qué corre solo y dónde | [Procesamiento en segundo plano](background-processing.md) |
| Por qué se decidió algo | [Decisiones (ADR)](../adr/README.md) |
| El recorrido crediticio real | [Onboarding y habilitación](onboarding-habilitacion-credito.md) |

## Principios que sostiene el código

| Principio | Cómo se comprueba |
|---|---|
| Capas uniformes: `controller → service → repository → mapper → DTO` | Revisión + `yarn check:overfetching` |
| Nunca devolver modelos Sequelize al transporte HTTP | Revisión + tipos de los DTO |
| Sin dependencias circulares nuevas | `yarn check:architecture`: un ciclo sólo pasa con excepción declarada (dueño, tarea y vencimiento) en `config/architecture/boundaries.json`. Hoy hay <!-- fig:arch.cycles -->1<!-- /fig --> ciclo, el de la excepción `auth-mail-cycle` (auth → mail-sender → notifications → internal-users → auth, AT-040, vence 2027-03-31) |
| Toda entrada validada con Zod | `yarn check:domain-schemas` |
| Un solo mapa tabla → esquema | `yarn check:domain-schema-layout` |
| Los archivos grandes no crecen | `yarn check:file-size` (trinquete) |

## Cifras reales

Calculadas del código por `yarn check:docs-figures` en cada PR (job `docs-drift`): si el código
cambia y esta tabla no, CI falla. Se regeneran con `yarn docs:figures`.

| Elemento | Cantidad | Cómo se cuenta |
|---|---:|---|
| Módulos de dominio | <!-- fig:code.modules -->44<!-- /fig --> | carpetas de `src/modules` con `*.module.ts` |
| Controladores | <!-- fig:code.controllers -->132<!-- /fig --> | clases `@Controller`, en <!-- fig:code.controllerFiles -->125<!-- /fig --> archivos |
| Modelos Sequelize | <!-- fig:code.ormModels -->213<!-- /fig --> | clases `@Table` en `src/` |
| Migraciones | <!-- fig:code.migrations -->192<!-- /fig --> | `src/database/migrations/*.ts` |
| Tablas / esquemas de dominio | <!-- fig:db.tables -->221<!-- /fig --> / <!-- fig:db.schemas -->15<!-- /fig --> | `ATLAS_DOMAIN_TABLES` (`src/database/domain-tables.ts`) |
| Rutas montadas | <!-- fig:code.routes -->616<!-- /fig --> | metadata de los controladores; incluye las internas fuera del contrato |
| Rutas / operaciones del contrato | <!-- fig:openapi.paths -->564<!-- /fig --> / <!-- fig:openapi.operations -->606<!-- /fig --> | `docs/endpoints/openapi.yaml` |
| Aristas módulo → módulo | <!-- fig:arch.moduleEdges -->99<!-- /fig --> | inventario de imports (`scripts/architecture/inventory-imports.ts`) |
| Ciclos entre módulos | <!-- fig:arch.cycles -->1<!-- /fig --> | mismo inventario; cada uno con excepción declarada |

Quién puede llamar a cada ruta: [Matriz de roles y permisos](../security/admin-rbac-matrix.md) (generada).

Metodología de la auditoría de julio (cifras de entonces, ya no vigentes): [Auditoría Graphify](../reports/graphify-audit.md).
