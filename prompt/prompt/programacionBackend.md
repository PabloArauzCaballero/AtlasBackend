# Prompt backend Atlas — NestJS

Usa siempre NestJS + TypeScript + Sequelize + PostgreSQL + Zod + JWT.

No uses Express puro, FastAPI, Prisma, TypeORM, Pydantic, Alembic ni Celery.

## Capas

- Controller: HTTP delgado.
- Service: casos de uso.
- Repository: Sequelize.
- Model: persistencia.
- Schema: Zod.
- DTO/type: contrato.
- Mapper: respuesta segura.

## Módulos Atlas principales

- auth
- users
- consumers
- merchants
- kyc
- consents
- credit-lines
- purchases
- installment-plans
- payments
- merchant-settlements
- risk-scoring
- fraud
- collections
- notifications
- audit
- operations

## Reglas BNPL

- 60% inicial.
- 40% en 3 cuotas.
- Separación de 14 días salvo política más específica.
- No acelerar deuda por impago de una cuota.
- Guardar snapshot de riesgo/cohorte/modelo.
- Límite de crédito por movimientos.

## Obligatorio

- Migraciones Sequelize.
- Seeders mínimos si se pide probar.
- Guards.
- ZodValidationPipe.
- Exception filters.
- Swagger/OpenAPI.
- README por módulo.
- Tests o smoke tests.
