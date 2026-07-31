<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/customer-privacy

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que hace exigibles los derechos de privacidad y limita el uso de datos personales.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; gestiona decisiones de tratamiento y solicitudes del titular con auditoría y aislamiento por tenant.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`customer-privacy.controller.spec.ts`](./customer-privacy.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-privacy.repository.spec.ts`](./customer-privacy.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-privacy.service.spec.ts`](./customer-privacy.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
