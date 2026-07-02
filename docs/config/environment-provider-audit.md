# Auditoría integral de configuración de proveedores — Patch 2.4.5

Esta revisión endurece la configuración de proveedores para evitar errores ocultos al pasar de desarrollo a staging o producción.

## Riesgos corregidos

1. **Provider activo sin credenciales**  
   Si se configura `NOTIFICATION_EMAIL_PROVIDER=resend`, `NOTIFICATION_PUSH_PROVIDER=fcm`, `NOTIFICATION_SMS_PROVIDER=twilio`, etc., el backend ahora valida las credenciales al arrancar. Esto evita descubrir el error recién cuando una notificación real ya falló.

2. **Webhook activo sin URL**  
   Si un canal usa `webhook`, debe existir URL específica del canal o `NOTIFICATION_WEBHOOK_URL` global.

3. **Clave de cifrado débil o equivocada en producción**  
   `NOTIFICATION_TOKEN_ENCRYPTION_KEY` ahora tiene mínimo de 32 caracteres y en producción no puede ser el valor de ejemplo ni ser igual al secreto JWT.

4. **Timeout/retry inconsistente entre adapters**  
   SMS y WhatsApp/Twilio ahora usan el mismo helper HTTP con timeout y retry que los adapters JSON/webhook. Antes los POST form-urlencoded no respetaban `NOTIFICATION_PROVIDER_HTTP_TIMEOUT_MS` ni retries.

5. **Payload push visible por defecto**  
   Por privacidad fintech, FCM queda data-only por defecto. Si se quiere que iOS/Android/web muestre título/cuerpo automáticamente, se habilita explícitamente con `NOTIFICATION_PUSH_INCLUDE_VISIBLE_NOTIFICATION=true`.

6. **WhatsApp Cloud sin soporte mínimo de templates**  
   Meta WhatsApp Cloud ahora puede enviar template si el payload trae `whatsappTemplateName`, `whatsappTemplateLanguage` y `whatsappTemplateParameters`, o si se configura `META_WHATSAPP_DEFAULT_TEMPLATE_NAME`. El mapeo formal por evento/template queda como tarea de activación de proveedor.

7. **Cifrado corrupto o cambio accidental de llave**  
   `decryptSecret` ya no tumba el proceso si encuentra ciphertext inválido o una llave equivocada; devuelve `null` para que el flujo falle como destino faltante y quede auditado.

8. **Uso mixto npm/yarn**  
   El full clean del patch elimina `package-lock.json`; el proyecto queda con `yarn.lock` y `packageManager=yarn@1.22.22`.

## Checklist antes de producción

```bash
yarn install
yarn type-check
yarn build
yarn test
yarn db:migration:up
yarn smoke:events
yarn smoke:notifications
yarn stress:notifications
```

Validar además:

- `NODE_ENV=production` no usa secretos de ejemplo.
- `NOTIFICATION_TOKEN_ENCRYPTION_KEY` está guardado en secret manager.
- Los webhooks de staging no apuntan a producción.
- Push visible solo se habilita si el contenido no revela datos sensibles.
- WhatsApp usa templates aprobados para mensajes iniciados por ATLAS.
