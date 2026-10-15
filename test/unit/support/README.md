<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/support

## Por qué existe

- **Negocio:** esta carpeta previene regresiones que afectarían los contratos críticos del backend.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; valida componentes aislados.

## Contenido

| Documento o código                                                                       | Responsabilidad                                               |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [`agent-profile.schema.spec.ts`](./agent-profile.schema.spec.ts)                         | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`business-hours.spec.ts`](./business-hours.spec.ts)                                     | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`case-number.util.spec.ts`](./case-number.util.spec.ts)                                 | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`case-state-machine.spec.ts`](./case-state-machine.spec.ts)                             | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`catalog-seed-alignment.spec.ts`](./catalog-seed-alignment.spec.ts)                     | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`category-audience.spec.ts`](./category-audience.spec.ts)                               | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`channel-category.spec.ts`](./channel-category.spec.ts)                                 | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`internal-support.controller.spec.ts`](./internal-support.controller.spec.ts)           | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`message-dlp.spec.ts`](./message-dlp.spec.ts)                                           | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`mobile-support.controller.spec.ts`](./mobile-support.controller.spec.ts)               | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`priority-policy.spec.ts`](./priority-policy.spec.ts)                                   | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`resolve-case.schema.spec.ts`](./resolve-case.schema.spec.ts)                           | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-actor.service.spec.ts`](./support-actor.service.spec.ts)                       | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-agent-enrollment.service.spec.ts`](./support-agent-enrollment.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-agent.repository.spec.ts`](./support-agent.repository.spec.ts)                 | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-attachment.service.spec.ts`](./support-attachment.service.spec.ts)             | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-case-closure.service.spec.ts`](./support-case-closure.service.spec.ts)         | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-case-escalation.service.spec.ts`](./support-case-escalation.service.spec.ts)   | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-case-list.spec.ts`](./support-case-list.spec.ts)                               | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-case-read.service.spec.ts`](./support-case-read.service.spec.ts)               | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-case-timeline.repository.spec.ts`](./support-case-timeline.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-case-workflow.spec.ts`](./support-case-workflow.spec.ts)                       | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-case.repository.spec.ts`](./support-case.repository.spec.ts)                   | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-case.service.spec.ts`](./support-case.service.spec.ts)                         | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-catalog.repository.spec.ts`](./support-catalog.repository.spec.ts)             | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-channel.repository.spec.ts`](./support-channel.repository.spec.ts)             | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-channel.service.spec.ts`](./support-channel.service.spec.ts)                   | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-chat.controller.spec.ts`](./support-chat.controller.spec.ts)                   | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-codes.spec.ts`](./support-codes.spec.ts)                                       | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-desk-list.repository.spec.ts`](./support-desk-list.repository.spec.ts)         | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-desk.service.spec.ts`](./support-desk.service.spec.ts)                         | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-hash-chain.spec.ts`](./support-hash-chain.spec.ts)                             | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-knowledge-faq.service.spec.ts`](./support-knowledge-faq.service.spec.ts)       | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-knowledge-read.service.spec.ts`](./support-knowledge-read.service.spec.ts)     | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-knowledge.repository.spec.ts`](./support-knowledge.repository.spec.ts)         | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-knowledge.service.spec.ts`](./support-knowledge.service.spec.ts)               | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-message.repository.spec.ts`](./support-message.repository.spec.ts)             | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-message.service.spec.ts`](./support-message.service.spec.ts)                   | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-realtime.service.spec.ts`](./support-realtime.service.spec.ts)                 | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support-sla.service.spec.ts`](./support-sla.service.spec.ts)                           | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`support.mapper.spec.ts`](./support.mapper.spec.ts)                                     | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
