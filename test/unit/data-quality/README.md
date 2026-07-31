<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/data-quality

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que evita decisiones crediticias basadas en datos incompletos, incoherentes o sin linaje.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; administra reglas, ejecuciones y hallazgos de calidad consultables por operaciones.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`data-quality.controller.spec.ts`](./data-quality.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`data-quality.repository.spec.ts`](./data-quality.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`data-quality.service.spec.ts`](./data-quality.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
