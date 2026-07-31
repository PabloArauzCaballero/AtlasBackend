<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/operations

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que permite resolver excepciones y revisiones manuales con responsabilidad y trazabilidad.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; gestiona colas y decisiones operativas mediante servicios transaccionales y repositorios aislados.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`operations.controller.spec.ts`](./operations.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`operations.mapper.spec.ts`](./operations.mapper.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`operations.repository.spec.ts`](./operations.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`operations.service.spec.ts`](./operations.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
