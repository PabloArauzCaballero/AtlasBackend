# Go-live audit v5 — External Providers

Antes de habilitar cualquier provider externo en producción, revisar:

1. Contrato o convenio firmado.
2. Credenciales fuera del repositorio.
3. Consentimiento legal aprobado y versionado.
4. Cost policy activa.
5. Proveedores caros con `block_by_default=true`.
6. Pruebas sandbox/mock completas.
7. Production gate en PASS.
8. Sanitization audit en PASS.
9. SLA report sin auth failures ni latencias críticas.
10. Kill switch probado.
11. Circuit breaker habilitado.
12. Scoring consumiendo solo `risk_feature_snapshots`.

No habilitar InfoCenter automático en onboarding. InfoCenter sigue siendo manual/high-risk por costo.
