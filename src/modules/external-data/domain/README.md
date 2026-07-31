<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/external-data/domain

## Por qué existe

- **Negocio:** esta carpeta incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
- **Sistema:** esta carpeta aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`external-provider-adapter.interface.ts`](./external-provider-adapter.interface.ts) | Puerto tipado: desacopla un caso de uso de su implementación. |
| [`external-provider.types.ts`](./external-provider.types.ts) | Tipos de dominio: hacen explícitos estados y contratos internos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
