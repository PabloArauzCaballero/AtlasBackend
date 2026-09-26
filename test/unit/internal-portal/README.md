<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/internal-portal

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`admin-read.service.spec.ts`](./admin-read.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`internal-portal-business-term.spec.ts`](./internal-portal-business-term.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`internal-portal-roles.spec.ts`](./internal-portal-roles.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`internal-portal-service-contract.spec.ts`](./internal-portal-service-contract.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`portal-lineage.service.spec.ts`](./portal-lineage.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`portal-tenant-scope.spec.ts`](./portal-tenant-scope.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
