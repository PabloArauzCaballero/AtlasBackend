<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/workflow-catalog/application

## Por qué existe

- **Negocio:** esta carpeta publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
- **Sistema:** esta carpeta expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`exposed-route-scanner.service.ts`](./exposed-route-scanner.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`workflow-completion-rule.util.ts`](./workflow-completion-rule.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`workflow-consistency.service.ts`](./workflow-consistency.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`workflow-progress.service.ts`](./workflow-progress.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`workflow-transition.service.ts`](./workflow-transition.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
