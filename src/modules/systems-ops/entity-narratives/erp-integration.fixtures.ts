/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Integración de eventos Core ↔ ERP (P-14): inbox externa, orden por agregado, entregas y cobertura proyectada. */
export const ERP_INTEGRATION_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'external_event_inbox',
    whyExists:
      'Es el acuse de recibo de Core para los hechos que manda el ERP: coberturas liquidadas, pagos de recuperación y asientos. El ERP entrega al menos una vez —reintenta tras un timeout o tras caerse entre el acuse y la marca—, así que sin esta tabla la misma cobertura se proyectaría dos veces.',
    whyNotDelete:
      'Cada fila es la prueba de que Core recibió ese evento y de qué hizo con él (aplicado, ignorado, obsoleto o sin cuota de Core). Borrarla hace que una reentrega vuelva a aplicarse y deja sin explicación por qué una cobertura no aparece ligada a su cuota; la migración no retira la tabla con filas.',
    decisionContribution:
      '`outcome` separa lo aplicado de lo que llegó sin cuota de Core (`UNLINKED`), que es la lista que alguien tiene que conciliar. La unicidad `(producer, event_key)` decide si una entrega es nueva o repetida, dentro de la misma transacción que el efecto.',
    usageExample:
      'El worker del ERP entrega la cobertura de la cuota 2 de un préstamo, no recibe respuesta por un corte y la reentrega cinco veces. La primera entrega queda APPLIED; las otras cinco chocan con la unicidad y responden DUPLICATE sin tocar la proyección.',
    systemsExplanation:
      'Tabla en `platform_ops`. La escribe `ErpEventInboxService` con `INSERT … ON CONFLICT DO NOTHING` y, en la misma transacción, el avance de versión y el efecto; si el efecto falla se revierte también el recibo y el reintento lo aplica. El 2xx al ERP sale sólo tras el commit.',
  },
  {
    tableName: 'external_aggregate_versions',
    whyExists:
      'Guarda la última versión aplicada de cada agregado que llega de otro servicio (una CxP, una recuperación del ERP). Sin ella, un pago de recuperación viejo reentregado tarde podría devolver la proyección a un importe recuperado menor que el real.',
    whyNotDelete:
      'Es lo único que distingue un evento nuevo de uno viejo del mismo agregado. Borrarla permitiría que una reentrega tardía revirtiera el estado más nuevo de una recuperación.',
    decisionContribution: 'Un evento cuya versión no supera `last_version` se registra como `STALE` en la inbox y no toca la proyección.',
    usageExample:
      'Llegan los pagos de recuperación v3 (recuperado 333,33) y después, por un reintento, el v2 (100,00): el v2 queda STALE y la proyección sigue en RECOVERED.',
    systemsExplanation:
      'Tabla en `platform_ops` con clave (productor, tipo, id). Upsert condicional `WHERE last_version < EXCLUDED.last_version`: el candado de fila serializa dos versiones del mismo agregado que lleguen a la vez.',
  },
  {
    tableName: 'outbound_event_deliveries',
    whyExists:
      'Es la cola de entregas de Core hacia el ERP: cada aviso de pago reportado, confirmado o rechazado por el comercio tiene que llegar al ERP, que decide si detiene una cobertura. Nace en la misma transacción que el aviso, así que no hay aviso sin su entrega.',
    whyNotDelete:
      'Una fila `pending` o `dead` es un hecho de pago que el ERP todavía no conoce; borrarla lo haría invisible y el ERP podría cubrir una cuota ya pagada. Una `delivered` es la prueba de cuándo lo supo el ERP.',
    decisionContribution:
      '`status` y `attempts` dicen si la integración va al día; una `dead` bloquea las versiones siguientes de esa cuota hasta que alguien la revise, para no aplicar una confirmación antes que su aviso.',
    usageExample:
      'El comercio confirma el pago con el ERP caído: la entrega reintenta con espera creciente y, al volver el ERP, sale primero el aviso (versión 1) y después la confirmación (versión 2), una vez cada una.',
    systemsExplanation:
      'Tabla en `platform_ops` con unicidad (destino, event_id) y el sobre ya construido (`atlas.core.outbox/1`, sin la referencia bancaria). La reserva usa lease y `FOR UPDATE SKIP LOCKED` sólo sobre la cabeza de cada cuota; la marca es condicional al lease. Trabajo `deliver_erp_events`.',
  },
  {
    tableName: 'installment_coverage_projections',
    whyExists:
      'Deja consultable en Core lo que ATLAS pagó al comercio por una cuota incumplida y cuánto se ha recuperado del cliente. Core es la fuente de la cuota; el ERP, de la cobertura y la recuperación: esta tabla es la proyección, no un saldo.',
    whyNotDelete:
      'Sin ella Core no sabe que una cuota en mora ya fue cubierta por ATLAS, y cobranza o soporte hablarían con el cliente sin saber que la deuda ahora es con ATLAS.',
    decisionContribution:
      'Cruza la cuota de Core con la cobertura y la recuperación del ERP; `loan_id` nulo marca una cobertura que no se pudo ligar a una cuota de Core y hay que conciliar.',
    usageExample:
      'La cuota 2 del préstamo 1 vence impaga; el ERP liquida 333,33 al comercio y Core recibe la cobertura: la proyección muestra 333,33 cubiertos, 0 recuperados, estado OPEN, y la cuota sigue en mora en Core.',
    systemsExplanation:
      'Tabla en `credit` con una fila por CxC de recuperación del ERP (`erp_recovery_id` único). La liquidación y los movimientos de recuperación rellenan columnas distintas con upserts; los movimientos sólo avanzan si su versión es mayor. Nunca modifica `loan_installments`.',
  },
];
