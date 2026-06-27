# SYSTEM INFO — Proyecto Atlas

**Versión:** 1.0  
**Fecha:** 2026-06-26  
**Documento:** Contexto integral de negocio, producto, operación y expectativas del sistema  
**Uso recomendado:** Documento base para prompts, arquitectura, diseño de módulos, definición de APIs, priorización de roadmap y alineación entre negocio, backend, frontend, mobile, datos, riesgo, fraude, legal y operaciones.

---

## 1. Identidad del producto

**Proyecto Atlas** es una fintech boliviana enfocada inicialmente en un modelo **BNPL — Buy Now, Pay Later**, es decir, compra ahora y paga después. Su objetivo de negocio es convertirse en un proveedor relevante de BNPL y crédito de consumo en Bolivia, empezando por Santa Cruz de la Sierra.

Atlas no debe entenderse únicamente como una app de cuotas. Debe entenderse como una **plataforma de inteligencia, originación, riesgo, fraude, comercio, operaciones y cobranza** que permite financiar compras de consumo en comercios aliados, con reglas propias de evaluación y seguimiento del usuario.

La idea central del modelo inicial es:

> El comercio vende el producto, el cliente paga una parte inicial al contado y Atlas asume el riesgo operativo/comercial asociado a las cuotas pendientes, ganando principalmente por una comisión cobrada al comercio.

---

## 2. Modelo de negocio base

### 2.1. Qué vende Atlas

Atlas vende a los comercios una solución para que puedan cerrar más ventas ofreciendo financiamiento al consumidor final sin construir ellos mismos una plataforma de riesgo, scoring, seguimiento, cobranza, conciliación y operación tecnológica.

Para el consumidor, Atlas ofrece acceso a compra financiada con una experiencia simple: registro, evaluación, aprobación, compra, calendario de pagos y seguimiento.

Para el equipo interno, Atlas ofrece un sistema de control de riesgo, fraude, operaciones, revisión manual, auditoría, reporting y monitoreo.

### 2.2. Quién paga a Atlas

El ingreso principal inicial viene del **MDR — Merchant Discount Rate**, una comisión cobrada al comercio por cada venta financiada. En el modelo actual, el cliente no es la fuente principal de ingresos por intereses.

### 2.3. Por qué el comercio aceptaría pagar MDR

El comercio paga porque Atlas debe ayudarle a:

- Aumentar conversión de ventas.
- Vender productos de mayor ticket.
- Reducir fricción en el checkout.
- Dar una alternativa a clientes sin tarjeta de crédito o sin acceso fluido a crédito formal.
- Transferir a Atlas parte de la complejidad de evaluación, riesgo, operación y seguimiento.
- Recibir soporte en conciliación, liquidación, documentación y trazabilidad.

### 2.4. Riesgo central del negocio

El riesgo principal es que el cliente no pague las cuotas futuras. Por eso el sistema no puede ser solo transaccional; debe ser, desde el inicio, una plataforma de **conocimiento del usuario, riesgo y fraude**.

---

## 3. Producto financiero inicial

### 3.1. Plan estándar de lanzamiento

El flujo base del producto inicial es:

1. El cliente se registra y es evaluado.
2. El sistema decide si aprueba, rechaza o deriva a revisión manual.
3. Si aprueba, se asigna una línea o capacidad de compra.
4. El cliente elige un producto en un comercio aliado.
5. El cliente paga el **60% del monto al contado** directamente al comercio.
6. El **40% restante** se divide en **3 cuotas iguales**.
7. Las cuotas tienen separación de aproximadamente **14 días**.
8. El cliente paga cada cuota directamente al comercio.
9. Si el cliente no paga una cuota, Atlas cubre esa cuota específica al comercio en la fecha pactada y luego cobra esa cuota al cliente.

### 3.2. Regla crítica: no aceleración de deuda

Una regla fundamental del modelo es que **Atlas no acelera la deuda completa cuando el cliente incumple una cuota**.

Ejemplo:

- Si el cliente se atrasa en la cuota 2, Atlas no exige automáticamente el saldo completo.
- El calendario original se mantiene.
- Atlas cubre al comercio cuota por cuota, según las fechas originales.
- La cobranza al cliente se gestiona por cuota vencida, no por aceleración total del saldo.

