<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src

## Por qué existe

- **Negocio:** esta carpeta implementa las capacidades operativas, de identidad, riesgo y crédito de Atlas.
- **Sistema:** esta carpeta organiza el runtime NestJS en módulos con límites explícitos y dependencias dirigidas.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`app.module.ts`](./app.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`main.ts`](./main.ts) | Artefacto de soporte específico de esta carpeta. |

## Subcarpetas

- [`common/`](./common/README.md)
- [`config/`](./config/README.md)
- [`database/`](./database/README.md)
- [`modules/`](./modules/README.md)
- [`observability/`](./observability/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
