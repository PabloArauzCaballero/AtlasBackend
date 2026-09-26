/**
 * @file Guardas de la decisión de un caso de revisión manual desde el portal.
 * @business Un caso que se resuelve en otro sitio no puede cerrarse aquí sin dejar a su dueño sin salida.
 * @system funciones puras que `OperationsService.decideManualReviewCase` aplica antes de cerrar el caso.
 */
import { ConflictException } from '@nestjs/common';
import { CREDIT_REVIEW_CASE_TYPE } from '../../common/types/review-case.types.js';

/**
 * Los casos que NO se cierran con el formulario de decisión del portal.
 *
 * Fuera de `OperationsService` porque ese archivo y su `decideManualReviewCase` ya están en el tope
 * (tamaño y complejidad), y porque las dos guardas son de la misma familia: «este caso se resuelve
 * en otro sitio».
 *
 * **Delegado al Motor.** Cuando el Motor de Decisión resolvió la evaluación, él abrió su propio caso
 * de revisión —con su expediente, su petición de información y su auditoría— y esta fila es sólo el
 * ancla que el flujo de alta necesita. Dejar cerrarla desde el portal creaba dos decisiones para el
 * mismo cliente, tomadas por dos personas que no se ven, y una pregunta sin respuesta después: quién
 * aprobó. Se corta en el servicio y no sólo en la pantalla porque una pantalla se salta con curl, y
 * esto es lo que hace que la bandeja del Motor sea la de verdad.
 *
 * **De crédito (C-1).** El caso PROPIO que abre el crédito cuando el Motor manda una solicitud a
 * revisión sin abrir el suyo aparece en esta misma cola. Se decide sobre la SOLICITUD
 * (`POST operations/credit/applications/:id/decision`), que además cierra el caso: cerrarlo aquí
 * dejaría la solicitud `under_review` con su caso ya cerrado y sin nadie que la resuelva.
 */
export function assertDecidableFromPortal(reviewCase: { decisionExecutionId?: string | null; caseType?: string | null }): void {
  if (reviewCase.decisionExecutionId) throw new ConflictException('MANUAL_REVIEW_DELEGADA_AL_MOTOR');
  if (reviewCase.caseType === CREDIT_REVIEW_CASE_TYPE) throw new ConflictException('MANUAL_REVIEW_ES_DE_CREDITO');
}
