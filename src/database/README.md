# Database

Esta carpeta contiene infraestructura de base de datos para la primera fase del Proyecto Atlas.

## Contenido

- `sequelize.ts`: crea una instancia de Sequelize para migraciones y seeders.
- `sequelize.module.ts`: módulo NestJS mínimo para registrar Sequelize sin modelos de dominio.
- `migrate.ts`: ejecutor de migraciones con Umzug.
- `seed.ts`: ejecutor de seeders con Umzug.
- `migrations/`: migraciones versionadas en TypeScript.
- `seeders/`: datos mínimos de desarrollo en TypeScript.

## Comandos de migraciones

Crear una migración:

```bash
npm run db:migration:create -- create-atlas-user-intelligence-fraud-schema-v5-2-1
```

Ejecutar migraciones:

```bash
npm run db:migration:up
```

Revertir la última migración:

```bash
npm run db:migration:down
```

Ver estado:

```bash
npm run db:migration:status
```

## Comandos de seeders

Crear un seeder:

```bash
npm run db:seed:create -- seed-minimal-dev-credentials
```

Ejecutar seeds:

```bash
npm run db:seed:up
```

Revertir el último seed:

```bash
npm run db:seed:down
```

Ver estado:

```bash
npm run db:seed:status
```

## Regla de producción

No se usa `sequelize.sync({ force: true })` ni `sequelize.sync({ alter: true })`. Todo cambio estructural debe pasar por migraciones reversibles.

## Qué no va aquí

No colocar controllers, services de negocio, repositories de dominio, endpoints ni lógica de scoring en esta fase.
