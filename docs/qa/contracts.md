# Contrato de la API de control QA (`/api/v1/systems/qa`)

Estado: **implementado en `feat/qa-orchestration`** (AtlasBackend) y consumido por el portal en la rama homónima. Todas las respuestas usan el sobre de Atlas
`{ requestId, data, timestamp }` o `{ requestId, error: { code, message } }`.

La API deriva tenant y operador de la sesión interna. Un `tenantId` en el cuerpo no amplía nada.
Nunca devuelve tokens de personas, `runToken` del mock ni secretos.

Permisos (catálogo `internal-rbac`): `systems.qa.read`, `systems.qa.run`, `systems.qa.cancel`.
Roles: los de `SYSTEMS_OPS_ROLES` leen; `SYSTEMS_OPS_STRESS_ROLES` ejecutan y cancelan.

## Lectura

### `GET /capabilities`

```json
{
  "enabled": true,
  "deploymentEnvironment": "TEST",
  "generatorVersion": "persona-factory@1",
  "environments": [
    {
      "environmentId": "qa-isolated",
      "label": "QA aislado",
      "deploymentEnvironment": "TEST",
      "maxPersons": 100,
      "maxConcurrency": 10,
      "limits": { "maxRequests": 3000, "maxDurationMs": 1800000, "maxInFlightRequests": 10 }
    }
  ],
  "worker": { "ready": true, "lastHeartbeatAt": "2026-09-24T12:00:00.000Z", "activeRuns": 0, "queuedRuns": 0 },
  "mock": { "reachable": true, "schemaVersion": "2.0.0", "controlPlane": true }
}
```

`enabled: false` (PROD o `QA_EXECUTION_ENABLED` apagado) ⇒ el portal enseña el motivo y no ofrece ejecutar.

### `GET /journey-templates?workflowCode=customer_full_lifecycle`

`{ items: TemplateSummary[] }` donde

```ts
type TemplateSummary = {
  code: string;
  version: string;
  name: string;
  description: string;
  workflowCode: string;
  workflowVersion: string;
  actors: Array<'anonymous' | 'customer' | 'internal_user' | 'merchant_user'>;
  scenarios: string[];
  defaultScenario: string;
  datasetModes: Array<'NORMAL_SYNTHETIC' | 'INVALID' | 'BOUNDARY' | 'OUTCOMES' | 'MIXED'>;
  expectedTerminal: string;
  status: 'READY' | 'BLOCKED' | 'DRAFT';
  blockedReasons: string[];
  stepCount: number;
  providers: string[];
  coveredStepCodes: string[];
};
```

### `GET /journey-templates/:code/versions/:version`

`TemplateSummary & { steps: Array<{ stepKey, workflowStepCode?, method, path, endpoint, actor, dependsOn: string[], expectStatus: number[], branches: Array<{ label, status: number[] }>, providers: Array<{ provider, expectCall }>, rateLimit?: { bucket, perMinute } }> }`

### `GET /campaigns`

`{ items: Array<{ code, name, description, templates: Array<{ code, version, share }> }> }`

### `GET /coverage?workflowCode=`

`{ rows: Array<{ stepCode, status: 'COVERED'|'GAP', templates: string[], gapReason?: string }>, summary: { total, covered, gaps, byReason: Record<string, number> } }`

### `POST /journey-templates/:code/versions/:version/sample-inputs`

Cuerpo `{ seed: string, count: 1..5, datasetMode }`. No crea usuarios ni llama a nadie.
`{ generatorVersion, personas: Array<{ ordinal, personaKey, firstName, lastName, birthDate, city, monthlyIncome, archetype, caseCategory, email, phone }> }`
(los correos y teléfonos son de `example.test`/rango de pruebas; el PIN no se devuelve).

## Ejecución

### `POST /runs/preflight`

Cuerpo `QaRunRequest`:

```json
{
  "templateCode": "account_signup_to_login",
  "templateVersion": "1.0.0",
  "environmentId": "qa-isolated",
  "mode": "INTEGRATED_QA",
  "persons": 20,
  "concurrency": 5,
  "seed": "atlas-qa-regression-v1",
  "datasetMode": "NORMAL_SYNTHETIC",
  "scenarioCode": "happy_path",
  "limits": { "maxRequests": 3000 }
}
```

Respuesta 200:

```json
{ "status": "READY" , "blockers": [], "planId": "12", "planHash": "…", "expiresAt": "…",
  "plan": { "persons": 20, "concurrency": 5, "limits": { … }, "estimatedRequests": 80,
            "estimatedAdmissionMs": 60000, "stepCount": 4, "providers": [] } }
```

