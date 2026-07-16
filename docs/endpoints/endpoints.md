# Proyecto ATLAS — Endpoints compuestos disponibles

## Principio de diseño

La API de Atlas no expone CRUD por tabla. Cada endpoint de escritura representa un caso de uso de negocio y puede afectar varias tablas dentro de una transacción Sequelize.

Regla aplicada:

```txt
1 endpoint de escritura = 1 caso de uso real = varias tablas afectadas = transacción atómica.
```

No existen endpoints de seeds ni endpoints por tabla.

## Endpoints activos

| Método | Endpoint | Estado | Tipo |
|---|---|---|---|
| GET | `/api/v1/health` | Activo | Health técnico |
| GET | `/api/v1/consent-documents/active` | Activo | Lectura legal |
| POST | `/api/v1/customer-onboarding/start` | Activo | Escritura compuesta |
| POST | `/api/v1/customer-onboarding/:customerId/contact-verification/request` | Activo | Escritura compuesta |
| POST | `/api/v1/customer-onboarding/:customerId/contact-verification/submit` | Activo | Escritura compuesta |
| POST | `/api/v1/customer-onboarding/:customerId/identity-package` | Activo | Escritura compuesta |
| POST | `/api/v1/customer-onboarding/:customerId/address-package` | Activo | Escritura compuesta |
| POST | `/api/v1/customers/:customerId/telemetry/batch` | Activo | Escritura batch compuesta |
| POST | `/api/v1/customers/:customerId/risk-assessments` | Activo | Escritura compuesta |
| GET | `/api/v1/customers/:customerId/me` | Activo | Lectura agregada |
| POST | `/api/v1/customers/:customerId/sessions/start` | Activo | Escritura compuesta de sesión |
| POST | `/api/v1/customers/:customerId/sessions/:sessionId/heartbeat` | Activo | Escritura compuesta de liveness |
| POST | `/api/v1/customers/:customerId/sessions/:sessionId/end` | Activo | Escritura compuesta de cierre |
| GET | `/api/v1/customers/:customerId/session-state` | Activo | Lectura agregada de sesión |
| GET | `/api/v1/operations/sessions/:sessionId/investigation-summary` | Activo | Lectura interna agregada |
| POST | `/api/v1/customers/:customerId/privacy/consent-decisions` | Activo | Escritura batch compuesta |
| POST | `/api/v1/customers/:customerId/privacy/data-subject-requests` | Activo | Escritura compuesta |
| GET | `/api/v1/operations/work-queue` | Activo | Lectura interna agregada |
| GET | `/api/v1/operations/customers/:customerId/investigation-summary` | Activo | Lectura interna agregada |
| POST | `/api/v1/operations/manual-review-cases/:caseId/decision` | Activo | Escritura compuesta |
| POST | `/api/v1/operations/fraud-cases/:caseId/decision` | Activo | Escritura compuesta |
| GET | `/api/v1/operations/risk-assessments/:riskAssessmentRunId` | Activo | Lectura interna agregada |
| GET | `/api/v1/operations/risk-assessments/:riskAssessmentRunId/explanation` | Activo | Lectura interna agregada |
| GET | `/api/v1/operations/data-quality/issues` | Activo | Lectura interna paginada |
| POST | `/api/v1/operations/data-quality/issues/:issueId/resolve` | Activo | Escritura compuesta |
| GET | `/api/v1/operations/audit/customer/:customerId` | Activo | Lectura interna paginada |

---

## 1. Health

```http
GET /api/v1/health
```

### Lee

- Conexión Sequelize/PostgreSQL.

### Escribe

- Nada.

---

## 2. Documentos legales activos

```http
GET /api/v1/consent-documents/active
```

### Lee

- `consent_documents`

### Escribe

- Nada.

### Query

```txt
language=es
purposeCode=risk_evaluation
```

---

## 3. Inicio compuesto de onboarding

```http
POST /api/v1/customer-onboarding/start
```

### Escribe

- `customers`
- `customer_profile_versions`
- `customer_contact_methods`
- `customer_status_events`
- `global_device_fingerprints`
- `devices`
- `customer_device_links`
- `customer_sessions`
- `device_snapshots`
- `onboarding_flows`
- `onboarding_step_events`
- `permission_events`
- `customer_action_logs`
- `operational_audit_logs`
- `customer_consents`
- `consent_events`

### Lee

- `customers`
- `customer_contact_methods`
- `consent_documents`
- `global_device_fingerprints`
- `devices`
- `customer_device_links`

### Reglas

- Requiere `x-tenant-id`.
- Requiere `x-idempotency-key`.
- No guarda teléfono/email en claro.
- No guarda contactos crudos.
- No evalúa riesgo.
- No crea crédito, pagos, cuotas, MDR ni cobranza.

---

## 4. Solicitar verificación de contacto

```http
POST /api/v1/customer-onboarding/:customerId/contact-verification/request
```

### Escribe

- `contact_verification_attempts`
- `auth_events`
- `onboarding_step_events`
- `customer_action_logs`
- `operational_audit_logs`

### Lee

- `customers`
- `customer_contact_methods`
- `onboarding_flows`

### Reglas

- Unifica teléfono, email, SMS, email y WhatsApp bajo el mismo endpoint.
- No guarda OTP en claro.
- Contiene rate limit simple por último intento.

---

## 5. Confirmar verificación de contacto

```http
POST /api/v1/customer-onboarding/:customerId/contact-verification/submit
```

### Escribe

- `contact_verification_attempts`
- `customer_contact_methods`
- `auth_events`
- `onboarding_step_events`
- `customer_action_logs`
- `operational_audit_logs`

### Lee

- `customers`
- `customer_contact_methods`
- `contact_verification_attempts`
- `onboarding_flows`

### Reglas

- Marca el contacto como verificado.
- Registra evento de auth y onboarding.
- Para smoke local acepta `123456`; la integración real de proveedor queda pendiente.

---

## 6. Paquete KYC / identidad

```http
POST /api/v1/customer-onboarding/:customerId/identity-package
```

### Escribe

- `customer_identity_documents`
- `identity_verification_attempts`
- `evidence_documents`
- `evidence_extractions`
- `evidence_reviews`
- `data_provider_requests`
- `data_provider_responses`
- `customer_status_events`
- `onboarding_step_events`
- `customer_action_logs`
- `operational_audit_logs`

### Lee

- `customers`
- `onboarding_flows`

### Reglas

- No recibe imágenes en base64.
- No guarda documento en claro.
- Requiere al menos evidencia frontal.
- Deja la identidad en `pending_review`.
- No crea línea de crédito.

---

## 7. Paquete de dirección y GPS

```http
POST /api/v1/customer-onboarding/:customerId/address-package
```

### Escribe

- `customer_addresses`
- `customer_address_versions`
- `address_gps_observations`
- `customer_observations`
- `onboarding_step_events`
- `customer_action_logs`
- `operational_audit_logs`

### Lee

