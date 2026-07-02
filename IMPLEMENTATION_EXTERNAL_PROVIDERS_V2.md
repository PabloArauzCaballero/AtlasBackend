# Implementación External Providers v2 — ATLAS

## Objetivo

Ampliar endpoints, continuar Fase 2/Fase 3 en modo contractual/mock y reforzar calidad de largo plazo para evitar costos accidentales, duplicidades, errores de providers y acoplamiento con scoring.

## Cambios principales

### Endpoints nuevos o mejorados

- `GET /api/v1/external-data/consents/user/:customerId`
- `POST /api/v1/external-data/consents/:consentId/revoke`
- `GET /api/v1/external-data/requests/:requestId`
- `GET /api/v1/external-data/users/:customerId/features`
- `GET /api/v1/external-data/users/:customerId/observations`
- `GET /api/v1/admin/external-providers/:providerCode/cost-policy`
- `PATCH /api/v1/admin/external-providers/:providerCode/cost-policy/:queryType`
- `POST /api/v1/payments/qr/verify`
- `POST /api/v1/payments/bank-transfer/verify`
- `POST /api/v1/telco/phone-trust/verify`
- `GET /api/v1/telco/phone-trust/:customerId`
- `GET /api/v1/social/facebook/connect-url`
- `POST /api/v1/social/facebook/callback`
- `GET /api/v1/social/facebook/status/:customerId`
- `POST /api/v1/whatsapp/verification/start`
- `POST /api/v1/whatsapp/verification/confirm`
- `GET /api/v1/whatsapp/status/:customerId`
- `POST /api/v1/digital-trust/check`
- `GET /api/v1/digital-trust/profile/:customerId`

### Correcciones preventivas de calidad

- Control de cuotas diaria/mensual/global por política de costo.
- Reutilización de idempotency key para evitar duplicar consultas costosas.
- Lectura real de observations/features en vez de endpoints placeholder.
- Administración de cost policy por endpoint.
- Request detail con respuesta sanitizada y payload normalizado.
- Mock server ampliado para QR, WhatsApp y Facebook con escenarios de error útiles.
- Documentación de endpoints v2 y auditoría preventiva de riesgos.

## Validación doble

### Primera validación

```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/eslint/bin/eslint.js --config eslint.config.mjs "src/**/*.ts" "test/**/*.ts" "scripts/**/*.ts"
node node_modules/prettier/bin/prettier.cjs --check "src/**/*.ts" "test/**/*.ts" "scripts/**/*.ts"
```

Resultado: OK.

### Segunda validación

```bash
node node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand
node node_modules/typescript/bin/tsc -p tsconfig.json
```

Resultado:

```txt
Test Suites: 9 passed, 9 total
Tests: 49 passed, 49 total
Build TypeScript: OK
```

## Nota sobre Yarn en este entorno

El proyecto sigue configurado para Yarn 1.22.22 y los scripts fueron documentados con Yarn. En este contenedor, `yarn` intentó descargarse mediante Corepack pero no pudo por falta de acceso a red. Por eso la validación se ejecutó con binarios locales de `node_modules`. En tu máquina debes usar:

```bash
yarn install
yarn build
yarn type-check
yarn lint
yarn format:check
yarn test
yarn mock:providers
yarn smoke:external-providers
```

## Smoke tests

Intenté ejecutar `scripts/smoke/external-providers.smoke.ts`, pero el `node_modules` disponible en el entorno venía copiado desde Windows y `tsx/esbuild` no puede ejecutar en Linux con ese binario nativo. Esto no afecta el ZIP porque `node_modules` no se entrega. En tu Windows, con `yarn install`, debe usar el binario correcto.

## Pendiente real

- SEGIP real: requiere documentación/credenciales.
- InfoCenter real: requiere documentación/credenciales y aprobación económica.
- QR/Banca real: mini-adapters por banco y sandbox.
- Telcos reales: contrato/API oficial.
- Meta/WhatsApp real: API oficial, scopes mínimos y revisión de permisos.
