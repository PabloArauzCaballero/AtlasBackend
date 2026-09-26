/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Controles de concesión del plan de cumplimiento (P-09, P-11): cupo reservado y consentimiento replicado. */
export const CREDIT_CONTROL_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'credit_exposure_reservations',
    whyExists:
      'Es el cupo de la línea de crédito que una solicitud aprobada tiene apartado. La línea decía cuánto podía deber un cliente, pero el desembolso nunca la leía: dos compras simultáneas que cabían por separado se concedían juntas aunque juntas excedieran el límite. La reserva convierte el límite en un recurso que se toma bajo cerrojo, no en una suma que se lee.',
    whyNotDelete:
      'Una reserva consumida es el rastro de qué cupo tomó cada préstamo y con qué decisión vigente; una liberada es la prueba de que una cancelación devolvió el cupo una sola vez. Borrarlas deja sin explicación por qué una solicitud se rechazó por falta de cupo o por qué otra cupo, y la migración se niega a retirar la tabla si tiene filas.',
    decisionContribution:
      '`status` decide si el importe cuenta contra el límite (`reserved` y no vencida), si ya es préstamo (`consumed`, y entonces lo cuenta el saldo) o si volvió al cupo (`released`). `expires_at` es la vigencia de la decisión: vencida no cuenta ni se consume, y la concesión debe revalidar contra el límite de hoy.',
    usageExample:
      'Un cliente con 900 de deuda y 1.000 de límite acepta dos compras de 80 en dos cajas a la vez. La primera aceptación reserva 80 bajo el cerrojo del cliente; la segunda, al entrar, ve 980 comprometidos y recibe CREDIT_EXPOSURE_LIMIT_EXCEEDED. Sólo una llega a desembolsarse.',
    systemsExplanation:
      'Tabla en `credit` con índice único parcial `(_tenant_id, credit_application_id)` sobre estados vivos y CHECK de estado. Toda escritura toma primero `FOR UPDATE` sobre la fila del cliente; la exposición (saldo de préstamos vivos más reservas vivas de otras solicitudes) y la comparación con `approved_limit` se calculan en PostgreSQL en NUMERIC, sin pasar el dinero por flotantes.',
  },
  {
    tableName: 'decision_consent_replications',
    whyExists:
      'Es la cola duradera de lo que el motor de decisión debe saber del consentimiento de cada sujeto. La réplica se hacía con una llamada que devolvía false al fallar y nadie reintentaba: una revocación hecha con el motor caído no llegaba nunca y el motor seguía decidiendo con un permiso que el titular ya había retirado.',
    whyNotDelete:
      'Una fila pendiente es la única prueba de que el motor todavía no sabe algo que el core sí sabe, y es lo que bloquea el desembolso de ese cliente mientras tanto. Borrarla desbloquearía originaciones sobre un permiso retirado y ocultaría una desincronización que debe verse; la migración no retira la tabla con filas.',
    decisionContribution:
      '`action = revoke` con `status = pending` bloquea en el core el desembolso del cliente (CONSENT_REVOCATION_PENDING_SYNC) aunque el motor esté caído. `requested_at` ordena: un permiso más viejo que una revocación ya pedida no la pisa ni se entrega, para no resucitar en el motor lo que el titular retiró.',
    usageExample:
      'El titular revoca el análisis de su extracto un domingo con el motor en mantenimiento. La pasada del trabajo sync_engine_consents encola la revocación, falla y la reprograma; el lunes el motor responde, la fila pasa a synced y queda la marca de cuándo se enteró el motor. Entre tanto ningún desembolso de ese cliente salió.',
    systemsExplanation:
      'Tabla en `credit` con una fila por `(_tenant_id, subject_reference, purpose_code)`: sólo importa el último estado deseado. La escribe el cliente del motor antes de intentar la entrega y el reintentador con espera creciente; el acuse sólo cuenta si `requested_at` no cambió, para que una entrega vieja no dé por sincronizada una revocación posterior.',
  },
];
