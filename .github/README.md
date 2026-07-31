<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# .github

## Por qué existe

- **Negocio:** esta carpeta protege la calidad antes de integrar o desplegar cambios.
- **Sistema:** esta carpeta define automatización de CI, seguridad y políticas del repositorio.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`CODEOWNERS`](./CODEOWNERS) | Artefacto de soporte específico de esta carpeta. |
| [`dependabot.yml`](./dependabot.yml) | Configuración declarativa legible y versionada. |

## Subcarpetas

- [`workflows/`](./workflows/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
