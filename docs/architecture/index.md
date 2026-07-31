# Arquitectura

Backend por capas sobre NestJS 11, con 27 módulos de dominio, **cero dependencias circulares** entre
ellos y separación explícita entre el proceso que atiende clientes y el que ejecuta trabajo de fondo.

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
| Sin dependencias circulares (`forwardRef` prohibido) | **Verificado en el grafo**: 0 ciclos entre 27 módulos |
| Toda entrada validada con Zod | `yarn check:domain-schemas` |
| Un solo mapa tabla → esquema | `yarn check:domain-schema-layout` |
| Los archivos grandes no crecen | `yarn check:file-size` (trinquete) |

## Cifras reales

| Elemento | Cantidad |
|---|---:|
| Módulos de dominio | 27 |
| Controllers | 46 |
| Modelos Sequelize | 131 |
| Migraciones | 61 |
| Tablas en 12 esquemas | 138 |
| Rutas / operaciones expuestas | 252 / 264 |
| Aristas módulo → módulo | 32 |
| Dependencias circulares | **0** |

Metodología y evidencia: [Auditoría Graphify](../reports/graphify-audit.md).
