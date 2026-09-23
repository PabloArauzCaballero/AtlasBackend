# Reporte — identidad QA efímera de AdminPortal

## Cambio

Se añadió un comando que crea y revierte la credencial del actor sintético QA 930007 sobre el tenant demo 1. La operación exige `NODE_ENV=development`, `ALLOW_E2E_SEED=true`, host local y la base `atlas_e2e_admin`, y aborta antes de conectarse si falta cualquiera. La contraseña proviene del runner, se almacena con Argon2id y no aparece en la salida. Si el cluster está vacío, se crea `QA_ENGINEER` desde el catálogo canónico, se le conceden sus permisos y se asigna al actor dentro de la misma transacción.

## Evidencia local

- 9 pruebas unitarias del seed: verdes.
- `yarn type-check`, `yarn type-check:tests`, ESLint y Prettier de archivos modificados: verdes.
- `yarn build`: verde.

## Pendiente

La integración con PostgreSQL, el login con PIN y la suite Playwright se comprueban en el workflow de AdminPortal, que prepara y elimina su propia base efímera. No hay servicio PostgreSQL local para esta tarea.
