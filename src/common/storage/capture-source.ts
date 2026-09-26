/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system define en un solo sitio con qué se capturó una imagen de evidencia (cámara o escáner del sistema).
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
