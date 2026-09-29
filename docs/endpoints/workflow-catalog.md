# Catálogo de flujos de trabajo (árbol de endpoints)

El backend ya sabía **qué** endpoints expone (`system_endpoint_catalog`, poblado por
descubrimiento). Este catálogo responde lo que faltaba: **en qué orden se recorren**, **bajo qué
condiciones se pasa de uno al siguiente** y **qué estado del cliente habilita cada paso**.

Antes, ese conocimiento vivía repartido entre la prosa de [`endpoints.md`](./endpoints.md), la
lógica de `CustomerEligibilityService` y lo que cada cliente HTTP hubiera codificado por su cuenta.
Ahora es dato consultable, versionado y verificable contra el propio backend.

## Modelo de datos

Cinco tablas en el schema `platform_ops` (migración `20260728140000-create-workflow-catalog`),
ampliadas por `20260926170000-workflow-catalog-v2` (narrativa, dueño, prioridad, cliente por etapa,
naturaleza del paso) con una sexta, `workflow_definitions_sync`, que guarda la huella de lo volcado:

| Tabla                        | Qué modela                                                                                                                                                                                                       | Clave natural                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `workflow_definitions`       | El proceso y su versión: tipo, dueño, estado de activación, criterios de éxito y error, auditoría.                                                                                                               | `(workflow_code, version)`                  |
| `workflow_stages`            | Etapas y subetapas (`parent_stage_id` autorreferente): módulo funcional, actor, orden, opcionalidad, estados requeridos/resultantes, regla de completitud.                                                       | `(workflow_definition_id, stage_code)`      |
| `workflow_steps`             | El endpoint concreto: método, ruta, orden, obligatoriedad, roles, contratos de entrada/salida, validaciones, errores posibles, reintentos, eventos producidos/consumidos, indicadores de inicio/fin/éxito/error. | `(workflow_definition_id, step_code)`       |
| `workflow_step_dependencies` | Precedencia real entre pasos (`requires_completion`, `requires_data`, `soft`).                                                                                                                                   | `(step_id, depends_on_step_id)`             |
| `workflow_transitions`       | Paso anterior/siguiente con su condición (`always`, `on_success`, `on_error`, `on_state`, `conditional`). Un extremo nulo es entrada o salida del flujo.                                                         | `(workflow_definition_id, transition_code)` |

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

## Los procesos declarados en código

Desde el 2026-09-26 el catálogo **no se siembra**: cada proceso se declara en código en
`src/modules/workflow-catalog/definitions/processes/*.process.fixtures.ts`, la lista única es
`WORKFLOW_DEFINITIONS` (`workflow-definitions.registry.ts`) y llega a la base por las migraciones
`sync-workflow-catalog-N`, que llaman a `syncWorkflowCatalog` (upsert idempotente por clave natural,
en una transacción). Hoy hay **42 procesos**: cuatro recorridos compuestos (`C-01`…`C-04`) y los 38
procesos del inventario (`P-01`…`P-38`). Su ficha legible se genera en `docs/processes/`
(`yarn docs:processes`); no se escribe a mano.

Los cuatro recorridos compuestos:

| Proceso                        | Id     | Etapas | Pasos | Qué cubre                                                                                                                              |
| ------------------------------ | ------ | ------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `customer_credit_journey` v1   | `C-01` | 22     | 57    | El recorrido de crédito del cliente, con sus subetapas de captura (tabla de abajo).                                                    |
| `post_login_first_screen` v1   | `C-02` | 4      | 15    | El arranque de la app tras el login.                                                                                                   |
| `customer_full_lifecycle` v1   | `C-03` | 21     | 70    | Todo el recorrido del cliente, de los textos legales al cierre, pasando por identidad, riesgo, crédito, préstamos y avisos de pago.    |
| `customer_partner_commerce` v1 | `C-04` | 13     | 51    | El comercio de punta a punta y su cruce con el cliente: alta, KYB, sucursales, QR, venta en caja, aceptación y aviso de pago.          |

Las cifras de etapas y pasos son las de las fixtures el 2026-09-29; la fuente es el código, no esta
tabla.

### Cómo se declaran y qué los protege

`C-03` y `C-04` envuelven los árboles `FLUJO_CLIENTE_COMPLETO` y `FLUJO_CLIENTE_PARTNER`
(`src/database/seeders/demo/flujo-cliente-*.seed-data.ts`) con `stagesFromTree`; esos árboles ya no
se siembran, se conservan porque QA los recorre tal cual. El resto se escribe directamente como
fixture.

Los gates que corren en CI (job `backend`) sin levantar nada:

| Gate                             | Qué exige                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `yarn check:process-narratives`  | Que cada proceso conteste sus cinco preguntas y tenga dueño.                                                                  |
| `yarn check:process-steps`       | Que cada paso apunte a algo que existe: ruta del Backend por decoradores, ruta de Motor/ERP/Tableros, evento o job registrado. |
| `yarn check:process-sync`        | Que la última migración `sync-workflow-catalog-N` vuelque lo mismo que dice el código (candado `workflow-catalog.sync-lock.json`). |
| `yarn check:process-docs`        | Que `docs/processes/` coincida con lo que se generaría.                                                                       |

