<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/external-data

## Por qué existe

- **Negocio:** esta carpeta incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
- **Sistema:** esta carpeta aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`external-data-controller.util.ts`](./external-data-controller.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`external-data.controller.ts`](./external-data.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`external-data.module.ts`](./external-data.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`external-data.repository.ts`](./external-data.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`external-data.schemas.ts`](./external-data.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`external-data.service.ts`](./external-data.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Subcarpetas

- [`application/`](./application/README.md)
- [`controllers/`](./controllers/README.md)
- [`domain/`](./domain/README.md)
- [`infrastructure/`](./infrastructure/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
