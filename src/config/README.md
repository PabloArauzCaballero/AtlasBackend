# Configuración

Esta carpeta centraliza la lectura y validación de variables de entorno.

## Archivos

- `env.ts`: valida variables con Zod antes de usarlas.
- `database.config.ts`: arma la configuración de Sequelize para PostgreSQL.

## Regla importante

No se deben guardar secretos reales en el repositorio. Usa `.env` local y toma como base `.env.example`.
