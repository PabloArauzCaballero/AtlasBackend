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
  {
    tableName: 'card_tiers',
    whyExists:
      'Es el catálogo de las cinco tarjetas del cliente (Normal, Silver, Gold, Premium y Black): cómo se llama cada una, con qué nivel Atlas se desbloquea sola, cómo se pinta (degradado, tinta, acento y acabado) y qué beneficios muestra. Vive en la base y no en la app para que Atlas pueda cambiar el aspecto o los beneficios de «Gold» sin publicar en las tiendas, por tenant.',
    whyNotDelete:
      'Una tarjeta retirada sigue siendo la que un cliente tuvo, y los ajustes manuales del personal (`customer_card_tier_overrides`) apuntan a su código. Borrarla dejaría ajustes históricos señalando una tarjeta que ya no se puede nombrar. Por eso el retiro es `is_active = false` o `_deleted`, que conserva la fila y su orden.',
    decisionContribution:
      '`level_code` decide con qué nivel Atlas se gana la tarjeta de forma automática; `display_order` decide el escalón (y qué tarjeta se considera superior); `is_active` decide si se ofrece. La tarjeta es presentación y estatus: nada de esta tabla cambia el límite de crédito ni la decisión del Motor.',
    usageExample:
      'Un cliente llega al nivel Establecido y la app le muestra la tarjeta Gold, porque `level_code = ESTABLECIDO` apunta a esa fila. Si el personal le pone Premium a mano, la fila de `customer_card_tier_overrides` manda sobre ésta hasta que venza o se quite.',
    systemsExplanation:
      'Tabla en `catalog` con `_tenant_id`, borrado lógico y claves únicas `(tenant, tier_code)` y `(tenant, level_code)`. `theme_json` y `benefits_json` son JSONB, así que un beneficio o un color nuevos no exigen desplegar la app. Si un tenant no tiene las cinco filas, el servicio usa el catálogo de fábrica del dominio (`DEFAULT_CARD_TIERS`): nadie se queda sin tarjeta por un tenant nuevo.',
  },
  {
    tableName: 'customer_card_tier_overrides',
    whyExists:
      'Es cada vez que una persona del personal le puso a un cliente una tarjeta distinta de la que ganó por su nivel: qué tarjeta, por qué (motivo obligatorio), quién, desde cuándo, hasta cuándo y, si se quitó, quién y por qué. La tarjeta automática no se guarda: se calcula del nivel en cada lectura.',
    whyNotDelete:
      'Es la prueba de por qué un cliente tuvo una tarjeta que no le correspondía por nivel y quién lo decidió. Borrar una fila borra la autoría de un trato de favor o de una corrección. Por eso un ajuste nunca se borra: se revoca (`revoked_at`, `revoked_by_internal_user_id`, `revoke_reason`) o vence (`expires_at`).',
    decisionContribution:
      'Un ajuste NO revocado y NO vencido manda sobre la tarjeta del nivel. Nunca hay dos vigentes a la vez (índice único parcial sobre los no revocados): poner uno nuevo revoca el anterior en la misma transacción. No cambia el límite de crédito.',
    usageExample:
      'Operaciones le pone Black a un cliente fundador de la red, con vencimiento a fin de año y el motivo «Cliente fundador». En diciembre vence y el cliente vuelve a la tarjeta de su nivel; la fila queda como historial con su motivo y su autor.',
    systemsExplanation:
      'Tabla en `credit` con `_tenant_id`, `customer_id`, `tier_code`, `reason`, `set_by_internal_user_id`, `valid_from`, `expires_at` y los tres campos de revocación, con CHECK de vencimiento y de motivo de revocación. Toda escritura va en una transacción con su registro de auditoría operativa (`credit.card_tier.override_set` / `override_revoked`); si la auditoría falla, el ajuste se deshace.',
  },
];
