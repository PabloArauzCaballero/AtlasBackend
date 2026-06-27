# Informe de progreso del proyecto

## 1. Resumen del ciclo de trabajo

Se implementó la primera fase de endpoints de negocio del backend Atlas sobre el schema existente. La entrega se enfocó en onboarding inicial de cliente, consentimiento, sesiones/dispositivo, lectura de riesgo existente y lectura operativa interna de revisión/fraude.

No se crearon entidades nuevas ni endpoints para seeders.

## 2. Avance realizado

- Se convirtió el backend de migraciones en una API NestJS ejecutable.
- Se agregó `@nestjs/platform-express` para levantar servidor HTTP real.
- Se agregó JWT Bearer para endpoints protegidos.
- Se creó script `npm run dev:jwt` para generar tokens locales de prueba sin crear endpoint de login.
- Se agregaron modelos Sequelize para tablas existentes usadas por los primeros endpoints.
- Se creó módulo `customers`.
- Se creó módulo `consents`.
- Se creó módulo `sessions`.
- Se creó módulo `risk`.
- Se creó módulo `operations`.
- Se agregó validación Zod por endpoint.
- Se agregó filtro global de errores.
- Se agregó interceptor global de respuesta normalizada.
- Se documentaron endpoints en `docs/endpoints/endpoints.md`.
- Se documentó arquitectura en `docs/architecture/architecture.md`.
- Se documentaron flujos en `docs/architecture/flows.md`.
- Se agregó colección Postman en `docs/postman/collection.json`.

## 3. Riesgos detectados

| Riesgo | Impacto | Mitigación recomendada |
|---|---|---|
| No existe entidad de credenciales/password hash en el schema actual. | No se puede implementar login real sin inventar entidad o guardar secretos en tablas no diseñadas para eso. | Diseñar módulo Auth formal con tabla aprobada de credenciales o proveedor externo de identidad. |
| Las políticas de scoring, cutoffs y reason codes no están cerradas. | Implementar aprobación/rechazo automático ahora sería una decisión inventada. | Mantener endpoints de riesgo en solo lectura hasta cerrar políticas de riesgo. |
| Las transiciones de revisión manual y fraude no están definidas. | Un endpoint de actualización de estado podría romper operación, auditoría o permisos. | Definir estados, transiciones, roles y auditoría antes de habilitar mutaciones. |
| Todavía no existe estrategia completa de permisos por rol. | Los roles actuales protegen por grupos amplios. | Diseñar matriz RBAC/ABAC por módulo antes de ampliar operaciones internas. |
| Los endpoints dependen de migraciones ejecutadas previamente. | Sin base PostgreSQL migrada, la API compila pero no puede operar. | Ejecutar `npm run db:migration:up` y `npm run db:seed:up` en ambiente local. |

## 4. Decisiones clave tomadas

| Decisión | Justificación | Impacto |
|---|---|---|
| No crear endpoint de login. | El schema actual no define persistencia de credenciales. | Se evita inventar entidades y se usa JWT externo/dev para pruebas. |
| Proteger endpoints sensibles con JWT Bearer. | Los documentos de prompt exigen separar autenticación/autorización y proteger operaciones sensibles. | La API ya queda lista para integrarse con Auth formal. |
| Implementar registro de cliente con teléfono/email hasheados. | El SYSTEM INFO exige minimizar datos sensibles y evitar exposición innecesaria. | Se puede probar onboarding sin guardar PII en claro. |
| Implementar riesgo solo lectura. | No existen políticas cerradas de scoring/cutoffs. | Se evita una decisión automática falsa. |
| Implementar operaciones internas solo lectura. | Las transiciones de estados no están definidas. | Se entrega valor de inspección sin alterar negocio. |

## 5. Desviaciones de lo esperado

| Desviación | Motivo | Acción recomendada |
|---|---|---|
| No se implementó login. | No existe entidad aprobada para credenciales. | Diseñar Auth en una fase específica. |
| No se implementó endpoint para ejecutar scoring. | Faltan políticas de scorecard, cutoffs, reglas y reason codes aprobados. | Cerrar brief de scoring antes de crear mutaciones. |
| No se implementaron endpoints de compras, cuotas, pagos, MDR o cobranza. | El usuario pidió no salir del SYSTEM INFO ni crear lógica no definida; además hay preguntas de política pendientes. | Implementar en fases posteriores cuando se cierre política de producto financiero. |

## 6. Fase actual del proyecto

Fase API 1: endpoints iniciales de negocio sobre cliente, consentimiento, sesión/dispositivo, riesgo existente y operaciones internas de solo lectura.

## 7. Próxima fase recomendada

Fase API 2 recomendada: módulo Auth formal o KYC documental, dependiendo de cuál decisión se cierre primero.

Antes de implementar compras BNPL se deben resolver al menos:

- Concurrencia de compras activas.
- Expiración del pago inicial 60%.
- Estados de mora/default.
- Política de MDR.
- Campos obligatorios por etapa de onboarding.

## 8. Estado general del entregable

Parcial, completo para la Fase API 1, pendiente de validación contra PostgreSQL local migrado.
