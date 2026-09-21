/**
 * @file Contratos de la siembra demostrativa del repositorio.
 * @business Esta pieza documenta el recorrido donde el cliente y el comercio se encuentran.
 * @system define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import type { FlujoDeclarado } from './workflow-catalog-flujos.js';

/**
 * Cliente y comercio, el recorrido que los cruza: 13 etapas, 51 endpoints reales.
 *
 * ## Por qué faltaba entero
 *
 * El catálogo documentaba tres flujos y los tres eran del cliente solo. El comercio no aparecía en
 * ninguno —ni su alta, ni su KYB, ni sus sucursales, ni sus QR, ni sus usuarios— y tampoco el punto
 * donde los dos se encuentran, que es donde el producto gana o pierde dinero: el cliente escanea un
 * QR en la caja, pide crédito ahí mismo, el comercio acepta, y después alguien tiene que verificar
 * que el pago entró.
 *
 * `partner-onboarding` expone 20 rutas, `merchant` otras 17 y `operations/partners` otras 8. Nada
 * de eso estaba en el catálogo, así que ni el tablero de flujos del portal ni un motor de QA podían
 * saber que existía.
 *
 * ## Los TRES actores, que es lo que hace distinto a este flujo
 *
 * Aquí no hay un actor con un token: hay tres, y cada uno tiene el suyo.
 *
 * - El **comercio** (`merchant_user`) se da de alta, arma su red y acepta la compra.
 * - El **operador de Atlas** (`internal_user`) revisa el KYB, aprueba los QR y decide el alta.
 * - El **cliente** (`customer`) escanea, pide y paga.
 *
 * Un recorrido que usara el mismo token para los tres pasaría en verde habiendo comprobado una sola
 * autorización. Las etapas de aquí abajo declaran su actor por separado por ese motivo.
 *
 * ## Lo que NO afirma
 *
 * Que exista un ciclo de pago completo con contabilidad. Lo que hay es: aviso de pago del cliente,
 * comprobante, verificación del comercio y cartera. Desembolso, conciliación y asientos contables
 * no están en estas rutas, y por eso no se documentan como si estuvieran.
 */