Esta regla afecta directamente:

- Calendario de obligaciones.
- Estados de mora.
- Cobranza.
- Provisiones internas.
- Conciliación con comercios.
- Reportes de riesgo.
- Experiencia del cliente.
- Diseño de base de datos.

---

## 4. Qué debe ser el sistema Atlas

Atlas debe ser un sistema de varias capas. No debe diseñarse como una aplicación simple de CRUD.

Debe cubrir, como mínimo, estos frentes:

1. **App del consumidor**: registro, KYC, evaluación, compras, cuotas, pagos, notificaciones, soporte, consentimiento y perfil.
2. **Portal del comercio**: onboarding de comercio, generación de venta, validación de cliente, seguimiento de operaciones, liquidaciones, conciliaciones y reportes.
3. **Panel interno de operaciones**: revisión manual, casos de fraude, soporte, monitoreo, gestión de mora, conciliación, auditoría y análisis.
4. **Backend central**: APIs, motor de reglas, scoring, persistencia, integraciones, seguridad, observabilidad y procesos asíncronos.
5. **Capa de riesgo y fraude**: evaluación del cliente, dispositivo, sesión, comportamiento, checkout, comercio y señales externas.
6. **Capa de datos e inteligencia**: observaciones, atributos, features, snapshots, auditoría, trazabilidad y calidad de datos.
7. **Capa legal/compliance**: consentimiento, privacidad, retención, trazabilidad de decisiones y preparación para supervisión regulatoria.

---

## 5. Qué se espera que haga el sistema

### 5.1. En el consumidor

El sistema debe permitir que un consumidor:

- Se registre de forma simple.
- Verifique su identidad progresivamente.
- Entienda qué datos se le solicitan y para qué.
- Otorgue, revoque o actualice consentimientos cuando corresponda.
- Solicite evaluación de riesgo.
- Consulte su estado: pendiente, aprobado, rechazado, suspendido, bloqueado o en revisión.
- Vea su capacidad de compra disponible cuando exista el módulo financiero.
- Inicie una compra en comercio aliado.
- Confirme el pago inicial.
- Vea calendario de cuotas.
- Reciba recordatorios.
- Reporte problemas de compra, devolución o disputa.
- Consulte historial de operaciones.
- Reciba comunicación clara y no abusiva.
- Solicite soporte.

### 5.2. En el comercio

El sistema debe permitir que un comercio:

- Se registre y sea evaluado por Atlas.
- Configure sucursales, usuarios y permisos.
- Genere una venta financiada.
- Valide si un cliente puede operar.
- Consulte el estado de una compra.
- Confirme recepción del pago inicial.
- Consulte cuotas esperadas.
- Reporte pagos recibidos del cliente.
- Revise liquidaciones.
- Revise conciliaciones.
- Descargue reportes.
- Gestionar devoluciones, cancelaciones y disputas.
- Tener trazabilidad clara de comisiones MDR.

### 5.3. En operaciones internas

El sistema debe permitir que el equipo interno:

- Revise usuarios en onboarding.
- Apruebe, rechace o solicite información adicional.
- Revise casos de riesgo o fraude.
- Consulte historial de señales del usuario.
- Consulte evidencia asociada a una decisión.
- Audite decisiones automáticas y manuales.
- Gestione comercios.
- Supervise compras y cuotas.
- Detecte inconsistencias.
- Gestione reclamos, devoluciones y disputas.
- Gestione mora y cobranza sin acelerar indebidamente la deuda.
- Monitoree KPIs de riesgo, originación, mora, fraude y rentabilidad.

### 5.4. En riesgo y fraude

El sistema debe:

- Evaluar riesgo antes de aprobar capacidad de compra.
- Evaluar riesgo en el momento del checkout.
- Separar riesgo crediticio de riesgo de fraude.
- Considerar señales del usuario, dispositivo, sesión, comportamiento y contexto de compra.
- Guardar explicaciones y trazabilidad de cada evaluación.
- Permitir reglas automáticas y revisión manual.
- Mantener listas de observación, bloqueos y alertas.
- No tratar el scoring como caja negra.
- Permitir monitorear desempeño por cohortes, segmentos y fuentes.
- Preparar el terreno para modelos estadísticos futuros sin depender de ellos desde el día uno.

