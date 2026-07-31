<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/data-quality

## Por qué existe

- **Negocio:** esta carpeta evita decisiones crediticias basadas en datos incompletos, incoherentes o sin linaje.
- **Sistema:** esta carpeta administra reglas, ejecuciones y hallazgos de calidad consultables por operaciones.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`data-quality.controller.ts`](./data-quality.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`data-quality.module.ts`](./data-quality.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`data-quality.repository.ts`](./data-quality.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`data-quality.schemas.ts`](./data-quality.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`data-quality.service.ts`](./data-quality.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
