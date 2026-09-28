# assist · Atlas Assist en el móvil y en los portales

El botón de ayuda de la app del cliente y de los portales de Atlas. Quien pregunta llama a Core con
su sesión de siempre; este módulo reenvía a AtlasAIService de servidor a servidor
(`x-atlas-service-key` + `x-atlas-actor-ref`, y en los portales `x-atlas-assist-surface`) y traduce
cada desenlace al idioma de quien pregunta. El asistente NO ve la cuenta de nadie: recibe una
referencia opaca, nunca el JWT.

| Pieza | Qué hace |
|---|---|
| `assist.controller.ts` | Móvil: `POST /mobile/assist/chat` y `GET /mobile/assist/conversation`, sólo rol `customer`, con rate limit. |
| `portal-assist.controller.ts` | Portales: `POST /internal/assist/chat` y `GET /internal/assist/conversation?surface=`, con la regla de superficies (abajo) y el mismo rate limit. |
| `assist.service.ts` | Interruptor `ASSIST_ENABLED` (apagado = 404 y se esconde el botón), traducción de errores con el mensaje de cada audiencia, historial que degrada a hilo vacío, `mode: 'sin-ia'` sólo en portales. |
| `ai-assist.client.ts` | El transporte: URL, clave y timeout de `env`; sin reintentos (cada llamada al proveedor se factura; el reintento legítimo es el del cliente, idempotente por `clientMessageId`). |
| `assist.schemas.ts` | Contratos Zod del borde y vistas que se contestan. |

## Rutas

Con el prefijo global (`API_PREFIX=api/v1`):

| Método y ruta | Quién | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| `POST /api/v1/mobile/assist/chat` | `customer` | `{ prompt, clientMessageId, conversationId?, screen? }` (`screen` del catálogo del móvil) | `{ reply, suggestHandoff, conversationId, turnId }` |
| `GET /api/v1/mobile/assist/conversation` | `customer` | — | `{ conversationId, turns[] }` |
| `POST /api/v1/internal/assist/chat` | personal interno o comercio, según superficie | `{ surface, prompt, clientMessageId, conversationId?, screen? }` | lo del móvil más `mode?: 'sin-ia'` |
| `GET /api/v1/internal/assist/conversation?surface=` | personal interno o comercio, según superficie | `surface` obligatoria | `{ conversationId, turns[] }` |

En los portales `screen` es texto libre corto —la sección donde está la persona, p. ej.
«Contabilidad › Cierres»—: 1 a 80 caracteres, letras (con tildes), números, espacios y `› / · _ - ( ) . ,`.

Topes: 10 preguntas y 30 lecturas de conversación por minuto. 409 (`ASSIST_IN_FLIGHT`) y 429
(`ASSIST_BUSY`) salen con `Retry-After: 2`.

## Regla de superficies

La superficie la pide el portal, pero la decide el **rol del token** (`AuthenticatedUser.role`),
nunca el navegador: con ella el servicio de IA elige catálogo de hechos y audiencia.

| Superficie | Portal | Quién puede usarla |
|---|---|---|
| `admin-portal` | Portal de operaciones | Personal interno |
| `erp-staff` | ERP del personal (`/operaciones`) | Personal interno |
| `risk-portal` | Motor de decisión | Personal interno |
| `dashboards` | Tableros | Personal interno |
| `merchant-portal` | Portal de comercio del ERP (`/portal-comercio`) | Sólo usuario de comercio (`merchant`) |

- **Personal interno**: `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`,
  `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor`.
- **Comercio**: rol `merchant` (el `PARTNER_USER` de soporte).
- **Nadie más**: un `customer` o un `system` recibe 403. Una superficie ajena da 403
  `ASSIST_SURFACE_FORBIDDEN` antes de llamar al servicio de IA.

La referencia es `<surface>:<tenantId>:<userId>`, así cada portal tiene su propio hilo. `userId` es
`merchantUserId` para el comercio e `internalUserId` para el personal (`plataforma-<platformUserId>`
para usuarios de plataforma, que numeran aparte). Un id con caracteres fuera de `[A-Za-z0-9_-]`
viaja como hash hex corto. El móvil sigue con `tenantId:customerId` y sin cabecera de superficie:
el servicio lo trata como `consumer-app`.

Cuando el asistente no contesta, el mensaje depende de quién lee: al cliente se le ofrece Soporte
de la app, al personal que pruebe de nuevo en unos minutos, y al comercio «Soporte y tutoriales»
de su portal.

Core no persiste nada: las conversaciones viven en el PostgreSQL de AtlasAIService, por actor.
Configuración en `env.assist.schema.ts` / `env.assist.checks.ts`; el kill switch es
`ASSIST_ENABLED` en Coolify, sin redesplegar la app ni los portales.
