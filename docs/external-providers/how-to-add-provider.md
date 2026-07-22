# Cómo agregar un provider externo

1. Crear adapter en `src/modules/external-data/infrastructure/adapters/<provider>`.
2. Implementar `ExternalProviderAdapter`.
3. Registrar provider en `ExternalDataModule` y `ExternalDataService`.
4. Agregar seed en `20260702032000-seed-external-data-providers.ts`.
5. Agregar política de costo.
6. Agregar el emulador en el repo `AtlasExternalProvidersMock` (`src/providers/<nombre>.mjs` + registro en `index.mjs` + fila en `test/contract.test.mjs`).
7. Agregar pruebas smoke y matriz.

El adapter debe devolver observaciones normalizadas. No debe devolver decisiones finales.
