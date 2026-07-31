<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/database/seed-data

## Por qué existe

- **Negocio:** esta carpeta preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
- **Sistema:** esta carpeta define seed-data para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`customer-credit-workflow.seed-data.ts`](./customer-credit-workflow.seed-data.ts) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |
| [`post-login-first-screen-workflow.seed-data.ts`](./post-login-first-screen-workflow.seed-data.ts) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |
| [`signup-to-login-workflow.seed-data.ts`](./signup-to-login-workflow.seed-data.ts) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
