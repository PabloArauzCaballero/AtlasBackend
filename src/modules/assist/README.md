# assist · Atlas Assist en el canal móvil

El botón de ayuda de la app del cliente. La app llama a `/mobile/assist/*` con su sesión de
siempre; este módulo reenvía a AtlasAIService de servidor a servidor (`x-atlas-service-key` +
`x-atlas-actor-ref`) y traduce cada desenlace al idioma del móvil. El asistente NO ve la cuenta de
nadie: recibe una referencia opaca `tenantId:customerId`, nunca el JWT.

| Pieza | Qué hace |
|---|---|
| `assist.controller.ts` | `POST chat` y `GET conversation`, sólo rol `customer`, con rate limit. |
| `assist.service.ts` | Interruptor `ASSIST_ENABLED` (apagado = 404 y la app esconde el botón), traducción de errores a lenguaje de usuario, historial que degrada a hilo vacío. |
| `ai-assist.client.ts` | El transporte: URL, clave y timeout de `env`; sin reintentos (cada llamada al proveedor se factura; el reintento legítimo es el del móvil, idempotente por `clientMessageId`). |
| `assist.schemas.ts` | Contratos Zod del borde y vistas que ve el móvil. |

Core no persiste nada: las conversaciones viven en el PostgreSQL de AtlasAIService, por actor.
Configuración en `env.assist.schema.ts` / `env.assist.checks.ts`; el kill switch es
`ASSIST_ENABLED` en Coolify, sin redesplegar la app.
