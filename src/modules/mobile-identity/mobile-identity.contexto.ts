/**
 * @file El `context` que acompaña a cada ejecución de identidad en el Motor.
 * @business Dice al Motor de dónde vino el carnet (cámara o escáner del sistema) sin tocar las variables del artefacto, que sólo cambian con dos firmas.
 * @system función pura; la usa `MobileIdentityService.resolver`.
 */
import type { CaptureSource } from '../../common/storage/capture-source.js';

/**
 * El `context` de la ejecución de identidad en el Motor.
 *
 * - `behaviorSummaryId` ata la decisión a la fila exacta del resumen de comportamiento que vio el
 *   artefacto.
 * - `documentCaptureSource` (`camera` | `system_scanner`) dice con qué se sacaron anverso y reverso.
 *   Va aquí y NO en `variables`: una variable nueva del artefacto exige una versión firmada por dos
 *   personas. Sólo viaja si la app lo declaró; sin él, el contexto es exactamente el de antes.
 */
export function contextoDeLaEjecucion(
  verificationId: string,
  behaviorSummaryId: string | null,
  documentCaptureSource: CaptureSource | undefined,
): Record<string, unknown> {
  return {
    channel: 'MOBILE_APP',
    verificationId,
    behaviorSummaryId,
    ...(documentCaptureSource ? { documentCaptureSource } : {}),
  };
}
