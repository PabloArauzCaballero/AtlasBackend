/**
 * @file Vocabulario único del origen de una captura de evidencia: cámara de la app o escáner de documentos del sistema.
 * @business El Motor calibró su forense con fotos de la cámara; esta etiqueta le deja reconocer la imagen recortada y recodificada del escáner como otra población, que todavía no se ha medido.
 * @system define `CAPTURE_SOURCES`, el esquema zod del borde y la regla de que la selfie nunca viene del escáner; lo comparten upload-url, el paquete de identidad, mobile-identity y el modelo de `evidence_documents`.
 */
import { z } from 'zod';

/**
 * Con qué se capturó una imagen del carnet.
 *
 * - `camera`: la cámara de la app (`expo-camera`): la foto entera, sin recorte ni realce.
 * - `system_scanner`: el escáner de documentos DEL SISTEMA (VisionKit en iOS, ML Kit en Android). No
 *   entrega el original: devuelve un recorte con la perspectiva corregida, recodificado y, en iOS,
 *   con el filtro que haya elegido la persona. El forense del Motor se calibró con fotos, así que
 *   esta población se etiqueta para poder medirla aparte (plan del escáner, 2026-09-26, §2).
 *
 * La ausencia NO es un tercer valor: una fila o una petición sin origen es de la cámara, que es lo
 * único que existía antes de esta etiqueta. Por eso la columna es NULL por omisión y no se rellena.
 *
 * Es el mismo vocabulario en la app, en este backend (`privacy.evidence_documents.capture_source`,
 * con su CHECK) y en el `context` que se manda al Motor: cambiarlo aquí sin la migración rompe la
 * escritura.
 */
export const CAPTURE_SOURCES = ['camera', 'system_scanner'] as const;

export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

/** Campo opcional de origen de captura, para los esquemas del borde. */
export const captureSourceSchema = z.enum(CAPTURE_SOURCES);

/** Las evidencias que el escáner del sistema NO puede producir: la selfie siempre es de la cámara. */
const SIEMPRE_CON_CAMARA: ReadonlySet<string> = new Set(['selfie']);

/**
 * Regla de un item de evidencia: `system_scanner` en una selfie es un error del cliente, no un dato.
 * El escáner del sistema sólo fotografía documentos; aceptarlo en la selfie guardaría una etiqueta
 * falsa en `evidence_documents.capture_source`.
 */
export function sinEscanerEnLaSelfie(
  item: { evidenceType: string; captureSource?: CaptureSource | undefined },
  ctx: z.RefinementCtx,
): void {
  if (item.captureSource === 'system_scanner' && SIEMPRE_CON_CAMARA.has(item.evidenceType)) {
    ctx.addIssue({
      code: 'custom',
      path: ['captureSource'],
      message: 'La selfie siempre se toma con la cámara: captureSource no puede ser system_scanner.',
    });
  }
}
