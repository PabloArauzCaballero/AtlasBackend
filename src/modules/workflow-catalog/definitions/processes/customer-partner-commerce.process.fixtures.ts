/**
 * @file Proceso declarado en código: Cliente y comercio: del alta del partner a la compra verificada.
 * @business Muestra cómo se cruzan el comercio y el cliente: sin un comercio activo con QR aprobados no hay dónde comprar, y sin la verificación del comprobante por el comercio la cuota no se da por pagada.
 * @system envuelve el árbol `FLUJO_CLIENTE_PARTNER` (que también recorre QA) con narrativa, dueño y cliente por etapa: una sola fuente de pasos.
 */
import { FLUJO_CLIENTE_PARTNER } from '../../../../database/seeders/demo/flujo-cliente-partner.seed-data.js';
import type { WorkflowDefinitionFixture } from '../workflow-definition.types.js';
import { stagesFromTree } from '../workflow-tree-adapter.js';

export const CUSTOMER_PARTNER_COMMERCE: WorkflowDefinitionFixture = {
  processId: 'C-04',
  code: 'customer_partner_commerce',
  version: 'v1',
  name: 'Cliente y comercio: del alta del partner a la compra verificada',
  description:
    'El recorrido completo del comercio y su cruce con el cliente: alta del partner, representante legal, registro comercial, verificación de contacto, sucursales y terminales, emisión de QR, envío a revisión, KYB y decisión del operador, alta de usuarios del comercio, resolución del QR en la caja, solicitud de crédito en el punto de venta, aceptación por el comercio, aviso de pago con comprobante, verificación y cartera, y soporte del comercio.',
  processType: 'partner_journey',
  ownerDomain: 'partner_onboarding',
  ownerRole: 'OPERATIONS_MANAGER',
  priority: 'P1',
  systems: ['ATLAS_BACKEND'],
  narrative: {
    whyExists:
      'Muestra cómo se cruzan el comercio y el cliente: sin un comercio activo con QR aprobados no hay dónde comprar, y sin la verificación del comprobante por el comercio la cuota no se da por pagada.',
    whoStartsAndCloses:
      'Lo inicia el comercio al empezar su alta; intervienen el operador interno (KYB y aprobación del QR), el cliente (compra y aviso de pago) y el comercio (aceptación y verificación); lo cierra la cuota verificada en cartera.',
    startAndEnd:
      'Empieza con POST /partner-onboarding/start y termina cuando una compra del cliente en ese comercio tiene su pago verificado y conciliado en la cartera.',
    whenItFails:
      'Un KYB observado o un QR rechazado deja al comercio sin poder vender y aparece en la cola del portal; un comprobante rechazado devuelve el aviso de pago al cliente con el motivo.',
    healthIndicator: 'Comercios que pasan de alta a activos en 10 días y avisos de pago verificados en menos de 48 h.',
  },
  instanceEntity: {
    system: 'ATLAS_BACKEND',
    schema: 'partner',
    table: 'partner_profiles',
    idColumn: '_id',
    statusColumn: 'onboarding_status',
    labelColumn: 'legal_name',
  },
  success:
    'El comercio queda activo con sus QR aprobados y sus usuarios operando, y una compra del cliente llega a aceptada con su pago verificado.',
  failure:
    'El KYB rechaza o bloquea al comercio, sus QR no se aprueban, la solicitud del cliente en la caja se rechaza, o el pago avisado no se verifica.',
  sources: ['src/database/seeders/demo/flujo-cliente-partner.seed-data.ts'],
  stages: stagesFromTree(FLUJO_CLIENTE_PARTNER, {
    partner_signup: '/portal-comercio/expediente',
    partner_identity: '/portal-comercio/expediente',
    partner_contact: '/portal-comercio/expediente',
    partner_network: '/portal-comercio/expediente',
    partner_qr: '/portal-comercio/expediente',
    partner_submission: '/portal-comercio/expediente',
    partner_review: '/internal/operations/partners',
    partner_portfolio: '/portal-comercio/cartera',
    partner_support: '/portal-comercio/soporte',
  }),
};
