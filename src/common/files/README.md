<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/common/files

## Por qué existe

- **Negocio:** esta carpeta aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
- **Sistema:** esta carpeta provee infraestructura transversal de files sin introducir reglas de un dominio específico.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`file-adapter-config.service.ts`](./file-adapter-config.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`file-adapter.registry.ts`](./file-adapter.registry.ts) | Artefacto de soporte específico de esta carpeta. |
| [`file-content-type.util.ts`](./file-content-type.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`file-storage.types.ts`](./file-storage.types.ts) | Tipos de dominio: hacen explícitos estados y contratos internos. |
| [`file.service.ts`](./file.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`files-config.module.ts`](./files-config.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`files.module.ts`](./files.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`local-signature.util.ts`](./local-signature.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |

## Subcarpetas

- [`ingest/`](./ingest/README.md)
- [`storage/`](./storage/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