### 5.5. En datos y analítica

El sistema debe:

- Capturar datos mínimos necesarios.
- Evitar almacenar información sensible innecesaria.
- Diferenciar datos crudos, datos derivados, snapshots y features.
- Permitir reconstruir decisiones históricas.
- Medir calidad de datos.
- Mantener bitácoras de eventos relevantes.
- Permitir análisis por cohortes.
- Etiquetar riesgo al momento de originación.
- Generar datasets confiables para futuros modelos de scoring.

---

## 6. Actores del sistema

### 6.1. Consumidor / cliente final

Persona que desea comprar en un comercio aliado usando el producto Atlas.

Necesidades:

- Registro fácil.
- Decisión rápida.
- Explicación clara.
- Recordatorios.
- Transparencia.
- Soporte.

Riesgos asociados:

- Identidad falsa.
- Fraude de primera compra.
- Incapacidad de pago.
- Multi-cuenta.
- Manipulación de dispositivo.
- Incumplimiento.

### 6.2. Comercio aliado

Empresa o tienda que ofrece productos financiables con Atlas.

Necesidades:

- Vender más.
- Validar clientes rápido.
- Confirmar operaciones.
- Saber cuándo recibe dinero.
- Tener conciliación clara.

Riesgos asociados:

- Comercios falsos.
- Colusión comercio-cliente.
- Simulación de ventas.
- Inflación artificial de tickets.
- Falta de conciliación.
- Reclamos por entrega o devolución.

### 6.3. Usuario interno de Atlas

Operador, analista de riesgo, soporte, administrador, compliance o auditor.

Necesidades:

- Visibilidad completa.
- Permisos por rol.
- Registro de acciones.
- Herramientas de revisión.
- Reportes.

Riesgos asociados:

- Acceso indebido a datos sensibles.
- Cambios no auditados.
- Decisiones manuales inconsistentes.
- Fuga de información.

### 6.4. Proveedor externo

Buró, proveedor KYC, mensajería, pagos, facturación, banco, QR, Tigo Money u otro.

Necesidades:

- Integración segura.
- Idempotencia.
- Trazabilidad.
- Manejo de errores.
- Reintentos controlados.

Riesgos asociados:

- Caídas.
- Latencia.
- Respuestas inconsistentes.
- Cambios de API.
- Costos variables.
- Dependencia operativa.

---

## 7. Módulos funcionales esperados

### 7.1. Infraestructura y DevOps

Debe cubrir:

- Ambientes separados: local, dev, staging, producción.
- CI/CD.
- Logs centralizados.
- Monitoreo.
- Alertas.
- Backups.
- Seguridad.
- Gestión de secretos.
- Migraciones controladas.
- Infraestructura reproducible.

### 7.2. Base de datos y modelo de datos

Debe cubrir:

- Usuarios.
- Comercios.
- Identidad.
- Consentimientos.
- Dispositivos.
- Sesiones.
- Señales de comportamiento.
- Evaluaciones de riesgo.
- Fraude.
- Compras.
- Cuotas.
- Pagos.
- Mora.
- Liquidaciones.
- Conciliación.
- Auditoría.
- Reportes.

En la fase actual ya se empezó por la capa de usuario, inteligencia y fraude, sin modelar todavía crédito, pagos ni cuotas.

### 7.3. KYC / identidad

Debe cubrir:

- Captura de datos personales mínimos.
- Validación de documento.
- Verificación de teléfono y correo.
- Pruebas de vida si aplica.
- Evidencia de identidad.
- Registro de proveedor usado.
- Resultado de validación.
- Reintentos y fallos.
- Revisión manual.

### 7.4. Consentimiento, privacidad y retención

Debe cubrir:

- Versiones de consentimiento.
- Finalidad de uso de datos.
- Fecha y canal de aceptación.
- Revocación.
- Políticas de retención.
- Minimización de datos.
- Encriptación o hashing de campos sensibles.
- No almacenamiento de contactos crudos de agenda.
- Auditoría de acceso.

