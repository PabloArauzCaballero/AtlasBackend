<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta docs como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`classDiagram.puml`](./classDiagram.puml) | Artefacto de soporte específico de esta carpeta. |
| [`index.md`](./index.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`requirements.txt`](./requirements.txt) | Artefacto de soporte específico de esta carpeta. |

## Subcarpetas

- [`adr/`](./adr/README.md)
- [`api/`](./api/README.md)
- [`architecture/`](./architecture/README.md)
- [`audit/`](./audit/README.md)
- [`business/`](./business/README.md)
- [`claude/`](./claude/README.md)
- [`config/`](./config/README.md)
- [`data/`](./data/README.md)
- [`database/`](./database/README.md)
- [`endpoints/`](./endpoints/README.md)
- [`events/`](./events/README.md)
- [`external-providers/`](./external-providers/README.md)
- [`getting-started/`](./getting-started/README.md)
- [`governance/`](./governance/README.md)
- [`notifications/`](./notifications/README.md)
- [`observability/`](./observability/README.md)
- [`obsidian/`](./obsidian/README.md)
- [`operations/`](./operations/README.md)
- [`pending/`](./pending/README.md)
- [`performance/`](./performance/README.md)
- [`postman/`](./postman/README.md)
- [`progress/`](./progress/README.md)
- [`reports/`](./reports/README.md)
- [`runbooks/`](./runbooks/README.md)
- [`security/`](./security/README.md)
- [`testing/`](./testing/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
