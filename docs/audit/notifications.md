# Auditoría — Módulo `notifications`

**Alcance revisado:** `notifications.controller.ts`, `.service.ts`, `.repository.ts`,
`.mapper.ts`, `.schemas.ts`, `.module.ts`, `notification-orchestrator.service.ts`,
`notification-rules.service.ts`, `notification-template-renderer.service.ts`,
`notification-types.ts`; los 5 adapters de canal (`email`, `sms`, `push`, `whatsapp`,
`in-app-notification`) + `http-adapter.util.ts` + `notification-provider-config.service.ts`.
Tests: los 4 archivos existentes en `test/unit/notifications/` (orchestrator, provider-config,
rules, template-renderer).

**Resultado:** sin hallazgos críticos/altos/medios. No se modificó código.

---

## Por qué no hay hallazgos que corregir

- **Control de acceso a notificaciones de cliente deliberadamente más estricto que el genérico**:
  `notifications.service.ts` mantiene su propia `assertCustomerAccess` en vez de reutilizar
  `assertOwnCustomerResource` — el comentario en el código (`ATLAS-AUDIT-027`) explica por qué:
  el helper genérico solo bloquea el rol `customer` cruzado y deja pasar cualquier otro rol,
  mientras que aquí se exige una lista explícita de roles internos (y **excluye deliberadamente
  `merchant`**, que sí pasaría el chequeo genérico). Confirmé que la lista se usa de forma
  consistente en los 5 métodos que la necesitan (`listCustomerNotifications`, `unreadCount`,
  `markCustomerNotificationRead`, `markAllCustomerNotificationsRead`, `upsertDeviceToken`,
  `deactivateDeviceToken`).
- **Todos los endpoints de operaciones distinguen roles por tipo de acción** (mismo patrón que
  `operations.controller.ts`): lectura (`listMessages`, `getMessage`, `listTemplates`,
  `getPreferences`) permite `internal_operator`/`risk_analyst`/`compliance_analyst`/`fraud_analyst`;
  escritura de plantillas (`createTemplate`, `updateTemplate`) se restringe a
  `admin`/`platform_admin`/`system`, excluyendo explícitamente a los analistas de solo consulta.
- **Todas las queries de mensajes/tokens/plantillas están scoped por `tenantId`**
  (`getMessage`, `getCustomerMessage`, `deactivateDeviceToken`, etc.) — no es posible leer o
  modificar un mensaje o device token de otro tenant conociendo su id.
- Las URLs de los adapters de canal (`postJson`/`postForm` en `http-adapter.util.ts`) provienen
  siempre de configuración de servidor (`NotificationProviderConfigService`, `env.*`), nunca de
  input del cliente — sin el vector de SSRF encontrado en `systems-ops` (auditoría #16, mismo
  lote), pese a que este módulo también hace peticiones HTTP salientes reales hacia proveedores.
- `NotificationTemplateRendererService.render` usa un reemplazo de placeholders `{{path}}` con
  regex acotada (`[a-zA-Z0-9_.-]+`) y resolución de path segura (`getPathValue` verifica
  `typeof current === 'object'` y `part in current` en cada paso, sin `eval` ni acceso a
  prototipos) — no hay inyección de template ni acceso a propiedades fuera del payload.
- Los 6 endpoints de escritura exigen `X-Idempotency-Key` (`requireIdempotencyKey` en el
  controller).
