<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/partner-onboarding/application

## Por qué existe

- **Negocio:** esta carpeta sostiene una parte mantenida del backend Atlas.
- **Sistema:** esta carpeta agrupa artefactos relacionados bajo un límite navegable.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`partner-audience.ts`](./partner-audience.ts) | Artefacto de soporte específico de esta carpeta. |
| [`partner-commerce.service.ts`](./partner-commerce.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`partner-contact-verification.service.ts`](./partner-contact-verification.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`partner-profile.service.ts`](./partner-profile.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`partner-qr.service.ts`](./partner-qr.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
