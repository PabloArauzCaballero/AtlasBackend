<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/files

## Por qué existe

- **Negocio:** esta carpeta previene regresiones que afectarían los contratos críticos del backend.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; valida componentes aislados.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`file-content-type.spec.ts`](./file-content-type.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`file.service.spec.ts`](./file.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`local-file-storage.adapter.spec.ts`](./local-file-storage.adapter.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`local-signature.spec.ts`](./local-signature.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`multer-ingest.adapter.spec.ts`](./multer-ingest.adapter.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
