/**
 * @file Catálogo de cobertura: los pasos del inventario que todavía NO tienen receta, y por qué.
 * @business Esta pieza impide que una etapa sin probar se lea como cubierta: cada hueco tiene
 *   nombre, motivo y lo que falta para cerrarlo.
 * @system mapa `stepCode → motivo`; la prueba de contrato exige que cada paso del inventario esté
 *   cubierto por una receta o aparezca aquí, y que nada aparezca en los dos sitios.
 */

export type GapReason =
  /** El paso lee o escribe un código que llega por SMS/WhatsApp/correo: hace falta el inbox QA. */
  | 'NEEDS_OTP_SINK'
  /** Hay que subir bytes sintéticos reales al almacenamiento QA y confirmarlos; no vale inventar una URL. */
  | 'NEEDS_SYNTHETIC_UPLOAD'
  /** Lo ejecuta un operador interno con un rol mínimo provisionado para QA. */
  | 'NEEDS_INTERNAL_ACTOR'
  /** Lo ejecuta un usuario de comercio vinculado a un partner y terminal sintéticos. */
  | 'NEEDS_MERCHANT_ACTOR'
  /** Exige un préstamo o cuota existente, y ninguna API del alcance lo crea: fixture de setup. */
  | 'NEEDS_LOAN_FIXTURE'
  /** El contrato es alcanzable con lo que ya existe; falta escribir y validar la receta. */
  | 'RECIPE_PENDING';

export const COVERAGE_GAPS: Record<string, GapReason> = {
  // customer_full_lifecycle
  'lifecycle.bank_statement': 'NEEDS_SYNTHETIC_UPLOAD',
  'lifecycle.bank_statement_latest': 'NEEDS_SYNTHETIC_UPLOAD',
  'lifecycle.identity_decision': 'NEEDS_INTERNAL_ACTOR',
  'lifecycle.payment_instructions': 'NEEDS_LOAN_FIXTURE',
  'lifecycle.payment_claim': 'NEEDS_LOAN_FIXTURE',
  'lifecycle.payment_proof': 'NEEDS_LOAN_FIXTURE',
  'lifecycle.notification_read': 'RECIPE_PENDING',
  // customer_partner_commerce
  'pos.qr_resolve': 'NEEDS_MERCHANT_ACTOR',
  'pos.credit_products': 'NEEDS_MERCHANT_ACTOR',
  'pos.credit_apply': 'NEEDS_MERCHANT_ACTOR',
  'pos.partner_applications': 'NEEDS_MERCHANT_ACTOR',
  'pos.partner_acceptance': 'NEEDS_MERCHANT_ACTOR',
  'pos.business_acceptance': 'NEEDS_INTERNAL_ACTOR',
  'settlement.claim': 'NEEDS_LOAN_FIXTURE',
  'settlement.proof': 'NEEDS_LOAN_FIXTURE',
  'settlement.partner_claims': 'NEEDS_LOAN_FIXTURE',
  'settlement.partner_proof': 'NEEDS_LOAN_FIXTURE',
  'settlement.partner_verification': 'NEEDS_LOAN_FIXTURE',
  'portfolio.summary': 'NEEDS_MERCHANT_ACTOR',
};
