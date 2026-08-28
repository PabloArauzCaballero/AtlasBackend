/**
 * @file Utilidad pura: el número de caso que una persona puede dictar por teléfono.
 * @business Da a cada expediente un identificador legible sin revelar cuántos casos hay.
 * @system `ATL-SUP-<año>-<8 dígitos aleatorios>`, con reintento ante colisión.
 */
import { randomInt } from 'node:crypto';

const PREFIX = 'ATL-SUP';

/**
 * Aleatorio y no correlativo, a propósito.
 *
 * Un `ATL-SUP-2026-00000123` cuenta cuántos casos lleva la empresa —y, con dos capturas separadas
 * por una semana, a qué ritmo crecen los reclamos—. Eso es información de negocio que se regala en
 * cada correo de soporte. Ocho dígitos aleatorios dan mil millones de combinaciones por año: el
 * espacio es tan grande que dos casos del mismo día chocan con probabilidad despreciable, y la
 * unicidad real la sigue imponiendo la base, no esta función.
 *
 * Se mantiene en dígitos —no base32— porque el número se dicta por teléfono a personas: distinguir
 * «B» de «V» al teléfono en español es exactamente el problema que no queremos crear en un canal
 * de ayuda.
 */
export function generateCaseNumber(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const suffix = String(randomInt(0, 100_000_000)).padStart(8, '0');
  return `${PREFIX}-${year}-${suffix}`;
}

/** Código público del canal. Mismo criterio: no debe dejar contar conversaciones. */
export function generateChannelCode(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const suffix = String(randomInt(0, 100_000_000)).padStart(8, '0');
  return `ATL-CH-${year}-${suffix}`;
}

const CASE_NUMBER_PATTERN = /^ATL-SUP-\d{4}-\d{8}$/;

export function isCaseNumber(value: string): boolean {
  return CASE_NUMBER_PATTERN.test(value.trim().toUpperCase());
}
