<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/customer-onboarding

## Por qué existe

- **Negocio:** esta carpeta convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
- **Sistema:** esta carpeta orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`customer-onboarding-profile.controller.ts`](./customer-onboarding-profile.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`customer-onboarding-profile.schemas.ts`](./customer-onboarding-profile.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`customer-onboarding-status.controller.ts`](./customer-onboarding-status.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`customer-onboarding.controller.ts`](./customer-onboarding.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`customer-onboarding.dtos.ts`](./customer-onboarding.dtos.ts) | DTOs: contrato estable de salida sin filtrar modelos de persistencia. |
| [`customer-onboarding.mapper.ts`](./customer-onboarding.mapper.ts) | Mapper: transforma modelos internos a contratos de transporte. |
| [`customer-onboarding.module.ts`](./customer-onboarding.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`customer-onboarding.repository.ts`](./customer-onboarding.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`customer-onboarding.schemas.ts`](./customer-onboarding.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`customer-onboarding.service.ts`](./customer-onboarding.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-verification.controller.ts`](./customer-verification.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |

## Subcarpetas

- [`application/`](./application/README.md)
- [`repositories/`](./repositories/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