`workflowCode` (opcional) es el flujo del árbol desde el que se lanza; queda en la corrida y el
preflight lo rechaza si la plantilla no recorre ningún paso de ese flujo.

`status: "BLOCKED"` ⇒ `blockers: Array<{ code, message, subject? }>`, `planId: null`. Códigos:
`ENDPOINT_UNRESOLVED, CONTRACT_MISMATCH, ACTOR_UNAVAILABLE, FIXTURE_MISSING, WORKER_UNAVAILABLE,
MOCK_UNAVAILABLE, SCENARIO_UNSUPPORTED, UNSAFE_ENVIRONMENT, BUDGET_EXCEEDED, BINDING_UNRESOLVED,
GRAPH_INVALID, TEMPLATE_NOT_READY, INVALID_INPUT`. El plan dura 15 minutos.

### `POST /runs` — 202

Cabecera obligatoria `Idempotency-Key` (8–120 caracteres). Cuerpo `{ planId, planHash }`.
`{ runId, status: 'QUEUED' }`. Misma clave + mismo plan ⇒ la misma corrida. Misma clave + otro
plan ⇒ `409 IDEMPOTENCY_KEY_REUSED`. Plan vencido o hash distinto ⇒ `409 PLAN_EXPIRED|PLAN_CHANGED`.

### `GET /runs?limit=20&templateCode=`

`{ items: RunSummary[] }` (más reciente primero).

### `GET /runs/:runId`

```ts
type RunSummary = {
  runId: string;
  status: QaRunStatus;
  verdict: 'PASSED' | 'FAILED' | 'INCONCLUSIVE' | null;
  templateCode: string;
  templateVersion: string;
  workflowCode: string;
  environmentId: string;
  mode: string;
  persons: number;
  concurrency: number;
  seed: string;
  scenarioCode: string;
  datasetMode: string;
  counters: {
    personsRequested;
    personsPending;
    personsRunning;
    personsPassed;
    personsFailed;
    personsBlocked;
    personsIndeterminate;
    personsCancelled;
    stepsPassed;
    stepsFailed;
    stepsIndeterminate;
    stepsSkipped;
    stepsNotApplicable;
    requestsIssued;
    passRate: number | null;
  };
  steps: Array<{ stepKey; workflowStepCode: string | null; passed; failed; skipped; notApplicable; indeterminate; cancelled }>;
  rootCauses: Array<{ stepKey: string; reason: string; personas: number }>;
  evidence: { mockNamespace: boolean; mockConfirmed: boolean | null; providerCalls: number | null; detail: string };
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequestedAt: string | null;
  operatorId: string;
  errorMessage: string | null;
};
```

`QaRunStatus = QUEUED|PREFLIGHT|RUNNING|CANCELLING|COMPLETED|CANCELLED|BLOCKED|FAILED_INFRASTRUCTURE|TIMED_OUT`.
`COMPLETED` = terminó el trabajo; el resultado está en `verdict`. `passRate: null` = sin muestras.

### `GET /runs/:runId/personas?page=1&limit=50&status=FAILED`

`{ items: Array<{ ordinal, personaKey, status, caseCategory, archetype, resources: Record<string,string>, failedStepKey: string|null, reason: string|null, startedAt, finishedAt }>, total, page, limit }`

### `GET /runs/:runId/personas/:personaKey/steps`

`{ items: Array<{ stepKey, workflowStepCode, status, branch, reason, rootCauseStepKey, failures: Array<{code,message,path?}>, attempts: Array<{attempt,status,latencyMs,admissionLagMs,transportError?,requestId?,errorCode?}>, evidence: { method, path, requestBody?, responseSummary?, extracted? }, startedAt, finishedAt }> }`

### `GET /runs/:runId/events?after=0`

`{ items: Array<{ sequence, type, payload, createdAt }>, nextCursor: number }`. El portal sondea cada 2 s
(backoff a 10 s en errores) y deja de sondear en estado terminal.

### `POST /runs/:runId/cancel` — 202

`{ runId, status: 'CANCELLING'|<terminal> }`. Idempotente.

### `GET /runs/:runId/evidence`

Manifiesto: `{ runId, planHash, recipeHash, generatorVersion, seed, namespace, referenceDate, versions, counters, verdict, mockJournal: { entries, totalAppended, droppedByRetention } | null }`.
