/**
 * @file Registro de modelos de la integración de eventos con el ERP (P-14).
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system agrupa los modelos de inbox externa, entregas salientes y proyección de cobertura. El módulo
 *   `erp-integration` los escribe por SQL (inserciones condicionales y leases); el ORM los describe.
 */
import {
  ExternalAggregateVersionModel,
  ExternalEventInboxModel,
  InstallmentCoverageProjectionModel,
  OutboundEventDeliveryModel,
} from './models/index.js';

export const ERP_INTEGRATION_MODELS = [
  ExternalEventInboxModel,
  ExternalAggregateVersionModel,
  OutboundEventDeliveryModel,
  InstallmentCoverageProjectionModel,
] as const;
