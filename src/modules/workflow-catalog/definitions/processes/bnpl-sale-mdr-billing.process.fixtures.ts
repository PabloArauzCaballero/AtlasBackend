/**
 * @file Proceso declarado en código: Venta BNPL, comisión MDR, consumo y facturación del comercio (incl. SIAT).
 * @business Cada venta a plazos en un comercio le genera a Atlas una comisión que hay que calcular con la regla pactada, facturar con número propio y cobrar; este proceso lleva esa comisión de la venta a la factura descargable, y deja dicho que la factura fiscal del SIAT todavía no existe.
 * @system fixture que `syncWorkflowCatalog` vuelca a `workflow_*`; rutas del ERP (`b2b/bnpl`, `b2b/billing`, `portal/*`, `merchant-credit`, `integration/core/events`) y la cartera de cobros de AtlasBackend (`merchant/partners/:partnerId/payment-claims/portfolio`).
 */
import type { WorkflowDefinitionFixture } from '../workflow-definition.types.js';

/** `@Roles` de las pantallas del portal del comercio en el ERP (`PORTAL_ROLES`). */
const PORTAL_ROLES = ['ADMIN', 'COMMERCIAL_MANAGER', 'COMMERCIAL_EXECUTIVE', 'MERCHANT_ADMIN'];
/** `@Roles` de la pasarela `merchant-credit` del ERP. */
const MERCHANT_CREDIT = ['merchant', 'MERCHANT_ADMIN', 'MERCHANT_OPERATIONS', 'OPERATIONS', 'ADMIN'];
/** `@Roles` de `merchant-payment-claims.controller.ts` de AtlasBackend. */
const CORE_MERCHANT_CLAIMS = ['merchant', 'internal_operator', 'admin', 'platform_admin'];
/** `@Roles` de escritura de facturación del ERP. */
const FINANCE = ['FINANCE', 'ADMIN'];