- `customers`
- `customer_addresses`
- `onboarding_flows`

### Reglas

- Versiona la dirección.
- GPS es opcional.
- Valida rango de coordenadas.
- No guarda dirección sensible en claro si se envía cifrada/tokenizada.

---

## 8. Telemetría batch

```http
POST /api/v1/customers/:customerId/telemetry/batch
```

### Escribe

- `form_field_interaction_events`
- `permission_events`
- `auth_events`
- `device_risk_events`
- `sim_observations`
- `ip_reputation_observations`
- `customer_action_logs`
- `onboarding_step_events`
- `customer_observations`
- `on_device_computation_runs`
- `on_device_metric_values`
- `onboarding_behavior_summaries`
- `customer_activity_summaries`
- `operational_audit_logs`

### Lee

- `customers`
- `customer_device_links`
- `onboarding_flows`

### Reglas

- Requiere `x-idempotency-key`.
- Máximo 100 eventos y 100 métricas por request.
- Rechaza payloads con contactos crudos (`RAW_CONTACTS_NOT_ALLOWED`).
- No crea endpoints por evento individual.

---

## 9. Evaluación de riesgo

```http
POST /api/v1/customers/:customerId/risk-assessments
```

### Escribe

- `feature_computation_runs`
- `feature_values`
- `feature_snapshots`
- `risk_assessment_runs`
- `risk_assessment_contexts`
- `risk_rules_fired`
- `risk_feature_contributions`
- `risk_assessment_results`
- `manual_review_cases` cuando corresponde
- `data_quality_issues` cuando faltan datos críticos
- `operational_audit_logs`

### Lee

- `customers`
- `customer_consents`
- `customer_contact_methods`
- `customer_identity_documents`

### Reglas

- No crea crédito.
- No crea límite de crédito.
- No crea compra BNPL.
- Devuelve decisión de onboarding/riesgo: `approved_for_next_step` o `manual_review_required`.
- Usa reglas determinísticas MVP, no scorecard estadístico final.

---

## 10. Perfil propio del cliente

```http
GET /api/v1/customers/:customerId/me
```

### Lee

- `customers`
- `customer_profile_versions`
- `customer_contact_methods`
- `customer_consents`
- `risk_assessment_results`

### Escribe

- Nada.

---

## 11. Decisiones de consentimiento

```http
POST /api/v1/customers/:customerId/privacy/consent-decisions
```

### Escribe

- `customer_consents`
- `consent_events`
- `customer_status_events` cuando hay revocación
- `customer_action_logs`
- `operational_audit_logs`

### Lee

- `customers`
- `consent_documents`

---

## 12. Solicitudes de privacidad del titular

```http
POST /api/v1/customers/:customerId/privacy/data-subject-requests
```

### Escribe

- `data_subject_requests`
- `customer_action_logs`
- `operational_audit_logs`

### Lee

- `customers`

---

## 13. Cola operativa

```http
GET /api/v1/operations/work-queue
```

### Lee

- `manual_review_cases`
- `fraud_cases`

### Escribe

- Nada.

---

## 14. Resumen de investigación

```http
GET /api/v1/operations/customers/:customerId/investigation-summary
```

### Lee

- `customers`
- `customer_profile_versions`
- `customer_contact_methods`
- `customer_consents`
- `risk_assessment_results`
- `manual_review_cases`
- `fraud_cases`

### Escribe

- Nada.

---

## 15. Decisión de revisión manual

```http
POST /api/v1/operations/manual-review-cases/:caseId/decision
```

### Escribe

- `manual_review_cases`
- `manual_review_events`
- `customer_status_events`
- `customer_observations`
- `operational_audit_logs`
- `data_change_logs`

### Lee

- `manual_review_cases`

### Reglas

- No permite decidir casos cerrados.
- Registra evento append-only.
- Audita operador.

---

## 16. Decisión de fraude

```http
POST /api/v1/operations/fraud-cases/:caseId/decision
```

### Escribe

- `fraud_cases`
- `fraud_case_events`
- `watchlist_entries` cuando `applyWatchlist=true`
- `customer_status_events`
- `customer_observations`
- `operational_audit_logs`
- `data_change_logs`

### Lee

- `fraud_cases`

---

## 17. Detalle interno de evaluación de riesgo

```http
GET /api/v1/operations/risk-assessments/:riskAssessmentRunId
```

### Lee

- `risk_assessment_runs`
- `risk_assessment_results`
- `risk_rules_fired`
- `risk_feature_contributions`
- `feature_snapshots`

---

## 18. Explicación interna de riesgo

```http
GET /api/v1/operations/risk-assessments/:riskAssessmentRunId/explanation
```

### Lee

- `risk_assessment_runs`
- `risk_assessment_results`
- `risk_rules_fired`
- `risk_feature_contributions`
- `feature_snapshots`

---

## 19. Problemas de calidad de datos

```http
GET /api/v1/operations/data-quality/issues
```

### Lee

- `data_quality_issues`

---

## 20. Resolver problema de calidad de datos

```http
POST /api/v1/operations/data-quality/issues/:issueId/resolve
```

### Escribe

- `data_quality_issues`
- `operational_audit_logs`
- `data_change_logs`

### Lee

- `data_quality_issues`

---

## 21. Auditoría del cliente

```http
GET /api/v1/operations/audit/customer/:customerId
```

### Lee

- `operational_audit_logs`
- `data_change_logs`
- `customer_status_events`
- `customer_action_logs`
- `auth_events`

### Escribe

- Nada.

---

## Endpoints explícitamente no implementados

No se implementaron endpoints de:

- Seeds.
- CRUD por tabla.
- Crédito.
- Compras BNPL.
- Cuotas.
- Pagos.
- MDR.
- Liquidación.
- Cobranza.

Motivo: esas entidades y reglas no están cerradas en esta fase del backend actual.


---

## Sesiones — endpoints compuestos nuevos

La sesión en Atlas no es solo una fila en `customer_sessions`. Una sesión es una unidad de seguridad, dispositivo, GPS, permisos, red, SIM, actividad y auditoría. Por eso los endpoints de esta sección escriben en varias tablas dentro de una transacción y no exponen CRUD por tabla.

### EP-S01 — Iniciar sesión compuesta del cliente

```http
POST /api/v1/customers/:customerId/sessions/start
```

#### Qué es

Crea una nueva sesión activa para un cliente existente. Se usa cuando el cliente abre la app, vuelve después del onboarding inicial, inicia sesión desde otro dispositivo o necesita renovar contexto de seguridad.

No reemplaza `POST /api/v1/customer-onboarding/start`. Ese endpoint crea el cliente. Este endpoint crea una sesión posterior para un cliente ya existente.

#### Por qué es importante

Una sesión debe alimentar riesgo y fraude. Si solo se registra `customer_sessions`, se pierde contexto valioso: dispositivo, GPS, permisos, SIM, IP, VPN, root/emulador y auditoría. Este endpoint deja una trazabilidad completa desde el inicio de sesión.

