/**
 * @file Caso de uso de dominio: orquesta reglas y persistencia.
 * @business Esta pieza responde qué queda pendiente cuando un flujo termina de responder, y por qué.
 * @system traduce los eventos observados a un diagnóstico por flujo, distinguiendo entorno de avería.
 */
import { Injectable } from '@nestjs/common';
import { listEventDefinitions } from '../events/event-registry.js';
import {
  SystemFlowsAsyncRepository,
  type DomainEventRow,
  type OutboxHealthRow,
  type PendingWorkRow,
} from './system-flows.async.repository.js';

const DIA_MS = 86_400_000;
/** Sin una corrida completada del consumidor en este margen, se da por ausente en este entorno. */
const CONSUMIDOR_VIVO_MS = 10 * 60_000;

/**
 * - `SIN_CONSUMIDOR`: nadie consume el outbox en este entorno. Los pendientes no dicen nada de los
 *   flujos: un stack local sin worker los acumula todos, y llamarlos «atascados» sería inventar una
 *   avería. Medido: 447 pendientes y 6 flujos «atascados» en local, con la última corrida del
 *   consumidor seis días antes.
 * - `SALTADOS`: el consumidor corre y hay pendientes MÁS VIEJOS que su última corrida, así que los
 *   ha visto y no los ha tomado. Ésa sí es una avería, y la más engañosa, porque el job sale en verde.
 *   Así se encontró que los eventos sin inquilino no los recogía nadie.
 * - `AL_DIA`: el consumidor corre y lo pendiente es posterior a su última pasada.
 */
type Diagnostico = 'SIN_CONSUMIDOR' | 'SALTADOS' | 'AL_DIA';

@Injectable()
export class SystemFlowsAsyncService {
  constructor(private readonly repository: SystemFlowsAsyncRepository) {}

  async pendingWork(windowDays = 30) {
    const [filas, salud, dominio] = await Promise.all([
      this.repository.pendingWork(windowDays),
      this.repository.outboxHealth(),
      this.repository.domainEventConsumers(windowDays),
    ]);
    const ultimaCorrida = salud?.consumer_last_run ? new Date(salud.consumer_last_run) : null;
    const consumidorVivo = Boolean(ultimaCorrida && Date.now() - ultimaCorrida.getTime() <= CONSUMIDOR_VIVO_MS);
    const flows = filas.map((fila) => traducir(fila, consumidorVivo ? ultimaCorrida : null));
    const atribuidos = flows.reduce((n, flujo) => n + flujo.pending, 0);
    const pendientes = Number(salud?.pending ?? 0);

    return {
      windowDays,
      consumer: { lastRunAt: ultimaCorrida, running: consumidorVivo },
      diagnosis: diagnosticar(consumidorVivo, flows),
      flowsThatEnqueue: flows.length,
      pending: pendientes,
      // Pendientes que no se pudieron atar a ninguna petición: el log de éxito es fire-and-forget y
      // puede faltar. Sin esta resta desaparecerían del recuento sin que nada lo dijera.
      unattributedPending: Math.max(0, pendientes - atribuidos),
      pendingWithoutTenant: Number(salud?.pending_without_tenant ?? 0),
      failed: Number(salud?.failed ?? 0),
      oldestPending: salud?.oldest_pending ? new Date(salud.oldest_pending) : null,
      skipped: flows.filter((flujo) => flujo.skippedByConsumer).map((flujo) => `${flujo.method} ${flujo.path}`),
      failing: flows.filter((flujo) => flujo.failed > 0).map((flujo) => `${flujo.method} ${flujo.path}`),
      flows,
      domainEvents: clasificarDominio(dominio),
    };
  }
}

/**
 * Quién consume cada evento de dominio, con la prueba que hay para decirlo.
 *
 * - `SIN_REGISTRO`: avería segura, y no por deducción. `process_events` sólo reclama códigos del
 *   registro y `process_outbox` sólo los que no están, así que un evento de dominio sin registro lo
 *   marca procesado el job de compatibilidad sin avisar a nadie. Así estaba `customer.lifecycle.*`:
 *   23 transiciones, 0 avisos, con un comentario que afirmaba lo contrario.
 * - `REGISTRADO_SIN_AVISOS`: lo toma `process_events` pero no dejó ningún mensaje. Puede ser a propósito
 *   —un evento para auditoría o métricas— y por eso no se llama avería: se enseña para que alguien
 *   decida.
 * - `AVISA`: al menos uno de sus eventos terminó en un mensaje.
 */
function clasificarDominio(filas: DomainEventRow[]) {
  const registrados = new Set(listEventDefinitions().map((definicion) => definicion.code));
  const rows = filas.map((fila) => {
    const conAviso = Number(fila.events_with_message);
    return {
      eventCode: fila.event_code,
      aggregateType: fila.aggregate_type,
      events: Number(fila.events),
      eventsWithMessage: conAviso,
      messages: Number(fila.messages),
      lastEventAt: fila.last_event_at ? new Date(fila.last_event_at) : null,
      consumer: !registrados.has(fila.event_code) ? 'SIN_REGISTRO' : conAviso > 0 ? 'AVISA' : 'REGISTRADO_SIN_AVISOS',
    };
  });
  return {
    unregistered: rows.filter((row) => row.consumer === 'SIN_REGISTRO').map((row) => row.eventCode),
    registeredWithoutMessages: rows.filter((row) => row.consumer === 'REGISTRADO_SIN_AVISOS').map((row) => row.eventCode),
    rows,
  };
}

function diagnosticar(consumidorVivo: boolean, flows: ReturnType<typeof traducir>[]): Diagnostico {
  if (!consumidorVivo) return 'SIN_CONSUMIDOR';
  return flows.some((flujo) => flujo.skippedByConsumer) ? 'SALTADOS' : 'AL_DIA';
}

function traducir(fila: PendingWorkRow, ultimaCorrida: Date | null) {
  const pendingSince = fila.pending_since ? new Date(fila.pending_since) : null;
  const lastProcessedAt = fila.last_processed_at ? new Date(fila.last_processed_at) : null;
  return {
    method: fila.method,
    path: fila.path,
    events: Number(fila.events),
    pending: Number(fila.pending),
    processed: Number(fila.processed),
    failed: Number(fila.failed),
    other: Number(fila.other),
    pendingWithoutTenant: Number(fila.pending_without_tenant),
    pendingSince,
    // La fecha, no un booleano: «nunca procesado» dentro de una ventana se leía como «nadie recoge»
    // cuando el consumidor llevaba días parado tras procesar dos, o como «lento» cuando lo mandaba
    // todo a `failed`. Con la fecha cada cual saca la conclusión correcta.
    lastProcessedAt,
    // Sólo si el consumidor CORRE y pasó después de que el pendiente existiera, con margen de un día
    // para no llamar avería al ritmo normal de drenado.
    skippedByConsumer: Boolean(ultimaCorrida && pendingSince && pendingSince.getTime() < ultimaCorrida.getTime() - DIA_MS),
    codes: fila.codes ?? [],
  };
}

export type { OutboxHealthRow };