`test/unit/database/flujos-documentados.spec.ts` comprueba además, contra el inventario de
controladores, que cada ruta de los árboles de `C-03` y `C-04` existe, que el encuentro en la caja lo
ejecute el cliente y que la aceptación de la compra sea del comercio.

### El actor `merchant_user`

`workflow_stages` admitía cuatro actores y ninguno era el comercio, aunque la autenticación lo
reconoce desde siempre (`POST /merchant/auth/login`). Documentar el flujo del comercio murió con
`violates check constraint ck_workflow_stages_actor_type`. La migración
`20260921140000-workflow-stages-merchant-actor` amplía el vocabulario a `merchant_user` y
`platform_user`. Etiquetar al comercio como `internal_user` habría sido peor que el error: diría que
el comercio es personal de Atlas y borraría justo lo que ese flujo tiene de particular, que son tres
autorizaciones distintas.

## Recorrido `customer_credit_journey` v1 (`C-01`)

Declarado en `src/modules/workflow-catalog/definitions/processes/customer-credit-journey.process.fixtures.ts`.
Cada ruta corresponde a un endpoint implementado hoy (`yarn check:process-steps` lo comprueba).
Desde la regla eligibility-v2 (migración `sync-workflow-catalog-8`) las referencias personales son
opcionales y no bloquean la captura de datos.

| Orden | Etapa                          | Módulo              | Actor   | Regla de completitud                                    |
| ----- | ------------------------------ | ------------------- | ------- | ------------------------------------------------------- |
| 5     | `credit_catalog` (opcional)    | credit              | interno | manual                                                  |
| 10    | `registration`                 | customer_onboarding | cliente | sin bloqueador `NO_CREDENTIALS`                         |
| 20    | `session_bootstrap` (opcional) | sessions            | cliente | manual                                                  |
| 30    | `data_capture`                 | customer_onboarding | cliente | sin bloqueadores de 5 secciones + consentimientos       |
| 30.10 | ↳ `contact_verification`       | customer_onboarding | cliente | sección `contact_verification`                          |
| 30.20 | ↳ `personal_data`              | customer_onboarding | cliente | sección `personal_data`                                 |
| 30.30 | ↳ `financial_profile`          | customer_onboarding | cliente | sección `financial_profile`                             |
| 30.40 | ↳ `address`                    | customer_onboarding | cliente | sección `address`                                       |
| 30.50 | ↳ `identity_documents`         | customer_onboarding | cliente | sección `identity_documents`                            |
| 30.60 | ↳ `reference_contacts` (opc.)  | customer_onboarding | cliente | sección `reference_contacts`                            |
| 30.70 | ↳ `privacy_consents`           | customer_privacy    | cliente | sin bloqueador `CONSENT_MISSING`                        |
| 40    | `external_evidence` (opcional) | external_data       | sistema | manual                                                  |
| 50    | `submission`                   | customer_onboarding | cliente | estado ∈ {under_review, active, suspended, rejected}    |
| 60    | `risk_assessment`              | risk                | sistema | sin `RISK_NOT_APPROVED` / `RISK_ASSESSMENT_STALE`       |
| 70    | `back_office_review`           | operations          | interno | manual                                                  |
| 70.10 | ↳ `identity_decision`          | operations          | interno | sin `IDENTITY_NOT_VERIFIED` / `EVIDENCE_PENDING_REVIEW` |
| 70.20 | ↳ `compliance_screening`       | operations          | interno | sin `COMPLIANCE_MATCH_PENDING`                          |
| 70.30 | ↳ `manual_review` (opcional)   | operations          | interno | sin `OPEN_OBSERVATIONS`                                 |
| 70.40 | ↳ `fraud_review` (opcional)    | operations          | interno | sin `FRAUD_CASE_OPEN`                                   |
| 80    | `eligibility`                  | customers           | sistema | estado `active`                                         |
| 90    | `credit_application`           | credit              | cliente | manual                                                  |
| 100   | `credit_decision` (terminal)   | operations          | interno | manual                                                  |

Entrada del flujo: `POST /customer-onboarding/start`. Salida:
`POST /operations/credit/applications/:applicationId/decision`.

Ramas de excepción declaradas: verificación de identidad fallida → evidencia externa; paquete
incompleto → observaciones; coincidencias de cumplimiento → resolución; decisión que pide más
información → circuito de observaciones; caso de fraude descartado → reevaluación.

## API

Todas bajo `/api/v1`. Lectura del catálogo: cualquier rol autenticado del conjunto de lectura
(incluido `customer`, que es quien recorre el flujo). El informe de consistencia exige rol de
gobierno técnico.

