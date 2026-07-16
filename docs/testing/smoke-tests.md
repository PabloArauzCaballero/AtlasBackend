# Proyecto ATLAS — Smoke tests locales

Este backend ya trae smoke tests ejecutables para validar que el servidor responde contra PostgreSQL real, usando las migraciones y el seed mínimo de desarrollo.

## Valores por defecto del seed local

No necesitas exportar variables para el caso local normal. Los scripts usan estos valores automáticamente:

```txt
BASE_URL=http://localhost:3000/api/v1
TENANT_ID=1
CUSTOMER_ID=1
DEVICE_ID=1
SESSION_ID=1
INTERNAL_USER_ID=1
PLATFORM_USER_ID=1
```

El seed local crea esos registros base: tenant demo, usuario interno, cliente demo, dispositivo demo, sesión demo, consentimiento, evaluación de riesgo demo, caso de revisión manual y caso de fraude demo.

## Requisitos previos

En una terminal:

```powershell
yarn install
yarn db:migration:up
yarn db:seed:up
yarn type-check
yarn build
yarn start:dev
```

`yarn start:dev` compila con `tsc` y luego ejecuta `node dist/src/main.js`. Esto es intencional: NestJS necesita metadata de decoradores emitida por TypeScript para resolver dependencias en runtime. No uses `tsx watch src/main.ts` para levantar la API principal porque puede romper la inyección de dependencias de Nest.

En otra terminal puedes correr los smoke tests.

## Smoke simple

```powershell
yarn smoke
```

Ese comando valida, en una sola ejecución:

```txt
health
consentimientos activos
customer me
cola operativa
investigation summary
catálogos/definiciones/políticas
runtime jobs en dry-run
sesiones compuestas start/heartbeat/summary/end
telemetry batch
risk assessment + detalle + explicación
privacidad / data subject request
auditoría y data quality
```

## Smoke por módulos

```powershell
yarn smoke:core
yarn smoke:catalog
yarn smoke:runtime
yarn smoke:sessions
yarn smoke:risk-telemetry
```

## Sobrescribir ambiente

Solo si estás probando otro puerto, tenant o customer:

```powershell
$env:BASE_URL="http://localhost:3000/api/v1"
$env:TENANT_ID="1"
$env:CUSTOMER_ID="1"
$env:DEVICE_ID="1"
$env:SESSION_ID="1"
$env:INTERNAL_USER_ID="1"
$env:PLATFORM_USER_ID="1"

yarn smoke
```

## Confirmación manual rápida

```powershell
curl.exe "http://localhost:3000/api/v1/health"
```

Debe responder correctamente antes de ejecutar `yarn smoke`.

## Notas importantes

- Los smoke tests generan sus propios JWT de desarrollo usando `JWT_ACCESS_TOKEN_SECRET` del `.env`.
- Los endpoints mutables usan `x-idempotency-key` único en cada ejecución.
- Los jobs runtime se ejecutan con `dryRun: true`, para validar contrato sin aplicar acciones destructivas.
- Si falla `yarn smoke`, corre el módulo específico para aislar el problema.

## Smoke tests de eventos y notificaciones

Nuevos comandos:

```bash
yarn smoke:events
yarn smoke:notifications
```

Validan event-driven messaging, outbox, notification orchestration, adapters configurables, delivery logs y notificaciones internas.


## Stress tests de notificaciones

Para validar carga básica del core de eventos y notificaciones:

```bash
yarn stress:notifications
```

Ver detalles en `docs/testing/stress-notifications.md`.