### 7.5. Motor de scoring y riesgo

Debe cubrir:

- Evaluación por reglas iniciales.
- Evaluación por scorecard cuando exista suficiente data.
- Separación de variables permitidas/prohibidas.
- Explicabilidad.
- Cutoffs.
- Revisión manual.
- Versionamiento de modelos/reglas.
- Monitoreo de performance.
- Reportes de estabilidad.

### 7.6. Motor de fraude

Debe cubrir:

- Riesgo de identidad.
- Riesgo de dispositivo.
- Riesgo de sesión.
- Riesgo de comportamiento.
- Riesgo de comercio.
- Riesgo de checkout.
- Multi-cuenta.
- Velocity checks.
- Watchlists.
- Bloqueos.
- Evidencias.

### 7.7. Checkout y compra

Debe cubrir:

- Inicio de compra desde comercio.
- Validación de cliente.
- Evaluación de riesgo en checkout.
- Registro de contexto de compra.
- Confirmación de pago inicial.
- Generación de plan de cuotas.
- Registro de estado de compra.
- Cancelación o expiración.
- Manejo de disputas.

### 7.8. Pagos Bolivia

Debe cubrir:

- QR BCB.
- Transferencias bancarias.
- Tigo Money si aplica.
- Confirmación manual inicialmente si no hay API confiable.
- Conciliación automática cuando sea posible.
- Estados: pendiente, confirmado, rechazado, observado, reversado.
- Idempotencia.
- Evidencia de pago.

### 7.9. Liquidación y conciliación con comercios

Debe cubrir:

- Comisiones MDR.
- Ventas originadas.
- Cuotas pagadas al comercio.
- Cuotas cubiertas por Atlas.
- Saldos por comercio.
- Reportes diarios/semanales.
- Diferencias entre lo esperado y lo recibido.
- Estados de conciliación.

### 7.10. Cobranza y mora

Debe cubrir:

- Recordatorios preventivos.
- Mora por cuota.
- Estados de atraso.
- Suspensión de línea.
- Default según política futura.
- Contactabilidad.
- Promesas de pago.
- Gestión manual.
- Trazabilidad de comunicaciones.
- Prohibición de acelerar deuda si la política vigente lo mantiene.

### 7.11. Comunicaciones

Debe cubrir:

- WhatsApp.
- SMS.
- Email.
- Push notifications.
- Plantillas versionadas.
- Preferencias del usuario.
- Opt-in/opt-out.
- Registro de envíos.
- Fallos y reintentos.

### 7.12. Portal comercio

Debe cubrir:

- Login de comercio.
- Gestión de usuarios y roles.
- Generación de venta.
- Búsqueda de operaciones.
- Confirmación de pago inicial.
- Reporte de pagos de cuotas.
- Liquidaciones.
- Disputas.
- Soporte.

### 7.13. Panel admin / operaciones

Debe cubrir:

- Gestión de clientes.
- Gestión de comercios.
- Casos de revisión manual.
- Casos de fraude.
- Auditoría.
- Reportes.
- Gestión de roles.
- Configuración de reglas.
- Monitoreo operativo.

### 7.14. Reportes y analítica

Debe cubrir:

- Originaciones.
- Aprobaciones.
- Rechazos.
- Revisión manual.
- Mora por cohorte.
- Fraude detectado.
- Conversión por comercio.
- Ticket promedio.
- MDR generado.
- Pérdida esperada.
- Pérdida real.
- Calidad de datos.
- Estabilidad de score.

---

## 8. Contexto específico de Bolivia

### 8.1. Pagos

Bolivia no tiene un ecosistema idéntico al de mercados con Stripe, Plaid o open banking ampliamente estandarizado. Por eso el sistema debe prepararse para integraciones más locales y, en algunos casos, procesos híbridos.

El **QR BCB Bolivia** es clave porque permite pagos en comercios, mercados, ecommerce, páginas web y pasarelas. Esto lo convierte en un riel natural para pagos iniciales, cuotas y comprobantes de operación.

