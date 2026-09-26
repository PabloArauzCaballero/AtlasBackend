/**
 * @file Proceso declarado en código: pago de cuota con el QR del comercio, comprobante y verificación.
 * @business El dinero de una transferencia lo ve el comercio en su cuenta, no Atlas: este proceso lleva el aviso de pago del cliente hasta el comercio, que lo confirma, y sólo entonces la cuota queda pagada.
 * @system fixture que `syncWorkflowCatalog` vuelca a `workflow_*`; rutas de `loan-payment-claims` (app y comercio), la pasarela `merchant-credit` del ERP y el consumidor `integration/core/events`.
 */
import type { WorkflowDefinitionFixture } from '../workflow-definition.types.js';

const CUSTOMER_ROLES = ['customer', 'internal_operator', 'admin', 'platform_admin'];
const MERCHANT_ROLES = ['merchant', 'internal_operator', 'admin', 'platform_admin'];
const ERP_MERCHANT_ROLES = ['merchant', 'MERCHANT_ADMIN', 'MERCHANT_OPERATIONS', 'OPERATIONS', 'ADMIN'];

export const INSTALLMENT_PAYMENT_CLAIMS: WorkflowDefinitionFixture = {
  processId: 'P-09',
  code: 'installment_payment_claims',
  version: 'v1',
  name: 'Pago de cuota con QR del comercio, comprobante y verificación',
  description:
    'El cliente ve el QR bancario activo del comercio para su cuota, transfiere desde su banco, sube el comprobante y avisa; el comercio lo verifica desde el portal del comercio y, al confirmarlo, Atlas registra el pago en la cuota y avisa al cliente y al ERP.',
  processType: 'customer_journey',
  ownerDomain: 'loan_servicing',
  ownerRole: 'OPERATIONS_MANAGER',
  priority: 'P0',
  systems: ['ATLAS_BACKEND', 'ERP_BACKEND'],
  narrative: {
    whyExists:
      'La cuota se paga por transferencia a la cuenta del comercio, y ese dinero sólo lo ve el comercio en su extracto. El proceso convierte «ya pagué» en un pago registrado: el cliente avisa con comprobante y el comercio, que es quien puede comprobarlo, lo confirma o lo rechaza con motivo.',
    whoStartsAndCloses:
      'Lo inicia el cliente desde la pantalla «Pagar» de la app, con el QR activo del comercio de su crédito. Lo cierra una persona del comercio (rol merchant) al verificar o rechazar el comprobante en «Gestión POS › Comprobantes por verificar» del portal del comercio.',
    startAndEnd:
      'Empieza cuando la app pide la instrucción de pago de una cuota no pagada. Termina cuando el aviso queda `verified` (se registra el pago en la cuota con el código del aviso como clave de idempotencia) o `rejected` con motivo; mientras tanto el aviso está `pending_verification` y no se admite otro para la misma cuota.',
    whenItFails:
      'Sin QR activo la instrucción devuelve `paymentQr: null` con el motivo; un crédito sin comercio responde 422 LOAN_WITHOUT_PARTNER antes de crear un aviso huérfano; un comprobante que no está en el almacén da 422 EVIDENCE_OBJECT_NOT_FOUND y la misma imagen dos veces choca con el índice único de evidencias. Si el comercio no mira su cola el aviso queda pendiente sin plazo ni alerta, y el portal interno no ve esa cola.',
    healthIndicator:
      'Avisos en `pending_verification` y su antigüedad por comercio, y proporción verificados frente a rechazados, leídos de `credit.loan_payment_claims`. Al 2026-09-14 había cero avisos en el servidor: ningún recorrido real verificado todavía, así que el primer indicador es que existan.',
  },
  instanceEntity: {
    system: 'ATLAS_BACKEND',
    schema: 'credit',
    table: 'loan_payment_claims',
    idColumn: '_id',
    statusColumn: 'status',
    labelColumn: 'claim_code',
    openStatuses: ['pending_verification'],
  },
  success: 'El comercio verifica el comprobante, el pago queda aplicado a la cuota y el cliente y el ERP reciben la confirmación.',
  failure:
    'El aviso se rechaza con motivo, no llega a crearse (sin comercio, sin comprobante) o queda pendiente sin que nadie lo verifique.',
  sources: [
    'src/modules/loan-payment-claims/mobile-payment-claims.controller.ts',
    'src/modules/loan-payment-claims/merchant-payment-claims.controller.ts',
    'src/modules/loan-payment-claims/loan-payment-claims.service.ts',
    'src/modules/loan-payment-claims/partner-payment-claims.service.ts',
    'src/modules/loan-payment-claims/payment-instruction.service.ts',
    'src/modules/loan-payment-claims/payment-claims.shared.ts',
    'src/database/migrations/20260825040000-create-loan-payment-claims.ts',
    'src/modules/notifications/notification-rules.service.ts',
    'AtlasERPBackend/src/modules/partner-onboarding-gateway/merchant-credit-gateway.controller.ts',
    'AtlasERPBackend/src/modules/b2b-sales-crm/controllers/core-events.controller.ts',
    'AtlasERPBackend/src/modules/b2b-sales-crm/integration/core-payment-events.service.ts',
    'AtlasERPFrontend/components/screens/MerchantPosScreen.tsx',
    'AtlasFrontend/apps/consumer-app/app/(app)/pagar/[installmentId].tsx',
    'memoria atlas-flujo-pago-qr-comprobante',
    '_plan-documentar-procesos-y-cableado-portal-2026-09-26/datos/procesos.json (P-09)',
  ],
  metadata: {
    inventoryStatesMismatch:
      'El inventario nombra submitted/under_review/verified/rejected; el CHECK de la tabla admite pending_verification, verified y rejected.',
  },
  stages: [
    {
      code: 'pay_instruction',
      name: 'Instrucción de pago de la cuota',
      description:
        'La app pide cómo pagar la cuota: importe, QR bancario ACTIVO de la empresa del comercio (embebido como imagen en la respuesta) y, si lo hay, el aviso ya abierto.',
      module: 'loan_payment_claims',
      actor: 'customer',
      client: 'CONSUMER_APP',
      screen: '/pagar/[installmentId]',
      entry: true,
      steps: [
        {
          code: 'pay.instruction',
          name: 'Leer la instrucción de pago',
          description:
            'Resuelve la cuota dentro de los préstamos del cliente, su comercio y el QR vivo. Sin QR no es un 404: devuelve `paymentQr: null` con el motivo.',
          method: 'GET',
          path: '/mobile/customers/:customerId/payment-claims/instructions/:installmentId',
          roles: CUSTOMER_ROLES,
          output: { paymentQr: 'object | null', paymentQrUnavailableReason: 'string | null', openClaim: 'object | null' },
          errors: ['403 otro cliente', '404 cuota no encontrada'],
        },
      ],
    },
    {
      code: 'pay_bank_transfer',
      name: 'Transferencia desde el banco del cliente',
      description: 'El cliente escanea el QR con la app de su banco y transfiere. Ocurre fuera de Atlas.',
      module: 'loan_payment_claims',
      actor: 'customer',
      client: 'CONSUMER_APP',
      steps: [
        {
          code: 'pay.bank_transfer',
          description:
            'El cliente escanea el QR del comercio con la app de su banco y transfiere el importe de la cuota a la cuenta del comercio. Atlas no participa en este movimiento de dinero.',
          name: 'Pagar con el QR en la app del banco',
          kind: 'manual',
          reason: 'El pago lo hace el cliente en su propio banco hacia la cuenta del comercio; Atlas no lo ve ni lo ejecuta.',
        },
      ],
    },
    {
      code: 'pay_claim_submission',
      name: 'Comprobante y aviso de pago',
      description:
        'El cliente sube la captura del comprobante y avisa. Esto NO salda nada: crea el aviso pendiente y lo publica hacia el comercio.',
      module: 'loan_payment_claims',
      actor: 'customer',
      client: 'CONSUMER_APP',
      screen: '/pagar/[installmentId]',
      resultingStates: ['pending_verification'],
      steps: [
        {
          code: 'pay.proof_ticket',
          name: 'Pedir el ticket de subida del comprobante',
          description: 'Devuelve una URL firmada del almacén. El tipo de archivo se comprueba contra la lista permitida.',
          method: 'POST',
          path: '/mobile/customers/:customerId/payment-claims/proof-tickets',
          roles: CUSTOMER_ROLES,
          input: { contentType: 'string', sizeBytes: 'number (≤ 15 MB)' },
          errors: ['422 EVIDENCE_CONTENT_TYPE_NOT_ALLOWED', '503 DOCUMENT_STORAGE_NOT_CONFIGURED'],
          successStatus: [200, 201],
        },
        {
          code: 'pay.proof_upload',
          description:
            'La app sube la captura del comprobante al almacén con la URL firmada del ticket. El aviso posterior sólo se acepta si este objeto existe de verdad.',
          name: 'Subir el comprobante al almacén',
          kind: 'external',
          reason: 'La app sube los bytes directamente al almacén de objetos con la URL firmada; no pasa por la API de Atlas.',
        },
        {
          code: 'pay.claim_submit',
          name: 'Avisar el pago',
          description:
            'Comprueba el objeto realmente almacenado, crea la evidencia y el aviso `pending_verification` y publica el evento en la misma transacción. Después cuelga el comprobante en el expediente del cliente.',
          method: 'POST',
          path: '/mobile/customers/:customerId/payment-claims',
          roles: CUSTOMER_ROLES,
          resultingStates: ['pending_verification'],
          input: {
            installmentId: 'string',
            amount: 'string (2 decimales)',
            payerReference: 'string?',
            storageKey: 'string',
            contentType: 'string',
          },
          errors: [
            '409 INSTALLMENT_ALREADY_PAID',
            '409 PAYMENT_CLAIM_ALREADY_PENDING',
            '422 EVIDENCE_OBJECT_NOT_FOUND',
            '422 LOAN_WITHOUT_PARTNER',
            '409 evidencia duplicada (mismo sha256)',
          ],
          events: ['payment.reported'],
          successStatus: [200, 201],
        },
      ],
    },
    {
      code: 'pay_notice_delivery',
      name: 'Entrega del aviso al comercio y al ERP',
      description:
        'El evento `payment.reported` sale por el outbox: el ERP lo recibe firmado para su cobertura y el consumidor de eventos genera el aviso en la bandeja.',
      module: 'events',
      actor: 'system',
      client: 'BLOCK',
      steps: [
        {
          code: 'pay.outbox_reported',
          description:
            'El despachador del outbox entrega el evento payment.reported, con la versión de la cuota, a quien concilia la cuota (el ERP) con reintentos.',
          name: 'Despachar el evento del aviso',
          kind: 'job',
          job: 'process_outbox',
          consumes: ['payment.reported'],
        },
        {
          code: 'pay.erp_receives_reported',
          name: 'El ERP registra el aviso',
          description:
            'Receptor firmado (HMAC) del ERP. Un aviso de Core es UN aviso del ERP; su estado sólo avanza de REPORTED a CONFIRMED o REJECTED.',
          system: 'ERP_BACKEND',
          method: 'POST',
          path: '/integration/core/events',
          auth: false,
          errors: ['400 sobre inválido', '422 payload o tópico'],
        },
        {
          code: 'pay.notify_reported',
          description:
            'El consumidor de eventos convierte payment.reported en un aviso en la bandeja de la app, para que el cliente sepa que su pago quedó en verificación.',
          name: 'Aviso en la bandeja del cliente',
          kind: 'job',
          job: 'process_events',
          consumes: ['payment.reported'],
        },
      ],
    },
    {
      code: 'pay_merchant_verification',
      name: 'Verificación del comercio',
      description:
        'La persona del comercio abre «Comprobantes por verificar», ve la imagen del comprobante, lo busca en su extracto y confirma o rechaza con motivo.',
      module: 'loan_payment_claims',
      actor: 'merchant_user',
      client: 'ERP_PORTAL',
      screen: '/portal-comercio/gestion-pos',
      roles: ERP_MERCHANT_ROLES,
      requiredStates: ['pending_verification'],
      resultingStates: ['verified', 'rejected'],
      steps: [
        {
          code: 'pay.erp_list_claims',
          name: 'Listar los comprobantes por verificar',
          system: 'ERP_BACKEND',
          method: 'GET',
          path: '/merchant-credit/:partnerId/payment-claims',
          roles: ERP_MERCHANT_ROLES,
          description: 'La pasarela del ERP pide la cola al núcleo de Atlas; por defecto sólo los pendientes.',
        },
        {
          code: 'pay.erp_proof',
          name: 'Ver el comprobante',
          system: 'ERP_BACKEND',
          method: 'GET',
          path: '/merchant-credit/:partnerId/payment-claims/:claimId/proof',
          roles: ERP_MERCHANT_ROLES,
          description: 'La imagen viaja como bytes y el portal la pinta por blob local: un <img src> no manda la credencial.',
        },
        {
          code: 'pay.erp_decide',
          description:
            'La persona del comercio confirma que el dinero llegó o lo rechaza con motivo. La pasarela del ERP reenvía la decisión al núcleo de Atlas, que es quien la aplica.',
          name: 'Confirmar o rechazar el comprobante',
          system: 'ERP_BACKEND',
          method: 'POST',
          path: '/merchant-credit/:partnerId/payment-claims/:claimId/verification',
          roles: ERP_MERCHANT_ROLES,
          input: { verified: 'boolean', reason: 'string (obligatorio al rechazar)' },
        },
      ],
    },
    {
      code: 'pay_core_decision',
      name: 'Atlas aplica la decisión del comercio',
      description:
        'Lo que el portal del comercio pide por la pasarela del ERP lo resuelve el núcleo: al confirmar registra el pago en la cuota y marca el aviso `verified`; al rechazar lo marca `rejected` con motivo.',
      module: 'loan_payment_claims',
      actor: 'system',
      client: 'BLOCK',
      parent: 'pay_merchant_verification',
      steps: [
        {
          code: 'pay.core_list_claims',
          description:
            'El núcleo devuelve los avisos de pago de ese comercio, por defecto sólo los pendientes. Es lo que la pasarela del ERP pinta como cola de comprobantes.',
          name: 'Cola de avisos del comercio',
          method: 'GET',
          path: '/merchant/partners/:partnerId/payment-claims',
          roles: MERCHANT_ROLES,
        },
        {
          code: 'pay.core_proof',
          description:
            'El núcleo sirve la imagen del comprobante como bytes, sólo al comercio al que llegó el aviso, para que pueda compararlo con su extracto.',
          name: 'Bytes del comprobante',
          method: 'GET',
          path: '/merchant/partners/:partnerId/payment-claims/:claimId/proof',
          roles: MERCHANT_ROLES,
          errors: ['403 el comprobante no llegó a este comercio', '404 PAYMENT_CLAIM_WITHOUT_PROOF', '404 EVIDENCE_OBJECT_NOT_FOUND'],
        },
        {
          code: 'pay.core_decide',
          name: 'Registrar la decisión y, si se confirma, el pago',
          description:
            'Con el préstamo bloqueado: confirmar registra un pago `bank_transfer` con el código del aviso como clave de idempotencia (verificar dos veces no cobra dos veces).',
          method: 'POST',
          path: '/merchant/partners/:partnerId/payment-claims/:claimId/verification',
          roles: MERCHANT_ROLES,
          requiredStates: ['pending_verification'],
          resultingStates: ['verified', 'rejected'],
          errors: [
            '404 PAYMENT_CLAIM_NOT_FOUND',
            '409 PAYMENT_CLAIM_NOT_PENDING',
            '409 LOAN_NOT_COLLECTABLE',
            '422 PAYMENT_EXCEEDS_OUTSTANDING',
          ],
          events: ['payment.confirmed', 'payment.rejected'],
        },
      ],
    },
    {
      code: 'pay_merchant_portfolio',
      name: 'Cartera del comercio',
      description: 'El comercio consulta sus créditos, cuotas y pagos, con los avisos pendientes contados.',
      module: 'loan_payment_claims',
      actor: 'merchant_user',
      client: 'ERP_PORTAL',
      screen: '/portal-comercio/cartera',
      optional: true,
      steps: [
        {
          code: 'pay.erp_portfolio',
          description:
            'El portal del comercio muestra sus créditos, cuotas y pagos por la pasarela del ERP, con los avisos pendientes contados.',
          name: 'Ver la cartera en el portal del comercio',
          system: 'ERP_BACKEND',
          method: 'GET',
          path: '/merchant-credit/:partnerId/portfolio',
          roles: ERP_MERCHANT_ROLES,
          optional: true,
        },
        {
          code: 'pay.core_portfolio',
          description:
            'El núcleo calcula la cartera del comercio: créditos activos, cuotas, pagos (incluidos los revertidos) y avisos pendientes de verificar.',
          name: 'Cartera calculada por el núcleo',
          method: 'GET',
          path: '/merchant/partners/:partnerId/payment-claims/portfolio',
          roles: MERCHANT_ROLES,
          optional: true,
        },
      ],
    },
    {
      code: 'pay_decision_delivery',
      name: 'La decisión llega al cliente y al ERP',
      description:
        '`payment.confirmed` o `payment.rejected` salen por el outbox con la versión de la cuota: el ERP concilia su cobertura y el cliente recibe el aviso por bandeja, push y correo.',
      module: 'events',
      actor: 'system',
      client: 'BLOCK',
      steps: [
        {
          code: 'pay.outbox_decision',
          description:
            'El despachador del outbox entrega payment.confirmed o payment.rejected con la versión de la cuota, para que un evento tardío no devuelva una cuota pagada a reportada.',
          name: 'Despachar el evento de la decisión',
          kind: 'job',
          job: 'process_outbox',
          consumes: ['payment.confirmed', 'payment.rejected'],
        },
        {
          code: 'pay.erp_receives_decision',
          name: 'El ERP concilia la cuota',
          description:
            'Con cobertura viva el ERP no confirma: deja el aviso REPORTED y abre LATE_PAYMENT_WITH_COVERAGE en su cola, para no pagar dos veces.',
          system: 'ERP_BACKEND',
          method: 'POST',
          path: '/integration/core/events',
          auth: false,
        },
        {
          code: 'pay.notify_decision',
          description: 'El consumidor de eventos avisa al cliente de la decisión del comercio por bandeja, push y correo.',
          name: 'Avisar al cliente',
          kind: 'job',
          job: 'process_events',
          consumes: ['payment.confirmed', 'payment.rejected'],
        },
      ],
    },
    {
      code: 'pay_customer_result',
      name: 'El cliente ve su cuota al día',
      description: 'En «Pagos» la cuota aparece pagada, o el aviso rechazado con el motivo del comercio para volver a intentarlo.',
      module: 'loans',
      actor: 'customer',
      client: 'CONSUMER_APP',
      screen: '/pagos',
      terminal: true,
      steps: [
        {
          code: 'pay.payment_calendar',
          description: 'La app lee el calendario de pagos y el cliente ve la cuota pagada, o el aviso rechazado para volver a intentarlo.',
          name: 'Leer el calendario de pagos',
          method: 'GET',
          path: '/customers/:customerId/payment-calendar',
          roles: ['customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin'],
        },
      ],
    },
    {
      code: 'pay_internal_oversight',
      name: 'Seguimiento interno de avisos',
      description:
        'Operaciones podría consultar la cola de avisos de un comercio (la ruta admite roles internos), pero el portal interno no tiene ninguna pantalla que lo haga: los avisos atascados o sin comercio no se ven.',
      module: 'loan_payment_claims',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      optional: true,
      roles: ['internal_operator', 'admin', 'platform_admin'],
      steps: [
        {
          code: 'pay.internal_list_claims',
          description:
            'Una persona interna podría leer la cola de avisos de un comercio, porque la ruta admite roles internos, pero ninguna pantalla del portal lo hace hoy.',
          name: 'Consultar la cola de un comercio',
          method: 'GET',
          path: '/merchant/partners/:partnerId/payment-claims',
          roles: MERCHANT_ROLES,
          optional: true,
        },
      ],
    },
  ],
  transitions: [
    {
      code: 'pay.entry',
      from: null,
      to: 'pay.instruction',
      condition: 'always',
      isDefault: true,
      description: 'El cliente abre «Pagar» en una cuota.',
    },
    {
      code: 'pay.instruction_to_transfer',
      from: 'pay.instruction',
      to: 'pay.bank_transfer',
      condition: 'conditional',
      expression: { paymentQr: 'not_null' },
      isDefault: true,
      description: 'Con QR activo el cliente transfiere desde su banco.',
    },
    {
      code: 'pay.no_qr_exit',
      from: 'pay.instruction',
      to: null,
      condition: 'conditional',
      expression: { paymentQr: null },
      description: 'Sin QR activo (o sin comercio) no hay a dónde pagar: la app explica el motivo.',
    },
    { code: 'pay.transfer_to_ticket', from: 'pay.bank_transfer', to: 'pay.proof_ticket', condition: 'on_success', isDefault: true },
    { code: 'pay.ticket_to_upload', from: 'pay.proof_ticket', to: 'pay.proof_upload', condition: 'on_success', isDefault: true },
    { code: 'pay.upload_to_submit', from: 'pay.proof_upload', to: 'pay.claim_submit', condition: 'on_success', isDefault: true },
    { code: 'pay.submit_to_outbox', from: 'pay.claim_submit', to: 'pay.outbox_reported', condition: 'on_success', isDefault: true },
    { code: 'pay.outbox_to_erp', from: 'pay.outbox_reported', to: 'pay.erp_receives_reported', condition: 'on_success', isDefault: true },
    { code: 'pay.erp_to_queue', from: 'pay.erp_receives_reported', to: 'pay.erp_list_claims', condition: 'on_success', isDefault: true },
    { code: 'pay.queue_to_proof', from: 'pay.erp_list_claims', to: 'pay.erp_proof', condition: 'on_success', isDefault: true },
    { code: 'pay.proof_to_decide', from: 'pay.erp_proof', to: 'pay.erp_decide', condition: 'on_success', isDefault: true },
    { code: 'pay.decide_to_core', from: 'pay.erp_decide', to: 'pay.core_decide', condition: 'always', isDefault: true },
    { code: 'pay.core_to_outbox', from: 'pay.core_decide', to: 'pay.outbox_decision', condition: 'on_success', isDefault: true },
    {
      code: 'pay.core_conflict',
      from: 'pay.core_decide',
      to: 'pay.erp_list_claims',
      condition: 'on_error',
      description: 'Aviso ya decidido o cuota no cobrable: el comercio vuelve a su cola.',
    },
    {
      code: 'pay.outbox_to_erp_decision',
      from: 'pay.outbox_decision',
      to: 'pay.erp_receives_decision',
      condition: 'on_success',
      isDefault: true,
    },
    { code: 'pay.outbox_to_notify', from: 'pay.outbox_decision', to: 'pay.notify_decision', condition: 'on_success' },
    { code: 'pay.notify_to_calendar', from: 'pay.notify_decision', to: 'pay.payment_calendar', condition: 'on_success', isDefault: true },
    {
      code: 'pay.rejected_retry',
      from: 'pay.payment_calendar',
      to: 'pay.instruction',
      condition: 'conditional',
      expression: { claimStatus: 'rejected' },
      description: 'Rechazado con motivo: el cliente puede volver a avisar con otro comprobante.',
    },
    { code: 'pay.exit', from: 'pay.payment_calendar', to: null, condition: 'always', isDefault: true },
  ],
  dependencies: [
    {
      step: 'pay.claim_submit',
      dependsOn: 'pay.proof_ticket',
      type: 'requires_data',
      description: 'El `storageKey` del aviso lo da el ticket.',
    },
    {
      step: 'pay.claim_submit',
      dependsOn: 'pay.proof_upload',
      type: 'requires_completion',
      description: 'El servidor lee el objeto real antes de crear el aviso.',
    },
    {
      step: 'pay.core_decide',
      dependsOn: 'pay.claim_submit',
      type: 'requires_completion',
      description: 'Sólo se decide sobre un aviso pendiente.',
    },
    {
      step: 'pay.erp_decide',
      dependsOn: 'pay.erp_proof',
      type: 'soft',
      description: 'Decidir sin mirar el comprobante es posible, pero no es verificar.',
    },
  ],
};
