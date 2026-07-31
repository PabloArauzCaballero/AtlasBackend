# Catálogo de flujos de trabajo (árbol de endpoints)

El backend ya sabía **qué** endpoints expone (`system_endpoint_catalog`, poblado por
descubrimiento). Este catálogo responde lo que faltaba: **en qué orden se recorren**, **bajo qué
condiciones se pasa de uno al siguiente** y **qué estado del cliente habilita cada paso**.

Antes, ese conocimiento vivía repartido entre la prosa de [`endpoints.md`](./endpoints.md), la
lógica de `CustomerEligibilityService` y lo que cada cliente HTTP hubiera codificado por su cuenta.
Ahora es dato consultable, versionado y verificable contra el propio backend.

## Modelo de datos

Cinco tablas en el schema `platform_ops` (migración `20260728140000-create-workflow-catalog`):

| Tabla | Qué modela | Clave natural |
| --- | --- | --- |
| `workflow_definitions` | El proceso y su versión: tipo, dueño, estado de activación, criterios de éxito y error, auditoría. | `(workflow_code, version)` |
| `workflow_stages` | Etapas y subetapas (`parent_stage_id` autorreferente): módulo funcional, actor, orden, opcionalidad, estados requeridos/resultantes, regla de completitud. | `(workflow_definition_id, stage_code)` |
| `workflow_steps` | El endpoint concreto: método, ruta, orden, obligatoriedad, roles, contratos de entrada/salida, validaciones, errores posibles, reintentos, eventos producidos/consumidos, indicadores de inicio/fin/éxito/error. | `(workflow_definition_id, step_code)` |
| `workflow_step_dependencies` | Precedencia real entre pasos (`requires_completion`, `requires_data`, `soft`). | `(step_id, depends_on_step_id)` |
| `workflow_transitions` | Paso anterior/siguiente con su condición (`always`, `on_success`, `on_error`, `on_state`, `conditional`). Un extremo nulo es entrada o salida del flujo. | `(workflow_definition_id, transition_code)` |

### Decisiones de diseño

1. **Es catálogo de la plataforma, no de un tenant.** Describe el software desplegado (rutas,
   métodos, roles del sistema de autorización), no la operación de un cliente. Por eso no lleva
   `_tenant_id`, igual que `system_endpoint_catalog`. Lo que sí es por cliente —su avance— se deriva
   en tiempo real de sus propios datos.
2. **Versionado por fila.** Una versión nueva es un conjunto nuevo de filas; las anteriores quedan
   intactas en `deprecated`. Publicar no cambia el comportamiento de nadie hasta marcar `is_default`
   (un índice único parcial impide dos predeterminadas con el mismo código).
3. **Transiciones como filas, no columnas `next_step_id`.** El proceso real tiene bifurcaciones:
   enviar el paquete lleva a revisión o de vuelta a corregir según los bloqueadores.
4. **`endpoint_code` es referencia lógica, no FK.** Se deriva con `buildEndpointCode`, la misma
   función del catálogo técnico de endpoints, así los dos catálogos cruzan por construcción. No es
   FK física porque ese catálogo se puebla por descubrimiento en runtime y puede estar vacío en una
   instalación recién migrada.
5. **El avance no se reimplementa.** `completion_rule_json` nombra la sección, el estado o los
   bloqueadores que ya produce `CustomerEligibilityService`, que sigue siendo la única fuente de
   "dónde va el cliente". Una etapa sin señal automática se declara `manual` y se reporta como
   `not_applicable`, en lugar de fingir que el sistema sabe si un analista la resolvió.

## Flujo sembrado: `customer_credit_journey` v1

Sembrado por `src/database/seeders/production/20260728140000-seed-standard-customer-credit-workflow.ts`
a partir de `src/database/seed-data/customer-credit-workflow.seed-data.ts`. Es el recorrido REAL:
cada ruta corresponde a un endpoint implementado hoy.

