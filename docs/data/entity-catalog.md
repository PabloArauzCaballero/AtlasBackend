# Catálogo de entidades

138 tablas en 12 esquemas de dominio. Esta página es el índice navegable; el catálogo **vivo y
consultable** vive en la propia base (`system_data_entity_catalog` y tablas hermanas de
`platform_ops`) y se expone por `GET /operations/systems/data-catalog`.

Los dos no compiten: la base tiene el detalle campo a campo y su narrativa de negocio (139 de 139
entidades catalogadas tienen la suya); esta página dice **dónde mirar** y qué esperar de cada zona.

---

## `iam` · Identidad y acceso — 10 tablas

| Tabla | Propósito | Sensibilidad |
|---|---|---|
| `tenants` | Cliente de la plataforma. Raíz del aislamiento | Baja |
| `platform_users` | Cuenta de un cliente final | **PII** |
| `internal_users` | Cuenta de personal interno | **PII** |
| `internal_roles`, `internal_permissions`, `internal_role_permissions`, `internal_user_roles` | RBAC interno | Baja |
| `auth_credentials` | Hash Argon2 de contraseña y `token_version` | **Secreto** |
| `auth_refresh_tokens` | Tokens opacos de refresco | **Secreto** |
| `auth_one_time_codes` | Códigos de un solo uso (PIN, recuperación) | **Secreto**, TTL corto |

## `customer` · Cliente — 12 tablas

| Tabla | Propósito | Sensibilidad |
|---|---|---|
| `customers` | La entidad central del dominio. 12 módulos dependen de ella | **PII** |
| `customer_status_events` | Cada transición de la máquina de estados: quién, cuándo y por qué | Media |
| `customer_profile_versions` | Historial de versiones del perfil | **PII** |
| `customer_identity_documents` | Documentos de identidad. Hash indexado + blob cifrado | **PII crítica** |
| `identity_verification_attempts` | Cada intento de verificación y su resultado | Media |
| `customer_contact_methods`, `contact_verification_attempts` | Teléfonos y correos, y su verificación | **PII** |
| `customer_addresses`, `customer_address_versions`, `address_gps_observations` | Domicilio e historial | **PII** |
| `customer_reference_contacts` | Referencias personales declaradas | **PII de terceros** |
| `customer_eligibility_evaluations` | Evidencia persistida de cada cálculo de elegibilidad | Media |

## `privacy` · Privacidad — 11 tablas

Consentimientos, finalidades de tratamiento, políticas de retención, clasificación de datos y reglas
de campos sensibles. Es el esquema que hace auditable el tratamiento de PII: ver
[Retención y clasificación](retention.md).

## `risk` · Riesgo — 14 tablas

Definiciones de features, versiones de ruleset, reglas de política, ejecuciones de cálculo y
evaluaciones. Cada evaluación guarda **qué versión de modelo y de ruleset usó**: sin eso, una decisión
crediticia no es explicable meses después.

## `catalog` · Catálogos — 17 tablas

Catálogos versionados, definiciones semánticas, glosario de negocio y mapeos de riesgo que consume el
motor de decisión. Es dato de referencia: se siembra en el perfil `production`.

## `telemetry` · Telemetría — 18 tablas

Señales de dispositivo, comportamiento durante el onboarding y sesión. Alimentan features de riesgo y
fraude.

## `case_management` · Casos — 6 tablas

Casos de fraude, observaciones de back office y su ciclo de revisión. Un caso abierto bloquea la
elegibilidad (`FRAUD_CASE_OPEN`).

## `integrations` · Proveedores externos — 6 tablas

| Tabla | Propósito |
|---|---|
| `data_providers` | Los nueve proveedores, con su modo y su política de retención |
| `external_provider_cost_policies` | Coste unitario, topes por usuario y día, TTL de caché, etapas permitidas |
| `data_provider_requests`, `data_provider_responses` | Evidencia íntegra de cada consulta |
| `provider_health_logs` | Salud e histórico de latencia por proveedor |
| `external_oauth_connections` | Conexiones OAuth voluntarias |

## `messaging` · Notificaciones — 5 tablas

`notification_messages` (el mensaje y su estado), `notification_deliveries` (cada intento por canal),
plantillas, preferencias y reglas. `notification_messages` es la cola real de la entrega diferida.

## `audit` · Auditoría — 5 tablas

`operational_audit_logs` (toda acción de un actor sobre un recurso, con payload redactado) y el
registro de acciones HTTP. Es lo que permite responder «quién hizo esto y cuándo».

## `credit` · Crédito — 3 tablas

Productos, solicitudes y decisiones. Deliberadamente pequeño: compras, cuotas y comercios están fuera
del alcance actual.

## `platform_ops` · Plataforma — 31 tablas

El esquema más grande, y el que no es de negocio: catálogo del propio sistema (endpoints, entidades,
narrativas), `system_job_runs`, `outbox_events`, `idempotency_keys`, las cinco tablas de
`workflow_*` y el gobierno de esquema.

**No lleva `_tenant_id`**: describe el software desplegado, no la operación de un cliente.

---

## Sin datos a propósito

Cinco tablas se quedan vacías deliberadamente, y está registrado como ATLAS-TECH-005:
`auth_refresh_tokens`, `system_action_logs`, `system_test_runs` y `system_test_step_runs` son
artefactos generados en runtime —sembrarlos con datos falsos les quita el valor de ser evidencia
real— y `external_oauth_connections` no tiene consumidor todavía.

---

## Verificación

| Comando | Qué comprueba |
|---|---|
| `yarn check:entity-narratives` | Que toda tabla con modelo ORM trae su narrativa curada (los cinco campos, sin stubs) |
| `yarn check:domain-schemas` | Que cada modelo resuelve en el esquema que le corresponde |
| `yarn check:domain-schema-layout` | Que el mapa tabla → esquema es único y coherente |
| `yarn check:read-api-views` | Que las vistas `read_api` no exponen hashes ni blobs cifrados |
| `yarn check:overfetching` | Que las consultas no traen columnas que nadie usa |
| `yarn db:seed:verify-graph` | Que ninguna relación padre → hijo del grafo sembrado queda huérfana |
