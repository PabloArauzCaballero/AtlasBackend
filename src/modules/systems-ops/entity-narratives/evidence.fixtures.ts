/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Documentos probatorios del cliente, su extracción automática y su revisión humana (schema `privacy`). */
export const EVIDENCE_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'evidence_documents',
    whyExists:
      'Es el archivo probatorio del negocio: la foto del carnet, la selfie, la boleta de pago, la factura de servicios. Cuando una decisión se cuestiona meses después, lo único que la sostiene es el documento que la respaldó.',
    whyNotDelete:
      'Sin evidencia, una aprobación de crédito o una verificación de identidad es una afirmación sin prueba. Se pierde la capacidad de defenderse ante un reclamo, de responder a una autoridad y de detectar reuso de documentos entre cuentas, que se hace comparando `file_hash_sha256`.',
    decisionContribution:
      'Es el insumo de la verificación de identidad y de la validación de ingresos y domicilio. Su `status` decide si el expediente está completo para aprobar; el hash detecta que el mismo documento se subió en dos cuentas distintas, señal fuerte de suplantación.',
    usageExample:
      'Dos solicitudes de clientes diferentes suben una boleta de pago con el mismo `file_hash_sha256`. La coincidencia abre un caso de fraude y ambas quedan retenidas hasta revisión, sin necesidad de que un humano lo notara.',
    systemsExplanation:
      'Tabla en `privacy` que guarda metadatos y puntero al objeto (`s3_bucket`, `s3_key`), nunca el binario en la base. Registra el contexto de subida (`uploaded_from_ip`, `uploaded_from_session_id`, `uploaded_from_device_fingerprint`) y la retención (`retention_policy_id`, `expires_at`, `retention_until`). Tiene borrado lógico: la baja real es la eliminación del objeto en almacenamiento más la anonimización de la fila, ejecutada por el proceso de retención. El acceso al archivo se sirve con URLs firmadas de corta vida y queda auditado.',
  },
  {
    tableName: 'evidence_extractions',
    whyExists:
      'Convierte una imagen en datos utilizables: OCR del documento, lectura de un comprobante, extracción de campos de una boleta. Es lo que permite automatizar sin que un humano transcriba cada archivo.',
    whyNotDelete:
      'Guarda qué leyó la máquina, con qué método y versión (`extraction_method`, `extraction_version`) y con qué confianza. Sin eso no se puede auditar un error de OCR que causó un rechazo, ni comparar el desempeño de dos versiones del extractor, ni reprocesar selectivamente lo de baja confianza.',
    decisionContribution:
      '`confidence_score` y `requires_review` deciden el camino del caso: automático si la extracción es confiable, revisión manual si no. La comparación entre lo extraído y lo declarado por el cliente es una señal directa de inconsistencia o de documento adulterado.',
    usageExample:
      'El OCR extrae nombre y número de un carnet con confianza 0.58 y marca `requires_review = true`. El caso no se aprueba solo: entra a la cola de revisión y un analista confirma o corrige contra la imagen original.',
    systemsExplanation:
      'Tabla append-only en `privacy`, ligada a `evidence_documents`. Guarda dos versiones del resultado: `extracted_data_json` (completo, sensible) y `redacted_extracted_data_json` (apto para logs, portal y análisis). `processing_duration_ms` permite monitorear el proveedor de extracción. Una nueva pasada del extractor genera una fila nueva; no se sobrescribe la anterior, para poder comparar versiones.',
  },
  {
    tableName: 'evidence_reviews',
    whyExists:
      'Registra la decisión humana sobre una evidencia: aceptada, rechazada, corregida. Es el punto donde una persona asume responsabilidad sobre lo que la máquina no pudo resolver sola.',
    whyNotDelete:
      'Es la traza de accountability sobre el expediente. Sin ella no se sabe quién validó un documento falso que pasó, ni se puede medir la calidad de los revisores, ni sostener ante un tercero que hubo control humano sobre la decisión automatizada.',
    decisionContribution:
      'Su `review_status` y `rejection_reason_code` determinan si el expediente avanza, se pide nueva evidencia o se rechaza. Las `reviewed_corrections_json` alimentan la mejora del extractor: dónde se equivoca sistemáticamente el OCR.',
    usageExample:
      'Un analista rechaza una selfie con `rejection_reason_code = FACE_NOT_VISIBLE` y nota explicativa. El cliente recibe una notificación específica pidiendo repetir la foto con mejor luz, en lugar de un rechazo genérico que lo haría abandonar.',
    systemsExplanation:
      'Tabla append-only en `privacy`, ligada a `evidence_documents` y al revisor (`reviewed_by` → `internal_users`). Cada revisión es una fila nueva, de modo que una segunda opinión o una reapertura quedan ambas registradas. La transición de `evidence_documents.status` ocurre en la misma transacción que la revisión, y el acto se replica en `operational_audit_logs`.',
  },
];
