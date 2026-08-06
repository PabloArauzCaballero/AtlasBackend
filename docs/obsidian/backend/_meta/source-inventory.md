---
title: "Inventario de fuentes"
type: "reference"
status: "verified"
owner: "unknown"
criticality: "low"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "meta"
---
# Inventario de fuentes

Estado del repositorio en la revisión `80fc741`.

| Artefacto | Cantidad | Ruta |
|---|---:|---|
| Archivos TypeScript en `src/` | 686 | `src/` |
| Módulos NestJS | 35 | `src/**/*.module.ts` |
| Controllers | 48 clases / 42 archivos | `src/**/*.controller.ts` |
| Rutas HTTP | 266 | decoradores `@Get`/`@Post`/… |
| Servicios | 122 | `src/**/*.service.ts` |
| Modelos Sequelize | 130 | `src/database/models/` |
| Columnas | 2040 | — |
| Claves foráneas | 244 | migraciones `schema-relationships-*` |
| Índices | 290 | migraciones |
| Migraciones | 61 | `src/database/migrations/` |
| Seeders | 18 | `src/database/seeders/` |
| Variables de entorno (Zod) | 159 | `src/config/env*.schema.ts` |
| Tipos de evento | 92 | `src/modules/events/event-registry.ts` |
| Archivos de test | 304 | `test/` |
| Scripts de smoke | 19 | `scripts/smoke/` |
| Vistas `read_api` | 7 | migraciones |

## Método de extracción

Análisis estático por patrones sobre el árbol de fuentes (sin ejecutar el backend ni consultar ninguna base de datos). Contraste de validación: el número de rutas extraídas (266) coincide con las operaciones del contrato OpenAPI generado (265) más `GET /metrics`, que está excluido del contrato a propósito.

## Exclusiones

`node_modules/`, `dist/`, `coverage/`, `.git/`, artefactos generados y `Archivo.log`.
