# Glosario

Términos con significado **específico en Atlas**. Cuando una palabra del negocio y una del código no
coinciden, aquí se dice cuál es cuál.

| Término | Significado en Atlas |
|---|---|
| **Bloqueador** | Código nombrado que impide avanzar en el recorrido (`CONSENT_MISSING`, `FRAUD_CASE_OPEN`…). La elegibilidad devuelve una lista de bloqueadores, no un booleano |
| **Elegibilidad** | Si un cliente puede solicitar crédito **y qué le falta si no puede**. La calcula `GET /customers/:id/eligibility`, que persiste la evidencia del cálculo |
| **Evidencia** | Dato obtenido de una fuente externa autoritativa y conservado con su origen, su momento y su proveedor. No es lo mismo que un dato declarado por el cliente |
| **Feature** | Señal derivada que alimenta el motor de riesgo. Tiene definición versionada, clasificación de sensibilidad y política de retención propias |
| **Observación** | Hallazgo de la revisión de back office que el cliente debe atender. Mientras quede abierta, `OPEN_OBSERVATIONS` bloquea |
| **Outbox** | Tabla donde se escribe un evento **en la misma transacción** que el cambio de negocio. Es lo que garantiza que no se pierda ningún evento |
| **Paquete** | Conjunto de datos y documentos que el solicitante envía a revisión al terminar la captura |
| **Perfil de seed** | `production` / `development` / `demo` / `test`. Determina qué seeders corren. `production` sólo contiene catálogos de referencia, nunca datos ficticios |
| **Proveedor** | Fuente externa de evidencia (SEGIP, InfoCenter, telco, banca…). Tiene modo, política de coste y salud propios |
| **Recorrido** (*workflow*) | El proceso estándar como dato versionado en `workflow_definitions`, no como documentación |
| **Rol de proceso** (`APP_ROLE`) | Qué hace ESTE proceso: `api` atiende HTTP, `worker` ejecuta trabajo de fondo, `all` ambas cosas |
| **Ruleset** | Versión de un conjunto de reglas de riesgo. Cada evaluación guarda cuál usó, para poder explicarla después |
| **Sobre** (*envelope*) | La envoltura `{ requestId, data, timestamp }` de toda respuesta 2xx, y su equivalente de error |
| **Tenant** | Cliente de la plataforma. Todo dato de negocio lleva `_tenant_id` y `TenantGuard` impide cruzarlos |
| **Trinquete** (*ratchet*) | Gate de CI que congela una deuda en su nivel actual: no puede empeorar, aunque no se exija arreglarla ya |

## Siglas

| Sigla | Significado |
|---|---|
| **ADR** | *Architecture Decision Record*: registro de una decisión arquitectónica con su contexto y consecuencias |
| **AML** | *Anti-Money Laundering*: prevención de lavado de activos |
| **BFLA** | *Broken Function Level Authorization*: llamar a una función para la que no se tiene rol |
| **BNPL** | *Buy Now, Pay Later*: compra ahora, paga después |
| **BOLA** | *Broken Object Level Authorization*: acceder a un objeto ajeno cuyo id se conoce |
| **DLQ** | *Dead Letter Queue*: cola de mensajes que agotaron sus reintentos |
| **KYC** | *Know Your Customer*: verificación de identidad del cliente |
| **PII** | *Personally Identifiable Information*: dato personal identificable |
| **RBAC** | *Role-Based Access Control*: autorización por rol |
| **SLO** | *Service Level Objective*: objetivo medible de nivel de servicio |
| **STRIDE** | Metodología de modelado de amenazas (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) |
