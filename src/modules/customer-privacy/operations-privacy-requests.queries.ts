/**
 * @file Consultas y mapeo de la cola interna de solicitudes del titular.
 * @business Cumplimiento tiene que ver qué solicitudes esperan, de quién son y cuáles ya vencieron.
 * @system construye el SQL de la lista, el detalle y el historial, y convierte cada fila en su forma pública.
 */
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { DATA_SUBJECT_REQUEST_OPEN_STATUSES, dueDateFrom, isOverdue } from './data-subject-request.state.js';

const tabla = (nombre: string): string => `${atlasSchemaFor(nombre)}.${nombre}`;

/** Literal SQL de los estados abiertos. Sale de una constante del código, nunca de la petición. */
export const SQL_OPEN_STATUSES = `(${DATA_SUBJECT_REQUEST_OPEN_STATUSES.map((s) => `'${s}'`).join(', ')})`;

/** Fecha de recepción: `requested_at`, o el alta de la fila si una carga antigua lo dejó vacío. */
export const SQL_RECEIVED_AT = 'COALESCE(d.requested_at, d._created_at)';

export interface FilaDeSolicitud {
  requestId: string;
  requestCode: string | null;
  requestType: string | null;
  status: string | null;
  receivedAt: Date | string;
  resolvedAt: Date | string | null;
  resolutionNotes: string | null;
  handledByInternalUserId: string | null;
  handledByName: string | null;
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
  /** Lo que la persona escribió y qué quiere corregir. Antes no se guardaba. */
  description: string | null;
  rectificationField: string | null;
  hasProposedValue: boolean;
  pinVerifiedAt: Date | string | null;
  /** La opinión del Motor (fase en sombra). Todas nulas mientras no ha opinado. */
  decisionMode: string | null;
  engineDecision: string | null;
  engineReasonCode: string | null;
  engineAction: string | null;
  engineRiskSignals: number | null;
  engineReevaluateCredit: boolean | null;
  engineInputs: Record<string, unknown> | null;
  engineExecutionId: string | null;
  engineArtifactCode: string | null;
  engineArtifactVersionId: string | null;
  engineDecidedAt: Date | string | null;
  engineAttempts: number | null;
  engineLastError: string | null;
  /** Sólo en el detalle: el sobre cifrado del valor propuesto. Nunca sale tal cual en la respuesta. */
  proposedValueEnvelope?: string | null;
}

export interface FilaDeHistorial {
  actionCode: string | null;
  occurredAt: Date | string | null;
  actorType: string | null;
  actorInternalUserId: string | null;
  actorName: string | null;
  payload: Record<string, unknown> | null;
}

export function sqlSolicitudes(where: string, paginar: boolean, conValorCifrado = false): string {
  return `
    SELECT d._id::text AS "requestId", d.request_code AS "requestCode", d.request_type AS "requestType", d.status,
           ${SQL_RECEIVED_AT} AS "receivedAt", d.resolved_at AS "resolvedAt", d.resolution_notes AS "resolutionNotes",
           d.handled_by::text AS "handledByInternalUserId", iu.full_name AS "handledByName",
           d.customer_id::text AS "customerId", cu.customer_code AS "customerCode",
           NULLIF(TRIM(CONCAT_WS(' ', pv.first_name, pv.last_name)), '') AS "customerName",
           d.description, d.rectification_field AS "rectificationField",
           (d.proposed_value_encrypted IS NOT NULL) AS "hasProposedValue", d.pin_verified_at AS "pinVerifiedAt",
           d.decision_mode AS "decisionMode", d.engine_decision AS "engineDecision", d.engine_reason_code AS "engineReasonCode",
           d.engine_action AS "engineAction", d.engine_risk_signals AS "engineRiskSignals",
           d.engine_reevaluate_credit AS "engineReevaluateCredit", d.engine_inputs_json AS "engineInputs",
           d.engine_execution_id AS "engineExecutionId", d.engine_artifact_code AS "engineArtifactCode",
           d.engine_artifact_version_id AS "engineArtifactVersionId", d.engine_decided_at AS "engineDecidedAt",
           d.engine_attempts AS "engineAttempts", d.engine_last_error AS "engineLastError"
           ${conValorCifrado ? `, convert_from(d.proposed_value_encrypted, 'UTF8') AS "proposedValueEnvelope"` : ''}
      FROM ${tabla('data_subject_requests')} d
      LEFT JOIN ${tabla('customers')} cu ON cu._id = d.customer_id AND cu._tenant_id = d._tenant_id
      LEFT JOIN ${tabla('customer_profile_versions')} pv ON pv._id = cu.current_profile_version_id AND pv._tenant_id = d._tenant_id
      LEFT JOIN ${tabla('internal_users')} iu ON iu._id = d.handled_by AND iu._tenant_id = d._tenant_id
     WHERE ${where}
     ORDER BY (d.status IN ${SQL_OPEN_STATUSES}) DESC,
              CASE WHEN d.status IN ${SQL_OPEN_STATUSES} THEN ${SQL_RECEIVED_AT} END ASC,
              ${SQL_RECEIVED_AT} DESC, d._id DESC
     ${paginar ? 'LIMIT $limit OFFSET $offset' : ''}`;
}

