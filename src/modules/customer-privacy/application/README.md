<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/customer-privacy/application

## Por qué existe

- **Negocio:** esta carpeta hace exigibles los derechos de privacidad y limita el uso de datos personales.
- **Sistema:** esta carpeta gestiona decisiones de tratamiento y solicitudes del titular con auditoría y aislamiento por tenant.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`privacy-request-decision.service.ts`](./privacy-request-decision.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`privacy-request-facts.repository.ts`](./privacy-request-facts.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`privacy-request-features.ts`](./privacy-request-features.ts) | Artefacto de soporte específico de esta carpeta. |

## Subcarpetas

- [`ports/`](./ports/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