#### Headers requeridos

```http
Authorization: Bearer <customer_token>
x-tenant-id: 1
x-idempotency-key: <uuid-o-string-unico>
content-type: application/json
```

#### Body recomendado

```json
{
  "device": {
    "deviceFingerprintHash": "sha256-session-device-001",
    "fingerprintVersion": "v1",
    "channel": "mobile_app",
    "userAgent": "AtlasMobile/0.1.0",
    "snapshot": {
      "brand": "Apple",
      "model": "iPhone 13",
      "osFamily": "iOS",
      "osVersion": "18.0",
      "appVersion": "0.1.0",
      "isRooted": false,
      "isEmulator": false,
      "vpnDetected": false
    }
  },
  "authMethod": "app_session",
  "gpsObservation": {
    "lat": -17.7833,
    "lng": -63.1821,
    "accuracyMeters": 15,
    "capturedAt": "2026-06-29T13:30:00.000Z"
  },
  "permissions": [
    {
      "permissionCode": "location",
      "granted": true,
      "decidedAt": "2026-06-29T13:30:00.000Z"
    }
  ],
  "locationPermissionGranted": true,
  "simObservation": {
    "phoneNumberHash": "sha256-phone-line",
    "phoneLast4": "0000",
    "carrierName": "Tigo",
    "simType": "physical",
    "simCount": 1
  },
  "ipReputation": {
    "isVpn": false,
    "isProxy": false,
    "isTor": false,
    "countryCode": "BO",
    "city": "Santa Cruz",
    "reputationScore": 0.12
  }
}
```

#### Tablas que lee

- `customers`: valida existencia, tenant y estado del cliente.
- `global_device_fingerprints`: verifica si el fingerprint ya fue visto globalmente.
- `devices`: verifica si el dispositivo ya existe en el tenant.
- `customer_device_links`: verifica vínculo cliente-dispositivo.
- `customer_addresses`: busca dirección actual si existe.
- `customer_address_versions`: asocia GPS a versión vigente de dirección si existe.
- `onboarding_flows`: relaciona la sesión con el flujo activo si el cliente sigue en onboarding.

#### Tablas que escribe o actualiza

- `global_device_fingerprints`: crea o actualiza reutilización global del dispositivo.
- `devices`: crea o actualiza `last_seen_at` y contador de reutilización.
- `customer_device_links`: crea o actualiza vínculo, `first_seen_session_id` y `last_seen_session_id`.
- `customer_sessions`: crea la sesión activa.
- `device_snapshots`: guarda estado técnico del dispositivo.
- `address_gps_observations`: guarda GPS si existe permiso de ubicación.
- `permission_events`: registra permisos enviados por la app.
- `auth_events`: registra `session_started`.
- `ip_reputation_observations`: guarda señales de IP, VPN, proxy o Tor.
- `sim_observations`: guarda observación de SIM/carrier si viene en el body.
- `device_risk_events`: crea señales si hay root, emulador o VPN.
- `customer_action_logs`: registra `session_started`.
- `customer_activity_summaries`: actualiza resumen de actividad.
- `customer_observations`: deja observación resumida de sesión/GPS.
- `onboarding_step_events`: registra evento si hay onboarding activo.
- `operational_audit_logs`: audita la operación.

#### Respuesta esperada

```json
{
  "data": {
    "customerId": "1",
    "sessionId": "10",
    "deviceId": "4",
    "sessionStatus": "active",
    "gpsObservationId": "7",
    "gpsObservationCreated": true,
    "gpsObservationSkippedReason": null,
    "deviceTrustLevel": "new",
    "nextStep": "continue"
  }
}
```

#### Reglas

1. Requiere `x-idempotency-key`.
2. No crea cliente nuevo.
3. No crea crédito, pagos, cuotas, MDR ni cobranza.
4. Solo guarda GPS si `locationPermissionGranted=true` o si hay permiso `location` concedido.
5. Si no hay dirección actual, crea `address_gps_observations` con `customer_address_id=null` y `address_version_id=null`.
6. Si existe dirección actual, asocia el GPS a `customer_addresses.current_version_id`.
7. Si detecta root, emulador o VPN, crea `device_risk_events`.

---

### EP-S02 — Registrar heartbeat de sesión

```http
POST /api/v1/customers/:customerId/sessions/:sessionId/heartbeat
```

#### Qué es

Registra señales ligeras mientras la sesión está viva: GPS recurrente, permisos, snapshot del dispositivo, IP, SIM y señales de riesgo. No es un `PATCH` porque no representa una edición simple de `customer_sessions`, sino un nuevo paquete de eventos y observaciones.

#### Por qué es importante

Permite detectar cambios dentro de la misma sesión: usuario revoca GPS, aparece VPN, cambia SIM, el dispositivo se vuelve sospechoso o se reciben nuevas ubicaciones. Esto es útil para riesgo, fraude y auditoría.

#### Headers requeridos

```http
Authorization: Bearer <customer_token>
x-tenant-id: 1
x-idempotency-key: <uuid-o-string-unico>
content-type: application/json
```

#### Body recomendado

```json
{
  "deviceId": "4",
  "clientHeartbeatId": "hb_20260629_001",
  "capturedAt": "2026-06-29T13:35:00.000Z",
  "gpsObservation": {
    "lat": -17.7829,
    "lng": -63.1818,
    "accuracyMeters": 12
  },
  "permissionChanges": [
    {
      "permissionCode": "location",
      "granted": true,
      "decidedAt": "2026-06-29T13:35:00.000Z"
    }
  ],
  "locationPermissionGranted": true,
  "deviceSnapshot": {
    "isRooted": false,
    "isEmulator": false,
    "vpnDetected": false,
    "appVersion": "0.1.1"
  },
  "ipReputation": {
    "isVpn": false,
    "isProxy": false,
    "isTor": false,
    "countryCode": "BO",
    "city": "Santa Cruz",
    "reputationScore": 0.10
  }
}
```

#### Tablas que lee

- `customers`: valida ownership.
- `customer_sessions`: valida que la sesión exista y esté activa.
- `devices`: valida dispositivo.
- `customer_device_links`: valida vínculo cliente-dispositivo.
- `customer_addresses`: busca dirección actual.
- `customer_address_versions`: asocia GPS a versión vigente si existe.
- `onboarding_flows`: relaciona evento con onboarding si aplica.

#### Tablas que escribe o actualiza

- `address_gps_observations`: crea nueva observación GPS si hay permiso.
- `device_snapshots`: crea snapshot si viene en el body.
- `devices`: actualiza `last_seen_at`.
- `customer_device_links`: actualiza `last_seen_session_id` y `last_seen_at`.
- `permission_events`: registra cambios de permisos.
- `ip_reputation_observations`: registra IP/VPN/proxy/Tor si viene metadata.
- `sim_observations`: registra SIM si viene metadata.
- `device_risk_events`: registra root/emulador/VPN si se detecta.
- `customer_action_logs`: registra `session_heartbeat`.
- `customer_activity_summaries`: actualiza última actividad.
- `customer_observations`: registra observación derivada.
- `operational_audit_logs`: audita la recepción del heartbeat.

