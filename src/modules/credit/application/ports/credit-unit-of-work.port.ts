/**
 * @file Puerto de unidad de trabajo de Crédito (AT-015).
 * @business La admisión escribe evaluación, solicitud y evento «o todo o nada»; el caso de uso pide
 *   una sesión y escribe a través de ella, sin ver el ORM.
 * @system Firmas sin `Transaction`: la sesión ya está ligada. `CreditRepository` sigue siendo el
 *   adaptador real; aquí sólo se recorta lo que la admisión necesita (segregación de interfaz).
 */
import type { TransactionalOutbox } from '../../../../platform/events/transactional-outbox.port.js';
import type { LocalUnitOfWork } from '../../../../platform/persistence/local-unit-of-work.js';
import type { RecordedEligibility } from '../../../customers/application/customer-eligibility.service.js';
import type { EligibilityFacts } from '../../../customers/repositories/customer-eligibility.facts.js';
import type { CreditRepository } from '../../credit.repository.js';

export type NewCreditApplication = Parameters<CreditRepository['createApplication']>[0];
export type NewCreditApplicationEvent = Parameters<CreditRepository['createApplicationEvent']>[0];
export type CreditApplicationRow = Awaited<ReturnType<CreditRepository['createApplication']>>;

export interface CreditApplicationStore {
  findProductById(tenantId: string, productId: string): ReturnType<CreditRepository['findProductById']>;
  findOpenApplication(tenantId: string, customerId: string): ReturnType<CreditRepository['findOpenApplication']>;
  createApplication(values: NewCreditApplication): Promise<CreditApplicationRow>;
  createApplicationEvent(values: NewCreditApplicationEvent): ReturnType<CreditRepository['createApplicationEvent']>;
}

export interface CreditAdmissionEligibility {
  /** Bloquea la fila del cliente durante la sesión (AT-007). */
  lockCustomer(tenantId: string, customerId: string): Promise<void>;
  /** Hechos del cliente leídos UNA vez dentro de la sesión; alimentan elegibilidad general y por producto. */
  loadFacts(tenantId: string, customerId: string): Promise<EligibilityFacts>;
  evaluateAndRecord(input: {
    tenantId: string;
    customerId: string;
    evaluatedByType: string;
    evaluatedByInternalUserId: string | null;
    decisionSource: 'automatic' | 'manual_override' | 'manual_decision';
    reasonCode?: string | null;
    facts?: EligibilityFacts;
  }): Promise<RecordedEligibility>;
}

export type CreditWorkSession = {
  applications: CreditApplicationStore;
  eligibility: CreditAdmissionEligibility;
  /** Outbox ligado a la misma transacción (AT-033): el evento se confirma con el agregado. */
  outbox: TransactionalOutbox;
};

export type CreditUnitOfWork = LocalUnitOfWork<CreditWorkSession>;

export const CREDIT_UNIT_OF_WORK = 'atlas.credit.unit-of-work';
