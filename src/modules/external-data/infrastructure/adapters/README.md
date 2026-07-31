<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/external-data/infrastructure/adapters

## Por qué existe

- **Negocio:** esta carpeta incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
- **Sistema:** esta carpeta aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| — | Esta carpeta funciona como agrupador; su contenido está en subcarpetas. |

## Subcarpetas

- [`banking-generic/`](./banking-generic/README.md)
- [`digital-trust-generic/`](./digital-trust-generic/README.md)
- [`facebook-meta/`](./facebook-meta/README.md)
- [`infocenter/`](./infocenter/README.md)
- [`qr-generic/`](./qr-generic/README.md)
- [`segip/`](./segip/README.md)
- [`shared/`](./shared/README.md)
- [`telco-generic/`](./telco-generic/README.md)
- [`whatsapp/`](./whatsapp/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