| Orden | Etapa | Módulo | Actor | Regla de completitud |
| --- | --- | --- | --- | --- |
| 5 | `credit_catalog` (opcional) | credit | interno | manual |
| 10 | `registration` | customer_onboarding | cliente | sin bloqueador `NO_CREDENTIALS` |
| 20 | `session_bootstrap` (opcional) | sessions | cliente | manual |
| 30 | `data_capture` | customer_onboarding | cliente | sin bloqueadores de las 6 secciones + consentimientos |
| 30.10 | ↳ `contact_verification` | customer_onboarding | cliente | sección `contact_verification` |
| 30.20 | ↳ `personal_data` | customer_onboarding | cliente | sección `personal_data` |
| 30.30 | ↳ `financial_profile` | customer_onboarding | cliente | sección `financial_profile` |
| 30.40 | ↳ `address` | customer_onboarding | cliente | sección `address` |
| 30.50 | ↳ `identity_documents` | customer_onboarding | cliente | sección `identity_documents` |
| 30.60 | ↳ `reference_contacts` | customer_onboarding | cliente | sección `reference_contacts` |
| 30.70 | ↳ `privacy_consents` | customer_privacy | cliente | sin bloqueador `CONSENT_MISSING` |
| 40 | `external_evidence` (opcional) | external_data | sistema | manual |
| 50 | `submission` | customer_onboarding | cliente | estado ∈ {under_review, active, suspended, rejected} |
| 60 | `risk_assessment` | risk | sistema | sin `RISK_NOT_APPROVED` / `RISK_ASSESSMENT_STALE` |
| 70 | `back_office_review` | operations | interno | manual |
| 70.10 | ↳ `identity_decision` | operations | interno | sin `IDENTITY_NOT_VERIFIED` / `EVIDENCE_PENDING_REVIEW` |
| 70.20 | ↳ `compliance_screening` | operations | interno | sin `COMPLIANCE_MATCH_PENDING` |
| 70.30 | ↳ `manual_review` (opcional) | operations | interno | sin `OPEN_OBSERVATIONS` |
| 70.40 | ↳ `fraud_review` (opcional) | operations | interno | sin `FRAUD_CASE_OPEN` |
| 80 | `eligibility` | customers | sistema | estado `active` |
| 90 | `credit_application` | credit | cliente | manual |
| 100 | `credit_decision` (terminal) | operations | interno | manual |

Entrada del flujo: `POST /customer-onboarding/start`. Salida:
`POST /operations/credit/applications/:applicationId/decision`.

Ramas de excepción declaradas: verificación de identidad fallida → evidencia externa; paquete
incompleto → observaciones; coincidencias de cumplimiento → resolución; decisión que pide más
información → circuito de observaciones; caso de fraude descartado → reevaluación.

## API

Todas bajo `/api/v1`. Lectura del catálogo: cualquier rol autenticado del conjunto de lectura
(incluido `customer`, que es quien recorre el flujo). El informe de consistencia exige rol de
gobierno técnico.

| Método y ruta | Para qué |
| --- | --- |
| `GET /workflows` | Listar flujos. Filtros: `status`, `processType`, `ownerDomain`, `moduleCode`, `role`, `includeDeprecated`. |
| `GET /workflows/:workflowCode` | Árbol completo (etapas anidadas, pasos, transiciones, totales). |
| `GET /workflows/:workflowCode/versions` | Versiones registradas, de la más reciente a la más antigua. |
| `GET /workflows/:workflowCode/stages` | Etapas aplanadas en orden con su `depth`, para un stepper lineal. |
| `GET /workflows/:workflowCode/transitions` | Transiciones con condición, origen y destino. |
| `GET /workflows/:workflowCode/graph` | Nodos y aristas listos para una librería de diagramas. |
| `POST /workflows/:workflowCode/transitions/validate` | ¿Es legal ir de A a B? Devuelve `allowed` + `reasonCode`. |
| `GET /customers/:customerId/workflow-progress` | Avance del cliente: completadas, pendientes, bloqueadas y siguiente paso válido. |
| `GET /operations/workflows/:workflowCode/consistency` | Informe de divergencia contra los endpoints realmente montados. |

Todas aceptan `version` (`latest` por defecto, o `v1`). `latest` resuelve la versión predeterminada
y, si ninguna lo está, la activa más reciente — devolver un borrador solo por ser el más nuevo haría
que publicar cambiara el comportamiento de todos los consumidores sin que nadie lo decidiera.

### Filtros del árbol

