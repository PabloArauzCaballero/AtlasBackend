# Matriz de pruebas — External Providers

| Proveedor | Escenario | Resultado esperado | Status esperado | Guarda request | Guarda response | Genera observation | Genera feature | Manual review |
|---|---|---|---|---|---|---|---|---|
| SEGIP | happy_path | Identidad verificada | MOCKED/COMPLETED | sí | sí | sí | sí | no |
| SEGIP | partial_match | Revisión manual | MOCKED/COMPLETED | sí | sí | sí | sí | sí |
| SEGIP | timeout | Provider unavailable | FAILED/PROVIDER_UNAVAILABLE | sí | no/sanitizada | no | no | sí |
| INFOCENTER | cost_blocked | Bloqueado por costo | BLOCKED_BY_COST_POLICY | sí | no | no | no | no |
| QR | payment_verified | Pago confirmado | MOCKED/COMPLETED | sí | sí | sí | sí | no |
| BANKING | pending | Conciliación pendiente | MOCKED/COMPLETED | sí | sí | sí | parcial | no |
| TELCO | fraud_signal_high | Riesgo SIM swap | MOCKED/COMPLETED | sí | sí | sí | sí | sí |
| FACEBOOK | data_not_available | No inventar antigüedad | MOCKED/COMPLETED | sí | sí | sí | parcial | no |
| WHATSAPP | otp_verified | Contactabilidad OK | MOCKED/COMPLETED | sí | sí | sí | sí | no |
| DIGITAL_TRUST | fraud_signal_high | Riesgo alto | MOCKED/COMPLETED | sí | sí | sí | sí | sí |
