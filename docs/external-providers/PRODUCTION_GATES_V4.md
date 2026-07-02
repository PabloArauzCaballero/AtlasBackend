# Production gates para proveedores externos — V4

Antes de poner un provider en `production`, validar:

1. Contrato vigente.
2. Credenciales reales en secrets manager o mecanismo equivalente.
3. Consentimiento versionado.
4. Política de costo activa.
5. `block_by_default=true` si el proveedor es HIGH/CRITICAL.
6. Cuotas por usuario y globales.
7. Circuit breaker activo.
8. Cache TTL definido para proveedores costosos cuando aplique.
9. Feature TTL definido para evitar scoring con señales viejas.
10. Sanitization audit sin hallazgos HIGH.
11. Mock server y smoke tests pasados.
12. Readiness sin blockers críticos.

Nunca activar producción solo cambiando `.env` sin revisar estos gates.
