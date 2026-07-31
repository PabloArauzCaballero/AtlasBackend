<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/database/seeders/development

## Por qué existe

- **Negocio:** esta carpeta preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
- **Sistema:** esta carpeta define development para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`20260626160720-seed-minimal-dev-credentials.ts`](./20260626160720-seed-minimal-dev-credentials.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260704121500-seed-pablo-admin-user.ts`](./20260704121500-seed-pablo-admin-user.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
