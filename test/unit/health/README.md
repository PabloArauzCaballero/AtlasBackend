<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/health

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que permite retirar instancias enfermas antes de afectar a clientes u operadores.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; expone liveness y readiness con estados HTTP útiles para orquestadores.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`health.controller.spec.ts`](./health.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
