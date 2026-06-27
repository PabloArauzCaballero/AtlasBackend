# Checklist final para entregas Atlas

Antes de entregar cualquier ZIP, código o documentación, revisa dos veces:

## Stack

- [ ] Backend usa NestJS + TypeScript.
- [ ] ORM es Sequelize, no Prisma/TypeORM.
- [ ] Validación con Zod.
- [ ] Auth con JWT encapsulado.
- [ ] Web usa Next.js 15.
- [ ] Mobile usa Expo.
- [ ] Infra usa AWS/Terraform cuando aplica.

## Negocio

- [ ] Se respeta regla 60/40.
- [ ] Se crean 3 cuotas para el 40%.
- [ ] Se respeta separación de 14 días cuando aplica.
- [ ] No se acelera deuda completa por una cuota vencida.
- [ ] MDR se trata como ingreso del comercio, no cargo al cliente salvo regla explícita.
- [ ] El límite de crédito se registra por movimientos.
- [ ] La compra guarda snapshot de riesgo/cohorte/modelo.

## Seguridad y privacidad

- [ ] No se guarda agenda de contactos.
- [ ] No se guarda biometría cruda sin política explícita.
- [ ] No hay secrets.
- [ ] No hay `.env` real.
- [ ] No hay logs con PII.
- [ ] Endpoints sensibles tienen guards.
- [ ] Errores no exponen stack trace.

## Base de datos

- [ ] Cambios de schema tienen migración.
- [ ] Seeders son mínimos y seguros.
- [ ] Tablas financieras no se tratan como CRUD común.
- [ ] Hay auditoría o eventos para acciones críticas.
- [ ] No hay drops destructivos sin aprobación.

## Calidad

- [ ] Lint.
- [ ] Type-check.
- [ ] Tests o smoke tests.
- [ ] Build.
- [ ] README actualizado.
- [ ] OpenAPI/endpoints actualizados si hay API.
- [ ] Comandos de ejecución incluidos.

## Honestidad de entrega

- [ ] Se indica qué se validó realmente.
- [ ] Se indican supuestos.
- [ ] Se indican pendientes.
- [ ] Se entrega ZIP real si fue solicitado.


## Pendientes y supuestos

- [ ] Todo pendiente detectado quedó documentado en Markdown.
- [ ] Existe `docs/pending/pending-items.md` si se generó un proyecto, módulo o ZIP de implementación.
- [ ] Se actualizó `PENDIENTES_ATLAS.md` si el pendiente afecta reglas de producto Atlas.
- [ ] Los pendientes bloqueantes están marcados como `Bloqueante`, no como tareas menores.
- [ ] Los supuestos temporales están marcados como `SUPUESTO_ATLAS:`.
- [ ] No se implementó lógica definitiva sobre decisiones abiertas de crédito, dinero, scoring, KYC, consentimiento, pagos, MDR, liquidación, mora/default, facturación, seguridad, privacidad o auditoría.
- [ ] La respuesta final indica si quedan pendientes abiertos, bloqueantes o supuestos temporales.
