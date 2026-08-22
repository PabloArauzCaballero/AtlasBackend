<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/notifications/adapters/gmail

## Por qué existe

- **Negocio:** esta carpeta entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
- **Sistema:** esta carpeta orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`gmail-mail.module.ts`](./gmail-mail.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`gmail-mime.util.ts`](./gmail-mime.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`gmail-oauth-token.service.ts`](./gmail-oauth-token.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`gmail.adapter.ts`](./gmail.adapter.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
