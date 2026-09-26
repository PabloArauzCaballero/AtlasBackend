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
  /**
   * Depende de una decisión del Motor (comercio aprobado, extracto leído por su worker). Sin Motor en
   * el entorno QA no se alcanza; en DEV/TEST sí, y ahí la plantilla lo declara en `platformServices`.
   */
  | 'NEEDS_DECISION_ENGINE'
  /** Ningún paso del recorrido produce lo que el paso consume: es una carencia del producto, no de la receta. */
  | 'NEEDS_PRODUCT_EVENT'
  /** El contrato es alcanzable con lo que ya existe; falta escribir y validar la receta. */
  | 'RECIPE_PENDING';

export const COVERAGE_GAPS: Record<string, GapReason> = {
  // customer_full_lifecycle
  // El extracto lo lee el worker del Motor (este backend ya no lee extractos).
  'lifecycle.bank_statement': 'NEEDS_DECISION_ENGINE',
  'lifecycle.bank_statement_latest': 'NEEDS_DECISION_ENGINE',
  'lifecycle.payment_instructions': 'NEEDS_LOAN_FIXTURE',
  'lifecycle.payment_claim': 'NEEDS_LOAN_FIXTURE',
  'lifecycle.payment_proof': 'NEEDS_LOAN_FIXTURE',
  // Medido el 2026-09-24: ni la decisión de crédito ni ningún otro paso del ciclo crean un aviso in-app
  // para el cliente (messaging.notification_messages no tiene ninguno con recipient_type customer).
  'lifecycle.notification_read': 'NEEDS_PRODUCT_EVENT',
  // customer_partner_commerce — la venta en caja exige un comercio APROBADO, y lo aprueba el Motor.
  'pos.qr_resolve': 'NEEDS_DECISION_ENGINE',
  'pos.credit_products': 'NEEDS_DECISION_ENGINE',
  'pos.credit_apply': 'NEEDS_DECISION_ENGINE',
  'pos.partner_applications': 'NEEDS_DECISION_ENGINE',
  'pos.partner_acceptance': 'NEEDS_DECISION_ENGINE',
  'pos.business_acceptance': 'NEEDS_DECISION_ENGINE',
  'settlement.claim': 'NEEDS_LOAN_FIXTURE',
  'settlement.proof': 'NEEDS_LOAN_FIXTURE',
  'settlement.partner_claims': 'NEEDS_LOAN_FIXTURE',
  'settlement.partner_proof': 'NEEDS_LOAN_FIXTURE',
  'settlement.partner_verification': 'NEEDS_LOAN_FIXTURE',
  'portfolio.summary': 'NEEDS_DECISION_ENGINE',
};
