/**
 * @file Catálogo de recetas: índice de plantillas publicadas, campañas y matriz de cobertura.
 * @business Esta pieza es lo que el laboratorio QA enseña como «journeys precargados».
 * @system una sola fuente consumida por la API, el worker, el CLI y la prueba de cobertura.
 */
import { createHash } from 'node:crypto';
import type { JourneyTemplate } from '../domain/journey-recipe.types.js';
import { ACCOUNT_SIGNUP_TO_LOGIN, POST_LOGIN_FIRST_SCREEN } from './customer-account.recipes.js';
import { CUSTOMER_CREDIT_JOURNEY, CUSTOMER_ONBOARDING_INCOMPLETE } from './customer-credit.recipes.js';
import { COVERAGE_GAPS, type GapReason } from './coverage-gaps.js';

export const JOURNEY_TEMPLATES: readonly JourneyTemplate[] = [
  ACCOUNT_SIGNUP_TO_LOGIN,
  POST_LOGIN_FIRST_SCREEN,
  CUSTOMER_CREDIT_JOURNEY,
  CUSTOMER_ONBOARDING_INCOMPLETE,
];

export type JourneyCampaign = { code: string; name: string; description: string; templates: Array<{ code: string; version: string; share: number }> };

/** Una campaña reparte N personas entre plantillas; el total se enseña antes de ejecutar. */
export const JOURNEY_CAMPAIGNS: readonly JourneyCampaign[] = [
  {
    code: 'regression_normal',
    name: 'Regresión normal',
    description: 'Recorridos del cliente con datos normales: alta, primera pantalla y decisión de crédito.',
    templates: [
      { code: 'account_signup_to_login', version: '1.0.0', share: 1 },
      { code: 'post_login_first_screen', version: '1.0.0', share: 1 },
      { code: 'customer_credit_decision', version: '1.0.0', share: 2 },
    ],
  },
  {
    code: 'errors_and_boundaries',
    name: 'Errores y fronteras',
    description: 'Rechazos esperados: el error exacto es el éxito y no quedan efectos indebidos.',
    templates: [{ code: 'customer_onboarding_incomplete', version: '1.0.0', share: 1 }],
  },
];

export function findTemplate(code: string, version: string): JourneyTemplate | undefined {
  return JOURNEY_TEMPLATES.find((template) => template.code === code && template.version === version);
}

/** Hash canónico de la receta: entra en el plan congelado y detecta cualquier edición posterior. */
export function recipeHash(template: JourneyTemplate): string {
  return createHash('sha256').update(canonical(template)).digest('hex');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

export type CoverageRow = {
  stepCode: string;
  status: 'COVERED' | 'GAP';
  templates: string[];
  gapReason?: GapReason;
};

/** Matriz stepCode × plantillas. Recibe los códigos del inventario para no depender de la semilla. */
export function coverageMatrix(inventory: readonly string[]): CoverageRow[] {
  const covering = new Map<string, Set<string>>();
  for (const template of JOURNEY_TEMPLATES) {
    for (const step of template.steps) {
      if (!step.workflowStepCode) continue;
      const set = covering.get(step.workflowStepCode) ?? new Set<string>();
      set.add(`${template.code}@${template.version}`);
      covering.set(step.workflowStepCode, set);
    }
  }
  return inventory.map((stepCode) => {
    const templates = [...(covering.get(stepCode) ?? [])].sort();
    if (templates.length > 0) return { stepCode, status: 'COVERED', templates };
    return { stepCode, status: 'GAP', templates, gapReason: COVERAGE_GAPS[stepCode] };
  });
}