#### Respuesta esperada

```json
{
  "data": {
    "sessionId": "10",
    "status": "accepted",
    "gpsObservationCreated": true,
    "gpsObservationId": "8",
    "gpsObservationSkippedReason": null,
    "riskSignalsCreated": 0
  }
}
```

#### Reglas

1. Requiere sesión activa.
2. Requiere que `deviceId` coincida con la sesión.
3. Requiere `x-idempotency-key`.
4. Si no hay permiso de ubicación, no crea `address_gps_observations`.
5. No reemplaza `telemetry/batch`; este endpoint es para liveness de sesión, no para eventos masivos de formulario.

---

### EP-S03 — Cerrar sesión

```http
POST /api/v1/customers/:customerId/sessions/:sessionId/end
```

#### Qué es

Cierra formalmente una sesión activa. Aunque internamente actualiza `customer_sessions`, se expone como `POST /end` porque representa un comando de negocio: cerrar sesión, registrar salida, generar auditoría y dejar trazabilidad.

#### Por qué es importante

Permite saber cuándo terminó una sesión, calcular duración, cerrar contexto de riesgo y evitar que sesiones viejas queden indefinidamente activas.

#### Headers requeridos

```http
Authorization: Bearer <customer_token>
x-tenant-id: 1
x-idempotency-key: <uuid-o-string-unico>
content-type: application/json
```

#### Body recomendado

```json
{
  "deviceId": "4",
  "endedAt": "2026-06-29T14:10:00.000Z",
  "reasonCode": "customer_logout"
}
```

#### Tablas que lee

- `customers`: valida cliente.
- `customer_sessions`: valida sesión activa.
- `devices`: se usa si viene `deviceId`.
- `customer_device_links`: valida vínculo indirectamente por sesión/dispositivo.

#### Tablas que escribe o actualiza

- `customer_sessions`: actualiza `ended_at` y `session_status=ended`.
- `auth_events`: registra `session_ended`.
- `customer_action_logs`: registra `session_ended`.
- `customer_activity_summaries`: actualiza última actividad.
- `operational_audit_logs`: audita cierre.

#### Respuesta esperada

```json
{
  "data": {
    "sessionId": "10",
    "sessionStatus": "ended",
    "endedAt": "2026-06-29T14:10:00.000Z"
  }
}
```

#### Reglas

1. No permite cerrar sesión inexistente.
2. No permite cerrar una sesión que no está activa.
3. Si `deviceId` viene en el body, debe coincidir con el dispositivo de la sesión.
4. No borra la sesión; solo cambia estado y registra eventos.

---

### EP-S04 — Obtener estado actual de sesión del cliente

```http
GET /api/v1/customers/:customerId/session-state
```

#### Qué es

Devuelve a la app un resumen seguro de la sesión activa actual, dispositivo asociado y última observación GPS. Es una lectura agregada para evitar múltiples llamadas pequeñas.

#### Por qué es importante

La app puede saber si tiene sesión activa, si hay GPS reciente y qué nivel básico de confianza tiene el dispositivo sin consultar tablas internas.

#### Headers requeridos

```http
Authorization: Bearer <customer_token>
x-tenant-id: 1
```

#### Tablas que lee

- `customers`
- `customer_sessions`
- `devices`
- `customer_device_links`
- `device_snapshots`
- `address_gps_observations`

#### Respuesta esperada

```json
{
  "data": {
    "customerId": "1",
    "activeSession": {
      "sessionId": "10",
      "status": "active",
      "startedAt": "2026-06-29T13:30:00.000Z"
    },
    "device": {
      "deviceId": "4",
      "trustLevel": "new",
      "riskStatus": "unknown"
    },
    "location": {
      "lastGpsObservedAt": "2026-06-29T13:35:00.000Z",
      "hasRecentGps": true
    }
  }
}
```

#### Reglas

1. Cliente solo puede verse a sí mismo.
2. Operadores internos autorizados pueden consultar.
3. No expone hashes, coordenadas exactas ni auditoría completa.
4. Si no hay sesión activa, devuelve `activeSession=null`.

---

### EP-S05 — Resumen interno de investigación de sesión

```http
GET /api/v1/operations/sessions/:sessionId/investigation-summary
```

#### Qué es

Devuelve una vista interna para investigar una sesión específica: cliente, dispositivo, GPS, permisos, IP, SIM, eventos de auth, señales de riesgo, acciones, observaciones y auditoría.

#### Por qué es importante

Operaciones, riesgo y fraude necesitan entender qué pasó en una sesión sin consultar manualmente 10 o 15 endpoints. Este endpoint es clave para investigar dispositivo nuevo, ubicación rara, VPN, emulador, SIM sospechosa o sesiones anómalas.

#### Headers requeridos

```http
Authorization: Bearer <risk_or_operations_token>
x-tenant-id: 1
```

#### Tablas que lee

- `customer_sessions`
- `customers`
- `devices`
- `customer_device_links`
- `device_snapshots`
- `address_gps_observations`
- `permission_events`
- `auth_events`
- `ip_reputation_observations`
- `sim_observations`
- `device_risk_events`
- `customer_action_logs`
- `customer_observations`
- `operational_audit_logs`

#### Respuesta esperada

```json
{
  "data": {
    "session": {
      "sessionId": "10",
      "customerId": "1",
      "deviceId": "4",
      "status": "active",
      "channel": "mobile_app",
      "startedAt": "2026-06-29T13:30:00.000Z"
    },
    "customer": {
      "customerId": "1",
      "customerCode": "CUS-...",
      "lifecycleStatus": "registered"
    },
    "device": {
      "deviceId": "4",
      "riskStatus": "unknown"
    },
    "gpsObservations": [],
    "deviceSnapshots": [],
    "permissions": [],
    "authEvents": [],
    "ipReputation": [],
    "simObservations": [],
    "deviceRiskEvents": [],
    "customerActions": [],
    "customerObservations": [],
    "auditTrail": []
  }
}
```

#### Reglas

1. Solo roles internos autorizados.
2. No expone coordenadas exactas; responde `hasCoordinates` y timestamps.
3. No expone hashes sensibles completos.
4. Limita listas internas a últimos N eventos para evitar respuestas gigantes.

---

# Módulo de catalogación, definiciones, riesgo y gobierno de datos

Esta sección documenta los endpoints compuestos agregados para administrar catálogos versionados, definiciones técnicas, políticas de riesgo y gobierno de datos. La regla se mantiene: no se expone CRUD por tabla. Cada escritura representa un paquete o decisión de negocio y afecta varias tablas dentro de una transacción.

## EP-CAT-001 — Listar catálogos disponibles

