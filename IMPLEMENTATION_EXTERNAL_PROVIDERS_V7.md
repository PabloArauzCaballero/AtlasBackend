# ATLAS External Providers v7 — Auditoría 10/10

## Objetivo

La v7 endurece controles de seguridad, operación y salida a producción del módulo de External Data Providers. Esta versión no agrega más proveedores; corrige riesgos de calidad de largo plazo detectados al auditar la v6.

## Correcciones aplicadas

1. **Ownership por cliente en endpoints externos**
   - Los endpoints de consentimientos, KYC, pagos, telco, Facebook, WhatsApp, digital trust, features, observations, scoring input y decision package ahora verifican que un usuario con rol `customer` solo pueda operar sobre su propio `customerId`.
   - Se reutiliza `assertOwnCustomerResource` para no duplicar lógica.

2. **Revocación de consentimiento con control de propiedad**
   - Antes, la revocación validaba tenant + consentId, pero no validaba dueño cuando el actor era cliente.
   - Ahora, si el actor es `customer`, el servicio valida que el consentimiento pertenezca a su `customerId` antes de revocar.

3. **Roles explícitos en ExternalDataController y KYC SEGIP**
   - Se restringe el acceso a roles esperados.
   - Se evita que un rol no pertinente como `merchant` use endpoints de datos externos sensibles.

4. **Auditoría correcta del actor solicitante**
   - `actorId` ahora registra también `customerId` cuando el actor es cliente.
   - Esto evita requests externos sin `requestedByUserId` en autoservicio del cliente.

5. **Production Gate más estricto**
   - Si un provider se configura en `production`, ahora se bloquea si falta:
     - `*_REAL_INTEGRATION_IMPLEMENTED=true`
     - variables base/credenciales mínimas por provider
     - prohibición de mock en producción
   - Esto corrige el riesgo de que health/readiness parezcan OK aunque el adapter real no esté implementado.

6. **Bloqueo preventivo de ejecución productiva incompleta**
   - Si un provider queda accidentalmente en `production` sin integración real validada, la ejecución se bloquea antes de llamar al adapter.
   - El bloqueo queda auditado como `PROVIDER_UNAVAILABLE` con `PRODUCTION_GATE_BLOCKED`.

7. **Runtime policy más segura**
   - `PATCH /api/v1/admin/external-providers/:providerCode/runtime` ya no permite pasar a `production` solo con confirmación humana.
   - También exige que los blockers técnicos de producción estén resueltos.

## Validación ejecutada

Con dependencias locales disponibles mediante symlink temporal a `node_modules` del workspace original:

```bash
tsc --noEmit -p tsconfig.json
eslint --config eslint.config.mjs "src/**/*.ts" "test/**/*.ts" "scripts/**/*.ts"
prettier --check "src/**/*.ts" "test/**/*.ts" "scripts/**/*.ts"
jest --config jest.config.cjs --runInBand
tsc -p tsconfig.json
```

Resultado:

- Type-check: OK
- Lint: OK
- Format: OK
- Unit tests: 9 suites / 49 tests OK
- Build TypeScript: OK

## Nota honesta

No se ejecutaron smoke tests con servidor HTTP y base de datos real en este entorno porque no está levantado PostgreSQL/Redis ni el runtime completo. En máquina local deben ejecutarse con Yarn:

```bash
yarn install
yarn db:migration:up
yarn db:seed:up
yarn mock:providers
yarn start:dev
yarn smoke:external-providers:governance
yarn audit:external-providers:quality-10
```
