/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aplica la retención de datos que la política declara, o deja constancia de por qué todavía no puede aplicarla.
 * @system reclama, procesa y reintenta jobs/outbox con locks y métricas operativas.
 */

/**
 * Destinos EJECUTABLES de `apply_retention_policies`: `policy_code` -> tabla sobre la que actúa.
 *
 * A propósito, solo se registran tablas de telemetría cruda claramente no-financieras y
 * no-auditables (GPS, snapshots de dispositivo, interacción de formularios) — nunca tablas de
 * decisión/auditoría (`risk_assessment_results`, `operational_audit_logs`…), que deben seguir siendo
 * append-only según `BACKEND_DEVELOPMENT_CONTEXT.md` §8 y §11.
 *
 * Para que una política de aquí purgue de verdad, un operador debe además tener la fila activa en
 * `retention_policies`. Mientras no exista, no se ejecuta ninguna acción destructiva.
 */
export const RETENTION_TARGETS: Record<string, { table: string; description: string }> = {
  gps_observations_90d: {
    table: 'address_gps_observations',
    description: 'Purga GPS crudo de onboarding/direcciones tras el período de retención.',
  },
  device_snapshots_90d: {
    table: 'device_snapshots',
    description: 'Anonimiza snapshots de dispositivo (marca/modelo/versión) conservando señales de riesgo agregadas (root/emulador/VPN).',
  },
  form_interaction_events_60d: {
    table: 'form_field_interaction_events',
    description: 'Purga eventos crudos de interacción de formularios de onboarding.',
  },
};

/**
 * Políticas SEMBRADAS que todavía no pueden ejecutarse, con el motivo explícito.
 *
 * ATLAS-DATA-004. Antes esta lista no existía: las políticas sin destino se reportaban dentro del
 * JSON de resultado del job, en un campo `unmappedPolicies` que nadie leía, y el sistema quedaba
 * documentando un control de retención que no ejercía. Para un backend KYC con base legal declarada
 * en la propia fila (`kyc_aml_record_keeping`, `post_retention_action = 'anonymize'`), esa
 * diferencia entre lo declarado y lo aplicado es un hallazgo de cumplimiento, no un detalle.
 *
 * `yarn check:retention-coverage` obliga a que toda política sembrada esté en ESTE mapa o en
 * `RETENTION_TARGETS`. El estado "sembrada, activa y silenciosamente inerte" ya no compila el gate.
 *
 * Cada entrada debe decir QUÉ falta decidir y QUIÉN decide, no "pendiente".
 */
export const RETENTION_POLICIES_PENDING_DECISION: Record<string, string> = {
  'risk-data-365d':
    'Alcance ambiguo: "datos de riesgo y fraude" puede incluir tablas de decisión (risk_assessment_results, ' +
    'fraud_reviews) que son append-only por requisito de auditoría. Acotar la política a las tablas de features ' +
    'derivadas es una decisión de Riesgo + Legal antes de mapearla.',
  'risk-features-730d':
    'Mismo caso que risk-data-365d, con horizonte distinto. Requiere confirmar con Riesgo qué features son ' +
    'reproducibles desde datos crudos (purgables) y cuáles sustentan una decisión ya tomada (no purgables).',
  'risk-model-inputs-730d':
    'Entradas del modelo de riesgo del baseline BNPL. Purgarlas rompe la reproducibilidad de un score ya emitido, ' +
    'que es justo lo que un regulador pide reconstruir. Antes de mapearla hay que decidir con Riesgo si la ' +
    'reproducibilidad se garantiza archivando la entrada o congelando el score con su explicación.',
  'pii-core-1095d':
    'La PII núcleo del cliente no se purga por antigüedad sino por cierre de relación + plazo legal: el disparador ' +
    'correcto es el ciclo de vida del cliente (lifecycle_status = closed), no una fecha de creación. Mapearla como ' +
    'purga por antigüedad borraría datos de clientes activos.',
  'audit-logs-1825d':
    'operational_audit_logs es append-only por requisito de auditoría (BACKEND_DEVELOPMENT_CONTEXT.md §11). Su ' +
    'retención se ejerce archivando fuera de la base transaccional, no borrando filas: requiere el destino de ' +
    'archivado antes de poder ejecutarse.',
  'notification-540d':
    'Las entregas de notificación sustentan la prueba de comunicación al cliente en disputas. Purgarlas exige ' +
    'confirmar con Legal el plazo mínimo probatorio, que puede ser mayor que los 540 días sembrados.',
  'external-provider-365d':
    'Evidencia de proveedores externos usada en decisiones KYC. Antes de purgar hay que separar la evidencia que ' +
    'sustenta una decisión vigente de la consulta meramente operativa; hoy conviven en las mismas tablas.',
  'external-provider-evidence-1825d':
    'Sembrada con base legal kyc_aml_record_keeping y acción anonymize. Anonimizar evidencia de proveedor requiere ' +
    'definir qué campos son identificadores y cuáles sustentan la trazabilidad de la decisión: decisión de ' +
    'Cumplimiento, no del backend.',
};
