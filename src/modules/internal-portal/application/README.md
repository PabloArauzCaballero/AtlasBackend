<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/internal-portal/application

## Por qué existe

- **Negocio:** esta carpeta ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
- **Sistema:** esta carpeta compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`admin-read.service.ts`](./admin-read.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`portal-data-quality.service.ts`](./portal-data-quality.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`portal-format.util.ts`](./portal-format.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`portal-glossary.service.ts`](./portal-glossary.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`portal-governance.service.ts`](./portal-governance.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`portal-lineage.service.ts`](./portal-lineage.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`portal-operations.service.ts`](./portal-operations.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`portal-query.base.ts`](./portal-query.base.ts) | Artefacto de soporte específico de esta carpeta. |
| [`portal-report-definitions.ts`](./portal-report-definitions.ts) | Artefacto de soporte específico de esta carpeta. |
| [`portal-reports.service.ts`](./portal-reports.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`portal-scope.util.ts`](./portal-scope.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`portal-search.service.ts`](./portal-search.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
