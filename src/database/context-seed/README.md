<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/database/context-seed

## Por qué existe

- **Negocio:** esta carpeta preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
- **Sistema:** esta carpeta define context-seed para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`context-seed-rows.ts`](./context-seed-rows.ts) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |
| [`context-seed-upserts.constants.ts`](./context-seed-upserts.constants.ts) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |
| [`context-seed-validation.ts`](./context-seed-validation.ts) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |
| [`context-seed-writer.ts`](./context-seed-writer.ts) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |
| [`context-seed.types.ts`](./context-seed.types.ts) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |
| [`multidomain-context-loader.ts`](./multidomain-context-loader.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
