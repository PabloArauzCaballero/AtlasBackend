<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/e2e/notifications/support

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
- **Sistema:** esta carpeta contiene pruebas HTTP integradas y soporte reproducible; orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`notifications-test-app.ts`](./notifications-test-app.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
