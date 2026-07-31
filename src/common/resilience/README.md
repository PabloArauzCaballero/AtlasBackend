<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/common/resilience

## Por qué existe

- **Negocio:** esta carpeta aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
- **Sistema:** esta carpeta provee infraestructura transversal de resilience sin introducir reglas de un dominio específico.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`adapter-error.ts`](./adapter-error.ts) | Artefacto de soporte específico de esta carpeta. |
| [`circuit-breaker.ts`](./circuit-breaker.ts) | Artefacto de soporte específico de esta carpeta. |
| [`provider-config-validator.ts`](./provider-config-validator.ts) | Artefacto de soporte específico de esta carpeta. |
| [`resilience.module.ts`](./resilience.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`resilient-adapter-executor.service.ts`](./resilient-adapter-executor.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`retry.util.ts`](./retry.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