### 8.2. Regulación fintech

ASFI aprobó en 2025 el reglamento para **Empresas de Tecnología Financiera — ETF** mediante la Resolución ASFI/540/2025. Aunque la estrategia exacta debe revisarse con asesoría legal, el sistema debe diseñarse desde el inicio con trazabilidad, auditoría, controles, segregación de roles y evidencia suficiente para una futura formalización o supervisión.

### 8.3. Burós y datos externos

Bolivia cuenta con burós y proveedores de información crediticia. Atlas no debe depender únicamente de señales alternativas. El sistema debe estar preparado para integrar datos de buró, KYC, comportamiento y señales propias, respetando consentimiento y finalidad.

### 8.4. Facturación SIN

La facturación electrónica boliviana exige sistemas autorizados, emisión digital, validación y elementos como CUF/CUFD según modalidad. Aunque no sea el primer módulo, Atlas debe contemplar integración o interoperabilidad con facturación del comercio, porque puede afectar conciliación, soporte, disputas y formalidad operativa.

### 8.5. Datos personales

La Ley N.º 164 de Bolivia reconoce deberes de protección de datos personales y evita divulgación no autorizada. Para Atlas esto implica que el sistema debe aplicar minimización, consentimiento, cifrado, hashing, retención y auditoría desde la arquitectura base.

---

## 9. Principios de riesgo crediticio aplicables

El motor de riesgo debe construirse como un sistema explicable y gobernable.

Buenas prácticas a respetar:

- El score no debe ser una caja negra operativa.
- Las variables usadas deben ser entendibles, disponibles y legalmente defendibles.
- Debe existir separación entre score, reglas de política y overrides manuales.
- Deben definirse buenos, malos e indeterminados con criterios claros.
- Deben usarse cohortes y ventanas de performance para aprender del comportamiento real.
- Deben monitorearse estabilidad, drift, tasas de aprobación, mora y fraude.
- Debe existir revisión preimplementación antes de usar modelos en producción.

En etapa temprana, Atlas probablemente deberá iniciar con reglas heurísticas y scorecards simples, y luego evolucionar a modelos estadísticos más robustos cuando tenga suficiente muestra real.

---

## 10. Principios de fraude aplicables a BNPL

BNPL tiene riesgo particular porque la decisión ocurre muy cerca del checkout y el producto puede salir rápido del comercio.

El sistema debe cubrir fraude en tres momentos:

1. **Onboarding:** identidad falsa, documentos dudosos, teléfonos desechables, múltiples cuentas.
2. **Actividad post-login:** cambios de dispositivo, comportamiento anómalo, intento de evadir validaciones.
3. **Checkout:** monto inusual, comercio riesgoso, velocidad de intentos, patrón raro de compra, relación sospechosa cliente-comercio.

La defensa no debe basarse en una sola señal. Debe combinar:

- Identidad.
- Dispositivo.
- Sesión.
- Geografía.
- Comercio.
- Historial.
- Comportamiento.
- Watchlists.
- Evidencia externa.

---

## 11. Estados críticos que el sistema debe modelar

### 11.1. Cliente

Estados sugeridos:

- `pending_registration`
- `pending_kyc`
- `pending_review`
- `approved`
- `rejected`
- `active`
- `suspended`
- `blocked`
- `closed_by_user`
- `deleted_by_compliance`

### 11.2. Comercio

Estados sugeridos:

- `draft`
- `pending_review`
- `approved`
- `active`
- `suspended`
- `blocked`
- `terminated`

### 11.3. Compra

Estados sugeridos:

- `initiated`
- `pending_initial_payment`
- `initial_payment_confirmed`
- `active_installment_plan`
- `cancelled`
- `expired`
- `completed`
- `disputed`
- `refunded`

### 11.4. Cuota

Estados sugeridos:

- `scheduled`
- `due_soon`
- `due_today`
- `paid_to_merchant`
- `late`
- `covered_by_atlas`
- `collection_active`
- `recovered`
- `written_off`

### 11.5. Evaluación de riesgo

Estados sugeridos:

- `started`
- `completed_approved`
- `completed_rejected`
- `manual_review_required`
- `failed_provider_error`
- `failed_insufficient_data`
- `expired`

