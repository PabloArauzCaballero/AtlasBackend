<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/external-data/infrastructure/adapters/banking-generic

## Por qué existe

- **Negocio:** esta carpeta incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
- **Sistema:** esta carpeta aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`banking-generic.adapter.ts`](./banking-generic.adapter.ts) | Artefacto de soporte específico de esta carpeta. |
| [`banking-qr.util.ts`](./banking-qr.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
