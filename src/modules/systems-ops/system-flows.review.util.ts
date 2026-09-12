/**
 * @file Regla de dominio: qué flujos necesitan que una persona confirme lo que dedujo el análisis.
 * @business Esta pieza lleva a revisión humana sólo lo que importa y no se puede dar por bueno solo.
 * @system decide, sin tocar la base, los motivos por los que un flujo entra en la cola de revisión.
 */
import { flowAnalysisSchema } from './system-flows.schemas.js';

/**
 * Por qué un flujo va a revisión. Sólo cuenta en riesgo CRITICAL o HIGH: mandar a revisión los mil
 * flujos del catálogo convierte la cola en una lista que nadie lee, que es el fallo que esta
 * herramienta lleva persiguiendo.
 *
 * - `SIN_ANALISIS`: no se pudo seguir el handler; el mapa de ese flujo es sólo su ruta.
 * - `ANALISIS_PARCIAL`: se siguió, pero no hasta el final.
 * - `HUECOS_SIN_RESOLVER`: SQL dinámico, profundidad máxima, modelo sin tabla…
 * - `EVENTO_DINAMICO`: publica un evento cuyo código se arma en ejecución; quién lo recoge depende
 *   del valor.
 */
export type MotivoDeRevision = 'SIN_ANALISIS' | 'ANALISIS_PARCIAL' | 'HUECOS_SIN_RESOLVER' | 'EVENTO_DINAMICO';

export function motivosDeRevision(flujo: { risk: string; analysisJson: Record<string, unknown> | null }): MotivoDeRevision[] {
  if (flujo.risk !== 'CRITICAL' && flujo.risk !== 'HIGH') return [];
  const leido = flowAnalysisSchema.safeParse(flujo.analysisJson ?? {});
  if (!leido.success) return ['SIN_ANALISIS'];
  const analisis = leido.data;
  const motivos: MotivoDeRevision[] = [];
  if (analisis.status === 'DISCOVERED') motivos.push('SIN_ANALISIS');
  if (analisis.status === 'PARTIAL') motivos.push('ANALISIS_PARCIAL');
  if (analisis.unknowns.length) motivos.push('HUECOS_SIN_RESOLVER');
  if (analisis.events.some((evento) => evento.dynamic)) motivos.push('EVENTO_DINAMICO');
  return motivos;
}
