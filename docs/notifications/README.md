# Patch 2.0 — Notifications Core

Este módulo separa tres conceptos:

1. Evento de negocio: algo que ocurrió en ATLAS.
2. Mensaje: una comunicación concreta para un destinatario.
3. Adapter: la forma de enviar por un canal/proveedor.

El core no sabe si el proveedor real será Firebase, Gmail, SES, SendGrid, Meta WhatsApp API o Twilio.
