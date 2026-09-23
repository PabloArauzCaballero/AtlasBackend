# Entorno QA efímero para E2E de AdminPortal — AtlasBackend

## Decisión

El runner de GitHub crea PostgreSQL y Redis vacíos, migra y ejecuta `db:seed:demo`. Ese seed trae el tenant 1 y datos **sintéticos**, incluidos el actor QA 930007 sin credencial. Este trabajo añade una credencial temporal y el rol `QA_ENGINEER` sólo en la base efímera `atlas_e2e_admin`. El PIN se entrega mediante el transporte webhook existente, con `NODE_ENV=development` y MFA activado. La contraseña la genera el runner en cada corrida y no se versiona ni se imprime.

## Alcance

`src/database/qa-e2e-seed.ts`, `scripts/seed-admin-e2e.ts`, `test/unit/database/qa-e2e-seed.spec.ts`, `package.json` y este directorio de trabajo. No modifica tablas, migraciones ni datos de producción. La orquestación del runner vive en un PR de AdminPortal.

## H1 — Identidad QA reproducible y limitada

CA: en `atlas_e2e_admin`, tras migraciones y demo seed, el actor QA puede iniciar sesión con MFA y un rol propio; repetir la siembra deja una sola credencial y una sola asignación activa. Fuera de esa base o en producción, el comando aborta antes de escribir.

DoD: pruebas del comando, tipos, lint, formato y CI remota verdes; prueba de login/PIN real desde AdminPortal.

### H1.S1 — Seed seguro

CA: guardas y escritura idempotente verificadas. DoD: `yarn test:unit --runInBand test/unit/database/qa-e2e-seed.spec.ts`.

- [x] H1.S1.M1: pruebas de rechazo para entorno/base/bandera incorrectos. CA: todos rechazan. DoD: prueba unitaria directa.
- [ ] H1.S1.M2: credencial Argon2id y rol QA en transacción. CA: el seed no imprime la contraseña y el resultado es idempotente. DoD: prueba unitaria y CI con PostgreSQL.
- [ ] H1.S1.M3: comando de reset restringido. CA: retira sólo la credencial E2E y restaura el actor demo. DoD: prueba unitaria y CI con PostgreSQL.

## Ambigüedad

El plan original propone GitHub Secrets para una cuenta QA persistente. Aquí la cuenta y su clave son efímeras por corrida; esa opción reduce manejo de secretos y evita depender de un entorno externo. Confirmar con el propietario si en el futuro se necesita un entorno QA persistente.
