<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/runtime-jobs/support

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que completa trabajo asíncrono y recuperable fuera de la latencia del request.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; reclama, procesa y reintenta jobs/outbox con locks y métricas operativas.

## Contenido

| Documento o código                                 | Responsabilidad                                  |
| -------------------------------------------------- | ------------------------------------------------ |
| [`build-job-services.ts`](./build-job-services.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