export const BNPL_SALE_MDR_BILLING: WorkflowDefinitionFixture = {
  processId: 'P-20',
  code: 'bnpl_sale_mdr_billing',
  version: 'v1',
  name: 'Venta BNPL, comisión MDR, consumo y facturación del comercio (incl. SIAT)',
  description:
    'Una venta a plazos registrada en un comercio activo calcula su comisión (MDR) con la regla del contrato vigente y la banda de riesgo que decidió Core, y deja una cuenta por cobrar al comercio. Finanzas agrupa esas cuentas en una factura con número propio, registra el pago del comercio y la lleva al mayor; el comercio ve cobros, cargos y facturas en «Consumo y facturación». La factura electrónica del SIAT no está integrada.',
  processType: 'back_office',
  ownerDomain: 'merchant_billing',
  ownerRole: 'ERP:FINANCE',
  priority: 'P1',
  systems: ['ERP_BACKEND', 'ATLAS_BACKEND'],
  narrative: {
    whyExists:
      'La comisión por venta es el ingreso que Atlas cobra al comercio. Tiene que calcularse con la regla pactada en el contrato vigente y no con lo que el comercio declare, facturarse con una serie sin huecos ni repetidos, y quedar visible para el comercio junto a lo que ya cobró, sin mezclar dos libros que no se hablan (los cobros viven en Atlas y los cargos en el ERP).',
    whoStartsAndCloses:
      'Lo inicia la venta a plazos: hoy la registra Operaciones del ERP (o el comercio con rol MERCHANT_ADMIN) desde «Cobertura y conciliación»; la banda de riesgo llega sola de Core. Finanzas del ERP (FINANCE) emite la factura, registra el pago del comercio y la contabiliza; el comercio la consulta y descarga desde «Consumo y facturación».',
    startAndEnd:
      'Empieza con la compra registrada (POST /b2b/bnpl/purchases), que exige cuenta CUSTOMER, sucursal activa que pueda originar y contrato vigente, y deja la cuenta por cobrar de tipo MDR. Termina con la factura FAC-CM-AAAA-NNNNNN emitida (ISSUED), pagada (PAID) y contabilizada; la factura fiscal del SIAT con CUF queda fuera hasta que se integre.',
    whenItFails:
      'Un comercio que no está en CUSTOMER responde 403, una sucursal que no puede originar 403, y sin versión contractual activa para la fecha 409; la entrada que no sea el 60 % se rechaza. Sin banda de riesgo conocida la compra sigue sin banda, no se bloquea. Una comisión creada sobre el id del contrato en vez del de la versión nunca se aplicó. El PDF avisa de que es representación interna mientras no haya documento SIAT aceptado.',
    healthIndicator:
      'Compras sin cuenta por cobrar MDR (lo detecta la conciliación), cuentas por cobrar MDR abiertas y vencidas por comercio, facturas en DRAFT sin contabilizar, y la diferencia entre la comisión devengada por cuotas y la calculada sobre pagos que «Consumo y facturación» enseña en vez de taparla.',
  },
  instanceEntity: {
    system: 'ERP_BACKEND',
    schema: 'atlas_sales',
    table: 'merchant_invoices',
    idColumn: 'id',
    statusColumn: 'status',
    labelColumn: 'invoice_number',
    openStatuses: ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE'],
  },
  success: 'La comisión de cada venta queda facturada con número de serie, pagada, contabilizada y visible para el comercio.',
  failure:
    'La venta no se registra (comercio, sucursal o contrato no habilitados), la comisión no se calcula o la factura queda sin pagar o sin contabilizar.',
  sources: [
    'AtlasERPBackend/docs/architecture/flows.md (Venta BNPL y MDR, Facturación y cobro B2B)',
    'AtlasERPBackend/src/modules/b2b-sales-crm/services/b2b-bnpl-billing.service.ts',
    'AtlasERPBackend/src/modules/b2b-sales-crm/integration/core-credit-events.service.ts',
    'AtlasERPBackend/src/modules/b2b-sales-crm/controllers/billing.controller.ts',
    'AtlasERPBackend/src/modules/b2b-sales-crm/controllers/bnpl.controller.ts',
    'AtlasERPBackend/src/modules/portal/portal.service.ts (listCommissions)',
    'AtlasERPBackend/src/common/numbering/document-numbering.ts',
    'src/modules/loan-payment-claims/merchant-payment-claims.controller.ts (portfolio)',
    'src/modules/runtime-jobs/optional-jobs.catalog.ts (deliver_erp_events)',
    'AtlasERPFrontend/app/operaciones/crm/facturacion/page.tsx',
    'AtlasERPFrontend/app/operaciones/crm/conciliacion-cobertura/page.tsx (registrar compra a plazos)',
    'AtlasERPFrontend/components/screens/MerchantBillingScreen.tsx',
    '_plan-facturacion-siat-2026-09-26/PLAN.md',
    'memoria atlas-erp-consumo-facturacion',
    'memoria atlas-facturacion-numeracion-descarga',
    'memoria atlas-erp-uuid-de-otra-entidad',
  ],
  metadata: {
    gaps: [
      'El portal admin no observa la facturación de comercios (ni debería operarla): falta decidir si la observa.',
      'La comisión MDR nunca se pudo pactar desde el ERP hasta que el listado de contratos devolvió currentVersionId (la pantalla mandaba el id del contrato).',
      'SIAT: nada integrado; merchant_invoices no guarda NIT, razón social ni emisor, y la tabla electronic_tax_document sólo cubre la factura AR contable. Decisiones D-1..D-8 del plan del 2026-09-26 abiertas.',
      'La venta BNPL del ERP no nace del desembolso de Core: sólo la registra una persona (POST /b2b/bnpl/purchases); no hay otro llamador.',
      'Nada periódico agrupa las cuentas por cobrar en facturas: Finanzas las elige a mano. La factura de comercio nace sin asiento; contabilizarla es un paso manual.',
      'Expediente de Atlas y cuenta B2B del ERP no están enlazados en «Consumo y facturación»: un usuario con dos expedientes puede ver cobros de uno junto a cargos de otro.',
    ],
  },
  stages: [
    {
      code: 'mdr_risk_band',
      name: 'Core informa la banda de riesgo del cliente',
      description:
        'Al decidir un crédito, Core publica credit.decision.recorded y lo entrega firmado al ERP, que guarda la banda del cliente. Así la regla MDR por banda la decide Core y no el comercio.',
      module: 'erp_integration',
      actor: 'system',
      client: 'BLOCK',
      entry: true,
      steps: [
        {
          code: 'mdr.core_deliver_decision',
          name: 'Entregar la decisión de crédito al ERP',
          kind: 'event',
          reason:
            'Lo entrega el job deliver_erp_events del catálogo de jobs opcionales de AtlasBackend, que sólo existe con ERP_EVENTS_DELIVERY_URL y su secreto configurados.',
          description: 'Sin receptor configurado las entregas quedan pending en outbound_event_deliveries.',
        },
        {
          code: 'mdr.erp_receive_decision',
          name: 'Guardar la banda de riesgo del cliente',
          description:
            'Receptor firmado (HMAC, ventana de 300 s). UPSERT condicional por decidedAt en atlas_sales.customer_risk_tiers: un evento viejo no retrocede la banda.',
          system: 'ERP_BACKEND',
          method: 'POST',
          path: '/integration/core/events',
          auth: false,
          consumes: ['credit.decision.recorded'],
          errors: ['400 sobre inválido', '422 payload o tópico', '401 firma'],
        },
      ],
    },
    {
      code: 'mdr_register_sale',
      name: 'Se registra la venta a plazos',
      description:
        '«Registrar compra a plazos» en Cobertura y conciliación: la entrada es el 60 % y se paga en el momento; el 40 % se reparte en cuotas. La compra guarda la versión contractual vigente y su comisión.',
      module: 'b2b_sales_crm',
      actor: 'internal_user',
      client: 'ERP_PORTAL',
      screen: '/operaciones/crm/conciliacion-cobertura',
      link: '{ERP}/operaciones/crm/conciliacion-cobertura',
      roles: ['MERCHANT_ADMIN', 'OPERATIONS', 'ADMIN'],
      steps: [
        {
          code: 'mdr.erp_register_purchase',
          name: 'Registrar la compra y su comisión',
          description:
            'Crea la compra, sus cuotas, el pago inicial al comercio y la cuenta por cobrar MDR contra el comercio, en una transacción.',
          system: 'ERP_BACKEND',
          method: 'POST',
          path: '/b2b/bnpl/purchases',
          roles: ['MERCHANT_ADMIN', 'OPERATIONS', 'ADMIN'],
          input: {
            merchantAccountId: 'uuid',
            branchId: 'uuid',
            consumerExternalRef: 'string',
            purchaseAmount: 'decimal',
            productCategory: 'string?',
            mdrReceivableDueDate: 'date',
          },
          errors: [
            '404 Cuenta B2B no encontrada',
            '403 El comercio no está activo como CUSTOMER',
            '403 La sucursal no está habilitada para originar BNPL',
            '409 El comercio no tiene versión contractual activa para la fecha de compra',
          ],
        },
      ],
    },
    {
      code: 'mdr_merchant_consumption',
      name: 'El comercio ve su consumo y facturación',
      description:
        '«Consumo y facturación» del portal del comercio lee dos libros: los cobros de Atlas (por expediente) y los cargos, comisiones y facturas del ERP (por cuenta B2B). Cada factura se descarga como documento.',
      module: 'portal',
      actor: 'merchant_user',
      client: 'ERP_PORTAL',
      screen: '/portal-comercio/facturacion',
      link: '{ERP}/portal-comercio/facturacion',
      roles: ['MERCHANT_ADMIN'],
      steps: [
        {
          code: 'mdr.gw_portfolio',
          name: 'Ver los cobros (pasarela del ERP)',
          description: 'El ERP sólo reenvía; se identifica por expediente.',
          system: 'ERP_BACKEND',
          method: 'GET',
          path: '/merchant-credit/:partnerId/portfolio',
          roles: MERCHANT_CREDIT,
        },
        {
          code: 'mdr.core_portfolio',
          name: 'Cartera de cobros del comercio',
          description:
            'Pagos e imputaciones de credit.loan_payments; la comisión se calcula sobre lo imputado a cuotas, así una reversión no devenga.',
          method: 'GET',
          path: '/merchant/partners/:partnerId/payment-claims/portfolio',
          roles: CORE_MERCHANT_CLAIMS,
        },
        {
          code: 'mdr.portal_commissions',
          name: 'Ver las comisiones que debe',
          description: 'Cuentas por cobrar MDR de la cuenta del llamador; la cuenta sale del alcance, no del parámetro.',
          system: 'ERP_BACKEND',
          method: 'GET',
          path: '/portal/commissions',
          roles: PORTAL_ROLES,
        },
        {
          code: 'mdr.portal_billing',
          name: 'Ver cargos y facturas',
          description: 'merchant_receivables y merchant_invoices de la cuenta B2B.',
          system: 'ERP_BACKEND',
          method: 'GET',
          path: '/portal/billing',
          roles: PORTAL_ROLES,
        },
        {
          code: 'mdr.portal_invoice',
          name: 'Descargar una factura',
          description: 'Buscada dentro de la cuenta del llamador: un comercio no lee la factura de otro.',
          system: 'ERP_BACKEND',
          method: 'GET',
          path: '/portal/billing/invoices/:id',
          roles: PORTAL_ROLES,
          optional: true,
        },
      ],
    },
    {
      code: 'mdr_issue_invoice',
      name: 'Finanzas emite la factura de comisión',
      description:
        'CRM › Facturación: Finanzas elige las cuentas por cobrar abiertas del comercio y emite la factura; el número lo asigna el sistema (serie global FAC-CM con cerrojo) y el IVA sale del cálculo, no se teclea.',
      module: 'b2b_sales_crm',
      actor: 'internal_user',
      client: 'ERP_PORTAL',
      screen: '/operaciones/crm/facturacion',
      link: '{ERP}/operaciones/crm/facturacion',
      roles: FINANCE,
      resultingStates: ['ISSUED'],
      steps: [
        {
          code: 'mdr.erp_receivables',
          name: 'Ver las cuentas por cobrar',
          description: 'Catálogo de cuentas por cobrar para elegir qué facturar.',
          system: 'ERP_BACKEND',
          method: 'GET',
          path: '/b2b/receivables',
          roles: ['COMMERCIAL_EXECUTIVE', 'COMMERCIAL_MANAGER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'],
        },
        {
          code: 'mdr.erp_issue_invoice',
          name: 'Emitir la factura',
          description: 'Agrupa las cuentas por cobrar elegidas; todas deben ser de la cuenta indicada.',
          system: 'ERP_BACKEND',
          method: 'POST',
          path: '/b2b/billing/invoices',
          roles: FINANCE,
          resultingStates: ['ISSUED'],
        },
        {
          code: 'mdr.erp_invoice_list',
          name: 'Ver las facturas emitidas',
          description: 'Incluye dueDate y accountingDocumentId para saber si ya está contabilizada.',
          system: 'ERP_BACKEND',
          method: 'GET',
          path: '/b2b/billing/invoices',
          roles: ['FINANCE', 'OPERATIONS', 'ADMIN'],
          repeatable: true,
        },
        {
          code: 'mdr.erp_invoice_detail',
          name: 'Descargar la factura como documento',
          description: 'Factura con líneas y cuenta; el PDF lo arma el portal y lo imprime el worker compartido.',
          system: 'ERP_BACKEND',
          method: 'GET',
          path: '/b2b/billing/invoices/:id',
          roles: ['FINANCE', 'OPERATIONS', 'ADMIN'],
          optional: true,
        },
      ],
    },
    {
      code: 'mdr_collect_and_post',
      name: 'Finanzas registra el pago y contabiliza',
      description:
        'El pago del comercio se aplica por imputaciones explícitas a sus cargos; la factura se lleva al mayor con un paso manual.',
      module: 'b2b_sales_crm',
      actor: 'internal_user',
      client: 'ERP_PORTAL',
      screen: '/operaciones/crm/facturacion',
      link: '{ERP}/operaciones/crm/facturacion',
      roles: FINANCE,
      requiredStates: ['ISSUED'],
      resultingStates: ['PARTIALLY_PAID', 'PAID'],
      steps: [
        {
          code: 'mdr.erp_merchant_payment',
          name: 'Registrar el pago del comercio',
          description: 'Las imputaciones deben cuadrar con el pago; actualiza saldos y estados.',
          system: 'ERP_BACKEND',
          method: 'POST',
          path: '/b2b/billing/merchant-payments',
          roles: FINANCE,
          resultingStates: ['PARTIALLY_PAID', 'PAID'],
        },
        {
          code: 'mdr.erp_post_to_gl',
          name: 'Contabilizar la factura',
          description: 'Genera el documento contable (entidad legal, libro, cuentas); la factura nace sin asiento.',
          system: 'ERP_BACKEND',
          method: 'PATCH',
          path: '/b2b/billing/invoices/:id/post-to-gl',
          roles: ['FINANCE', 'ADMIN', 'ACCOUNTANT'],
        },
      ],
    },
    {
      code: 'mdr_siat',
      name: 'Factura electrónica del SIAT',
      description:
        'Pendiente: la emisión fiscal con CUF ante el SIN no está integrada. El plan del 2026-09-26 la emula en el servidor de pruebas de proveedores.',
      module: 'accounting',
      actor: 'external_provider',
      client: 'BLOCK',
      optional: true,
      terminal: true,
      steps: [
        {
          code: 'mdr.siat_emit',
          name: 'Emitir la factura ante el SIAT',
          kind: 'external',
          reason:
            'El SIAT del SIN es un servicio externo que el ERP todavía no consume: no hay cliente, catálogos SIN ni cola de envío (plan _plan-facturacion-siat-2026-09-26).',
          description: 'Mientras no exista, la factura del comercio es una representación interna.',
          optional: true,
        },
      ],
    },
  ],
  transitions: [
    {
      code: 'mdr.entry',
      from: null,
      to: 'mdr.erp_register_purchase',
      condition: 'always',
      isDefault: true,
      description: 'Entrada: la venta a plazos.',
    },
    {
      code: 'mdr.band_to_purchase',
      from: 'mdr.erp_receive_decision',
      to: 'mdr.erp_register_purchase',
      condition: 'always',
      description: 'La banda guardada decide la regla MDR por segmento.',
    },
    {
      code: 'mdr.deliver_to_receive',
      from: 'mdr.core_deliver_decision',
      to: 'mdr.erp_receive_decision',
      condition: 'always',
      isDefault: true,
      description: 'Core entrega; el ERP guarda.',
    },
    {
      code: 'mdr.purchase_to_commissions',
      from: 'mdr.erp_register_purchase',
      to: 'mdr.portal_commissions',
      condition: 'on_success',
      description: 'El comercio ve la comisión devengada.',
    },
    {
      code: 'mdr.purchase_to_invoice',
      from: 'mdr.erp_register_purchase',
      to: 'mdr.erp_issue_invoice',
      condition: 'on_success',
      isDefault: true,
      description: 'Finanzas factura las comisiones.',
    },
    {
      code: 'mdr.invoice_to_payment',
      from: 'mdr.erp_issue_invoice',
      to: 'mdr.erp_merchant_payment',
      condition: 'on_success',
      isDefault: true,
      description: 'El comercio paga.',
    },
    {
      code: 'mdr.invoice_to_gl',
      from: 'mdr.erp_issue_invoice',
      to: 'mdr.erp_post_to_gl',
      condition: 'on_success',
      description: 'Se contabiliza.',
    },
    {
      code: 'mdr.invoice_to_portal',
      from: 'mdr.erp_issue_invoice',
      to: 'mdr.portal_invoice',
      condition: 'on_success',
      description: 'El comercio la descarga.',
    },
    {
      code: 'mdr.invoice_to_siat',
      from: 'mdr.erp_issue_invoice',
      to: 'mdr.siat_emit',
      condition: 'conditional',
      expression: { siatIntegrated: true },
      description: 'Futuro: emisión fiscal.',
    },
    {
      code: 'mdr.exit',
      from: 'mdr.erp_merchant_payment',
      to: null,
      condition: 'on_success',
      isDefault: true,
      description: 'Salida: comisión cobrada.',
    },
  ],
  dependencies: [
    {
      step: 'mdr.erp_register_purchase',
      dependsOn: 'mdr.erp_receive_decision',
      type: 'soft',
      description: 'Sin banda conocida la compra sigue, pero la regla por banda no casa.',
    },
    {
      step: 'mdr.erp_issue_invoice',
      dependsOn: 'mdr.erp_register_purchase',
      type: 'requires_data',
      description: 'Se facturan las cuentas por cobrar MDR que deja la compra.',
    },
    {
      step: 'mdr.erp_merchant_payment',
      dependsOn: 'mdr.erp_issue_invoice',
      type: 'requires_data',
      description: 'El pago se imputa a cargos facturados.',
    },
    {
      step: 'mdr.erp_post_to_gl',
      dependsOn: 'mdr.erp_issue_invoice',
      type: 'requires_completion',
      description: 'Se contabiliza una factura emitida.',
    },
    {
      step: 'mdr.core_portfolio',
      dependsOn: 'mdr.gw_portfolio',
      type: 'requires_completion',
      description: 'El portal llega por la pasarela.',
    },
  ],
};
