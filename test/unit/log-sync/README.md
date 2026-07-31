<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/log-sync

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que preserva evidencia operativa suficiente para diagnosticar incidentes con retención limitada.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; sincroniza logs redactados hacia MongoDB, aplica TTL y ofrece consultas administrativas.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`log-sync.service.spec.ts`](./log-sync.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`mongo-logs-query.service.spec.ts`](./mongo-logs-query.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`mongo-logs.controller.spec.ts`](./mongo-logs.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