/** El conteo lleva el JOIN al cliente porque `q` busca en su código: sin él, el total no respetaría la búsqueda. */
export const SQL_CONTEO = (where: string): string =>
  `SELECT COUNT(*)::text AS total FROM ${tabla('data_subject_requests')} d
     LEFT JOIN ${tabla('customers')} cu ON cu._id = d.customer_id AND cu._tenant_id = d._tenant_id
    WHERE ${where}`;

/** El resumen es de TODA la cola del tenant: dice si hay que ir a mirar, y no cambia con el filtro. */
export const SQL_RESUMEN = `
  SELECT COUNT(*) FILTER (WHERE d.status IN ${SQL_OPEN_STATUSES})::text AS open,
         COUNT(*) FILTER (WHERE d.status IN ${SQL_OPEN_STATUSES} AND ${SQL_RECEIVED_AT} < $overdueCutoff)::text AS overdue
    FROM ${tabla('data_subject_requests')} d
   WHERE d._tenant_id = $tenantId AND COALESCE(d._deleted, false) = false`;

export const SQL_HISTORIAL = `
  SELECT a.action_code AS "actionCode", a.occurred_at AS "occurredAt", a.actor_type AS "actorType",
         a.actor_internal_user_id::text AS "actorInternalUserId", iu.full_name AS "actorName", a.payload_json AS payload
    FROM ${tabla('operational_audit_logs')} a
    LEFT JOIN ${tabla('internal_users')} iu ON iu._id = a.actor_internal_user_id AND iu._tenant_id = a._tenant_id
   WHERE a._tenant_id = $tenantId AND a.target_type = 'data_subject_request' AND a.target_id = $requestId
   ORDER BY a.occurred_at ASC, a._id ASC`;

function iso(valor: Date | string): string {
  return valor instanceof Date ? valor.toISOString() : new Date(valor).toISOString();
}

const DIA_MS = 86_400_000;

/** El plazo y el «vencida» se calculan aquí, con un único «ahora» para la página y el resumen. */
export function presentarSolicitud(fila: FilaDeSolicitud, now: Date) {
  const recibida = new Date(fila.receivedAt);
  const vence = dueDateFrom(recibida);
  const overdue = isOverdue(fila.status, recibida, now);
  // El sobre cifrado nunca sale en la respuesta: el detalle pone el valor descifrado (y lo audita) aparte.
  const {
    proposedValueEnvelope: _sobre,
    decisionMode,
    engineDecision,
    engineReasonCode,
    engineAction,
    engineRiskSignals,
    engineReevaluateCredit,
    engineInputs,
    engineExecutionId,
    engineArtifactCode,
    engineArtifactVersionId,
    engineDecidedAt,
    engineAttempts,
    engineLastError,
    ...visible
  } = fila;
  const intentos = Number(engineAttempts ?? 0);
  return {
    ...visible,
    /**
     * Lo que opinó el Motor, o `null` si nunca se le preguntó. Con intentos y sin decisión, `decision` es nula y
     * `lastError` dice por qué: la persona decide igual, pero sabe que el Motor no contestó.
     */
    engine:
      engineDecision || intentos > 0
        ? {
            mode: decisionMode,
            decision: engineDecision,
            reasonCode: engineReasonCode,
            action: engineAction,
            riskSignals: engineRiskSignals === null ? null : Number(engineRiskSignals),
            reevaluateCredit: engineReevaluateCredit,
            inputs: engineInputs,
            executionId: engineExecutionId,
            artifactCode: engineArtifactCode,
            artifactVersionId: engineArtifactVersionId,
            decidedAt: engineDecidedAt ? iso(engineDecidedAt) : null,
            attempts: intentos,
            lastError: engineLastError,
          }
        : null,
    pinVerifiedAt: fila.pinVerifiedAt ? iso(fila.pinVerifiedAt) : null,
    status: fila.status ?? 'received',
    receivedAt: iso(fila.receivedAt),
    dueAt: vence.toISOString(),
    resolvedAt: fila.resolvedAt ? iso(fila.resolvedAt) : null,
    overdue,
    /** Días que faltan (positivo) o que lleva vencida (negativo); `null` si ya está cerrada. */
    daysToDue: DATA_SUBJECT_REQUEST_OPEN_STATUSES.includes((fila.status ?? 'received') as never)
      ? Math.floor((vence.getTime() - now.getTime()) / DIA_MS)
      : null,
  };
}

/** El historial sale de la auditoría: la creación desde la app y cada transición, con quién y cuándo. */
export function presentarHistorial(fila: FilaDeHistorial) {
  const payload = fila.payload ?? {};
  const texto = (clave: string): string | null => (typeof payload[clave] === 'string' ? (payload[clave] as string) : null);
  return {
    action: fila.actionCode === 'privacy.data_subject_request.create' ? 'created' : 'transition',
    fromStatus: texto('fromStatus'),
    toStatus: fila.actionCode === 'privacy.data_subject_request.create' ? 'received' : texto('toStatus'),
    reason: texto('reason'),
    actorType: fila.actorType,
    actorInternalUserId: fila.actorInternalUserId,
    actorName: fila.actorName,
    occurredAt: fila.occurredAt ? iso(fila.occurredAt) : null,
  };
}
