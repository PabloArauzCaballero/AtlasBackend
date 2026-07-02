# Smoke tests de notificaciones

`yarn smoke:notifications` valida:

- creación de evento de negocio;
- procesamiento vía `process-events`;
- creación de `notification_messages`;
- entrega real `in_app`;
- consulta de bandeja interna del cliente;
- conteo de no leídas;
- marcado como leído;
- registro de device token cifrado.

Los canales externos quedan registrados como fallidos si el provider está `disabled`. Para probar proveedores reales, configura `.env` con el provider y credenciales correspondientes.
