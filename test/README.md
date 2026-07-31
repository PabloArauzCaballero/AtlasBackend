<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test

## Por qué existe

- **Negocio:** esta carpeta sostiene una parte mantenida del backend Atlas.
- **Sistema:** esta carpeta agrupa artefactos relacionados bajo un límite navegable.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`setup-jest-env.cjs`](./setup-jest-env.cjs) | Artefacto de soporte específico de esta carpeta. |

## Subcarpetas

- [`e2e/`](./e2e/README.md)
- [`support/`](./support/README.md)
- [`unit/`](./unit/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
