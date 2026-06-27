# Proyecto Atlas — Brief técnico-operativo para IA

## 1. Qué es Atlas

Atlas es una fintech BNPL para Bolivia. El producto permite que un consumidor compre en un comercio pagando una parte inicial al contado y el resto en cuotas cortas. Atlas gana principalmente por el **MDR** cobrado al comercio y asume el riesgo de impago de las cuotas financiadas.

Atlas no debe modelarse como banco ni como procesador/intermediario de pagos. En el MVP, el cliente paga al comercio y Atlas coordina riesgo, calendario, conciliación, seguimiento, scoring, auditoría y cobranza.

## 2. Frentes del producto

### App móvil del consumidor

- Registro.
- Login.
- KYC y verificación de identidad.
- Consentimientos.
- Evaluación de línea de crédito.
- Visualización de compras y cuotas.
- Pago / reporte de pago según integración disponible.
- Notificaciones push.
- Señales de comportamiento y dispositivo con privacidad estricta.

### Portal web del comercio

- Gestión de ventas financiadas.
- Consulta de compras y cuotas.
- Liquidaciones.
- Conciliación básica.
- Estado de clientes asociados a ventas del comercio, respetando privacidad y permisos.

### Panel interno de operaciones

- Gestión de usuarios, comercios, compras, cuotas, mora, excepciones y auditoría.
- Supervisión de riesgo, fraude, scoring y KYC.
- Gestión operativa de conciliaciones, comunicación y cobranza.

### Backend Atlas

- Autenticación y autorización.
- Motor de scoring/riesgo.
- Motor de cuotas.
- KYC y consentimientos.
- Compras BNPL.
- Pagos reportados / conciliación.
- Liquidaciones a comercios.
- Mora y cobranza.
- Auditoría y trazabilidad.
- Workers persistentes para tareas asíncronas.

## 3. Regla de negocio principal del MVP

La regla estándar de lanzamiento es:

1. **Aprobación:** el cliente es evaluado y recibe una línea de crédito.
2. **Compra:** el cliente paga el 60% del monto al contado directamente al comercio.
3. **Financiamiento:** el 40% restante se divide en 3 cuotas iguales o casi iguales, separadas por 14 días.
4. **Pago directo:** cada cuota se paga directamente al comercio, salvo que una integración posterior indique otro flujo.
5. **Impago:** si el cliente no paga una cuota, Atlas paga esa cuota específica al comercio en la fecha original y luego cobra esa cuota al cliente.
6. **No aceleración:** si una cuota entra en mora, no se exige automáticamente todo el saldo restante. El calendario original se conserva cuota por cuota.

### Reglas que la IA no puede inventar

La IA no puede decidir por sí sola:

- Redondeo exacto de cuotas cuando el 40% no divide perfecto entre 3.
- Momento exacto desde el cual se cuentan los 14 días.
- Plazo máximo para completar el pago inicial del 60%.
- Si un usuario puede tener más de una compra activa.
- Días exactos entre mora, suspensión de línea y default.
- Flujo final de pago real con bancos, QR BCB, Tigo Money u otros.
- Política final de MDR, liquidación y facturación.

Si alguna de estas reglas afecta la implementación solicitada, debe detenerse y pedir aclaración.

### Referencia de pendientes

Todas estas decisiones abiertas deben conservarse marcadas en `PENDIENTES_ATLAS.md` y, cuando se genere código, en `docs/pending/pending-items.md`.

## 4. Decisiones de arquitectura ya fijadas

Estas decisiones deben respetarse:

1. **Contactos de terceros:** no guardar la agenda del usuario en servidor. Se procesa en el móvil y solo puede guardarse un puntaje o indicador agregado, con consentimiento.
2. **Señales del dispositivo:** no mezclar todas las señales en una tabla gigante. Separar por responsabilidad cuando el modelo lo permita.
3. **Productos futuros:** dejar puntos de extensión para préstamos con interés, reembolsos y cobranza avanzada, sin construirlos todavía.
4. **Cohorte y riesgo de originación:** cada compra debe guardar snapshot de cohorte, score, versión de modelo/regla y nivel de riesgo al originarse.
5. **Tipo de producto en planes de cuotas:** cada plan debe identificar el producto financiero al que pertenece.
6. **Límite de crédito como bitácora:** no sobrescribir simplemente el límite disponible; registrar movimientos para mantener historial completo.

## 5. Contexto Bolivia

Atlas debe diseñarse pensando en Bolivia:

- Existen burós como Infocred BI e Infocenter; el scoring puede requerir integración con historial crediticio real.
- No se debe asumir Stripe, Plaid ni rieles de pago estadounidenses.
- Las integraciones reales pueden incluir QR BCB Bolivia, Tigo Money y bancos locales.
- ASFI, contratos, consentimientos, privacidad, KYC y auditoría deben tratarse con cuidado.
- Facturación electrónica SIN puede volverse parte del flujo de comercio.

La IA no debe simular integraciones reales con proveedores si no se entregó documentación técnica. Debe crear interfaces/adaptadores claros y dejar implementaciones mock solo en ambientes locales.

## 6. Módulos por prioridad

### MVP piloto

1. Infraestructura y DevOps.
2. Base de datos y modelo de datos.
3. Backup y recuperación.
4. API backend.
5. KYC.
6. Legal y consentimientos.
7. Scoring crediticio.
8. Cobro / reporte / conciliación de pagos en Bolivia.
9. Liquidación y conciliación con comercios.
10. Comunicación SMS / WhatsApp / push.
11. QR.
12. App móvil del consumidor.
13. Panel interno de operaciones.
14. Portal web del comercio.
15. Notificaciones push.

### Fase 1

16. Cobranza y mora.
17. Incremento de línea.
18. Reglas de fraude y riesgo.
19. Onboarding de comercios.
20. Reportes y analítica.

### Fase 2

21. SDK JavaScript para comercios.
22. Referidos y lealtad.
23. Exportación contable y fiscal.

## 7. Criterio de éxito técnico

Una entrega Atlas es aceptable solo si:

- Es segura.
- Es auditable.
- No pierde historial financiero.
- No inventa reglas de crédito.
- Maneja errores de forma explícita.
- Tiene migraciones y seeds mínimos cuando corresponde.
- Tiene documentación clara para backend, web, mobile e infra.
- Incluye pruebas o al menos smoke tests ejecutables cuando se entrega código.
