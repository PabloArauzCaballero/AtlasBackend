/**
 * @file Proceso declarado en código: Ciclo de vida completo del cliente.
 * @business Es el mapa completo de lo que un cliente vive en Atlas, de los textos legales al cierre: sirve para ver de un vistazo cómo encajan los procesos más pequeños (alta, identidad, crédito, pagos, privacidad) y para el QA de punta a punta.
 * @system envuelve el árbol `FLUJO_CLIENTE_COMPLETO` (que también recorre QA) con narrativa, dueño y cliente por etapa: una sola fuente de pasos.
 */
import { FLUJO_CLIENTE_COMPLETO } from '../../../../database/seeders/demo/flujo-cliente-completo.seed-data.js';
import type { WorkflowDefinitionFixture } from '../workflow-definition.types.js';
import { stagesFromTree } from '../workflow-tree-adapter.js';

export const CUSTOMER_FULL_LIFECYCLE: WorkflowDefinitionFixture = {
  processId: 'C-03',
  code: 'customer_full_lifecycle',
  version: 'v1',
  name: 'Ciclo de vida completo del cliente',
  description:
    'Todo lo que un cliente recorre en Atlas, de la primera pantalla al cierre: textos legales, alta, verificación de contacto, identidad, domicilio, perfil financiero, referencias, encuesta, consentimientos, evidencia externa, envío a revisión, decisión del operador, riesgo, elegibilidad, solicitud y decisión de crédito, línea, préstamos y calendario, avisos de pago con comprobante, notificaciones y derechos sobre sus datos personales.',
  processType: 'customer_journey',
  ownerDomain: 'customer_lifecycle',
  ownerRole: 'OPERATIONS_MANAGER',
  priority: 'P1',
  systems: ['ATLAS_BACKEND'],
  narrative: {
    whyExists:
      'Es el mapa completo de lo que un cliente vive en Atlas, de los textos legales al cierre: sirve para ver de un vistazo cómo encajan los procesos más pequeños (alta, identidad, crédito, pagos, privacidad) y para el QA de punta a punta.',
    whoStartsAndCloses:
      'Lo inicia el cliente en la app; intervienen el operador interno (revisión, habilitación), el Motor (riesgo y crédito) y el propio cliente al pagar y ejercer sus derechos; lo cierra el cierre de cuenta o la solicitud de supresión.',
    startAndEnd:
      'Empieza con la aceptación de los textos legales y el registro, y termina con la cuenta cerrada o con los derechos del titular atendidos (derecho de supresión o portabilidad).',
    whenItFails:
      'Cada fallo lo gestiona el proceso pequeño que lo contiene (P-01…P-11); este recorrido compuesto sólo enlaza a ellos, así que un fallo se busca en el proceso que lo nombra.',
    healthIndicator:
      'Clientes que completan el recorrido sin intervención manual y tiempo desde registro hasta primera compra; ambos agregados de los procesos que lo componen.',
  },
  instanceEntity: {
    system: 'ATLAS_BACKEND',
    schema: 'customer',
    table: 'customers',
    idColumn: '_id',
    statusColumn: 'lifecycle_status',
    labelColumn: 'customer_code',
    openStatuses: ['registered', 'onboarding_in_progress', 'under_review', 'observed', 'active'],
  },
  success:
    'El cliente queda activo con su expediente completo, su elegibilidad resuelta y —si su producto lo permite— una solicitud de crédito con decisión y una línea vigente.',
  failure:
    'El expediente queda incompleto, la revisión lo rechaza o lo bloquea, el riesgo lo deja fuera de elegibilidad, o la solicitud se rechaza.',
  sources: ['src/database/seeders/demo/flujo-cliente-completo.seed-data.ts'],
  stages: stagesFromTree(FLUJO_CLIENTE_COMPLETO, {
    credit_decision: '/internal/operations/credit/applications/[applicationId]',
    operator_review: '/internal/operations/work-queue',
  }),
};
