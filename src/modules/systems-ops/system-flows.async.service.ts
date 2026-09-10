/**
 * @file Caso de uso de dominio: orquesta reglas y persistencia.
 * @business Esta pieza responde qué queda pendiente cuando un flujo termina de responder.
 * @system traduce los eventos observados a un desenlace por flujo, sin suponer nada del catálogo.
 */
import { Injectable } from '@nestjs/common';
import { SystemFlowsAsyncRepository, type PendingWorkRow } from './system-flows.async.repository.js';

/** A partir de cuántos días sin recoger un pendiente deja de ser «todavía no» y pasa a ser un hueco. */
const DIAS_PARA_ATASCO = 1;

@Injectable()
export class SystemFlowsAsyncService {
  constructor(private readonly repository: SystemFlowsAsyncRepository) {}

  /**
   * Qué deja encargado cada flujo y si alguien lo recoge.
   *
   * El mapa acababa en el endpoint: un flujo que encola un correo o un recálculo parecía terminar
   * ahí, y no termina. Esto lo hace visible con lo que de verdad se escribió, cruzado por
   * `correlation_id` con la petición que lo originó.
   *
   * `stuck` no es «hay pendientes» —eso es normal un segundo después de encolar— sino «llevan más de
   * un día sin recogerse», que ya no se explica por el ritmo normal de un consumidor.
   */
  async pendingWork(windowDays = 30) {
    const filas = await this.repository.pendingWork(windowDays);
    const flows = filas.map((fila) => traducir(fila));
    const pendientes = flows.reduce((n, flujo) => n + flujo.pending, 0);
    const masAntiguo = flows.reduce<Date | null>(
      (peor, flujo) => (flujo.pendingSince && (!peor || flujo.pendingSince < peor) ? flujo.pendingSince : peor),
      null,
    );
    return {
      windowDays,
      // Un cero aquí puede ser «no se encola nada» o «no se ha usado nada en la ventana». Se dice
      // cuántos flujos dejaron rastro para que no se lea como lo primero sin serlo.
      flowsThatEnqueue: flows.length,
      pending: pendientes,
      processed: flows.reduce((n, flujo) => n + flujo.processed, 0),
      oldestPending: masAntiguo,
      stuck: flows.filter((flujo) => flujo.stuck).map((flujo) => `${flujo.method} ${flujo.path}`),
      flows,
    };
  }
}

function traducir(fila: PendingWorkRow) {
  const pendingSince = fila.pending_since ? new Date(fila.pending_since) : null;
  const dias = pendingSince ? (Date.now() - pendingSince.getTime()) / 86_400_000 : 0;
  return {
    method: fila.method,
    path: fila.path,
    events: Number(fila.events),
    pending: Number(fila.pending),
    processed: Number(fila.processed),
    other: Number(fila.other),
    pendingSince,
    // Nada procesado NUNCA y pendientes viejos es distinto de «va con retraso»: es que no hay quien
    // los recoja. Se separa para que un consumidor lento no se lea igual que un consumidor ausente.
    neverProcessed: Number(fila.processed) === 0 && Number(fila.pending) > 0,
    stuck: dias > DIAS_PARA_ATASCO,
    codes: fila.codes ?? [],
  };
}
