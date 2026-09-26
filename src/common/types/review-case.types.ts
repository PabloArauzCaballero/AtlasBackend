/**
 * @file Tipos de dominio: hacen explícitos estados y contratos internos.
 * @business Nombra qué clase de trabajo humano sostiene un caso de `manual_review_cases`.
 * @system vocabulario compartido entre crédito (que abre el caso) y operaciones (que lo lista y lo decide).
 */

/**
 * `manual_review_cases.case_type` de los casos que abre el CRÉDITO.
 *
 * Vive en `common` porque lo leen dos contextos que no se pueden importar entre sí: crédito, que lo
 * abre cuando el Motor manda una solicitud a revisión sin abrir su propio caso, y operaciones, que
 * NO debe cerrarlo con el formulario de riesgo —cerrarlo allí dejaría la solicitud `under_review`
 * con su caso ya cerrado—. Los de riesgo de onboarding usan `risk_assessment_review`.
 */
export const CREDIT_REVIEW_CASE_TYPE = 'credit_application_review';
