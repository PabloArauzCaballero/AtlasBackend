/**
 * @file Constantes del caso de revisión de una solicitud de crédito.
 * @business Nombran de quién es la bandeja de una solicitud que espera a una persona.
 * @system vocabulario de la revisión de crédito (C-1); el tipo de caso vive en `common/types/review-case.types.ts`.
 */

/**
 * De quién es la bandeja que sostiene una solicitud en `under_review`.
 *
 * - `engine`: el Motor abrió su propio caso (`manualReview.caseCode`). Allí se resuelve, y la
 *   decisión humana de Atlas se rechaza para que no haya dos personas decidiendo sin verse.
 * - `atlas`: el Motor NO abrió caso —o no llegó a responder—, así que Atlas abre el suyo en
 *   `manual_review_cases`. Es la única bandeja que hay, y se decide aquí.
 */
export const REVIEW_CASE_SOURCE = { engine: 'engine', atlas: 'atlas' } as const;

export type ReviewCaseSource = (typeof REVIEW_CASE_SOURCE)[keyof typeof REVIEW_CASE_SOURCE];
