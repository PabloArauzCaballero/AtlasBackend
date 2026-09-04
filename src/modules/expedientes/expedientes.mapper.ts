/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Enseña del expediente lo que alguien necesita para decidir, y nada más.
 * @system traduce modelos a DTO; la clave del almacén nunca cruza el borde HTTP.
 */
import type {
  ExpedienteActividadModel,
  ExpedienteModel,
  ExpedienteNodoModel,
} from '../../database/models/index.js';
import type { Nivel } from './expedientes.types.js';

export type ExpedienteDto = ReturnType<typeof toExpedienteDto>;
export type NodoDto = ReturnType<typeof toNodoDto>;

export function toExpedienteDto(modelo: ExpedienteModel, extra: { nivelEfectivo: Nivel | null; nodos?: number; bytes?: string }) {
  return {
    expedienteId: modelo.id,
    subjectType: modelo.subjectType,
    subjectId: modelo.subjectId,
    sessionId: modelo.sessionId,
    customerCode: modelo.customerCode,
    estado: modelo.estado,
    enviadoEn: modelo.enviadoEn?.toISOString() ?? null,
    manifestPresente: modelo.manifestNodoId !== null,
    retencionHasta: modelo.retencionHasta?.toISOString() ?? null,
    purgadoEn: modelo.purgadoEn?.toISOString() ?? null,
    creadoEn: modelo.createdAtValue.toISOString(),
    nivelEfectivo: extra.nivelEfectivo,
    nodosTotal: extra.nodos ?? null,
    bytesTotal: extra.bytes ?? null,
  };
}

/**
 * El nodo, SIN su clave de almacén.
 *
 * `storage_key` se queda dentro a propósito. Publicarla no daría acceso —las URLs se firman en el
 * servidor— pero sí revelaría la organización interna del bucket e invitaría a construir rutas a
 * mano; el contenido se pide siempre por `nodoId`, que es lo que la autorización sabe comprobar.
 */
export function toNodoDto(modelo: ExpedienteNodoModel, nivelEfectivo: Nivel | null) {
  return {
    nodoId: modelo.id,
    parentId: modelo.parentId,
    tipo: modelo.tipo,
    nombre: modelo.nombre,
    ruta: modelo.ruta,
    origen: modelo.origen,
    clase: modelo.clase,
    mimeType: modelo.mimeType,
    sizeBytes: modelo.sizeBytes,
    sha256: modelo.sha256,
    objetoAusente: modelo.objetoAusente,
    inmutable: modelo.inmutable,
    evidenceDocumentId: modelo.evidenceDocumentId,
    engineRequestId: modelo.engineRequestId,
    creadoEn: modelo.createdAtValue.toISOString(),
    actualizadoEn: modelo.updatedAtValue.toISOString(),
    borradoEn: modelo.borradoEn?.toISOString() ?? null,
    nivelEfectivo,
  };
}

export function toActividadDto(modelo: ExpedienteActividadModel) {
  return {
    actividadId: modelo.id,
    nodoId: modelo.nodoId,
    accion: modelo.accion,
    actorTipo: modelo.actorTipo,
    actorId: modelo.actorId,
    detalle: modelo.detalle,
    ocurridoEn: modelo.createdAtValue.toISOString(),
  };
}
