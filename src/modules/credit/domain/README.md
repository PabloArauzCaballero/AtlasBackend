<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/credit/domain

## Por qué existe

- **Negocio:** esta carpeta materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.
- **Sistema:** esta carpeta coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`payment-capacity.ts`](./payment-capacity.ts) | Artefacto de soporte específico de esta carpeta. |
| [`statement-rejection.ts`](./statement-rejection.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
