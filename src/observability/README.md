<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/observability

## Por qué existe

- **Negocio:** esta carpeta reduce el tiempo de detección y recuperación de incidentes.
- **Sistema:** esta carpeta inicializa trazas y telemetría antes del runtime.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`tracing-bootstrap.ts`](./tracing-bootstrap.ts) | Artefacto de soporte específico de esta carpeta. |
| [`tracing.ts`](./tracing.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
