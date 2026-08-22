<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/partner-onboarding

## Por qué existe

- **Negocio:** esta carpeta sostiene una parte mantenida del backend Atlas.
- **Sistema:** esta carpeta agrupa artefactos relacionados bajo un límite navegable.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`partner-commerce.controller.ts`](./partner-commerce.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`partner-onboarding.controller.ts`](./partner-onboarding.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`partner-onboarding.mapper.ts`](./partner-onboarding.mapper.ts) | Mapper: transforma modelos internos a contratos de transporte. |
| [`partner-onboarding.module.ts`](./partner-onboarding.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`partner-onboarding.repository.ts`](./partner-onboarding.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`partner-onboarding.schemas.ts`](./partner-onboarding.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`partner-ownership.guard.ts`](./partner-ownership.guard.ts) | Guard: aplica autenticación o autorización antes del caso de uso. |

## Subcarpetas

- [`application/`](./application/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