```http
GET /api/v1/operations/catalogs
```

### Qué es

Endpoint interno para listar los catálogos de contexto disponibles y su última versión conocida.

### Por qué es importante

Riesgo, fraude y operaciones necesitan saber qué catálogos existen, si están activos y qué versión está vigente o en revisión. Sin esta vista, los analistas terminan consultando tablas sueltas.

### Autenticación

JWT interno con rol:

```txt
internal_operator | risk_analyst | compliance_analyst | fraud_analyst | admin | platform_admin | system
```

### Query params

```txt
domain=risk_context
status=draft|pending_approval|approved|published|retired|all
active=true|false|all
```

### Tablas leídas

```txt
context_catalogs
context_catalog_versions
```

### Respuesta esperada

```json
{
  "data": {
    "items": [
      {
        "catalogId": "1",
        "catalogCode": "city_zones",
        "catalogName": "Zonas de ciudad",
        "domain": "risk_context",
        "isActive": true,
        "currentVersion": {
          "catalogVersionId": "3",
          "versionCode": "2026.06",
          "status": "published",
          "validFrom": "2026-06-01",
          "validUntil": null
        }
      }
    ]
  }
}
```

---

## EP-CAT-002 — Ver versión completa de catálogo

```http
GET /api/v1/operations/catalogs/:catalogCode/versions/:versionId
```

### Qué es

Endpoint interno para revisar una versión completa de catálogo con items, alias y mapeos de riesgo.

### Por qué es importante

Antes de aprobar o publicar un catálogo, el equipo debe ver exactamente qué contiene. Esto evita publicar mapeos de riesgo incompletos o alias mal normalizados.

### Params

```txt
catalogCode=city_zones
versionId=4
```

### Tablas leídas

```txt
context_catalogs
context_catalog_versions
context_items
context_item_aliases
context_risk_mappings
```

### Respuesta esperada

```json
{
  "data": {
    "catalog": {
      "catalogId": "1",
      "catalogCode": "city_zones",
      "catalogName": "Zonas de ciudad"
    },
    "version": {
      "catalogVersionId": "4",
      "versionCode": "2026.07",
      "status": "draft"
    },
    "items": [
      {
        "contextItemId": "15",
        "itemCode": "santa_cruz_norte",
        "itemName": "Norte",
        "itemType": "zone",
        "aliases": [
          {
            "aliasValue": "Zona Norte",
            "aliasType": "common_name"
          }
        ],
        "riskMappings": [
          {
            "riskDimension": "location",
            "riskBand": "neutral",
            "reasonCode": "declared_zone_known"
          }
        ]
      }
    ]
  }
}
```

---

## EP-CAT-003 — Crear nueva versión de catálogo en paquete

```http
POST /api/v1/operations/catalogs/:catalogCode/versions
```

### Qué es

Crea una nueva versión de catálogo con sus items, alias y mapeos de riesgo en una sola transacción.

### Por qué es importante

Un catálogo no vale solo por sus items. Vale por su versión, fuente, alias y uso en riesgo. Por eso este endpoint reemplaza cualquier posible CRUD como `POST /context-items` o `POST /context-risk-mappings`.

### Headers requeridos

```http
Authorization: Bearer <token>
X-Tenant-Id: 1
X-Idempotency-Key: <uuid>
Content-Type: application/json
```

### Body recomendado

```json
{
  "versionCode": "2026.07",
  "validFrom": "2026-07-01",
  "notes": "Nueva versión de zonas para scoring inicial.",
  "items": [
    {
      "itemCode": "santa_cruz_norte",
      "itemName": "Norte",
      "itemType": "zone",
      "sourceCode": "internal_ops",
      "confidenceScore": "95.00",
      "attributes": {
        "city": "Santa Cruz de la Sierra",
        "countryCode": "BOL"
      },
      "aliases": [
        {
          "aliasValue": "Zona Norte",
          "aliasType": "common_name",
          "confidenceScore": "90.00"
        }
      ],
      "riskMappings": [
        {
          "riskDimension": "location",
          "riskBand": "neutral",
          "scorePointsSuggested": "0.00",
          "reasonCode": "declared_zone_known",
          "explanation": "Zona reconocida dentro del catálogo operativo.",
          "modelUsage": "onboarding_initial"
        }
      ]
    }
  ]
}
```

### Tablas leídas

```txt
context_catalogs
context_sources
```

### Tablas escritas

```txt
context_catalog_versions
context_items
context_item_aliases
context_risk_mappings
context_approval_events
operational_audit_logs
data_change_logs
```

### Respuesta esperada

```json
{
  "data": {
    "catalogCode": "city_zones",
    "catalogVersionId": "4",
    "status": "draft",
    "itemsCreated": 1,
    "aliasesCreated": 1,
    "riskMappingsCreated": 1
  }
}
```

### Reglas de negocio

```txt
- Requiere X-Idempotency-Key.
- No publica automáticamente.
- Crea versión en estado draft.
- Crea evento de aprobación version_created.
- Audita la operación.
- Registra data_change_logs.
```

---

## EP-CAT-004 — Enviar versión de catálogo a aprobación

```http
POST /api/v1/operations/catalogs/:catalogCode/versions/:versionId/submit-for-approval
```

### Qué es

Cambia una versión de catálogo de `draft` a `pending_approval`.

### Por qué es importante

Evita que una versión pase a producción sin revisión formal. Además deja trazabilidad de quién la envió a aprobación.

### Body recomendado

```json
{
  "notes": "Versión revisada por operaciones, lista para aprobación."
}
```

### Tablas leídas

```txt
context_catalogs
context_catalog_versions
context_items
```

### Tablas escritas/actualizadas

```txt
context_catalog_versions
context_approval_events
operational_audit_logs
data_change_logs
```

### Respuesta esperada

```json
{
  "data": {
    "catalogVersionId": "4",
    "status": "pending_approval"
  }
}
```

---

## EP-CAT-005 — Aprobar, rechazar, publicar o retirar versión de catálogo

```http
POST /api/v1/operations/catalogs/:catalogCode/versions/:versionId/decision
```

### Qué es

Ejecuta una decisión formal sobre una versión de catálogo.

### Por qué es importante

Los catálogos pueden afectar riesgo y fraude. No deben cambiar de estado silenciosamente.

### Body recomendado

```json
{
  "decision": "publish",
  "decisionReason": "Catálogo validado para uso en onboarding inicial.",
  "validFrom": "2026-07-01"
}
```

### Decisiones permitidas

```txt
approve
reject
publish
retire
```

### Tablas leídas

```txt
context_catalogs
context_catalog_versions
```

### Tablas escritas/actualizadas

```txt
context_catalog_versions
context_approval_events
operational_audit_logs
data_change_logs
```

### Respuesta esperada

```json
{
  "data": {
    "catalogVersionId": "4",
    "decision": "publish",
    "status": "published",
    "publishedAt": "2026-07-01T00:00:00.000Z"
  }
}
```

