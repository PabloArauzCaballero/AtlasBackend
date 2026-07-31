/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Habilitación crediticia y ciclo de solicitud (schemas `customer` y `credit`). */
export const CREDIT_LIFECYCLE_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'customer_eligibility_evaluations',
    whyExists:
      'Guarda la evidencia de cada evaluación de habilitación crediticia: si el cliente quedó habilitado o no, con qué versión de la regla, qué bloqueadores tenía y qué huella de información se usó. La habilitación no es una bandera que alguien escriba, es el resultado registrado de evaluar condiciones verificables.',
    whyNotDelete:
      'Es lo único que permite responder meses después "¿por qué este cliente quedó habilitado el 12 de marzo?" sin reconstruir a mano el estado del cliente en esa fecha, que es justamente lo que no se puede hacer. Sin ella, una decisión adversa impugnada no tiene defensa documental y una aprobación indebida no tiene rastro.',
    decisionContribution:
      'Sostiene la puerta de entrada al crédito: `eligible` y `blockers_json` explican qué falta, `rule_version` permite comparar decisiones tomadas bajo reglas distintas y `decision_source` separa lo automático de la excepción autorizada por una persona.',
    usageExample:
      'Un analista aprueba a un cliente que aún tenía un bloqueador de riesgo. La fila queda con `decision_source = manual_override` y la lista de bloqueadores omitidos, de modo que la excepción es visible en la auditoría en lugar de indistinguible de una aprobación limpia.',
    systemsExplanation:
      'Tabla append-only en `customer`, escrita solo por `CustomerEligibilityService` dentro de la misma transacción que la transición de estado. `facts_hash` es un SHA-256 de los hechos derivados (no de los datos personales) y permite demostrar que dos evaluaciones partieron del mismo estado de información. Las columnas `credit_eligibility_status`/`eligibility_evaluated_at` de `customers` son una caché consultable de la última fila; la fuente de verdad es esta tabla.',
  },
  {
    tableName: 'credit_products',
    whyExists:
      'Es el catálogo de lo que la institución ofrece: montos, plazos, tasa, moneda, requisitos de ingreso y vigencia. Sin él, "solicitar un crédito" no tiene objeto sobre el que recaer.',
    whyNotDelete:
      'Cada solicitud apunta a un producto concreto; borrarlo dejaría solicitudes históricas sin las condiciones bajo las que se pidieron, y con ellas la imposibilidad de auditar qué se le ofreció a quién. Por eso los productos se retiran cambiando `status`, no eliminándose.',
    decisionContribution:
      'Los rangos (`min/max_amount`, `min/max_term_months`) y `min_monthly_income` son las condiciones duras que el backend valida antes de aceptar una solicitud; `requires_manual_review` decide si el caso entra en cola humana; `status` decide qué se puede ofrecer hoy.',
    usageExample:
      'Negocio suspende temporalmente un producto por cambio de tasa. Se cambia su `status` a `suspended`: deja de aparecer en el catálogo del cliente y de admitir solicitudes nuevas, mientras las ya existentes conservan intacta la referencia a las condiciones originales.',
    systemsExplanation:
      'Tabla en `credit` con unicidad `(_tenant_id, product_code)` sobre filas no borradas, `CHECK` de coherencia de rangos (mínimo nunca mayor que máximo, tasa no negativa) y `CHECK` de estados legales. Nace en `draft` y solo un cambio de estado explícito y auditable la vuelve ofrecible. No se siembra ningún producto: inventar una tasa sería inventar una decisión de negocio.',
  },
  {
    tableName: 'credit_applications',
    whyExists:
      'Registra la solicitud concreta de un cliente: qué producto, qué monto, qué plazo, en qué estado y con qué evidencia de elegibilidad. Es el objeto sobre el que operan la decisión, el seguimiento y el reporte.',
    whyNotDelete:
      'Contiene `eligibility_snapshot_json` y `eligibility_evaluation_id`: la foto congelada de por qué se aceptó abrir esa solicitud. Borrarla destruye la trazabilidad entre lo que se aprobó y la información disponible en ese momento, que es el núcleo de cualquier revisión regulatoria de crédito.',
    decisionContribution:
      'Su `status` gobierna el ciclo (enviada, en revisión, aprobada, rechazada, cancelada, vencida) y `decision_reason_code` deja el motivo explícito. El índice único parcial de solicitudes vivas impide que un cliente acumule solicitudes simultáneas y descuadre el riesgo asumido.',
    usageExample:
      'Dos peticiones concurrentes con claves de idempotencia distintas intentan abrir solicitud para el mismo cliente. La base rechaza la segunda por el índice único parcial sobre estados vivos, y el cliente termina con una sola solicitud en lugar de dos historiales paralelos.',
    systemsExplanation:
      'Tabla en `credit` con unicidad `(_tenant_id, application_code)`, índice único parcial sobre `status IN (submitted, under_review)` por cliente y `CHECK` de estados y montos positivos. La creación reevalúa la elegibilidad EN EL SERVIDOR antes de escribir; `idempotency_key_hash` permite reintentar el comando sin duplicar. Ocultar el botón en la app es experiencia de usuario; esa reevaluación es la garantía.',
  },
  {
    tableName: 'credit_application_events',
    whyExists:
      'Historial inmutable de todo lo que le pasó a una solicitud: creación, cambios de estado, decisión y su motivo, con el actor que lo hizo y cuándo.',
    whyNotDelete:
      'El estado actual de una solicitud dice dónde está, no cómo llegó ahí. Sin el historial no se puede reconstruir la secuencia de decisiones ni demostrar quién aprobó qué, que es lo primero que se pide ante una impugnación o una revisión interna.',
    decisionContribution:
      'Permite medir el proceso (tiempo entre envío y decisión, tasa de rechazo por motivo) y sostiene la rendición de cuentas: `actor_type` y `actor_internal_user_id` atribuyen cada transición a alguien concreto.',
    usageExample:
      'Un cliente reclama que su solicitud fue rechazada sin revisión. El historial muestra la transición a `under_review`, la consulta del analista y la decisión con su `reason_code`, todo con marca de tiempo.',
    systemsExplanation:
      'Tabla append-only en `credit`, indexada por `(_tenant_id, credit_application_id, happened_at DESC)` para reconstruir la línea de tiempo de una solicitud en una sola consulta. Se escribe en la misma transacción que el cambio de estado de la solicitud: un evento sin su cambio, o un cambio sin su evento, no pueden existir.',
  },
];
