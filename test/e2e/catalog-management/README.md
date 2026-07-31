<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/e2e/catalog-management

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.
- **Sistema:** esta carpeta contiene pruebas HTTP integradas y soporte reproducible; implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`context-ingestion.spec.ts`](./context-ingestion.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
