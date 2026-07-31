# Matriz de trazabilidad

Une **negocio → código → contrato → datos → pruebas**. Responde la pregunta que ninguna de las otras
páginas responde sola: *«¿qué prueba cubre esta regla de negocio, y qué endpoint la expone?»*

---

## Capacidades

| Capacidad de negocio | Módulo | Endpoints principales | Datos | Pruebas |
|---|---|---|---|---|
| Registro y captura de datos | `customer-onboarding` | `POST /customer-onboarding/start`, secciones `PUT` | `customer.*` | `test/unit/customer-onboarding/`, `test/e2e/` |
| Verificación de contacto | `customer-onboarding` | `POST /customer-onboarding/:id/contact-methods/verify` | `customer_contact_methods`, `contact_verification_attempts` | `contact-verification-code.service.spec.ts` |
| Verificación de identidad | `customer-onboarding`, `external-data` | `POST /external-data/identity/verify` | `customer_identity_documents`, `identity_verification_attempts` | `customer-verification.service.spec.ts` |
| Consentimientos | `consents`, `customer-privacy` | `GET /consent-documents/active`, `POST /customer-privacy/consents` | `privacy.*` | `test/unit/consents/`, `test/unit/customer-privacy/` |
| Evidencia externa | `external-data` | `POST /external-data/*` | `integrations.*` | `test/unit/external-data/` (incluye bloqueo de mocks en producción) |
| Evaluación de riesgo | `risk` | `POST /risk/evaluations` | `risk.*` | `test/unit/risk/` |
| Detección de fraude | `fraud` | `GET/POST /fraud/cases` | `case_management.*` | `test/unit/fraud/` |
| **Elegibilidad** | `customers` | `GET /customers/:id/eligibility` | `customer_eligibility_evaluations` | `test/unit/customers/` |
| Revisión de back office | `operations` | `POST /operations/customers/:id/identity-decision` y hermanos | `case_management.*`, `audit.*` | `test/unit/operations/` |
| Solicitud y decisión de crédito | `credit`, `operations` | `POST /credit/applications`, `POST /operations/credit/applications/:id/decision` | `credit.*` | `test/unit/credit/` |
| Notificación multicanal | `notifications` | `POST /notifications/broadcast` | `messaging.*` | `test/unit/notifications/`, `notification-broadcast.deferred.spec.ts` |
| Catálogo del recorrido | `workflow-catalog` | `GET /operations/workflows/:code/consistency` | `platform_ops.workflow_*` | `customer-credit-workflow.seed-data.spec.ts` |

---

## Reglas de negocio críticas

| Regla | Dónde se aplica | Prueba que la protege | Si se rompiera |
|---|---|---|---|
| La elegibilidad devuelve bloqueadores, no un booleano | `customers/customer-eligibility.service.ts` | `test/unit/customers/` | El cliente no sabría qué le falta; el catálogo de flujos perdería su fuente de avance |
| `x-tenant-id` debe coincidir con el token | `common/guards/tenant.guard.ts` | `test/unit/common/` | Un actor del tenant A operaría el tenant B cambiando un encabezado |
| Un recurso sólo lo ve su dueño | `common/utils/auth/ownership.util.ts` | Specs por módulo | BOLA: leer el expediente de otro conociendo su id |
| En producción no se sirven datos simulados | `external-data/.../productionIntegrationBlockers` | `test/unit/external-data/` | Se verificarían identidades y se calcularía riesgo sobre payloads inventados |
| El riesgo se declara heurístico | `risk/risk-heuristic-v0.constants.ts` | `test/unit/risk/` | Se presentaría una heurística como scoring certificado |
| Una mutación no se ejecuta dos veces | `runtime-hardening/idempotency.interceptor.ts` | `test/unit/runtime-hardening/` | Reintentos duplicando efectos y coste de proveedores de pago |
| El evento y el cambio comparten transacción | `runtime-hardening/outbox.interceptor.ts` | `test/unit/runtime-hardening/` | Eventos perdidos o huérfanos |
| El DDL no sale de la API | `schema-management/` | `test/unit/schema-management/` | Divergencia entre catálogo y base real |

---

## Infraestructura y operación

| Propiedad | Dónde | Prueba | Si se rompiera |
|---|---|---|---|
| Con `APP_ROLE=api` no arranca ningún trabajo de fondo | `config/app-role.ts` + los tres servicios gateados | `runtime-jobs-scheduler.roles.spec.ts`, `app-role.spec.ts` | El trabajo de fondo correría duplicado en cada réplica de API |
| El worker no monta rutas de negocio | `worker.ts` (`createApplicationContext`) | `worker-probe-server.spec.ts` | La API quedaría expuesta en un contenedor tratado como interno |
| Readiness responde 503 durante el drenado | `graceful-shutdown.service.ts`, sonda del worker | `worker-probe-server.spec.ts` | Cada despliegue tiraría las peticiones de esa ventana |
| En modo diferido la API no entrega notificaciones | `notification-broadcast.service.ts` | `notification-broadcast.deferred.spec.ts` | La entrega correría en el proceso equivocado, sin que nada fallara |
| El job de entrega diferida no aplica corte por antigüedad | `runtime-maintenance-jobs.service.ts` | `deliver-pending-notifications.spec.ts` | Los broadcasts se retrasarían hasta 20 minutos |
| Las migraciones corren desde la imagen | `database/migrate.ts` | Job `docker-image` de CI | El artefacto de despliegue no podría provisionar su base |
| La imagen no corre como root | `Dockerfile` | Job `docker-image` de CI | Escalada de privilegios desde el contenedor |
| El manifiesto de producción aborta sin secretos | `docker-compose.prod.yml` | Job `docker-image` de CI | Un despliegue incompleto arrancaría con valores de ejemplo |

---

## Contrato

| Garantía del contrato | Gate |
|---|---|
| Toda operación tiene `operationId`, `summary`, `tags` y seguridad declarada | `yarn check:openapi` |
| Toda respuesta 2xx declara esquema | `yarn check:openapi` |
| Toda operación documenta 429 y 500 | `yarn check:openapi` |
| El contrato no lleva secretos ni placeholders | `yarn check:openapi` |
| El contrato cumple el estándar OpenAPI 3.1 | `yarn docs:openapi:lint` |
| El contrato coincide con las rutas montadas | `yarn docs:openapi` + revisión del diff |
| El recorrido documentado coincide con las rutas montadas | `GET /operations/workflows/:code/consistency` |

---

## Cómo usar esta matriz

- **Vas a cambiar una regla de negocio** → localiza su fila, mira qué prueba la cubre y qué endpoint
  la expone. Si el cambio es incompatible, el contrato también cambia.
- **Una prueba falla y no sabes qué protege** → búscala aquí; la columna «si se rompiera» dice cuál
  es el daño real.
- **Vas a borrar una prueba** → si aparece en esta matriz, no la borres: cambia la regla o cambia la
  prueba, pero deja constancia.
