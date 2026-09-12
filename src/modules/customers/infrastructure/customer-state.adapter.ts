/**
 * @file Adaptador local del puerto de estado del cliente (AT-024).
 * @business Traduce la fila del cliente y la evaluación del motor a valores que otro contexto puede
 *   consumir sin ver el ORM ni datos personales.
 * @system Reutiliza `CustomersRepository` y `CustomerEligibilityService.evaluate` (sin persistir); la
 *   caché de elegibilidad la escribe sólo el dueño.
 */
import { Injectable } from '@nestjs/common';
import { CustomerEligibilityService } from '../application/customer-eligibility.service.js';
import type { CustomerStatePort } from '../application/ports/customer-state.port.js';
import { normalizeLifecycleStatus } from '../customer-lifecycle.constants.js';
import { CustomersRepository } from '../customers.repository.js';
import type { CustomerStateView, EligibilitySummary } from '../public/customer.contracts.js';

@Injectable()
export class CustomerStateAdapter implements CustomerStatePort {
  constructor(
    private readonly customers: CustomersRepository,
    private readonly eligibility: CustomerEligibilityService,
  ) {}

  async getState(tenantId: string, customerId: string): Promise<CustomerStateView | null> {
    const customer = await this.customers.findById(tenantId, customerId);
    if (!customer) return null;
    return Object.freeze({
      tenantId,
      customerId: String(customer.id),
      lifecycleStatus: normalizeLifecycleStatus(customer.lifecycleStatus),
      creditEligibilityStatus: customer.creditEligibilityStatus ?? null,
      eligibilityEvaluatedAt: customer.eligibilityEvaluatedAt ? new Date(customer.eligibilityEvaluatedAt).toISOString() : null,
      readAt: new Date().toISOString(),
    });
  }

  async evaluateEligibility(tenantId: string, customerId: string): Promise<EligibilitySummary> {
    const assessment = await this.eligibility.evaluate(tenantId, customerId);
    return Object.freeze({
      eligible: assessment.eligible,
      blockers: Object.freeze(assessment.blockers.map((blocker) => blocker.code)),
      ruleVersion: assessment.ruleVersion,
      lifecycleStatus: assessment.lifecycleStatus,
      evaluatedAt: new Date().toISOString(),
    });
  }
}