---

## 12. Reglas de negocio pendientes que deben cerrarse

Antes de implementar módulos financieros completos, deben definirse estas políticas:

1. Si un usuario puede tener varias compras activas simultáneamente.
2. Cuánto tiempo tiene para completar el pago inicial antes de expirar la compra.
3. Días exactos para suspensión de línea.
4. Días exactos para default.
5. Cómo se cobra MDR: manual, automático, neteado contra liquidaciones o por factura.
6. Datos mínimos de registro inicial.
7. Datos progresivos posteriores.
8. Política de devolución y disputa.
9. Política de cancelación de compra.
10. Política de comercios de alto riesgo.
11. Política de reintentos de pago.
12. Política de contacto en cobranza.
13. Política de reactivación de usuario suspendido.
14. Política de fraude confirmado vs sospecha.
15. Política de retención de evidencias.

---

## 13. Qué NO debe hacer el sistema sin definición previa

El sistema no debe:

- Aprobar crédito sin registrar la versión de reglas/modelo usada.
- Guardar contactos crudos de agenda del usuario en servidor.
- Guardar datos sensibles en texto claro si no es estrictamente necesario.
- Usar variables legalmente dudosas sin revisión.
- Permitir acciones internas sin auditoría.
- Permitir cambios de estados críticos sin trazabilidad.
- Acelerar deuda si la política vigente dice que no se acelera.
- Mezclar pagos del cliente, pagos al comercio y MDR sin conciliación clara.
- Depender solo de confirmaciones manuales sin plan de control.
- Implementar modelos de scoring opacos sin monitoreo.
- Crear endpoints administrativos sin permisos granulares.
- Registrar tokens, contraseñas o información sensible en logs.

---

## 14. Criterios de diseño para desarrollo técnico

### 14.1. Arquitectura backend

El backend debe usar:

- NestJS.
- TypeScript.
- Sequelize.
- PostgreSQL.
- Zod para validación.
- JWT para autenticación cuando se implemente auth.
- Guards para permisos.
- Migraciones controladas.
- Documentación por módulo.
- Separación entre controllers, services, repositories, schemas, DTOs y mappers.

### 14.2. Diseño de datos

La base debe diferenciar:

- Tablas operativas.
- Eventos append-only.
- Snapshots.
- Proyecciones reconstruibles.
- Catálogos.
- Evidencias sensibles.
- Configuración YAML no ORM.

### 14.3. Seguridad

Debe contemplar:

- Cifrado en tránsito.
- Cifrado en reposo.
- Hashing de identificadores sensibles para búsqueda.
- Gestión de secretos.
- RBAC.
- Auditoría.
- Rate limiting.
- Idempotencia.
- Protección ante abuso.

### 14.4. Observabilidad

Debe contemplar:

- Correlation IDs.
- Logs estructurados.
- Métricas por módulo.
- Alertas de fallos críticos.
- Trazabilidad de integraciones.
- Auditoría de decisiones.

---

## 15. Flujos principales esperados

### 15.1. Registro y evaluación inicial

1. Cliente instala app o abre flujo web.
2. Ingresa teléfono/correo.
3. Verifica OTP.
4. Acepta términos y consentimiento.
5. Completa datos mínimos.
6. Se captura contexto de dispositivo y sesión.
7. Se ejecuta evaluación de identidad, riesgo y fraude.
8. El sistema aprueba, rechaza o deriva a revisión.
9. Se registra explicación y evidencia.

### 15.2. Compra en comercio

1. Comercio inicia venta.
2. Cliente es identificado.
3. Sistema valida estado del cliente.
4. Sistema evalúa contexto de checkout.
5. Si aprueba, muestra condiciones.
6. Cliente paga 60% al comercio.
7. Comercio confirma o el sistema concilia el pago.
8. Se activa plan de cuotas.
9. Se generan recordatorios.

### 15.3. Pago de cuota

1. Se aproxima vencimiento.
2. Sistema envía recordatorio.
3. Cliente paga al comercio.
4. Comercio reporta pago o se concilia por integración.
5. Se actualiza cuota.
6. Se registra evidencia.
7. Si no paga, se activa mora.

