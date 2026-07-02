# Quality Audit V6 — External Providers

## Controles revisados

| Control | Estado |
|---|---|
| TypeScript build | OK |
| ESLint | OK |
| Prettier | OK |
| Jest unit tests | OK |
| Scoring desacoplado de providers | OK |
| InfoCenter bloqueado por costo | OK |
| Tenant scoping por request crítico | Mejorado en V6 |
| Idempotency collision guard | Agregado en V6 |
| Auditoría de idempotencia | Agregada en V6 |

## Problemas que se previenen

### 1. Replay equivocado

El mismo header `x-idempotency-key` ya no puede reutilizarse para otro payload/proveedor sin error explícito.

### 2. Filtración cross-tenant

Las consultas y acciones críticas sobre provider requests ahora requieren tenant context.

### 3. Deuda técnica de migración

La migración crea índice único solo si la base no tiene duplicados históricos. Esto evita romper despliegues y permite auditar primero.

## Comandos recomendados con Yarn

```bash
yarn install
yarn db:migration:up
yarn db:seed:up
yarn audit:external-providers:v6
yarn mock:providers
yarn start:dev
yarn smoke:external-providers:governance
```
