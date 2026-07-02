# Quality Audit v7 — External Data Providers

## Calificación estricta

**Calificación actual: 9.3/10**

No la califico 10/10 todavía porque faltan validaciones que solo se pueden cerrar con infraestructura real:

- smoke tests contra PostgreSQL/Redis levantados,
- pruebas de migración sobre una copia real de staging,
- pruebas e2e con backend HTTP vivo,
- credenciales sandbox/productivas reales de SEGIP/InfoCenter/telcos/bancos,
- revisión legal final de textos de consentimiento.

## Riesgos corregidos en v7

| Riesgo | Severidad | Estado |
|---|---:|---|
| Cliente puede consultar datos externos de otro customerId | Crítica | Corregido |
| Cliente puede revocar consentimiento ajeno dentro del mismo tenant | Alta | Corregido |
| SEGIP/KYC sin roles explícitos | Alta | Corregido |
| Actor cliente no queda auditado en requestedByUserId | Media | Corregido |
| Production gate aprueba providers sin implementación real | Crítica | Corregido |
| Adapter production arroja error tarde en vez de bloquear antes | Alta | Corregido |
| Merchant podría tocar endpoints external-data generales | Alta | Corregido |

## Riesgos pendientes controlados

| Riesgo | Control actual | Próximo paso |
|---|---|---|
| Proveedores reales no disponibles | mock_local/mock_server + production gate | Integrar sandbox real por provider |
| Migraciones no probadas en DB real en este entorno | TypeScript OK | Ejecutar en staging DB |
| Smoke HTTP no corrido aquí | Scripts Yarn existentes | Ejecutar local/CI con DB y mock server |
| Consentimiento legal no revisado por abogado | Versionado y auditado | Revisión legal formal |

## Reglas de calidad bloqueantes

Un provider no debe pasar a producción si:

- no tiene adapter registrado,
- no tiene política de costo,
- es sensible y no requiere consentimiento,
- es caro y no está bloqueado/manual,
- está en modo production sin `*_REAL_INTEGRATION_IMPLEMENTED=true`,
- le faltan credenciales/base URL,
- permite mock en producción,
- falla sanitization audit,
- tiene findings HIGH/CRITICAL en strict mode.
