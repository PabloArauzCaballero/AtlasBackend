# Changelog — Atlas Backend

Formato inspirado en [Keep a Changelog](https://keepachangelog.com/). Antes de esta entrada, el
historial de parches vivía incorrectamente dentro de `README.md` — ver `ATLAS-AUDIT-008` en
`docs/pending/pending-items.md`.

## [0.2.1] — 2026-07-02 — Corrección de arranque local y hardening Fase 1

- Corrige el error real de arranque donde `yarn start:dev` tomaba `NODE_ENV=production` desde Windows/PowerShell y Zod exigía `REDIS_URL` y secretos productivos.
- `start:dev` ahora usa `scripts/run-dev.mjs` para forzar `NODE_ENV=development`; producción queda separada en `start:prod`/`start`.
- Agrega `yarn env:doctor`, `.env.production.example` y documentación clara de configuración local vs. producción.
- Corrige `AuthService.refresh()` para no crear refresh tokens nuevos antes de validar que el actor siga activo.
- Elimina fire-and-forget (`void`) en idempotencia/outbox: las escrituras críticas se esperan antes de responder.
- Agrega action log HTTP global en `operational_audit_logs` para trazabilidad de endpoints golpeados.
- Cambia `API_DOCS_ENABLED` para que Swagger esté apagado por defecto en producción salvo activación explícita.

## [0.2.0] — 2026-07-01 — Patch de corrección de auditoría (Fase 1)

Implementa las correcciones descritas en la auditoría técnica del backend (`AUDITORIA_ATLAS_BACKEND.md`), con foco en Fase 1 (usuarios) y las piezas de Fase 2 ya adelantadas. Ver `IMPLEMENTATION_REPORT.md` para el detalle completo, y `docs/pending/pending-items.md` para lo que queda abierto.

Resumen de cambios de mayor impacto:

- **Nuevo módulo `auth`**: login, refresh (con rotación), logout, provisión de credenciales para actores internos. Antes, el único emisor de JWT era un script de desarrollador.
- **Cierre de condición de carrera en alta de cliente**: índice único real en `customers.primary_email_hash`; `UniqueConstraintError` bajo carrera se traduce al mismo error de negocio que el chequeo previo.
- **`processOutbox` con bloqueo de fila real** (`FOR UPDATE SKIP LOCKED`), eliminando el riesgo de procesamiento duplicado bajo ejecuciones concurrentes.
- **Rate limiting respaldado por Redis** cuando `REDIS_URL` está configurado (obligatorio en producción).
- **Job de retención con ejecución real** para 3 tablas de telemetría de alto volumen.
- **Revocación real de tokens** (`tokenVersion` validado contra `auth_credentials` en cada request).
- **Verificación de ownership unificada** en `assertOwnCustomerResource`.
- Migrado el test runner de Node nativo a **Jest**; tests nuevos para el código de mayor riesgo.
- **Swagger/OpenAPI** wired (`yarn docs:openapi`, Swagger UI en `/api/v1/docs`).
- **CI** (`.github/workflows/ci.yml`), **ESLint + Prettier**, `.env` real eliminado del paquete.
- `README.md` reescrito como guía real de proyecto (antes solo tenía el changelog de un parche puntual — ver entrada `[2.4.6]` más abajo).

## [2.4.6] — Patch TypeScript provider config fix

Corrige errores de compilación detectados en `yarn type-check`:

- `BodyInit` no existe porque el proyecto no compila con tipos DOM. Se reemplaza por `string` en `http-adapter.util.ts`.
- Se incluye explícitamente `notification-provider-config.service.ts` con `getWebhookUrl(channel?: NotificationChannel)` para que los adapters `push`, `sms`, `whatsapp`, `email` y `phone` puedan resolver webhooks por canal.

## Patch 3 - Corrección gates locales de lint, formato y Jest

- Se renombró `eslint.config.js` a `eslint.config.mjs` para eliminar el warning de `MODULE_TYPELESS_PACKAGE_JSON` sin cambiar el tipo de módulo del proyecto.
- Se desactivó `no-undef` únicamente para archivos TypeScript, porque TypeScript ya valida nombres/globales y ESLint estaba marcando falsos positivos con `fetch`, `Response`, `AbortController`, `URLSearchParams` y globals de Jest.
- Se reemplazó `jest.config.ts` por `jest.config.cjs` para que `yarn test:coverage` no requiera `ts-node` solo para leer la configuración.
- Se corrigieron imports/variables no usadas en guards, consents, data-quality, catalog-management y notifications.
- Se aplicó Prettier a `src/**/*.ts`, `test/**/*.ts` y `scripts/**/*.ts`.
- Se ajustó ESLint para que los scripts CLI puedan usar `console.log` sin warnings y para aislar la deuda tipada dinámica del repositorio de catalogación sin ensuciar la salida de `yarn lint`.


## Patch 4 - Configs explícitos para ESLint/Jest

- `yarn lint` ahora fuerza `--config eslint.config.mjs` para ignorar cualquier `eslint.config.js` legado que quede al extraer encima de una carpeta previa.
- `yarn test`, `yarn test:unit`, `yarn test:watch` y `yarn test:coverage` ahora fuerzan `--config jest.config.cjs` para evitar el error de múltiples configuraciones si quedó `jest.config.ts` de versiones anteriores.
- Se agrega `yarn clean:legacy-configs` para borrar `eslint.config.js` y `jest.config.ts` obsoletos.

## Patch 5 — Jest globals y entorno de test explícito

- Corregido `yarn test:coverage` cuando `ts-jest` no reconocía `describe`, `it`, `expect` y `jest`.
- Los tests unitarios ahora importan explícitamente los helpers desde `@jest/globals`, evitando depender de globals implícitos o de un `tsconfig` productivo.
- Agregado `tsconfig.spec.json` para aislar la compilación de tests.
- Agregado `test/setup-jest-env.cjs` para forzar `NODE_ENV=test` aunque Windows tenga `NODE_ENV=production` configurado globalmente.
- `jest.config.cjs` ahora usa `tsconfig.spec.json`, `isolatedModules` y `setupFiles` para evitar el warning de módulo híbrido y errores falsos de configuración.
