<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/customer-privacy

## Por qué existe

- **Negocio:** esta carpeta hace exigibles los derechos de privacidad y limita el uso de datos personales.
- **Sistema:** esta carpeta gestiona decisiones de tratamiento y solicitudes del titular con auditoría y aislamiento por tenant.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`customer-privacy.controller.ts`](./customer-privacy.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`customer-privacy.module.ts`](./customer-privacy.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`customer-privacy.repository.ts`](./customer-privacy.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`customer-privacy.schemas.ts`](./customer-privacy.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`customer-privacy.service.ts`](./customer-privacy.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
