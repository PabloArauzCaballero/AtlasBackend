# Smoke tests manuales — API Fase 1

## 1. Preparar base

```bash
cp .env.example .env
npm install
npm run db:migration:up
npm run db:seed:up
npm run start:dev
```

## 2. Generar token cliente

```bash
CUSTOMER_TOKEN=$(npm run --silent dev:jwt -- --role=customer --tenant-id=1 --customer-id=1)
```

## 3. Registro público de cliente

```bash
curl -X POST http://localhost:3000/api/v1/customers/register \
  -H 'Content-Type: application/json' \
  -H 'x-tenant-id: 1' \
  -d '{
    "phone": "+59170000000",
    "email": "cliente.demo@atlas.bo",
    "firstName": "Cliente",
    "lastName": "Demo",
    "preferredLanguage": "es",
    "marketingOptIn": false
  }'
```

## 4. Consultar resumen protegido

```bash
curl http://localhost:3000/api/v1/customers/1/summary \
  -H 'x-tenant-id: 1' \
  -H "Authorization: Bearer $CUSTOMER_TOKEN"
```

## 5. Registrar sesión

```bash
curl -X POST http://localhost:3000/api/v1/customers/1/sessions \
  -H 'Content-Type: application/json' \
  -H 'x-tenant-id: 1' \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -d '{
    "deviceFingerprintHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "fingerprintVersion": "v1",
    "channel": "mobile_app",
    "authMethod": "jwt"
  }'
```

## 6. Token interno para operaciones

```bash
ADMIN_TOKEN=$(npm run --silent dev:jwt -- --role=admin --tenant-id=1 --internal-user-id=1)
```

```bash
curl http://localhost:3000/api/v1/operations/manual-review-cases?page=1\&limit=20 \
  -H 'x-tenant-id: 1' \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```
