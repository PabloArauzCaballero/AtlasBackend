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
  'lifecycle.whatsapp_start': 'RECIPE_PENDING',
  'lifecycle.whatsapp_confirm': 'NEEDS_OTP_SINK',
  'lifecycle.address_book': 'RECIPE_PENDING',
  'lifecycle.bank_statement': 'NEEDS_SYNTHETIC_UPLOAD',
  'lifecycle.bank_statement_latest': 'NEEDS_SYNTHETIC_UPLOAD',
  'lifecycle.evidence_documents': 'NEEDS_INTERNAL_ACTOR',
  'lifecycle.review_queue': 'NEEDS_INTERNAL_ACTOR',
  'lifecycle.identity_decision': 'NEEDS_INTERNAL_ACTOR',
  'lifecycle.compliance_screening': 'NEEDS_INTERNAL_ACTOR',
  'lifecycle.compliance_clear': 'NEEDS_INTERNAL_ACTOR',
  'lifecycle.investigation_summary': 'NEEDS_INTERNAL_ACTOR',
  'lifecycle.eligibility_decision': 'NEEDS_INTERNAL_ACTOR',
  'lifecycle.risk_assessment': 'NEEDS_INTERNAL_ACTOR',
  'lifecycle.credit_rating_run': 'NEEDS_INTERNAL_ACTOR',
  'lifecycle.credit_rating_read': 'RECIPE_PENDING',
  'lifecycle.application_detail': 'NEEDS_INTERNAL_ACTOR',
  'lifecycle.credit_decision': 'NEEDS_INTERNAL_ACTOR',
  'lifecycle.loans': 'NEEDS_LOAN_FIXTURE',
  'lifecycle.payment_calendar': 'NEEDS_LOAN_FIXTURE',
  'lifecycle.payment_instructions': 'NEEDS_LOAN_FIXTURE',
  'lifecycle.payment_claim': 'NEEDS_LOAN_FIXTURE',
  'lifecycle.payment_proof': 'NEEDS_LOAN_FIXTURE',
  'lifecycle.notification_read': 'RECIPE_PENDING',
  // customer_partner_commerce
  'partner.start': 'RECIPE_PENDING',
  'partner.mine': 'RECIPE_PENDING',
  'partner.status': 'RECIPE_PENDING',
  'partner.documents_upload_url': 'NEEDS_SYNTHETIC_UPLOAD',
  'partner.legal_representative': 'RECIPE_PENDING',
  'partner.commercial_registry': 'RECIPE_PENDING',
  'partner.commercial_profile': 'RECIPE_PENDING',
  'partner.contact_request': 'RECIPE_PENDING',
  'partner.contact_submit': 'NEEDS_OTP_SINK',
  'partner.branch_create': 'RECIPE_PENDING',
  'partner.branches': 'RECIPE_PENDING',
  'partner.branch_update': 'RECIPE_PENDING',
  'partner.pos_create': 'RECIPE_PENDING',
  'partner.pos_list': 'RECIPE_PENDING',
  'partner.pos_update': 'RECIPE_PENDING',
  'partner.qr_upload_url': 'NEEDS_SYNTHETIC_UPLOAD',
  'partner.qr_create': 'NEEDS_SYNTHETIC_UPLOAD',
  'partner.qr_list': 'RECIPE_PENDING',
  'partner.qr_content': 'NEEDS_SYNTHETIC_UPLOAD',
  'partner.submit': 'RECIPE_PENDING',
  'partner.queue': 'NEEDS_INTERNAL_ACTOR',
  'partner.kyb_review': 'NEEDS_INTERNAL_ACTOR',
  'partner.qr_pending': 'NEEDS_INTERNAL_ACTOR',
  'partner.qr_review': 'NEEDS_INTERNAL_ACTOR',
  'partner.decision': 'NEEDS_INTERNAL_ACTOR',
  'partner.erp_account': 'NEEDS_INTERNAL_ACTOR',
  'merchant.provisioning_request': 'NEEDS_MERCHANT_ACTOR',
  'merchant.provisioning_list': 'NEEDS_MERCHANT_ACTOR',
  'merchant.provisioning_approve': 'NEEDS_INTERNAL_ACTOR',
  'merchant.login': 'NEEDS_MERCHANT_ACTOR',
  'merchant.me': 'NEEDS_MERCHANT_ACTOR',
  'merchant.users': 'NEEDS_MERCHANT_ACTOR',
  'merchant.user_status': 'NEEDS_MERCHANT_ACTOR',
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
  'support.faq': 'NEEDS_MERCHANT_ACTOR',
  'support.categories': 'NEEDS_MERCHANT_ACTOR',
  'support.case_create': 'NEEDS_MERCHANT_ACTOR',
  'support.case_detail': 'NEEDS_MERCHANT_ACTOR',
  'support.case_close_request': 'NEEDS_MERCHANT_ACTOR',
  'support.case_feedback': 'NEEDS_MERCHANT_ACTOR',
};
