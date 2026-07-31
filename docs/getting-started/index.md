# Empezar

Todo lo necesario para pasar de un repositorio recién clonado a un backend que responde.

## Prerrequisitos

| Herramienta | Versión | Por qué esa |
|---|---|---|
| Node.js | ≥ 22 (`.nvmrc` fija 22.16.0) | Es la que usan CI y la imagen de producción. Divergir aquí produce fallos que sólo aparecen al desplegar |
| Yarn | 1.22.22 (`packageManager`) | El lockfile es de Yarn 1; otro gestor lo reescribiría |
| Docker | ≥ 24 con Compose v2 | PostgreSQL, Redis y el stack completo |
| PostgreSQL | 16 | Igual que CI y que el compose |
| Redis | 7 | Rate limiting, elección de líder de los jobs y caché |

MongoDB 7 es **opcional**: sólo alimenta el visor de logs. Sin `MONGO_DB_URL_CONNECTION`, la
sincronización queda apagada sin romper nada.

## Rutas

- [Configuración local](local-setup.md) — levantar y verificar.
- [Variables de entorno](../config/environment.md) — las 148 variables tipadas.
- [Validación en Windows](../testing/validacion-local-windows.md) — evidencia de un ciclo completo.

## Verificación mínima

Antes de dar por bueno el entorno:

```bash
yarn type-check && yarn lint && yarn test:unit
```

Si los tres pasan, el entorno está bien. Si alguno falla, el problema es del entorno y no del
código: los tres están en verde en `main`.
