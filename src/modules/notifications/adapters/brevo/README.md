<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/notifications/adapters/brevo

## Por qué existe

- **Negocio:** esta carpeta entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
- **Sistema:** esta carpeta orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`brevo-config.util.ts`](./brevo-config.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`brevo-request.util.ts`](./brevo-request.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`brevo-webhook-secret.util.ts`](./brevo-webhook-secret.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`brevo-whatsapp.util.ts`](./brevo-whatsapp.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