export const FLUJO_CLIENTE_PARTNER: FlujoDeclarado = {
  code: 'customer_partner_commerce',
  version: 'v1',
  name: 'Cliente y comercio: del alta del partner a la compra verificada',
  description:
    'El recorrido completo del comercio y su cruce con el cliente: alta del partner, representante legal, registro ' +
    'comercial, verificación de contacto, sucursales y terminales, emisión de QR, envío a revisión, KYB y decisión ' +
    'del operador, alta de usuarios del comercio, resolución del QR en la caja, solicitud de crédito en el punto de ' +
    'venta, aceptación por el comercio, aviso de pago con comprobante, verificación y cartera, y soporte del comercio.',
  processType: 'partner_journey',
  ownerDomain: 'partner_onboarding',
  success:
    'El comercio queda activo con sus QR aprobados y sus usuarios operando, y una compra del cliente llega a ' +
    'aceptada con su pago verificado.',
  failure:
    'El KYB rechaza o bloquea al comercio, sus QR no se aprueban, la solicitud del cliente en la caja se rechaza, ' +
    'o el pago avisado no se verifica.',
  metadata: {
    audience: 'portal_comercio + app_movil',
    maintainer: 'partner_onboarding',
    actores: ['merchant_user', 'internal_user', 'customer'],
    inventarioDeRutas: 'derivado de la app corriendo el 21-sep-2026',
  },
  stages: [
    {
      code: 'partner_signup',
      name: 'Alta del comercio',
      description: 'El comercio se registra y abre su expediente.',
      module: 'partner_onboarding',
      actor: 'merchant_user',
      entry: true,
      steps: [
        {
          code: 'partner.start',
          name: 'Iniciar el alta del comercio',
          description: 'Crea el partner y su flujo de onboarding. Devuelve el partnerId que usan todos los pasos siguientes.',
          method: 'POST',
          path: '/partner-onboarding/start',
          auth: false,
          idempotencyKey: true,
          resultingStates: ['registered'],
          errors: ['409 PARTNER_ALREADY_EXISTS', '422 VALIDATION_ERROR'],
          events: ['partner.registered'],
          successStatus: [200, 201],
        },
        {
          code: 'partner.mine',
          name: 'Mi comercio',
          description: 'El expediente del comercio del usuario autenticado. Es la pantalla de inicio del portal del comercio.',
          method: 'GET',
          path: '/partner-onboarding/mine',
        },
        {
          code: 'partner.status',
          name: 'Estado del alta',
          description: 'Dónde va el expediente del comercio y qué le falta.',
          method: 'GET',
          path: '/partner-onboarding/:partnerId/status',
          repeatable: true,
        },
      ],
    },
    {
      code: 'partner_identity',
      name: 'Identidad del negocio',
      description: 'Quién responde por el comercio y con qué papeles. Es el bloque que sostiene el KYB.',
      module: 'partner_onboarding',
      actor: 'merchant_user',
      steps: [
        {
          code: 'partner.documents_upload_url',
          name: 'URL firmada para documentos',
          description: 'Los documentos no pasan por la API: se suben con una URL de un solo uso.',
          method: 'POST',
          path: '/partner-onboarding/:partnerId/documents/upload-url',
          successStatus: [200, 201],
        },
        {
          code: 'partner.legal_representative',
          name: 'Representante legal',
          description: 'La persona natural que responde por el comercio, con su documento.',
          method: 'POST',
          path: '/partner-onboarding/:partnerId/legal-representative',
          successStatus: [200, 201],
        },
        {
          code: 'partner.commercial_registry',
          name: 'Registro comercial',
          description: 'NIT, matrícula y su respaldo documental. Es lo que el KYB verifica.',
          method: 'POST',
          path: '/partner-onboarding/:partnerId/commercial-registry',
          successStatus: [200, 201],
        },
        {
          code: 'partner.commercial_profile',
          name: 'Perfil comercial',
          description: 'Rubro, tamaño y volumen declarado. Entra en la evaluación de riesgo del comercio.',
          method: 'PATCH',
          path: '/partner-onboarding/:partnerId/commercial-profile',
        },
      ],
    },
    {
      code: 'partner_contact',
      name: 'Verificación de contacto del comercio',
      description: 'Mismo mecanismo que el del cliente, sobre el contacto del comercio.',
      module: 'partner_onboarding',
      actor: 'merchant_user',
      steps: [
        {
          code: 'partner.contact_request',
          name: 'Pedir el código',
          description: 'Emite el código de un solo uso al contacto declarado.',
          method: 'POST',
          path: '/partner-onboarding/:partnerId/contact-verification/request',
          errors: ['409 VERIFICATION_RATE_LIMITED'],
          successStatus: [200, 201, 202],
        },
        {
          code: 'partner.contact_submit',
          name: 'Confirmar el código',
          description: 'Marca el contacto del comercio como verificado.',
          method: 'POST',
          path: '/partner-onboarding/:partnerId/contact-verification/submit',
          errors: ['400 INVALID_CODE', '410 CODE_EXPIRED'],
          successStatus: [200, 201],
        },
      ],
    },
    {
      code: 'partner_network',
      name: 'Sucursales y terminales',
      description: 'La red física del comercio: dónde cobra y con qué.',
      module: 'partner_onboarding',
      actor: 'merchant_user',
      steps: [
        {
          code: 'partner.branch_create',
          name: 'Crear sucursal',
          description: 'Un punto físico con su dirección. Un comercio puede tener varios.',
          method: 'POST',
          path: '/partner-onboarding/:partnerId/branches',
          repeatable: true,
          successStatus: [200, 201],
        },
        {
          code: 'partner.branches',
          name: 'Sucursales del comercio',
          description: 'La red declarada hasta ahora.',
          method: 'GET',
          path: '/partner-onboarding/:partnerId/branches',
        },
        {
          code: 'partner.branch_update',
          name: 'Corregir sucursal',
          description: 'Ajusta datos de una sucursal ya declarada.',
          method: 'PATCH',
          path: '/partner-onboarding/:partnerId/branches/:branchId',
          optional: true,
        },
        {
          code: 'partner.pos_create',
          name: 'Alta de terminal de venta',
          description: 'La caja concreta que va a cobrar. El QR cuelga de aquí.',
          method: 'POST',
          path: '/partner-onboarding/:partnerId/branches/:branchId/pos-terminals',
          repeatable: true,
          successStatus: [200, 201],
        },
        {
          code: 'partner.pos_list',
          name: 'Terminales del comercio',
          description: 'Todas las cajas, con su sucursal y su estado.',
          method: 'GET',
          path: '/partner-onboarding/:partnerId/pos-terminals',
        },
        {
          code: 'partner.pos_update',
          name: 'Cambiar estado de una terminal',
          description: 'Habilita o deshabilita una caja sin borrarla: su historia de cobros sigue existiendo.',
          method: 'PATCH',
          path: '/partner-onboarding/:partnerId/pos-terminals/:terminalId',
          optional: true,
        },
      ],
    },
    {
      code: 'partner_qr',
      name: 'Códigos QR de cobro',
      description: 'El instrumento con el que el cliente llega. Cada QR se revisa antes de servir.',
      module: 'merchant_identity',
      actor: 'merchant_user',
      steps: [
        {
          code: 'partner.qr_upload_url',
          name: 'URL firmada para la imagen del QR',
          description: 'El comercio sube la imagen de su QR bancario por URL de un solo uso.',
          method: 'POST',
          path: '/partner-onboarding/:partnerId/qr-codes/upload-url',
          successStatus: [200, 201],
        },
        {
          code: 'partner.qr_create',
          name: 'Declarar un QR',
          description: 'Registra el QR contra una terminal. Queda PENDIENTE de revisión, no operativo.',
          method: 'POST',
          path: '/partner-onboarding/:partnerId/qr-codes',
          repeatable: true,
          resultingStates: ['qr_pending_review'],
          events: ['partner.qr.submitted'],
          successStatus: [200, 201],
        },
        {
          code: 'partner.qr_list',
          name: 'QR del comercio',
          description: 'Los QR declarados con su estado de revisión.',
          method: 'GET',
          path: '/partner-onboarding/:partnerId/qr-codes',
        },
        {
          code: 'partner.qr_content',
          name: 'Contenido del QR',
          description: 'La imagen guardada, por lectura autorizada. No es un enlace público.',
          method: 'GET',
          path: '/partner-onboarding/:partnerId/qr-codes/:qrId/content',
          optional: true,
        },
      ],
    },
    {
      code: 'partner_submission',
      name: 'Envío a revisión',
      description: 'El comercio da por completo su expediente.',
      module: 'partner_onboarding',
      actor: 'merchant_user',
      steps: [
        {
          code: 'partner.submit',
          name: 'Enviar el expediente del comercio',
          description: 'Cierra la captura y encola el KYB. Rechaza si faltan piezas obligatorias.',
          method: 'POST',
          path: '/partner-onboarding/:partnerId/submit',
          idempotencyKey: true,
          resultingStates: ['under_review'],
          errors: ['409 PARTNER_ONBOARDING_INCOMPLETE'],
          events: ['partner.onboarding.submitted'],
          successStatus: [200, 201, 202],
        },
      ],
    },
    {
      code: 'partner_review',
      name: 'KYB y decisión del operador',
      description: 'Atlas revisa al comercio. Actor distinto, token distinto, autorización distinta.',
      module: 'operations',
      actor: 'internal_user',
      roles: ['internal_operator', 'compliance_analyst', 'risk_analyst', 'admin'],
      steps: [
        {
          code: 'partner.queue',
          name: 'Cola de comercios por revisar',
          description: 'Lo que el operador tiene pendiente, con su antigüedad.',
          method: 'GET',
          path: '/operations/partners/queue',
        },
        {
          code: 'partner.kyb_review',
          name: 'Revisión KYB',
          description: 'Comprueba el registro comercial y al representante. Puede pedir corrección sin rechazar.',
          method: 'POST',
          path: '/operations/partners/:partnerId/kyb-review',
          successStatus: [200, 201],
        },
        {
          code: 'partner.qr_pending',
          name: 'QR pendientes de aprobación',
          description: 'Los QR que esperan revisión, de todos los comercios.',
          method: 'GET',
          path: '/operations/partners/qr-codes/pending',
        },
        {
          code: 'partner.qr_review',
          name: 'Aprobar o rechazar un QR',
          description:
            'Un QR aprobado pasa a resolver en la caja. Sin esta aprobación, `merchant-qr/resolve` no puede devolver ese comercio.',
          method: 'POST',
          path: '/operations/partners/:partnerId/qr-codes/:qrId/review',
          resultingStates: ['qr_approved', 'qr_rejected'],
          events: ['partner.qr.reviewed'],
          successStatus: [200, 201],
        },
        {
          code: 'partner.decision',
          name: 'Decidir el alta del comercio',
          description: 'Activa, observa o rechaza al comercio. Es lo que mueve su estado.',
          method: 'POST',
          path: '/operations/partners/:partnerId/decision',
          resultingStates: ['active', 'observed', 'rejected'],
          events: ['partner.decided'],
          successStatus: [200, 201],
        },
        {
          code: 'partner.erp_account',
          name: 'Vincular cuenta ERP',
          description: 'Ata al comercio con su cuenta contable. Sin ella no hay a quién liquidar.',
          method: 'PATCH',
          path: '/operations/partners/:partnerId/erp-account',
          optional: true,
        },
      ],
    },
    {
      code: 'merchant_users',
      name: 'Usuarios del comercio',
      description: 'Quién opera la caja. El comercio pide el alta y Atlas la aprueba.',
      module: 'merchant_identity',
      actor: 'merchant_user',
      steps: [
        {
          code: 'merchant.provisioning_request',
          name: 'Pedir alta de un usuario',
          description: 'El comercio solicita una cuenta para una persona de su equipo. No la crea por su cuenta.',
          method: 'POST',
          path: '/merchant/users/provisioning-requests',
          successStatus: [200, 201],
        },
        {
          code: 'merchant.provisioning_list',
          name: 'Solicitudes de alta',
          description: 'Las que el comercio pidió y en qué estado están.',
          method: 'GET',
          path: '/merchant/users/provisioning-requests',
        },
        {
          code: 'merchant.provisioning_approve',
          name: 'Aprobar el alta',
          description: 'Un operador autorizado crea la cuenta. Es el paso que impide que un comercio se dé usuarios solo.',
          method: 'POST',
          path: '/merchant/users/provisioning-requests/:requestId/approve',
          roles: ['internal_operator', 'admin', 'platform_admin'],
          successStatus: [200, 201],
        },
        {
          code: 'merchant.login',
          name: 'Login del usuario del comercio',
          description: 'Entrada al portal del comercio. Actor `merchant_user`, no `customer` ni `internal_user`.',
          method: 'POST',
          path: '/merchant/auth/login',
          auth: false,
          input: { actorType: 'merchant_user', identifier: 'correo del usuario del comercio', password: 'string' },
          errors: ['401 INVALID_CREDENTIALS', '429 RATE_LIMIT_EXCEEDED'],
          successStatus: [200, 201],
        },
        {
          code: 'merchant.me',
          name: 'Identidad del usuario del comercio',
          description: 'A qué comercio pertenece el portador del token. Delata un token cruzado entre comercios.',
          method: 'GET',
          path: '/merchant/auth/me',
        },
        {
          code: 'merchant.users',
          name: 'Usuarios activos del comercio',
          description: 'Quiénes pueden operar hoy.',
          method: 'GET',
          path: '/merchant/users',
        },
        {
          code: 'merchant.user_status',
          name: 'Habilitar o suspender un usuario',
          description: 'Corta el acceso de una persona sin borrar su historia de operaciones.',
          method: 'PATCH',
          path: '/merchant/users/:merchantUserId/status',
          optional: true,
        },
      ],
    },
    {
      code: 'point_of_sale',
      name: 'El encuentro en la caja',
      description:
        'Aquí se cruzan los dos recorridos: el CLIENTE escanea el QR del COMERCIO. Es el único paso que ejecuta un actor distinto al de su etapa anterior.',
      module: 'merchant_identity',
      actor: 'customer',
      steps: [
        {
          code: 'pos.qr_resolve',
          name: 'Resolver el QR escaneado',
          description:
            'Traduce el QR a comercio, sucursal y terminal. Un QR sin aprobar no resuelve: es lo que impide cobrar con un QR no revisado.',
          method: 'POST',
          path: '/merchant-qr/resolve',
          roles: ['customer'],
          output: { partnerId: 'string', branchId: 'string', terminalId: 'string', partnerName: 'string' },
          errors: ['404 QR_NOT_FOUND', '409 QR_NOT_APPROVED'],
          successStatus: [200, 201],
        },
      ],
    },
    {
      code: 'pos_credit',
      name: 'Crédito en el punto de venta',
      description: 'El cliente pide en la caja y el comercio acepta. Dos actores, dos autorizaciones.',
      module: 'credit',
      actor: 'customer',
      steps: [
        {
          code: 'pos.credit_products',
          name: 'Productos disponibles en la caja',
          description: 'Qué puede pedir ESTE cliente. Si no es elegible, el catálogo trae sus bloqueadores.',
          method: 'GET',
          path: '/customers/:customerId/credit-products',
          roles: ['customer'],
        },
        {
          code: 'pos.credit_apply',
          name: 'Solicitar el crédito de la compra',
          description:
            'La solicitud del cliente asociada al comercio donde está comprando. Un rechazo por no elegible es el comportamiento correcto.',
          method: 'POST',
          path: '/customers/:customerId/credit-applications',
          roles: ['customer'],
          idempotencyKey: true,
          errors: ['403 NOT_ELIGIBLE', '409 APPLICATION_ALREADY_OPEN'],
          events: ['credit.application.created'],
          successStatus: [200, 201],
        },
        {
          code: 'pos.partner_applications',
          name: 'Solicitudes que llegan al comercio',
          description: 'Lo que el comercio ve en su pantalla: las solicitudes hechas en SUS cajas, no las de otro comercio.',
          method: 'GET',
          path: '/merchant/partners/:partnerId/credit-applications',
          roles: ['merchant_user'],
        },
        {
          code: 'pos.partner_acceptance',
          name: 'El comercio acepta la compra',
          description:
            'El comercio confirma que entrega contra ese crédito. Es lo que cierra la venta, y es del comercio: el cliente no puede aceptarse a sí mismo.',
          method: 'POST',
          path: '/merchant/partners/:partnerId/credit-applications/:applicationId/acceptance',
          roles: ['merchant_user'],
          idempotencyKey: true,
          events: ['credit.application.accepted_by_partner'],
          successStatus: [200, 201],
        },
        {
          code: 'pos.business_acceptance',
          name: 'Aceptación comercial en operaciones',
          description: 'La contraparte interna de la aceptación, para las operaciones que la requieren.',
          method: 'POST',
          path: '/operations/credit/applications/:applicationId/business-acceptance',
          roles: ['internal_operator', 'admin'],
          optional: true,
          successStatus: [200, 201],
        },
      ],
    },
    {
      code: 'payment_settlement',
      name: 'Aviso de pago y verificación',
      description:
        'El cliente avisa, el comercio verifica. Avisar no es pagar: el estado sólo cambia cuando el otro lado lo confirma contra el comprobante.',
      module: 'loan_payment_claims',
      actor: 'customer',
      steps: [
        {
          code: 'settlement.claim',
          name: 'El cliente avisa el pago',
          description: 'Declara el pago de su cuota con la referencia de la transferencia.',
          method: 'POST',
          path: '/mobile/customers/:customerId/payment-claims',
          roles: ['customer'],
          idempotencyKey: true,
          events: ['payment.claim.created'],
          successStatus: [200, 201],
        },
        {
          code: 'settlement.proof',
          name: 'Comprobante del pago',
          description: 'La imagen que el verificador va a mirar.',
          method: 'POST',
          path: '/mobile/customers/:customerId/payment-claims/proof-tickets',
          roles: ['customer'],
          successStatus: [200, 201],
        },
        {
          code: 'settlement.partner_claims',
          name: 'Avisos que llegan al comercio',
          description: 'Los pagos declarados contra ESTE comercio, pendientes de verificar.',
          method: 'GET',
          path: '/merchant/partners/:partnerId/payment-claims',
          roles: ['merchant_user'],
        },
        {
          code: 'settlement.partner_proof',
          name: 'Ver el comprobante',
          description: 'Lectura autorizada del comprobante. No es un enlace público ni compartible.',
          method: 'GET',
          path: '/merchant/partners/:partnerId/payment-claims/:claimId/proof',
          roles: ['merchant_user'],
        },
        {
          code: 'settlement.partner_verification',
          name: 'El comercio verifica el pago',
          description:
            'Confirma o rechaza que el pago entró. Un rechazo con motivo es un resultado válido del proceso, no un fallo del sistema.',
          method: 'POST',
          path: '/merchant/partners/:partnerId/payment-claims/:claimId/verification',
          roles: ['merchant_user'],
          idempotencyKey: true,
          events: ['payment.claim.verified'],
          successStatus: [200, 201],
        },
      ],
    },
    {
      code: 'partner_portfolio',
      name: 'Cartera del comercio',
      description: 'Lo que el comercio tiene por cobrar y lo que ya cobró.',
      module: 'loan_payment_claims',
      actor: 'merchant_user',
      optional: true,
      steps: [
        {
          code: 'portfolio.summary',
          name: 'Cartera de avisos de pago',
          description: 'Resumen por estado y antigüedad. Es la pantalla con la que el comercio cierra su día.',
          method: 'GET',
          path: '/merchant/partners/:partnerId/payment-claims/portfolio',
          optional: true,
        },
      ],
    },
    {
      code: 'partner_support',
      name: 'Soporte del comercio',
      description: 'Cómo el comercio pide ayuda y cómo se cierra el caso.',
      module: 'support',
      actor: 'merchant_user',
      terminal: true,
      optional: true,
      steps: [
        {
          code: 'support.faq',
          name: 'Preguntas frecuentes',
          description: 'Lo que resuelve sin abrir un caso.',
          method: 'GET',
          path: '/merchant/support/faq',
          optional: true,
        },
        {
          code: 'support.categories',
          name: 'Categorías de caso',
          description: 'El catálogo válido. Evita que el comercio invente una categoría.',
          method: 'GET',
          path: '/merchant/support/categories',
          optional: true,
        },
        {
          code: 'support.case_create',
          name: 'Abrir un caso',
          description: 'Crea el caso con su categoría y arranca su reloj de SLA.',
          method: 'POST',
          path: '/merchant/support/cases',
          optional: true,
          events: ['support.case.created'],
          successStatus: [200, 201],
        },
        {
          code: 'support.case_detail',
          name: 'Seguimiento del caso',
          description: 'Estado, mensajes y plazos del caso.',
          method: 'GET',
          path: '/merchant/support/cases/:caseId',
          optional: true,
        },
        {
          code: 'support.case_close_request',
          name: 'Pedir el cierre',
          description: 'El comercio dice que ya está resuelto. Cerrar sigue siendo de soporte.',
          method: 'POST',
          path: '/merchant/support/cases/:caseId/close-request',
          optional: true,
          successStatus: [200, 201],
        },
        {
          code: 'support.case_feedback',
          name: 'Valorar la atención',
          description: 'Cierra el circuito con la opinión del comercio.',
          method: 'POST',
          path: '/merchant/support/cases/:caseId/feedback',
          optional: true,
          successStatus: [200, 201],
        },
      ],
    },
  ],
};