---

## EP-CAT-006 — Iniciar ingesta de catálogo

```http
POST /api/v1/operations/catalog-ingestions
```

### Qué es

Registra una ingesta de datos internos o externos para cargar items candidatos a catálogo.

### Por qué es importante

La información cruda no debe entrar directo a producción. Primero entra a staging, luego se revisa y recién se convierte en catálogo versionado.

### Body recomendado

```json
{
  "catalogCode": "city_zones",
  "sourceType": "manual_upload",
  "sourceName": "Operaciones Atlas",
  "items": [
    {
      "rawValue": "Norte Interno",
      "normalizedValue": "santa_cruz_norte",
      "itemType": "zone",
      "confidenceScore": "88.00",
      "rawPayload": {
        "city": "Santa Cruz de la Sierra",
        "countryCode": "BOL"
      }
    }
  ]
}
```

### Tablas leídas

```txt
context_catalogs
context_sources
```

### Tablas escritas

```txt
context_sources
context_ingestion_jobs
context_staging_items
operational_audit_logs
data_change_logs
```

### Respuesta esperada

```json
{
  "data": {
    "ingestionJobId": "10",
    "status": "completed",
    "stagingItemsCreated": 1
  }
}
```

---

## EP-CAT-007 — Decidir items en staging por batch

```http
POST /api/v1/operations/catalog-staging-items/decision-batch
```

### Qué es

Aprueba o rechaza varios items de staging. Si se aprueban, se crean items reales dentro de una versión de catálogo.

### Por qué es importante

Permite revisar carga masiva sin hacer endpoints por item ni mover datos brutos directo a producción.

### Body recomendado

```json
{
  "targetCatalogVersionId": "4",
  "decisions": [
    {
      "stagingItemId": "20",
      "decision": "approve",
      "itemCode": "santa_cruz_norte",
      "itemName": "Norte",
      "itemType": "zone",
      "decisionReason": "Zona válida para catálogo operativo.",
      "aliases": [
        {
          "aliasValue": "Norte Interno",
          "aliasType": "common_name"
        }
      ],
      "riskMappings": [
        {
          "riskDimension": "location",
          "riskBand": "neutral",
          "reasonCode": "declared_zone_known"
        }
      ]
    }
  ]
}
```

### Tablas leídas

```txt
context_staging_items
context_catalog_versions
```

### Tablas escritas/actualizadas

```txt
context_staging_items
context_items
context_item_aliases
context_risk_mappings
context_approval_events
operational_audit_logs
```

### Respuesta esperada

```json
{
  "data": {
    "processed": 1,
    "approved": 1,
    "rejected": 0,
    "itemsCreated": 1
  }
}
```

---

## EP-CAT-008 — Obtener diccionario técnico de definiciones

```http
GET /api/v1/operations/definitions
```

### Qué es

Lista definiciones técnicas de eventos, observaciones, atributos y features.

### Por qué es importante

Evita que el backend escriba códigos desordenados como `gps_observed`, `gps_seen` y `location_received` para la misma idea.

### Query params

```txt
type=observation|event|attribute|feature|all
status=active|inactive|all
domain=sessions|onboarding|risk|fraud|privacy
```

### Tablas leídas

```txt
observation_definitions
event_definitions
attribute_definitions
feature_definitions
```

---

## EP-CAT-009 — Registrar paquete de definiciones

```http
POST /api/v1/operations/definitions/package
```

### Qué es

Registra o actualiza en batch definiciones de eventos, observaciones, atributos y features.

### Por qué es importante

El motor de riesgo necesita un diccionario estable para auditar qué significa cada dato usado por scoring/fraude.

### Body recomendado

```json
{
  "domain": "sessions",
  "definitions": {
    "events": [
      {
        "eventCode": "session_started",
        "eventName": "Sesión iniciada",
        "eventFamily": "sessions",
        "targetTables": ["customer_sessions", "auth_events"]
      }
    ],
    "observations": [
      {
        "observationCode": "gps_observed",
        "observationName": "GPS observado",
        "dataType": "boolean",
        "sourceGroup": "sessions"
      }
    ],
    "attributes": [
      {
        "attributeCode": "last_gps_observed_at",
        "attributeName": "Último GPS observado",
        "entityScope": "customer",
        "dataType": "datetime"
      }
    ],
    "features": [
      {
        "featureCode": "device_reuse_count",
        "featureName": "Cantidad de reutilización del dispositivo",
        "featureFamily": "device",
        "dataType": "number"
      }
    ]
  }
}
```

### Tablas escritas/actualizadas

```txt
observation_definitions
event_definitions
attribute_definitions
feature_definitions
operational_audit_logs
data_change_logs
```

---

## EP-CAT-010 — Obtener política de riesgo vigente

```http
GET /api/v1/operations/risk-policy/current
```

### Qué es

Devuelve versiones activas/publicadas de modelos, rulesets, reglas y semillas de señal.

### Por qué es importante

Permite saber qué política está usando el motor de evaluación sin consultar tablas técnicas manualmente.

### Tablas leídas

```txt
risk_model_versions
risk_ruleset_versions
risk_policy_rules
risk_signal_seeds
```

---

## EP-CAT-011 — Crear versión de reglas de riesgo

```http
POST /api/v1/operations/risk-policy/ruleset-versions
```

### Qué es

Crea en paquete una versión de modelo, una versión de ruleset, reglas y semillas de señales.

### Por qué es importante

Las reglas de riesgo no deben editarse una por una en producción. Deben crearse como versión controlada.

### Body recomendado

```json
{
  "modelVersion": {
    "modelCode": "atlas_onboarding_risk",
    "versionCode": "2026.07",
    "modelType": "rules",
    "assessmentType": "onboarding_initial"
  },
  "ruleset": {
    "rulesetCode": "onboarding_initial_rules",
    "versionCode": "2026.07",
    "assessmentType": "onboarding_initial"
  },
  "rules": [
    {
      "ruleCode": "device_emulator_hard_stop",
      "ruleName": "Dispositivo emulador",
      "riskDimension": "device",
      "ruleType": "hard_stop",
      "severity": "critical",
      "expressionJson": {
        "field": "device.isEmulator",
        "operator": "eq",
        "value": true
      },
      "actionCode": "blocked",
      "reasonCode": "device_emulator_detected",
      "isHardStop": true
    }
  ]
}
```

### Tablas escritas

```txt
risk_model_versions
risk_ruleset_versions
risk_policy_rules
risk_signal_seeds
operational_audit_logs
data_change_logs
```

---

## EP-CAT-012 — Activar versión de reglas de riesgo

```http
POST /api/v1/operations/risk-policy/ruleset-versions/:rulesetVersionId/activate
```

### Qué es

Activa una versión de ruleset y retira versiones activas anteriores del mismo `rulesetCode`.

### Por qué es importante

Separar creación y activación evita romper scoring en producción por una versión no revisada.

### Body recomendado