### 15.4. Incumplimiento de cuota

1. Cuota vence sin pago confirmado.
2. Sistema marca atraso.
3. Atlas cubre esa cuota al comercio si corresponde.
4. Cliente pasa a cobranza por esa cuota específica.
5. No se acelera automáticamente la deuda completa.
6. Se actualiza riesgo del cliente.

### 15.5. Disputa o devolución

1. Cliente o comercio reporta problema.
2. Se abre caso.
3. Se congela o marca la operación según política.
4. Se solicita evidencia.
5. Operaciones resuelve.
6. Se ajustan cuotas, saldos, liquidaciones y reportes.

---

## 16. KPIs que el sistema debe poder medir

### 16.1. Producto

- Registros iniciados.
- Registros completados.
- Tasa de aprobación.
- Tasa de rechazo.
- Tasa de revisión manual.
- Tiempo promedio de decisión.
- Conversión checkout.
- Ticket promedio.

### 16.2. Riesgo

- Mora por cuota.
- Mora por cohorte.
- Default.
- Pérdida esperada.
- Pérdida real.
- Cure rate.
- Roll rate.
- Usuarios suspendidos.
- Usuarios reactivados.

### 16.3. Fraude

- Casos sospechosos.
- Fraude confirmado.
- Intentos bloqueados.
- Multi-cuenta detectada.
- Fraude por comercio.
- Falsos positivos.
- Falsos negativos.

### 16.4. Comercio

- Ventas financiadas.
- MDR generado.
- Conversión por comercio.
- Mora por comercio.
- Disputas por comercio.
- Conciliaciones pendientes.

### 16.5. Operaciones

- Casos abiertos.
- SLA de revisión.
- Tiempo de resolución.
- Casos vencidos.
- Acciones manuales.
- Errores de integración.

---

## 17. Roadmap funcional recomendado

### 17.1. MVP técnico mínimo

1. Infraestructura.
2. Base de datos.
3. Autenticación y roles.
4. KYC básico.
5. Consentimiento.
6. Perfil de cliente.
7. Dispositivo/sesión.
8. Evaluación inicial de riesgo/fraude.
9. Revisión manual.
10. Portal interno mínimo.

### 17.2. MVP comercial

1. Onboarding comercio.
2. Portal comercio básico.
3. Creación de venta.
4. Validación cliente.
5. Confirmación de pago inicial.
6. Plan de cuotas.
7. Recordatorios.
8. Conciliación manual controlada.
9. Reporte básico de MDR.

### 17.3. Crecimiento temprano

1. Cobranza.
2. Motor de incremento de línea.
3. Fraude avanzado.
4. Liquidaciones automáticas.
5. Dashboard de reportes.
6. Integraciones con proveedores.

### 17.4. Escala

1. SDK checkout.
2. APIs para comercios.
3. Integración profunda con facturación.
4. Modelos estadísticos.
5. Automatización de cobranza.
6. Exportación contable/fiscal.

---

## 18. Preguntas estratégicas para dirección

Antes de construir la parte financiera completa, dirección debe responder:

1. ¿Atlas será legalmente acreedor, garante, comprador de cartera o proveedor tecnológico con obligación comercial?
2. ¿Cómo se formaliza la obligación del cliente?
3. ¿Qué documento contractual acepta el cliente?
4. ¿Qué documento contractual firma el comercio?
5. ¿Cómo se factura el MDR?
6. ¿Quién emite factura al consumidor final?
7. ¿Qué pasa si el producto se devuelve después de activadas cuotas?
8. ¿Qué pasa si el comercio confirma pago falso?
9. ¿Qué comercios están prohibidos?
10. ¿Qué límites iniciales se manejarán?
11. ¿Se reportará comportamiento a burós?
12. ¿Qué datos alternativos son legalmente aceptables?
13. ¿Cuál es el apetito de riesgo inicial?
14. ¿Cuál es la pérdida máxima aceptable del piloto?
15. ¿Qué debe ocurrir para suspender operaciones con un comercio?

---

## 19. Supuestos actuales

Este documento asume:

