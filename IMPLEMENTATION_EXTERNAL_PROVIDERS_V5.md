# ATLAS External Data Providers — v5

## Objetivo de la fase

La v5 agrega gobierno operativo de producción sobre todo lo construido en v1-v4. El foco ya no es solo ejecutar providers; ahora el backend puede responder si un provider está listo para producción, si cumple SLA, si el paquete de decisión del cliente tiene features suficientes y si una consulta histórica puede reconstruir features sin volver a pagar al proveedor.

## Cambios principales

### 1. Production gate

Nuevo endpoint:

```http
GET /api/v1/admin/external-providers/production-gate?providerCode=SEGIP&strict=true
```

Evalúa readiness, quality audit, sanitization audit, health, cost policies y bloqueadores. Sirve como compuerta antes de pasar SEGIP, InfoCenter, telcos, bancos o digital trust a modo productivo.

### 2. SLA report

Nuevo endpoint:

```http
GET /api/v1/admin/external-providers/sla?days=30&providerCode=SEGIP
```

Calcula volumen, éxito, fallo, bloqueos, cache, rate limits, auth failures, costo real y latencia p95.

### 3. Decision package del cliente

Nuevo endpoint:

```http
GET /api/v1/external-data/users/:customerId/decision-package
```

Devuelve scoring input, observaciones, consentimientos, requests recientes y banderas de riesgo. Es el paquete que debería ver operaciones/riesgo para revisión manual sin llamar providers directamente.

### 4. Rebuild de feature snapshots

Nuevo endpoint:

```http
POST /api/v1/admin/external-providers/requests/:requestId/rebuild-features
```

Reconstruye `feature_snapshots` desde observaciones normalizadas ya guardadas. No consulta al proveedor y no genera costo. Sirve para corregir problemas de mapeo, regenerar features y mantener trazabilidad.

### 5. Corrección de frescura de features

Se corrigió el cálculo de `ageHours` en scoring input. En v4 estaba dividido por `36_000`; ahora se usa `3_600_000`, que es el número correcto de milisegundos por hora.

## Riesgos de largo plazo cubiertos

- Pasar providers a producción sin contrato o sin aprobación de compliance.
- Medir solo health y no desempeño real.
- Tomar decisiones con features obsoletas.
- Volver a consultar un proveedor caro cuando solo hacía falta regenerar features.
- No tener paquete auditable para revisión manual.
- No detectar fallas de autenticación o latencia antes de que afecten onboarding.

## Validación esperada

```bash
yarn type-check
yarn lint
yarn format:check
yarn test
yarn build
```

Smoke adicional:

```bash
yarn smoke:external-providers:governance
```

