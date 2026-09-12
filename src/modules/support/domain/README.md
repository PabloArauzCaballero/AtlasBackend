<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/support/domain

## Por qué existe

- **Negocio:** esta carpeta sostiene una parte mantenida del backend Atlas.
- **Sistema:** esta carpeta agrupa artefactos relacionados bajo un límite navegable.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`business-hours.ts`](./business-hours.ts) | Artefacto de soporte específico de esta carpeta. |
| [`case-number.util.ts`](./case-number.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`case-state-machine.ts`](./case-state-machine.ts) | Artefacto de soporte específico de esta carpeta. |
| [`message-dlp.ts`](./message-dlp.ts) | Artefacto de soporte específico de esta carpeta. |
| [`priority-policy.ts`](./priority-policy.ts) | Artefacto de soporte específico de esta carpeta. |
| [`support-hash-chain.ts`](./support-hash-chain.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
