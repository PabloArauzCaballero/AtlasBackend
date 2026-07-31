<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/risk

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que produce una recomendación explicable para reducir pérdida crediticia y trato inconsistente.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; calcula evaluaciones versionadas, contribuciones y reglas disparadas sin presentarlas como un modelo validado.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`risk.controller.spec.ts`](./risk.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk.mapper.spec.ts`](./risk.mapper.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk.repository.spec.ts`](./risk.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk.service.spec.ts`](./risk.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
