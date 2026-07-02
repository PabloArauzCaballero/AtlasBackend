# Pendientes por fase — External Data Providers

## Fase 1 — implementado en esta entrega

- Arquitectura general de providers externos.
- Adapter SEGIP/CGIP en modo `mock_local` y `mock_server`.
- Adapter InfoCenter en modo mock con bloqueo por costo.
- Tabla `external_provider_cost_policies`.
- Seeds de providers y políticas.
- Registro auditable en `data_provider_requests` y `data_provider_responses`.
- Observaciones en `customer_observations`.
- Features en `feature_snapshots`.
- Mock server transversal.

## Fase 1 — pendiente real

- Credenciales oficiales/contrato/documentación SEGIP.
- Sandbox o endpoint oficial SEGIP.
- Credenciales/documentación InfoCenter.
- Definir precio real por consulta InfoCenter en la policy.
- Flujo UI/admin para aprobar manualmente consultas caras.

## Fase 2 — preparado, pendiente real

- Integración real QR BCB o proveedor QR.
- Integración real con bancos.
- Mini-adapters por banco: Banco Unión, BNB, Bisa, Mercantil, Ganadero, Económico, FIE, etc.
- Conciliación real de pagos y referencias.

## Fase 3 — preparado, pendiente real

- Contratos/API con telcos.
- OAuth real Facebook/Meta con permisos aprobados.
- Canal WhatsApp oficial para OTP/contactabilidad.
- Proveedores reales de digital trust/email/IP/device reputation.

## Reglas que no deben cambiarse

- Scoring no consulta providers directamente.
- No guardar contactos ni chats.
- No guardar tokens planos.
- No inventar datos no disponibles.
- InfoCenter no se ejecuta automáticamente en onboarding.
