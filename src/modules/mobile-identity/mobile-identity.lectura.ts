/**
 * @file Filtra lo que el artefacto leyó del carnet a lo que se puede ofrecer para prellenar.
 * @business Que la persona confirme lo leído en vez de teclearlo dos veces; nunca se ofrece lo que un modelo «propuso».
 * @system sólo campos del catálogo y procedencias que sostienen «se leyó el documento» (OCR, MRZ, código de barras, proveedor).
 */
import { CAMPOS_LEIDOS, type LecturaDelDocumento } from './mobile-identity.schemas.js';

/** Procedencias que sostienen la afirmación «se leyó el documento». Espejo de `ExtractedFieldSource` del Motor. */
const PROCEDENCIAS_UTILIZABLES = new Set(['OCR', 'MRZ', 'BARCODE', 'PROVIDER']);

/** Filtra la salida del artefacto a los campos y procedencias que se pueden ofrecer para prellenar. */
export function lecturaUtilizable(salida: unknown): LecturaDelDocumento | null {
  if (!salida || typeof salida !== 'object') return null;
  const lectura: LecturaDelDocumento = {};
  for (const campo of CAMPOS_LEIDOS) {
    const crudo = (salida as Record<string, unknown>)[campo];
    if (!crudo || typeof crudo !== 'object') continue;
    const { value, confidence, source } = crudo as Record<string, unknown>;
    if (typeof value !== 'string' || value.trim().length === 0) continue;
    if (typeof source !== 'string' || !PROCEDENCIAS_UTILIZABLES.has(source)) continue;
    lectura[campo] = { value: value.trim(), confidence: typeof confidence === 'number' ? confidence : null, source };
  }
  return Object.keys(lectura).length > 0 ? lectura : null;
}
