# Reporte — identidad QA efímera de AdminPortal

## Cambio

Se añadió un comando que crea y revierte la credencial del actor sintético QA 930007 sobre el tenant demo 1. La operación exige `NODE_ENV=development`, `ALLOW_E2E_SEED=true`, host local y la base `atlas_e2e_admin`, y aborta antes de conectarse si falta cualquiera. La contraseña proviene del runner, se almacena con Argon2id y no aparece en la salida. Si el cluster está vacío, se crean `QA_ENGINEER` y `SUPER_ADMIN` desde el catálogo canónico, se conceden sus permisos y se asignan al actor dentro de la misma transacción. El acceso amplio sólo existe en el runner desechable para recorrer todas las vistas administrativas.

El mismo comando refleja tablas y columnas físicas en la versión `v1.0` del catálogo de esquema dentro de esa base QA. La migración crea la versión, pero deja el inventario vacío; el recorrido E2E de versión, esquema y tabla necesita datos reales. El seed es idempotente y conserva la misma guarda de destino local.

## Evidencia local

- 10 pruebas unitarias del seed: verdes.
- `yarn type-check`, `yarn type-check:tests`, ESLint y Prettier de archivos modificados: verdes.
- `yarn build`: verde.

## Pendiente

La integración con PostgreSQL, el login con PIN y la suite Playwright se comprueban en el workflow de AdminPortal, que prepara y elimina su propia base efímera. No hay servicio PostgreSQL local para esta tarea.
