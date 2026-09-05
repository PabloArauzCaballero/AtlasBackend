<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/decision-engine

## Por qué existe

- **Negocio:** esta carpeta sostiene una parte mantenida del backend Atlas.
- **Sistema:** esta carpeta agrupa artefactos relacionados bajo un límite navegable.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`bank-statement-engine.client.ts`](./bank-statement-engine.client.ts) | Artefacto de soporte específico de esta carpeta. |
| [`credit-decision-engine.service.ts`](./credit-decision-engine.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`decision-artifact-binding.controller.ts`](./decision-artifact-binding.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`decision-artifact-binding.service.ts`](./decision-artifact-binding.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`decision-engine.client.ts`](./decision-engine.client.ts) | Artefacto de soporte específico de esta carpeta. |
| [`decision-engine.module.ts`](./decision-engine.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`decision-engine.types.ts`](./decision-engine.types.ts) | Tipos de dominio: hacen explícitos estados y contratos internos. |
| [`feature-projection.service.ts`](./feature-projection.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`outcome-dispatch.service.ts`](./outcome-dispatch.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`risk-decision-engine.service.ts`](./risk-decision-engine.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`subject-reference.service.ts`](./subject-reference.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`underwriting-features.service.ts`](./underwriting-features.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
