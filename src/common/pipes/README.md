<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/common/pipes

## Por qué existe

- **Negocio:** esta carpeta aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
- **Sistema:** esta carpeta provee infraestructura transversal de pipes sin introducir reglas de un dominio específico.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`zod-validation.pipe.ts`](./zod-validation.pipe.ts) | Pipe: valida o transforma datos antes de invocar el controlador. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
