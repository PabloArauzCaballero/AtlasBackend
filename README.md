# Proyecto Atlas — ORM de migraciones y seeds mínimos

Este ZIP contiene la primera fase técnica del backend: infraestructura de migraciones para PostgreSQL usando Sequelize, TypeScript y Umzug dentro de un proyecto NestJS mínimo.

También incluye un seeder mínimo de desarrollo para probar la estructura base de usuario, identidad, dispositivo, sesión, consentimiento, riesgo, revisión manual y fraude.

## Instalar dependencias

```bash
npm install
```

## Configurar entorno

```bash
cp .env.example .env
```

Ajusta los valores de conexión a PostgreSQL en `.env`.

## Crear una migración

```bash
npm run db:migration:create -- create-atlas-user-intelligence-fraud-schema-v5-2-1
```

## Ejecutar migraciones

```bash
npm run db:migration:up
```

## Revertir última migración

```bash
npm run db:migration:down
```

## Ver estado de migraciones

```bash
npm run db:migration:status
```

## Crear un seeder

```bash
npm run db:seed:create -- seed-minimal-dev-credentials
```

## Ejecutar seeds mínimos

```bash
npm run db:seed:up
```

## Revertir último seed

```bash
npm run db:seed:down
```

## Ver estado de seeds

```bash
npm run db:seed:status
```

## Orden recomendado para probar localmente

```bash
npm install
cp .env.example .env
npm run db:migration:up
npm run db:seed:up
npm run db:seed:status
```

## Credenciales demo reservadas

Las credenciales están documentadas en `docs/database/dev-credentials.md`.

Importante: esta fase todavía no implementa Auth/JWT ni una tabla de contraseña. Por eso las contraseñas son valores reservados para pruebas futuras, no secretos persistidos en base de datos.

## Alcance

Incluye ORM/migrations y seeds mínimos de desarrollo. No incluye controllers, services, endpoints, auth, scoring ejecutable, crédito, préstamos, cuotas, pagos, MDR, cobranza ni límites de crédito.
