# Endpoints de AtlasBackend

El contrato exhaustivo y verificable está en [`openapi.yaml`](./openapi.yaml), generado desde los
controladores y schemas Zod con `yarn docs:openapi`. Este documento explica por qué se agrupan las
rutas y qué capacidad de negocio ofrece cada grupo; no duplica cada request/response del OpenAPI.

## Convenciones globales

- Prefijo: `/api/v1`.
- Respuesta exitosa: `{ success: true, data, meta? }`.
- Error: `{ success: false, error: { code, message, issues? }, requestId, timestamp }`.
- Rutas autenticadas: `Authorization: Bearer <access-token>`.
- Rutas multitenant: `x-tenant-id`, cruzado contra el JWT por `TenantGuard`.
- Comandos reintentables: `x-idempotency-key` según lo indique OpenAPI.
- Fechas: ISO-8601 UTC; IDs: string/entero positivo según el recurso.
- Entradas: Zod en el borde; PII nunca se devuelve como hash o blob cifrado.

## Grupos de rutas

| Prefijo                            | Negocio                                       | Sistema                                                                                              |
| ---------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `/health`, `/metrics`              | Saber si una instancia puede recibir tráfico. | Liveness, readiness y métricas Prometheus.                                                           |
| `/auth`                            | Acceso, recuperación y seguridad de cuenta.   | Login por contraseña/PIN, MFA, refresh, logout, reset y actor actual.                                |
| `/customer-onboarding`             | Completar alta, KYC y envío a revisión.       | Registro, perfil, contactos, OTP, documentos, identidad, dirección, referencias, screening y estado. |
| `/customers/:customerId`           | Consultar y habilitar al cliente.             | Perfil agregado, elegibilidad, productos y solicitudes de crédito.                                   |
| `/customers/:customerId/sessions`  | Mantener una interacción segura.              | Inicio, heartbeat, cierre, GPS, dispositivo y estado de sesión.                                      |
| `/customers/:customerId/telemetry` | Capturar señales anti-fraude con privacidad.  | Ingesta batch validada y acotada.                                                                    |
| `/customers/:customerId/privacy`   | Ejercer consentimiento y derechos de datos.   | Decisiones y solicitudes del titular.                                                                |
| `/consent-documents`               | Mostrar la versión legal aplicable.           | Consulta de documentos publicados y vigentes.                                                        |
| `/external-data`                   | Obtener evidencia externa controlada.         | Proveedores, costo, consentimiento, ejecución, cache, resiliencia y auditoría.                       |
| `/notifications`                   | Gestionar mensajes y preferencias.            | Plantillas, canales, entrega y broadcasts 202 en segundo plano.                                      |
| `/events`                          | Procesar efectos desacoplados.                | Registro/outbox y ejecución idempotente.                                                             |
| `/operations`                      | Resolver excepciones con intervención humana. | Colas, fraude, riesgo, calidad, auditoría, crédito y decisiones KYC/compliance.                      |
| `/internal` / `/internal-portal`   | Operar Atlas con mínimo privilegio.           | Autenticación interna, RBAC, reportes, búsqueda, glosario y linaje.                                  |
| `/systems`                         | Gobernar el backend y sus pruebas.            | Catálogo técnico, impactos, revisiones, stress, suites y logs.                                       |
| `/catalog-management`              | Gobernar definiciones y reglas versionadas.   | Ingesta, aprobación, activación, catálogo de riesgo y data governance.                               |
| `/schema-management`               | Registrar propuestas de estructura.           | Validación y auditoría; no ejecuta DDL físico.                                                       |

## Flujos de negocio críticos

### Registro y onboarding

1. `POST /customer-onboarding/start` crea cliente, credenciales y flujo de forma idempotente.
2. Se completa perfil y métodos de contacto.
3. `contact-verification/request` emite un código real por el canal configurado; solo se almacena hash.
4. `contact-verification/submit` valida TTL, intentos y consumo único. No acepta `123456` como bypass.
5. Documentos, identidad, domicilio, perfil financiero y referencias agregan evidencia.
6. Operaciones/proveedores resuelven identidad y compliance.
7. `POST /customer-onboarding/:customerId/submit` valida guardas y envía a revisión.

### Elegibilidad y crédito

1. `GET /customers/:customerId/eligibility` evalúa la regla vigente, persiste la evaluación como
   evidencia inmutable y devuelve `{ eligible, blockers[], sections[], completionPercentage, nextStep }`.
   Es una lectura con efecto de auditoría deliberado: no existe un `POST .../eligibility/evaluate`
   aparte, porque un segundo camino para el mismo cálculo permitiría que consulta y decisión
   divergieran.
2. `POST /operations/customers/:customerId/eligibility/decision` aplica la decisión humana
   (aprobar, rechazar, observar, suspender, reincorporar) validada contra la máquina de estados.
3. `GET /customers/:customerId/credit-products` muestra productos aplicables.
4. `POST /customers/:customerId/credit-applications` revalida elegibilidad vigente y congela el snapshot.
5. Operaciones decide con `/operations/credit/applications/:applicationId/decision` y genera evento.

La elegibilidad no garantiza aprobación: es una precondición auditable para abrir una solicitud.

### Árbol de endpoints del proceso

El recorrido anterior también está publicado como dato consultable en `/workflows` — etapas,
subetapas, pasos, dependencias y transiciones del flujo estándar, con su representación de grafo y
el avance de un cliente concreto. Ver [`workflow-catalog.md`](./workflow-catalog.md).

## Autenticación y autorización

- Endpoints públicos sensibles tienen límites más estrictos que el throttle global.
- El access token incluye actor, rol, tenant y versión de token.
- Los refresh tokens son opacos, rotan dentro de transacción y detectan reuso.
- `TenantGuard` evita operar otro tenant cambiando el header.
- Recursos de cliente aplican ownership anti-BOLA; roles internos no sustituyen permisos granulares donde corresponda.

## Evolución del contrato

1. Cambiar primero schema/DTO/controlador y su prueba OpenAPI.
2. Ejecutar `yarn docs:openapi`.
3. Revisar el diff de `openapi.yaml` y actualizar Postman/smokes si cambia el flujo.
4. Mantener compatibilidad o documentar la ruptura y versionar la ruta.
