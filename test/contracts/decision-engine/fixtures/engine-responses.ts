/**
 * @file Respuestas del motor para las pruebas de conformidad de Core (P-14).
 * @business Son las formas que el motor EMITE, no las que Core querría recibir.
 * @system copiadas de `src/modules/runtime/runtime.service.ts` del motor (commit en
 *   `engine-openapi.v1.json#/x-atlas-source`): `buildBody` (éxito), el `NO_DECISION` por variables,
 *   `recordBasisReview` y `recordInvalidOutput`. El OpenAPI del motor declara el cuerpo de la decisión
 *   como `object`, así que la forma real vive aquí. Datos sintéticos: ningún dato personal.
 */
const artifact = {
  code: 'BNPL_CREDIT_DECISION',
  versionId: '41',
  deploymentId: '17',
  environment: 'PROD',
  checksum: 'sha256:0f1e2d',
};

/** `buildBody` de una ejecución SUCCEEDED, con los campos aditivos de P-09/P-10/P-11. */
export function succeeded(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: 'credit-app-APP-5',
    correlationId: 'corr-1',
    executionId: '88001',
    status: 'SUCCEEDED',
    outcome: 'APPROVE',
    score: 712,
    riskBand: 'B',
    limit: 1500,
    output: { approved_credit_limit: 1500 },
    primaryResult: 'APPROVE',
    reasonCodes: [{ code: 'GOOD_PAYMENT_HISTORY', category: 'RISK', message: null, adverseAction: false, priority: 1 }],
    artifact,
    manualReview: null,
    traceReference: '88001',
    decisionValidUntil: '2026-09-24T13:00:00.000Z',
    exposure: {
      limitCode: 'SUBJECT_TOTAL',
      currencyCode: 'BOB',
      maxValue: 1000,
      enforced: true,
      currentExposure: 900,
      requestedAmount: 80,
      remainingBeforeDecision: 100,
      remainingAfterDecision: 20,
    },
    enablingBasis: { policySource: 'ORIGINATION_DEFAULT', purposes: ['credit_underwriting'] },
    degradedInputs: false,
    freshnessUnknown: [],
    ...overrides,
  };
}

/** 422: una variable obligatoria falta o no valida. `reasonCodes` llega como códigos sueltos. */
export const noDecisionVariables = {
  requestId: 'credit-app-APP-5',
  executionId: '88002',
  status: 'NO_DECISION',
  outcome: 'NO_DECISION',
  reasonCodes: ['VARIABLE_MISSING_OR_INVALID'],
  errors: [{ code: 'VARIABLE_MISSING_OR_INVALID', variable: 'declared_monthly_income', message: 'requerida' }],
  artifact: { code: artifact.code, versionId: artifact.versionId, deploymentId: artifact.deploymentId, checksum: artifact.checksum },
};

/** 422: falta la base habilitante (`recordBasisReview`). */
export const noDecisionBasis = {
  requestId: 'credit-app-APP-5',
  correlationId: 'corr-1',
  executionId: '88003',
  status: 'NO_DECISION',
  outcome: 'NO_DECISION',
  reasonCodes: [
    {
      code: 'ENABLING_BASIS_MISSING',
      category: 'COMPLIANCE',
      message: 'Falta una base habilitante vigente para tratar los datos del solicitante con esta finalidad.',
      adverseAction: false,
    },
  ],
  errors: [{ code: 'ENABLING_BASIS_NO_BASIS_RECORDED', purpose: 'credit_underwriting' }],
  enablingBasis: { policySource: 'ORIGINATION_DEFAULT', failures: [{ purpose: 'credit_underwriting', reason: 'NO_BASIS_RECORDED' }] },
  decisionValidUntil: null,
  artifact,
};

/** 422: salida económica fuera de rango (`recordInvalidOutput`). Sin `output`. */
export const noDecisionEconomic = {
  requestId: 'credit-app-APP-5',
  correlationId: 'corr-1',
  executionId: '88004',
  status: 'NO_DECISION',
  outcome: 'NO_DECISION',
  reasonCodes: [
    {
      code: 'ECONOMIC_OUTPUT_INVALID',
      category: 'TECHNICAL',
      message: 'La politica produjo una salida economica fuera de rango.',
      adverseAction: false,
    },
  ],
  errors: [{ code: 'PD_OUT_OF_RANGE', field: 'probability_of_default', message: '4.2 fuera de [0,1]' }],
  decisionValidUntil: null,
  artifact,
};
