<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta backend como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| — | Esta carpeta funciona como agrupador; su contenido está en subcarpetas. |

## Subcarpetas

- [`00-home/`](./00-home/README.md)
- [`01-overview/`](./01-overview/README.md)
- [`02-architecture/`](./02-architecture/README.md)
- [`03-domains/`](./03-domains/README.md)
- [`04-api/`](./04-api/README.md)
- [`05-data/`](./05-data/README.md)
- [`06-integrations/`](./06-integrations/README.md)
- [`07-async-processing/`](./07-async-processing/README.md)
- [`08-security/`](./08-security/README.md)
- [`09-observability/`](./09-observability/README.md)
- [`10-operations/`](./10-operations/README.md)
- [`11-quality/`](./11-quality/README.md)
- [`12-development/`](./12-development/README.md)
- [`13-change-impact/`](./13-change-impact/README.md)
- [`14-audits/`](./14-audits/README.md)
- [`15-reference/`](./15-reference/README.md)
- [`_meta/`](./_meta/README.md)
- [`templates/`](./templates/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
