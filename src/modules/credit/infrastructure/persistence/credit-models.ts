/**
 * @file Registro de modelos propios del contexto Crédito y admisión (AT-018).
 * @business Crédito es dueño de sus tablas: productos, solicitudes, sus eventos, líneas y revisiones de
 *   extracto. Nadie más las registra como propias; quien las lea lo hace por contrato.
 * @system Lo agrega `database-models.ts` mientras el monolito comparte proceso; un ejecutable extraído
 *   registraría sólo esta lista más sus dependencias técnicas autorizadas.
 */
import {
  BankStatementReviewModel,
  CardTierModel,
  CustomerCardTierOverrideModel,
  CreditApplicationEventModel,
  CreditApplicationModel,
  CreditExposureReservationModel,
  CreditLineModel,
  CreditProductModel,
} from '../../../../database/models/index.js';

export const CREDIT_MODELS = [
  CreditProductModel,
  CreditApplicationModel,
  CreditApplicationEventModel,
  CreditLineModel,
  BankStatementReviewModel,
  // P-11: la reserva del cupo de la línea es de Crédito, igual que la línea que limita.
  CreditExposureReservationModel,
  // Las tarjetas del cliente (Normal … Black): su catálogo de presentación y los ajustes manuales del personal.
  CardTierModel,
  CustomerCardTierOverrideModel,
] as const;
