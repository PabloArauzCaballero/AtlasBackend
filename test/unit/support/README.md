<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/support

## Por qué existe

- **Negocio:** esta carpeta previene regresiones que afectarían los contratos críticos del backend.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; valida componentes aislados.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`business-hours.spec.ts`](./business-hours.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`case-number.util.spec.ts`](./case-number.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`case-state-machine.spec.ts`](./case-state-machine.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`message-dlp.spec.ts`](./message-dlp.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`priority-policy.spec.ts`](./priority-policy.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-hash-chain.spec.ts`](./support-hash-chain.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-realtime.service.spec.ts`](./support-realtime.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
