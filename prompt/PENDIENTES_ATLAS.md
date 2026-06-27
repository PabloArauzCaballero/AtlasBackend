# Pendientes Atlas — decisiones abiertas y control obligatorio

Este archivo concentra los pendientes conocidos de Atlas y define cómo deben registrarse nuevos pendientes durante generación, revisión o implementación.

## 1. Regla fundamental

Todo pendiente debe quedar señalado en Markdown. La IA debe registrar cada pendiente de forma explícita, rastreable y revisable.

No se debe implementar una decisión crítica como si estuviera cerrada cuando todavía está pendiente.

## 2. Pendientes de política de negocio conocidos

El brief de producto indica que quedan ocho decisiones de negocio sin cerrar antes del brief de ingeniería. Cinco están explícitamente identificadas y tres quedan como preguntas operativas adicionales por cerrar en reunión.

| ID | Estado | Tipo | Prioridad | Área | Pendiente | Impacto si no se resuelve | Acción requerida | Responsable | Archivo relacionado |
|---|---|---|---|---|---|---|---|---|---|
| ATLAS-PEND-001 | Abierto | Decisión de negocio | Alta | Compras | Definir si un usuario puede tener varias compras activas al mismo tiempo o debe cerrar una antes de iniciar otra. | Afecta límites de crédito, exposición de riesgo, validación de compra y UX. | Confirmar política de concurrencia de compras. | Producto/Riesgo | docs/architecture/flows.md |
| ATLAS-PEND-002 | Abierto | Decisión de negocio | Alta | Pago inicial | Definir cuánto tiempo tiene el cliente para completar el pago inicial del 60% antes de que la compra expire. | Afecta estados de compra, reservas, expiración, notificaciones y conciliación. | Confirmar plazo de expiración y evento que inicia el conteo. | Producto/Operaciones | docs/architecture/flows.md |
| ATLAS-PEND-003 | Abierto | Decisión de negocio | Alta | Mora/default | Definir los días exactos que separan `línea suspendida` de `default` total. | Afecta cobranza, suspensión de crédito, reportes de riesgo y acciones operativas. | Confirmar calendario de mora, suspensión y default. | Riesgo/Operaciones/Legal | docs/architecture/flows.md |
| ATLAS-PEND-004 | Abierto | Decisión de negocio | Alta | MDR/liquidación | Definir cómo se cobra el MDR a comercios en la práctica: gestión manual, recordatorios automáticos, deducción en liquidación u otro mecanismo. | Afecta facturación, liquidación, cuentas por cobrar y conciliación. | Confirmar política operativa y contable del MDR. | Producto/Finanzas/Operaciones | docs/architecture/flows.md |
| ATLAS-PEND-005 | Abierto | Decisión de negocio | Alta | Onboarding/KYC | Definir qué datos son obligatorios en el registro inicial y cuáles se piden progresivamente después. | Afecta conversión, KYC, privacidad, scoring y validaciones de API/mobile. | Confirmar campos obligatorios por etapa. | Producto/KYC/Legal | docs/endpoints/endpoints.md |
| ATLAS-PEND-006 | Abierto | Decisión de negocio | Alta | Política operativa | Pregunta operativa adicional 1 pendiente de definición en reunión. | Puede afectar diseño de estados, permisos o flujos. | Documentar pregunta concreta cuando sea entregada. | Producto/Operaciones | docs/pending/pending-items.md |
| ATLAS-PEND-007 | Abierto | Decisión de negocio | Alta | Política operativa | Pregunta operativa adicional 2 pendiente de definición en reunión. | Puede afectar diseño de estados, permisos o flujos. | Documentar pregunta concreta cuando sea entregada. | Producto/Operaciones | docs/pending/pending-items.md |
| ATLAS-PEND-008 | Abierto | Decisión de negocio | Alta | Política operativa | Pregunta operativa adicional 3 pendiente de definición en reunión. | Puede afectar diseño de estados, permisos o flujos. | Documentar pregunta concreta cuando sea entregada. | Producto/Operaciones | docs/pending/pending-items.md |

## 3. Pendientes técnicos recurrentes que deben documentarse si aparecen

| ID base | Tipo | Cuándo marcarlo |
|---|---|---|
| ATLAS-TECH-PEND | Regla técnica | Cuando falten diagramas, contratos, variables de entorno, endpoints, permisos o estados. |
| ATLAS-INT-PEND | Integración externa | Cuando falte documentación de QR BCB, bancos, Tigo Money, burós, SMS, WhatsApp, push, SIN o KYC provider. |
| ATLAS-LEGAL-PEND | Riesgo legal/regulatorio | Cuando falte definición de consentimiento, privacidad, contratos, facturación, ASFI o tratamiento de datos. |
| ATLAS-SEC-PEND | Seguridad/privacidad | Cuando falte política sobre biometría, PII, retención, cifrado, logs, tokens o almacenamiento. |
| ATLAS-SCORE-PEND | Decisión de negocio | Cuando falte definición de scorecard, reason codes, cutoffs, segmentos, variables o monitoreo. |

## 4. Plantilla para nuevos pendientes

```md
| ID | Estado | Tipo | Prioridad | Área | Pendiente | Impacto si no se resuelve | Acción requerida | Responsable | Archivo relacionado |
|---|---|---|---|---|---|---|---|---|---|
| ATLAS-PEND-XXX | Abierto | Decisión de negocio | Alta | Área afectada | Describir pendiente. | Describir impacto. | Describir acción. | Responsable. | Archivo relacionado. |
```

## 5. Estados permitidos

- `Abierto`: pendiente identificado, sin definición final.
- `Bloqueante`: impide implementación segura.
- `Asumido temporalmente`: se avanzó con un supuesto documentado.
- `En validación`: existe propuesta, falta aprobación.
- `Resuelto`: existe decisión aprobada y documentada.
- `Descartado`: ya no aplica y se documentó el motivo.

## 6. Regla para implementación

Si un pendiente está en estado `Abierto` o `Bloqueante`, la IA no debe implementar lógica definitiva sobre ese punto. Puede crear interfaces, adapters, enums extensibles, TODOs y documentación, pero no cerrar la política por su cuenta.
