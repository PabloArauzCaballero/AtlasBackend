<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/mail-sender

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que entrega comunicaciones transaccionales indispensables para verificación y recuperación de acceso.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; encapsula el cliente HTTP de correo y sus plantillas, timeouts y errores tipados.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`mail-sender.client.spec.ts`](./mail-sender.client.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`mail-sender.service.spec.ts`](./mail-sender.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
