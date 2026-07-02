# Auditoría preventiva de riesgos — External Providers

## Riesgos corregidos en v2

1. **Gasto accidental en providers caros**  
   Mitigación: `external_provider_cost_policies`, bloqueo por costo, aprobación manual y cuotas.

2. **Consultas duplicadas por reintentos de frontend/timeout**  
   Mitigación: lectura de `x-idempotency-key` y replay seguro sin ejecutar otra consulta.

3. **Acoplamiento scoring-provider**  
   Mitigación: todos los providers generan `customer_observations` y `feature_snapshots`; scoring debe consumir snapshots.

4. **Falta de trazabilidad operativa**  
   Mitigación: `GET /external-data/requests/:requestId` expone estado, respuesta sanitizada y normalización.

5. **Políticas de costo inmóviles**  
   Mitigación: endpoints admin `GET/PATCH cost-policy`.

6. **Providers externos inestables**  
   Mitigación: mock server, health logs, status seguros y escenarios de error.

7. **Privacidad en social/messaging**  
   Mitigación: Facebook/WhatsApp solo mock/contractual; no chats, no contactos, no tokens planos, no scraping.

## Riesgos que deben seguir vigilándose

- Que producción no arranque con `*_ALLOW_MOCK_IN_PROD=true`.
- Que las credenciales reales estén solo en secrets manager o mecanismo equivalente.
- Que el rate limit de negocio no dependa solo del provider externo.
- Que los rechazos automáticos no dependan de señales sociales voluntarias.
- Que InfoCenter no se use para onboarding masivo sin modelo económico aprobado.
- Que un banco específico no rompa la interfaz general `BANKING_GENERIC`.
- Que los errores 429/503/timeout no se conviertan en rechazo del cliente por defecto.

## Reglas de largo plazo

- Cada provider nuevo debe tener adapter, mapper, mock, tests y docs.
- Cada señal nueva debe tener `featureKey`, confianza y fuente.
- Cada dato no disponible debe ser `DATA_NOT_AVAILABLE`, nunca inventado.
- Cada consulta cara debe tener ROI operativo medible.
