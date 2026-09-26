/**
 * @file Registro de modelos propios del contexto Crédito y admisión (AT-018).
 * @business Crédito es dueño de sus tablas: productos, solicitudes, sus eventos, líneas y revisiones de
 *   extracto. Nadie más las registra como propias; quien las lea lo hace por contrato.
 * @system Lo agrega `database-models.ts` mientras el monolito comparte proceso; un ejecutable extraído
 *   registraría sólo esta lista más sus dependencias técnicas autorizadas.
 */
import {
  BankStatementReviewModel,
  CreditApplicationEventModel,
  CreditApplicationModel,
  CreditLineModel,
  CreditProductModel,
} from '../../../../database/models/index.js';

export const CREDIT_MODELS = [
  CreditProductModel,
  CreditApplicationModel,
  CreditApplicationEventModel,
  CreditLineModel,
  BankStatementReviewModel,
] as const;
