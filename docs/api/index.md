# API

API HTTP REST bajo `/api/v1`. **252 rutas, 264 operaciones**, contrato OpenAPI **3.1** generado del
código y protegido por dos gates.

## Empezar a integrar

1. Lee [Convenciones](conventions.md): el sobre de respuesta, la autenticación, el tenant y la
   idempotencia son iguales en todas las operaciones.
2. Lee [Modelo de error](error-model.md): un solo formato para todos los fallos.
3. Abre la referencia interactiva en `/api/v1/reference` (Scalar) y prueba con tu token.

## Artefactos del contrato

| Artefacto | Dónde | Para qué |
|---|---|---|
| Contrato versionado | `docs/endpoints/openapi.yaml` | Lo que consume el frontend y los generadores de cliente |
| Contrato en vivo | `/api/v1/docs/openapi.json` | Lo que **este** proceso tiene montado ahora mismo |
| Referencia interactiva | `/api/v1/reference` | Explorar y probar |
| Swagger UI | `/api/v1/docs` | Conservada para clientes existentes |
| Colección Postman | `docs/postman/collection.json` | Pruebas manuales |

## Gates que lo protegen

| Comando | Qué verifica |
|---|---|
| `yarn docs:openapi` | Regenera el contrato desde el código |
| `yarn check:openapi` | Reglas propias: sobre declarado, seguridad en toda operación, 429/500 documentados, sin secretos ni placeholders |
| `yarn docs:openapi:lint` | El estándar OpenAPI, vía Redocly |

Los tres corren en CI. Un contrato incompleto no se puede fusionar.

## Estado medido

| Métrica | Valor |
|---|---:|
| Operaciones con `operationId` | 264 / 264 |
| Operaciones con seguridad declarada | 264 / 264 |
| Respuestas 2xx con esquema | 264 / 264 |
| Errores de Redocly | 0 |
| Operaciones con `description` larga | 118 / 264 (deuda declarada: ATLAS-DOC-006) |