`moduleCode`, `role`, `lifecycleStatus` y `actorType` recortan el árbol preservando tres
invariantes: la cadena de ancestros de una subetapa que sobrevive se conserva; los pasos de una
etapa descartada se descartan con ella; y ninguna transición o dependencia queda apuntando a un
paso inexistente.

### Validación de transición

Valida el **grafo declarado**, no autoriza la petición: los guards y las reglas de cada servicio se
siguen aplicando al ejecutar el endpoint. Sirve para que un cliente HTTP sepa por adelantado qué
puede intentar sin descubrirlo a base de 403 y 422. `reasonCode` posibles: `TRANSITION_DECLARED`,
`TRANSITION_NOT_DECLARED`, `STEP_NOT_FOUND`, `UNSATISFIED_DEPENDENCIES`, `ROLE_NOT_AUTHORIZED`,
`STATE_NOT_ALLOWED`.

## Sincronización con los endpoints reales

`GET /operations/workflows/:workflowCode/consistency` compara cada paso sembrado con las rutas que
**este proceso** tiene montadas (leídas del contenedor de Nest vía `DiscoveryService`, no de los
archivos fuente: un controlador que existe en `src/` pero cuyo módulo nadie importó no atiende
ninguna petición).

| Código | Severidad | Significa |
| --- | --- | --- |
| `STEP_ROUTE_NOT_EXPOSED` | error | El paso apunta a una ruta que no está montada. |
| `STEP_ENDPOINT_CODE_MISMATCH` | error | `endpoint_code` no deriva del método y la ruta declarados. |
| `STEP_UNKNOWN_LIFECYCLE_STATE` | error | Un estado que la máquina de estados del cliente no conoce. |
| `STEP_ROLES_DIVERGED` | aviso | Los roles del catálogo y los del decorador `@Roles` difieren. |
| `STEP_NOT_IN_ENDPOINT_CATALOG` | aviso | El endpoint aún no fue descubierto por el catálogo técnico. |
| `ROUTE_NOT_MAPPED` | aviso | Ruta de un dominio que el flujo cubre, sin ningún paso que la represente. |

`status` es `drift_detected` si hay al menos un error. El alcance de `ROUTE_NOT_MAPPED` se limita al
primer segmento de las rutas ya mapeadas: comparar contra las 250+ rutas del backend produciría un
informe con más ruido que señal.

Complemento estático: `test/unit/workflow-catalog/customer-credit-workflow.seed-data.spec.ts` cruza
la definición contra los controladores reales, la máquina de estados y los códigos de la regla de
habilitación en cada corrida de tests, sin base de datos.

## Operación

```bash
yarn db:migration:up                      # crea las cinco tablas
yarn db:seed:prod                         # siembra el árbol estándar
yarn db:seed:verify-prod-idempotency      # verifica que reejecutarlo no duplique filas
yarn smoke:workflow                       # contra una API levantada: árbol, grafo, transiciones y drift
```

`yarn smoke:workflow` falla si el informe de consistencia devuelve algún error, de modo que una
divergencia entre el árbol y los endpoints desplegados rompe el pipeline en vez de pasar inadvertida.

El seeder es idempotente por clave natural y mantiene identificadores estables. Una etapa o paso que
sale de la definición se marca `_deleted` (no se elimina: si alguien lo referenció, la referencia
sigue resolviendo); transiciones y dependencias sí se eliminan físicamente, porque son aristas sin
identidad propia y dejarlas marcadas obligaría a filtrar por `_deleted` en cada recorrido del grafo.
Nada de esto toca datos de clientes: el seeder solo escribe en las cinco tablas del catálogo.

## Cómo publicar una versión nueva

1. Editar `customer-credit-workflow.seed-data.ts` con `version: 'v2'` e `isDefault: false`.
2. Correr el seeder (o crear uno nuevo si `v1` debe quedar congelada tal cual está sembrada).
3. Revisar el árbol con `GET /workflows/customer_credit_journey?version=v2` y el informe de
   consistencia.
4. Marcar `v1` como `deprecated` y `v2` como `is_default` cuando la revisión termine.

Los recorridos históricos siguen siendo explicables: `v1` conserva sus filas intactas.
