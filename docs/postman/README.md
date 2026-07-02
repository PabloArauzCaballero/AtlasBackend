# Postman

La colección `collection.json` contiene únicamente endpoints activos y compuestos de la fase actual.

No incluye endpoints de seeds ni rutas fragmentadas por tabla.

Variables principales:

- `baseUrl`: URL base con prefijo `/api/v1`.
- `tenantId`: tenant de prueba.
- `token`: JWT generado con `yarn dev:jwt`.
- `idempotencyKey`: valor único por intento de onboarding.
