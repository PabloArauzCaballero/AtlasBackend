<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/auth

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`auth-actor-resolver.service.spec.ts`](./auth-actor-resolver.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`auth-password-reset.service.spec.ts`](./auth-password-reset.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`auth-repository-email-lookup.spec.ts`](./auth-repository-email-lookup.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`auth-token-issuer.service.spec.ts`](./auth-token-issuer.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`auth.controller.spec.ts`](./auth.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`auth.repository.spec.ts`](./auth.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`auth.service.spec.ts`](./auth.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`merchant-actor.repository.spec.ts`](./merchant-actor.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`ownership.util.spec.ts`](./ownership.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`password.util.spec.ts`](./password.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`refresh-token.util.spec.ts`](./refresh-token.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`token-revocation.service.spec.ts`](./token-revocation.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
