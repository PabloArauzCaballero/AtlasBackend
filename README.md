# Proyecto Atlas — Backend Fase API 1

Este proyecto contiene la base NestJS + Sequelize + PostgreSQL del backend Atlas.

La entrega actual incluye:

- Migraciones iniciales.
- Seeders mínimos de desarrollo.
- Primeros endpoints de negocio por fase.
- JWT Bearer para endpoints protegidos.
- Validaciones Zod.
- Repositories Sequelize.
- DTOs y mappers seguros.
- Documentación de endpoints, arquitectura, flujos y Postman.

## Instalar dependencias

```bash
npm install
```

## Configurar entorno

```bash
cp .env.example .env
```

Ajusta PostgreSQL y define un secreto JWT fuerte:

```env
JWT_ACCESS_TOKEN_SECRET=change-this-secret-with-at-least-32-characters
```

## Base de datos

Ejecutar migraciones:

```bash
npm run db:migration:up
```

Ejecutar seeds mínimos:

```bash
npm run db:seed:up
```

Ver estado:

```bash
npm run db:migration:status
npm run db:seed:status
```

## Levantar API

```bash
npm run start:dev
```

La API queda disponible en:

```txt
http://localhost:3000/api/v1
```

## Generar JWT local de prueba

Cliente:

```bash
npm run dev:jwt -- --role=customer --tenant-id=1 --customer-id=1
```

Interno/admin:

```bash
npm run dev:jwt -- --role=admin --tenant-id=1 --internal-user-id=1
```

No existe endpoint de login en esta fase porque el schema actual no define entidad de credenciales/password hash. Se evita inventar una tabla o guardar secretos en un lugar incorrecto.

## Endpoints implementados

Públicos:

- `POST /api/v1/customers/register`
- `GET /api/v1/consent-documents/active`

Protegidos:

- `GET /api/v1/customers/:customerId/summary`
- `POST /api/v1/customers/:customerId/consents`
- `POST /api/v1/customers/:customerId/sessions`
- `GET /api/v1/customers/:customerId/sessions`
- `GET /api/v1/customers/:customerId/risk/latest`
- `GET /api/v1/operations/manual-review-cases`
- `GET /api/v1/operations/fraud-cases`

Documentación completa:

```txt
docs/endpoints/endpoints.md
docs/architecture/architecture.md
docs/architecture/flows.md
docs/postman/collection.json
```

## Calidad

Validar TypeScript:

```bash
npm run type-check
```

Compilar:

```bash
npm run build
```

## Exclusiones explícitas

No se implementó:

- Endpoints para seeds.
- Login real.
- Password hash.
- Refresh token.
- Compras BNPL.
- Crédito.
- Cuotas.
- Pagos.
- MDR.
- Cobranza.
- Scoring automático.
- Cambios de estado operativos no definidos.

Estas exclusiones son intencionales para respetar SYSTEM INFO, pendientes de política y la regla de no inventar entidades ni decisiones de negocio.
