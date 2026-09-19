# Propiedad del consentimiento, la privacidad y la evidencia (AT-028)

Contratos: `src/modules/consents/public/consent-status.contracts.ts` (estado por propósito, `authorizes`),
`src/modules/customer-privacy/application/ports/privacy-command.port.ts` (revocación idempotente, retención).
Pruebas: `test/contracts/privacy/consent-authority.spec.ts`.

## Quién es dueño de qué

| Dato | Tabla | Dueño de escritura | Lectores por contrato |
|---|---|---|---|
| Documentos de consentimiento | `privacy.consent_documents` | `consents` | onboarding, portal |
| Consentimientos del cliente | `privacy.customer_consents` (la registran **7** módulos hoy) | `consents` (declarado en `context-map.json`) | riesgo, proveedores externos, admisión (vía hechos de elegibilidad), señales de dispositivo |
| Eventos de consentimiento | `privacy.consent_events` | `consents` | auditoría |
| Solicitudes de privacidad (ARCO) | `privacy.data_subject_requests` | `customer-privacy` | portal |
| Evidencia de identidad | `customer.evidence_documents`, `evidence_reviews` | `customer-onboarding` | riesgo, expedientes (por identificador) |

## Reglas fijadas por contrato

1. **Por propósito.** `getStatus(tenant, cliente, propósito)` devuelve el estado de ESE propósito; `authorizes` sólo es
   verdadero si coincide el propósito y está `granted`. Un consentimiento de marketing no autoriza una consulta a un
   proveedor de riesgo.
2. **Revisión.** Cada estado lleva `revision` (último registro). Una decisión crítica lo lee dentro de su transacción
   (la admisión ya lee `grantedConsentDocumentIds` en `loadFacts`, AT-007); nunca desde una proyección.
3. **Revocación idempotente.** Mismo `commandKey` → una sola revocación auditada; la segunda respuesta dice
   `alreadyRevoked` con la misma `revision`.
4. **Propagación.** Una revocación invalida autorizaciones **futuras**. Las proyecciones no críticas se actualizan por
   evento de dominio (`ConsentRevoked`, AT-032/33); las críticas no cachean.
5. **Retención manda sobre el borrado.** `assessRetentionPolicy('erasure')` separa lo borrable (preferencias de
   marketing, señales de dispositivo, estado de contenido) de lo retenido con plazo (evidencia KYC, consentimientos,
   casos de fraude, historial de crédito: 10 años). La solicitud se atiende informando el plazo, no destruyendo.
6. **Eventos sin blobs.** Un evento de consentimiento lleva propósito, estado y revisión; nunca la captura de
   evidencia (`evidence_snapshot_url`, IP, huella del dispositivo).

## Residual (para AT-041)

El comando real `revokeConsent` sobre `CustomerPrivacyService.registerConsentDecisions` y la publicación del evento
llegan con el inbox/outbox de F5. Hoy el contrato fija la semántica y una implementación en memoria la prueba.
