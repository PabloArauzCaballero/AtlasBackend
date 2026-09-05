<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/database/metadata

## Por qué existe

- **Negocio:** esta carpeta preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
- **Sistema:** esta carpeta define metadata para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| — | Esta carpeta funciona como agrupador; su contenido está en subcarpetas. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
