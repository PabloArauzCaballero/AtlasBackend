<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/fraud

## Por qué existe

- **Negocio:** esta carpeta reduce pérdidas y habilita revisión humana explicable de señales sospechosas.
- **Sistema:** esta carpeta administra casos, decisiones y eventos de fraude dentro de transacciones auditables.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`fraud.module.ts`](./fraud.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`fraud.repository.ts`](./fraud.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`fraud.schemas.ts`](./fraud.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`fraud.service.ts`](./fraud.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