| Método y ruta                                         | Para qué                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /workflows`                                      | Listar flujos. Filtros: `status`, `processType`, `ownerDomain`, `moduleCode`, `role`, `includeDeprecated`. |
| `GET /workflows/:workflowCode`                        | Árbol completo (etapas anidadas, pasos, transiciones, totales).                                            |
| `GET /workflows/:workflowCode/versions`               | Versiones registradas, de la más reciente a la más antigua.                                                |
| `GET /workflows/:workflowCode/stages`                 | Etapas aplanadas en orden con su `depth`, para un stepper lineal.                                          |
| `GET /workflows/:workflowCode/transitions`            | Transiciones con condición, origen y destino.                                                              |
| `GET /workflows/:workflowCode/graph`                  | Nodos y aristas listos para una librería de diagramas.                                                     |
| `POST /workflows/:workflowCode/transitions/validate`  | ¿Es legal ir de A a B? Devuelve `allowed` + `reasonCode`.                                                  |
| `GET /customers/:customerId/workflow-progress`        | Avance del cliente: completadas, pendientes, bloqueadas y siguiente paso válido.                           |
| `GET /operations/workflows/:workflowCode/consistency` | Informe de divergencia contra los endpoints realmente montados.                                            |

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

| Código                         | Severidad | Significa                                                                 |
| ------------------------------ | --------- | ------------------------------------------------------------------------- |
| `STEP_ROUTE_NOT_EXPOSED`       | error     | El paso apunta a una ruta que no está montada.                            |
| `STEP_ENDPOINT_CODE_MISMATCH`  | error     | `endpoint_code` no deriva del método y la ruta declarados.                |
| `STEP_UNKNOWN_LIFECYCLE_STATE` | error     | Un estado que la máquina de estados del cliente no conoce.                |
| `STEP_ROLES_DIVERGED`          | aviso     | Los roles del catálogo y los del decorador `@Roles` difieren.             |
| `STEP_NOT_IN_ENDPOINT_CATALOG` | aviso     | El endpoint aún no fue descubierto por el catálogo técnico.               |
| `ROUTE_NOT_MAPPED`             | aviso     | Ruta de un dominio que el flujo cubre, sin ningún paso que la represente. |

`status` es `drift_detected` si hay al menos un error. El alcance de `ROUTE_NOT_MAPPED` se limita al
primer segmento de las rutas ya mapeadas: comparar contra todas las rutas del backend produciría un
informe con más ruido que señal.

Complemento estático: `yarn check:process-steps` cruza cada paso declarado contra los controladores
reales, los eventos registrados y los jobs del planificador en cada PR, sin base de datos.

## Operación

```bash
yarn db:migration:up        # crea las tablas y vuelca los procesos (migraciones sync-workflow-catalog-N)
yarn workflows:sync         # sólo en local: vuelca las fixtures sin esperar a una migración nueva
yarn check:process-sync     # el código y la última migración de procesos dicen lo mismo
yarn smoke:workflow         # contra una API levantada: árbol, grafo, transiciones y drift
```

`yarn smoke:workflow` falla si el informe de consistencia devuelve algún error, de modo que una
divergencia entre el árbol y los endpoints desplegados rompe el pipeline en vez de pasar inadvertida.

El volcado es idempotente por clave natural y mantiene identificadores estables. Una etapa o paso que
sale de la fixture se marca `_deleted` (no se elimina: si alguien lo referenció, la referencia sigue
resolviendo); transiciones y dependencias sí se eliminan y se reescriben, porque son aristas sin
identidad propia. Nada de esto toca datos de clientes: sólo escribe filas del catálogo `workflow_*`.
En los entornos desplegados los procesos llegan **sólo** por migración; `workflows:sync` es para ver
en el portal local un proceso que se está escribiendo.

## Cómo cambiar un proceso

1. Editar su fixture en `src/modules/workflow-catalog/definitions/processes/`.
2. Crear una migración `sync-workflow-catalog-N` nueva (mismo patrón que las anteriores) y fijar el
   candado con `yarn check:process-sync --update <migración>`.
3. Regenerar la ficha con `yarn docs:processes` y pasar `yarn check:process-narratives`,
   `yarn check:process-steps` y `yarn check:process-docs`.
4. Revisar el árbol desplegado con `GET /workflows/:workflowCode` (p. ej. `workflowCode` =
   `customer_credit_journey`) y el informe `GET /operations/workflows/:workflowCode/consistency`.

El volcado escribe la versión que declara la fixture como `active` y predeterminada
(`is_default = true`), y el índice único parcial de `workflow_definitions` impide dos predeterminadas
del mismo código. Por eso hoy **no** se publican dos versiones a la vez: todas las fixtures son `v1`
y un cambio se edita en su sitio. La historia de un proceso está en git y en la huella de
`workflow_definitions_sync`. Mantener una `v2` en paralelo exigiría antes cambiar `syncWorkflowCatalog`.