- Atlas inicia con un producto tipo BNPL sin interés explícito al consumidor.
- El ingreso principal inicial es MDR.
- El cliente paga inicialmente 60%.
- El saldo se divide en 3 cuotas de 14 días.
- El cliente paga directamente al comercio.
- Atlas no es intermediario de pago en el MVP.
- Atlas cubre cuotas específicas impagas al comercio según calendario original.
- No se acelera la deuda completa.
- El sistema debe diseñarse para Bolivia.
- El sistema debe preservar privacidad y trazabilidad desde el inicio.

Si cualquiera de estos supuestos cambia, este documento debe actualizarse antes de seguir desarrollando módulos dependientes.

---

## 20. Fuentes consultadas

### Fuentes internas del proyecto

- `Proyecto_Atlas_Brief (1).docx`.
- `Atlas_User_Intelligence_Fraud_Schema_v5_2_1_NO_ORM_ROADMAP_YAML.puml`.
- `Se ha pegado el markdown.md` — lineamientos backend NestJS.
- `Se ha pegado el markdown (2).md` — lineamientos de programación profesional.
- `Credit_Risk_Scorecards_Developing_and_Im.pdf` — Naeem Siddiqi, *Credit Risk Scorecards*.

### Fuentes externas revisadas

- ASFI — Reglamento para Empresas de Tecnología Financiera, Resolución ASFI/540/2025: https://servdmzw.asfi.gob.bo/circular/Circulares/ASFI_885.pdf
- ASFI — Nota institucional sobre reglamento ETF: https://www.asfi.gob.bo/node/1176
- Banco Central de Bolivia — QR BCB Bolivia: https://www.bcb.gob.bo/?q=pagos_qr_bcb_bolivia
- Banco Central de Bolivia — lanzamiento QR BCB Bolivia: https://www.bcb.gob.bo/?q=content/el-bcb-lanza-el-qr-bcb-bolivia-para-desarrollar-e-implementar-un-sistema-de-pagos-moderno
- Servicio de Impuestos Nacionales — Factura Electrónica SIAT: https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/factura-electronica
- Servicio de Impuestos Nacionales — Generación CUF: https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/algoritmos-utilizados/generacion-cuf
- Ley N.º 164 — Telecomunicaciones, TIC y protección de datos personales: https://www.lexivox.org/norms/BO-L-N164.pdf
- OCC — Retail Lending: Risk Management of Buy Now, Pay Later Lending: https://www.occ.gov/news-issuances/bulletins/2023/bulletin-2023-37.html
- CFPB — BNPL market trends and consumer impacts: https://files.consumerfinance.gov/f/documents/cfpb_buy-now-pay-later-market-trends-consumer-impacts_report_2022-09.pdf
- McKinsey — Buy Now, Pay Later: Five business models to compete: https://www.mckinsey.com/industries/financial-services/our-insights/buy-now-pay-later-five-business-models-to-compete
- World Bank — Alternative data in credit risk assessment: https://documents1.worldbank.org/curated/en/099031325132018527/pdf/P179614-3e01b947-cbae-41e4-85dd-2905b6187932.pdf
- World Bank — Responsible digital credit: https://documents1.worldbank.org/curated/en/099072425135514500/pdf/P181316-72eed651-b7c2-4137-a1f0-a00c3e1efede.pdf

---

## 21. Resumen ejecutivo final

Atlas debe construirse como una plataforma financiera-operativa de riesgo, no como una simple app de cuotas. El MVP debe resolver primero la base confiable: identidad, consentimiento, usuario, dispositivo, sesión, riesgo, fraude, auditoría, comercio y operación. Luego debe integrar compra, cuotas, pagos, conciliación y cobranza.

El éxito del sistema depende de cinco capacidades críticas:

1. Conocer al usuario sin invadir innecesariamente su privacidad.
2. Tomar decisiones de riesgo rápidas, explicables y auditables.
3. Dar al comercio una experiencia simple y confiable.
4. Controlar mora, fraude y conciliación desde el primer día.
5. Diseñar todo con suficiente trazabilidad para crecer hacia regulación, scoring avanzado, reportes y escala operativa.
