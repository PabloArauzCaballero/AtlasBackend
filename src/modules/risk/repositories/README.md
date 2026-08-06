<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/risk/repositories

## Por qué existe

- **Negocio:** esta carpeta produce una recomendación explicable para reducir pérdida crediticia y trato inconsistente.
- **Sistema:** esta carpeta calcula evaluaciones versionadas, contribuciones y reglas disparadas sin presentarlas como un modelo validado.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`risk-policy.repository.ts`](./risk-policy.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
