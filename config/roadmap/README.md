<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# config/roadmap

## Por qué existe

- **Negocio:** esta carpeta mantiene visible el alcance y secuencia de evolución del producto.
- **Sistema:** esta carpeta provee configuración declarativa consumible por herramientas y revisiones.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`entity_build_scope.yaml`](./entity_build_scope.yaml) | Configuración declarativa legible y versionada. |
| [`implementation_phases.yaml`](./implementation_phases.yaml) | Configuración declarativa legible y versionada. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