```json
{
  "activationReason": "Reglas validadas para onboarding inicial."
}
```

### Tablas leídas

```txt
risk_ruleset_versions
```

### Tablas escritas/actualizadas

```txt
risk_ruleset_versions
operational_audit_logs
data_change_logs
```

---

## EP-CAT-013 — Ver políticas de gobierno de datos

```http
GET /api/v1/operations/data-governance/policies
```

### Qué es

Devuelve políticas activas de propósitos de tratamiento, retención, proveedores, clasificación, campos sensibles y calidad.

### Por qué es importante

Atlas maneja PII, evidencia, scoring y fraude. El gobierno de datos debe ser visible y auditable, no estar escondido en código.

### Tablas leídas

```txt
privacy_processing_purposes
retention_policies
data_providers
data_classification_policies
sensitive_field_rules
data_quality_rules
```

---

## EP-CAT-014 — Registrar paquete de políticas de gobierno de datos

```http
POST /api/v1/operations/data-governance/policy-package
```

### Qué es

Registra o actualiza en paquete propósitos, retención, proveedores, clasificación, reglas de campos sensibles y reglas de calidad.

### Por qué es importante

Evita que privacidad, seguridad y calidad de datos queden dispersas. Además permite auditar los cambios.

### Body recomendado

```json
{
  "retentionPolicies": [
    {
      "policyCode": "identity_evidence_5y",
      "appliesTo": "evidence_documents",
      "retentionDays": 1825,
      "postRetentionAction": "archive_or_delete",
      "legalBasis": "compliance"
    }
  ],
  "classificationPolicies": [
    {
      "classificationCode": "pii_sensitive",
      "classificationName": "Dato personal sensible",
      "sensitivityLevel": "high",
      "allowedStorageModes": {
        "modes": ["encrypted_hash_last4"]
      },
      "defaultStorageMode": "encrypted_hash_last4",
      "encryptionRequired": true,
      "hashingRequired": true,
      "rawStorageAllowed": false
    }
  ],
  "sensitiveFieldRules": [
    {
      "tableName": "customer_identity_documents",
      "fieldName": "document_number",
      "classificationCode": "pii_sensitive",
      "storageMode": "encrypted_hash_last4",
      "maskingStrategy": "last4"
    }
  ],
  "dataQualityRules": [
    {
      "ruleCode": "identity_document_hash_required",
      "ruleName": "Documento debe tener hash",
      "targetTable": "customer_identity_documents",
      "targetField": "document_hash",
      "severity": "critical",
      "expressionJson": {
        "required": true
      },
      "expectedAction": "block_risk_assessment"
    }
  ]
}
```

### Tablas escritas/actualizadas

```txt
privacy_processing_purposes
retention_policies
data_providers
data_classification_policies
sensitive_field_rules
data_quality_rules
operational_audit_logs
data_change_logs
```

---

# Runtime hardening, idempotencia, outbox y jobs internos

Esta sección documenta el endurecimiento operativo. No agrega integraciones con proveedores reales; agrega infraestructura interna para que los endpoints críticos sean más seguros, repetibles y auditables.

## RH-001 — Idempotencia fuerte para escrituras críticas

### Método

No es un endpoint nuevo. Es un interceptor global para métodos:

```http
POST | PUT | PATCH | DELETE
```

cuando el request incluye:

```http
X-Idempotency-Key: <uuid-o-key-estable>
```

### Qué hace

Registra una llave de idempotencia por tenant, método, ruta y body normalizado/redactado. Si el mismo request se repite con el mismo body, devuelve la respuesta persistida. Si la misma llave se repite con un body distinto, responde conflicto.

### Por qué es importante

La app móvil puede reenviar requests por mala conexión, doble tap o pérdida de respuesta. Sin idempotencia fuerte, una operación como onboarding, sesión, KYC, decisión de riesgo o catalogación puede duplicar registros o quedar inconsistente.

### Lee

```txt
idempotency_keys
```

### Escribe/actualiza

```txt
idempotency_keys
```

### Estados internos

```txt
processing
completed
failed
```

### Respuestas esperadas

Si se ejecuta por primera vez, deja pasar el endpoint normal y guarda la respuesta.

Si se repite igual:

```json
{
  "requestId": "req_123",
  "data": {
    "...": "misma respuesta ya persistida"
  }
}
```

Si se repite con body distinto:

```txt
409 IDEMPOTENCY_CONFLICT
```

Si todavía está en proceso:

```txt
409 IDEMPOTENCY_REQUEST_IN_PROGRESS
```

### Reglas

1. No guarda body sensible completo.
2. Redacta campos como token, password, phone, email, GPS, documentNumber, evidence, storageKey, rawPayload.
3. La llave se calcula por tenant + ruta + método + idempotency key.
4. No sustituye validaciones de negocio.
5. No convierte endpoints no idempotentes en seguros si no usan transacciones internas.

---

## RH-002 — Outbox técnico de comandos API completados

### Método

No es un endpoint público de negocio. Es un interceptor global para escrituras exitosas:

```http
POST | PUT | PATCH | DELETE
```

### Qué hace

Crea un evento interno en `outbox_events` cuando un comando API termina exitosamente. El evento es genérico y seguro: registra método, ruta, rol actor, correlación y tipo de resultado, sin payload sensible.

### Por qué es importante

Permite construir después notificaciones, auditoría asincrónica, integración con workers, colas, métricas y comunicación externa sin acoplar el service principal a proveedores reales.

### Escribe

```txt
outbox_events
```

### Campos relevantes

```txt
aggregate_type = api_command
aggregate_id = customerId|caseId|sessionId si existe
event_code = post_api_v1_..._completed
status = pending
```

### Reglas

1. No llama proveedores reales.
2. No manda SMS, WhatsApp, email ni push.
3. No guarda body completo.
4. Deja eventos en estado `pending` para workers posteriores.

---

## JOB-001 — Procesar outbox sin proveedores reales

```http
POST /api/v1/operations/jobs/process-outbox
```

### Qué es

Job interno para tomar eventos pendientes de `outbox_events` y marcarlos como procesados. En esta fase no llama proveedores reales; sirve para validar el patrón outbox y dejar el backend listo para workers.

### Por qué es importante

Evita meter llamadas externas dentro de los services transaccionales. En producción, este job será reemplazado o complementado por workers que envíen email, SMS, WhatsApp, push o eventos internos.

### Auth

```txt
admin | platform_admin | system
```

### Headers

```http
Authorization: Bearer <token interno>
X-Tenant-Id: 1
X-Idempotency-Key: <uuid>
X-Request-Id: <uuid>
```

### Body recomendado

```json
{
  "limit": 50,
  "dryRun": true
}
```

### Lee

```txt
outbox_events
```

### Escribe/actualiza

```txt
system_job_runs
outbox_events            # si dryRun=false
operational_audit_logs
idempotency_keys
```

### Respuesta esperada

```json
{
  "requestId": "req_123",
  "data": {
    "jobRunId": "1",
    "status": "completed",
    "result": {
      "selected": 10,
      "processed": 0,
      "dryRun": true
    }
  }
}
```

### Reglas

1. `dryRun=true` no modifica eventos.
2. `dryRun=false` marca eventos como `processed`.
3. No integra proveedores reales.
4. Siempre crea `system_job_runs`.
5. Siempre audita la ejecución.

---

## JOB-002 — Expirar sesiones inactivas

```http
POST /api/v1/operations/jobs/expire-stale-sessions
```

### Qué es

Job interno para cerrar sesiones activas antiguas que superan el tiempo máximo de inactividad configurado.

### Por qué es importante

Las sesiones no pueden quedar activas indefinidamente. Esto reduce riesgo operativo, fraude, sesiones zombie y errores de interpretación de actividad reciente.

### Auth

```txt
admin | platform_admin | system
```

### Body recomendado

```json
{
  "maxIdleMinutes": 120,
  "dryRun": true
}
```

### Lee

```txt
customer_sessions
```

### Escribe/actualiza

```txt
system_job_runs
customer_sessions        # si dryRun=false, session_status=expired y ended_at=now
operational_audit_logs
idempotency_keys
outbox_events            # evento genérico de comando completado
```

### Respuesta esperada

```json
{
  "requestId": "req_123",
  "data": {
    "jobRunId": "2",
    "status": "completed",
    "result": {
      "selected": 3,
      "expired": 0,
      "cutoff": "2026-06-29T10:00:00.000Z",
      "dryRun": true
    }
  }
}
```

### Reglas

1. Solo afecta sesiones `active`.
2. `dryRun=true` solo cuenta candidatas.
3. `dryRun=false` expira sesiones.
4. No borra sesiones.
5. Audita ejecución.

---

## JOB-003 — Aplicar políticas de retención en modo seguro

```http
POST /api/v1/operations/jobs/apply-retention-policies
```

### Qué es

Job interno para revisar políticas activas de retención. En esta fase no elimina ni anonimiza datos automáticamente.

### Por qué es importante

Atlas maneja PII, GPS, identidad y evidencias. La retención debe ser gobernada y auditable, no hardcodeada ni ejecutada sin control.

### Body recomendado

```json
{
  "policyCode": "identity_evidence_5y",
  "dryRun": true
}
```

### Lee

```txt
retention_policies
```

### Escribe

```txt
system_job_runs
operational_audit_logs
idempotency_keys
outbox_events
```

### Respuesta esperada

```json
{
  "requestId": "req_123",
  "data": {
    "jobRunId": "3",
    "status": "completed",
    "result": {
      "policiesScanned": 1,
      "destructiveActionsExecuted": 0,
      "dryRun": true,
      "note": "Este job registra ejecución y análisis. No elimina ni anonimiza datos sin política operativa aprobada."
    }
  }
}
```

### Reglas

1. No borra datos en esta fase.
2. No anonimiza datos en esta fase.
3. Registra job run y auditoría.
4. Permite filtrar por `policyCode`.

---

## JOB-004 — Recalcular calidad de datos en modo seguro

```http
POST /api/v1/operations/jobs/recalculate-data-quality
```

### Qué es

Job interno para revisar el estado actual de issues de calidad de datos, opcionalmente por cliente.

### Por qué es importante

Riesgo y onboarding dependen de datos completos y coherentes. Este endpoint permite validar la capa operativa antes de automatizar reglas específicas.

### Body recomendado

```json
{
  "customerId": "1",
  "dryRun": true
}
```

### Lee

```txt
data_quality_issues
```

### Escribe

```txt
system_job_runs
operational_audit_logs
idempotency_keys
outbox_events
```

### Respuesta esperada

```json
{
  "requestId": "req_123",
  "data": {
    "jobRunId": "4",
    "status": "completed",
    "result": {
      "openIssues": 0,
      "issuesCreated": 0,
      "dryRun": true,
      "note": "Recalcula conteos actuales; las reglas automáticas de calidad quedan para workers específicos por regla."
    }
  }
}
```

### Reglas

1. No crea issues automáticos todavía.
2. No modifica datos de cliente.
3. Sirve como base para workers de data quality por regla.
4. Audita ejecución.

## Events Core

### GET /operations/events/catalog
Lista el catálogo de eventos internos soportados.

### GET /operations/events
Lista eventos de `outbox_events`. Filtros: `status`, `eventCode`, `aggregateType`, `correlationId`, `page`, `limit`.

### GET /operations/events/:eventId
Obtiene un evento específico.

### POST /operations/events
Publica un evento de negocio en `outbox_events`. Requiere `X-Idempotency-Key`.

Body mínimo:

```json
{
  "eventCode": "user.registered",
  "aggregateType": "customer",
  "aggregateId": "1",
  "payload": { "customerId": "1" },
  "metadata": { "source": "manual" }
}
```

### POST /operations/events/:eventId/retry
Reintenta un evento `failed` o `cancelled`. Requiere `X-Idempotency-Key`.

### POST /operations/events/:eventId/cancel
Cancela un evento no procesado. Requiere `X-Idempotency-Key`.

### POST /operations/jobs/process-events
Procesa eventos pendientes y dispara notificaciones.

```json
{
  "limit": 50,
  "dryRun": false
}
```

## Notifications Core

### GET /operations/notifications/messages
Lista mensajes generados. Filtros: `status`, `channel`, `recipientType`, `recipientId`, `correlationId`, `from`, `to`, `page`, `limit`.

### GET /operations/notifications/messages/:messageId
Obtiene un mensaje con historial de deliveries.

### POST /operations/notifications/messages/:messageId/retry
Reintenta un mensaje fallido. Requiere `X-Idempotency-Key`.

### POST /operations/notifications/messages/:messageId/cancel
Cancela un mensaje pendiente. Requiere `X-Idempotency-Key`.

### GET /operations/notifications/templates
Lista templates.

### POST /operations/notifications/templates
Crea template por tenant. Requiere `X-Idempotency-Key`.

### PATCH /operations/notifications/templates/:templateId
Actualiza template por tenant. Requiere `X-Idempotency-Key`.

### GET /operations/notifications/preferences/:customerId
Lista preferencias de notificación del cliente.

### PATCH /operations/notifications/preferences/:customerId
Actualiza preferencias. Requiere `X-Idempotency-Key`.

### GET /customers/:customerId/notifications
Lista notificaciones internas `in_app` del cliente.

### GET /customers/:customerId/notifications/unread-count
Cuenta notificaciones internas no leídas.

### POST /customers/:customerId/notifications/:notificationId/read
Marca una notificación interna como leída.

### POST /customers/:customerId/notifications/read-all
Marca todas como leídas.

### POST /customers/:customerId/device-tokens
Registra o actualiza un device token usando hash, no token en claro.

### DELETE /customers/:customerId/device-tokens/:deviceTokenId
Desactiva un device token.
